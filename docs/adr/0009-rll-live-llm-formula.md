# ADR-0009 — RLL: a six-arm bandit whose policy is a live LLM call

Status: accepted · 2026-11-03 · implemented 2026-11-03

## Context

Every formula in this app is deterministic and offline: it reads `lottery_cache.csv` and returns numbers.
None of them calls a network model, and none of them can be validated on exact prize 1 — five candidates over
761 historical draws expect **0.004** hits, so a promotion gate there could never distinguish skill from luck.

The owner asked for a formula named **Reinforcement Learn LLM** that uses a live LLM on every draw and
participates in Picks, and supplied a CommandCode credential plus the model id
`deepseek/deepseek-v4.1-flash`. The repo is public, so no key may ever be committed, and ADR-0003 /
ADR-0007 / ADR-0006 still govern badges, prospective evidence and frontend ownership.

## Decision

**The formula is a six-arm multi-armed bandit — the allocation sees no per-draw features, so it is not a
contextual bandit — and the LLM is the policy that maps an arm to five tickets.**

- **Reward** `r = max` over the five candidates of the number of matching digit positions (0–6). It is *not*
  the payout. Under uniform draws the null is exact: pmf `[0.042391, 0.502763, 0.378069, 0.070443, 0.006059,
  0.00027, 0.000005]`, **mean 1.495846, sd 0.717875**, median 1, 5–95 % band 1–3.
- **Arms** are six frozen prompt strategies (`digit-hot`, `digit-gap`, `pair-markov`, `pool-weighted`,
  `calendar`, `control-uniform`). Thompson sampling over Gaussian posteriors with the *null* σ and
  `n0 = 48` pseudo-draws per arm; only the played arm is updated, with `{n, sum_r}` stored.
- **One call per draw**, chosen lazily on the first read of `GET /api/rll/formula?date=`. The prompt is built
  server-side in a fixed line order (arm → history slice → the arm's own last 8 outcomes → a no-reuse list →
  the JSON contract), so `prompt_sha256` is re-derivable from the pinned `history_sha256`.
- **Immutability**: `INSERT OR IGNORE` on `(target_date, protocol)`. No re-roll endpoint, no regenerate
  button. A failure other than "no credential" is stored as `unavailable` so the draw cannot be retried into
  a nicer answer; the provider ignores `seed`, which makes the stored response the only reproducibility.
- **Participation**: an explicit allowlist keyed on `fr.group === 'RLL'` lets the row past the Picks
  `edge > 0` gate at `edge = 0` / `weight = 1.0`, always with the ทดลอง badge and a "ไม่มีหลักฐาน" marker.
- **Evidence is prospective only.** No historical backtest exists, because it would require one paid call per
  past draw and could never reproduce the original responses. The Backtest table shows one row with "—" for
  rate and edge plus `draws-since × 5/10⁶` expected hits.

### Considered and rejected

- **A frozen offline artifact** (LLM designs a policy once, runtime is deterministic): rejected by the owner,
  who wanted live calls and accepted the reproducibility cost.
- **A payout-only reward**: rejected because it is observed 0.004 times in the whole history — the posterior
  would never move, and the "learning" claim would be unfalsifiable.
- **Hard diversity (pairwise Hamming ≥ 3)**: kept as prompt guidance only. Enforcing it as a parse rule
  changes the null distribution of the reward, so it would need its own recomputation before it can be a gate.
- **Targeting a measurable field** (pool-1-4 tail-3, bottom2): the power table shows those are the only fields
  where an edge is detectable at all, but the owner chose exact prize 1 and the shaped reward is what makes it
  measurable-ish.

## Consequences

- The formula can never demonstrate a payout edge: a +100 % payout edge needs **1,569,768 draws ≈ 65,407
  years**. Even its shaped reward needs 480 draws (~20 years) to show a +50 % lift.
- Every draw costs one provider call (~1.7–2.5 k tokens, 18–24 s observed) and the record is permanent.
- `astra_runtime/rll.sqlite3` is production data, not a cache: never wipe it to "fix" a bad record.
- The app must be restarted after a code change to serve `/api/rll/*`; a stale process returns 404.

## Result

