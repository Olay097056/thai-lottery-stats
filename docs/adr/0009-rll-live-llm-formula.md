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

**The formula is a six-arm contextual bandit, and the LLM is the policy that maps an arm to five tickets.**

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
| draws for 80 % power, +100 % / +50 % / +25 % lift (simulated, 1,200 reps) | 120 / 480 / 960 |
| expected payout hits, 761 draws × 5 candidates | 0.004 |
| live calls made while verifying | 4 (all HTTP 200, 17.4–23.9 s) |
| stored-record audit | `response_raw` 5,321 B, sha256 matches `response_sha256` |
| tests | 11 Python protocol tests, 14 JS contract checks, suites at baseline |
| measured outcome so far | 0 hits, 0.000 … expected — **no evidence**, permanently ทดลอง |

The honest reading: this ships a working, auditable learning loop whose correct answer on an i.i.d. draw is
"no arm is better", and the app says exactly that instead of implying an edge.