| measure | value |
| :--- | ---: |
| chance mean / sd of the reward | 1.495846 / 0.717875 |
| expected payout hits, 761 draws × 5 candidates | 0.004 |
| live calls made while verifying | 4 (all HTTP 200, 17.4–23.9 s) |
| stored-record audit | `response_raw` 5,321 B, sha256 matches `response_sha256` |
| measured outcome so far | 0 hits, 0.000 … expected — **no evidence**, permanently ทดลอง |

The honest reading: this ships a working, auditable learning loop whose correct answer on an i.i.d. draw is
"no arm is better", and the app says exactly that instead of implying an edge.

## Amendment 2026-11-16 — the loop closes itself, and the ban list is one list

The Decision above says a reward enters through `POST /api/rll/resolve`. Nothing ever called it, so
`rll_rewards` and `rll_arms` stayed empty from ship date until this amendment and every arm sat at
`n = 0`: the "learning" half of the design had never run once. Two changes:

- **`rll.resolve_pending()`** scores every stored forecast whose draw has a first prize in the cache.
  A target with no result is reported `pending` and never guessed; a draw already scored returns
  `created=False`, so the sweep is idempotent on `(target_date, protocol)`. It is called from both
  cache-write paths — the automation's `on_cache_change` hook and `POST /api/refresh` — after the
  writer lock is released, with the exception swallowed so a broken sweep cannot break a cache
  update. `scripts/rll_resolve_pending.py [--dry-run] [--json]` is the manual path. The API endpoint
  remains; it is no longer the only way in.
- **`BANNED_LIMIT = 400` makes the printed and enforced no-reuse lists the same list.** `pool-weighted`
  collects ~1,328 numbers from eight draws while a prompt carries 400, so the other 928 were enforced
  but invisible: an answer reusing one was rejected, the retry was spent, and the draw was then stored
  as `unavailable` permanently. Measured after the fix, printed = enforced on every arm
  (60/60, 60/60, 60/60, 400/400, 40/40, 0/0).

Still true: the reward's ceiling is +5.26 % over 1.495846, so 480 draws cannot demonstrate a +50 %
lift — see the Correction below. Closing the loop makes the arms move; it does not make an i.i.d.
draw predictable.

## Correction 2026-11-16 — the reward's null is a property of the candidate layout

The 1.495846 figure above is the null for five **independent** tickets. The prompt asks for tickets that differ
in at least three positions and the model returns sets that differ in all six, which changes the null:

| candidate set | E[r] | sd | P(r=0) | payout chance |
| :--- | ---: | ---: | ---: | ---: |
| five independent tickets (the figure in this ADR) | 1.495846 | 0.717875 | 4.2391 % | 5/10⁶ |
| five tickets sharing a digit in every position | 0.600000 | 0.734847 | 53.1441 % | 5/10⁶ |
| **five tickets, no shared digit in any position (the ceiling)** | **1.574580** | 0.678880 | 1.5625 % | 5/10⁶ |

1.574580 is the maximum over any five-candidate set, computed by DP over per-candidate match counts
(6 positions × 7⁵ states) and confirmed bit-for-bit against an exhaustive 10⁶-target scan of the stored set.
Consequences that this ADR got wrong:

- **The reward is mostly layout, not prediction.** The whole attainable range is 0.600–1.5746 while the payout
  probability is fixed at 5/10⁶, so an arm can gain +5.26 % over the stated baseline with no predictive content
  at all. The card now computes and prints E[r] for the five numbers it actually returned.
- **The +25 / +50 / +100 % power rows above are unreachable.** Those lifts need r̄ = 1.87 / 2.24 / 2.99, all
  above the 1.5746 ceiling. The largest lift that exists is +5.26 %, and 80 % power for it needs ≈1,249 draws
  per arm (≈7,494 draws, ≈312 years at 24 draws/year; exact pmf, Welch t, bisected). Copy that quotes
  "480 draws for +50 %" is quoting a number that cannot occur.

Reading the loop honestly therefore means: it optimises a shaped reward whose ceiling is 5 % and whose signal is
dominated by ticket layout. That is a reason to keep it permanently ทดลอง, not a reason to promote it.
