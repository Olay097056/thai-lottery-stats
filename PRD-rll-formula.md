# PRD — Reinforcement Learn LLM (RLL)

Status: implemented 2026-11-03 · governing ADR: [0009](docs/adr/0009-rll-live-llm-formula.md)

## Hypothesis

A small reinforcement-learning loop — a six-arm contextual bandit — can be made **real and auditable** on top
of a live LLM policy, and its honest outcome on an i.i.d. lottery is "no arm is better". The product value is
the loop's transparency, not an edge: every draw's prompt, model, response hash and reward sit in one stored
record that anyone can re-derive.

## Reward

`r = max` over the five candidates of matching digit positions (0–6), computed after the draw resolves.

- Exact null: mean **1.495846**, sd **0.717875**, pmf `[.042391, .502763, .378069, .070443, .006059, .00027,
  .000005]`.
- The payout hit is recorded separately (`rll_rewards.payout`) and is **never optimised**.
- The reward and the prize are different numbers with different labels; the UI must never present `r` as money.

## Loop

| element | value |
| :--- | :--- |
| arms | `digit-hot`, `digit-gap`, `pair-markov`, `pool-weighted`, `calendar`, `control-uniform` (null arm) |
| allocation | Thompson sampling, Gaussian posterior, known null σ, `n0 = 48` pseudo-draws per arm |
| update | only the played arm: `{n, sum_r}`; mean = `(n0·μ0 + sum_r)/(n0+n)` |
| allocation seed | `SHA-256(target_date + protocol)` — the arm choice is reproducible even though the model output is not |
| guardrails | no arm retirement before 40 own draws; σ fixed at the null; frozen arm library (any change = `rll-v2`) |

## Call protocol (`rll-v1`)

1. Triggered lazily by `GET /api/rll/formula?date=`, never on page load.
2. Prompt: fixed line order — arm → history (strictly prior draws) → that arm's last 8 outcomes → no-reuse
   list → JSON contract. `prompt_sha256` is re-derivable from `history_sha256`.
3. Parse: exactly five distinct six-digit ASCII strings, none from the no-reuse list, `finish_reason != length`.
4. Failure: one retry on 429/5xx/timeout/parse; 401/403/400 are permanent; "no credential" is not stored;
   every other failure is stored as `unavailable` (so a draw cannot be retried into a better answer).
5. `INSERT OR IGNORE` on `(target_date, protocol)` — **no re-roll path exists**.
6. Endpoint always answers HTTP 200 with `ok` + `status`, so the Decision Center's failure guard never trips.

## Storage

`astra_runtime/rll.sqlite3` (production data, never wiped):

- `rll_forecasts(target_date, protocol, payload)` — full prompt, numbers, model, attempts, response hash.
- `rll_rewards(target_date, protocol, r, payout, matched, resolved_at)` — append-only.
- `rll_arms(protocol, arm_id, n, sum_r)` — the posterior.

## UI

- **สูตรคำนวณ → RLL** panel: a five-step card (arm → prompt hash + model → five numbers → reward vs chance →
  limits), the ทดลอง badge and a "ไม่มีหลักฐาน" chip.
- **Picks / เลขแนะนำ**: the row enters Picks at `edge = 0`, `weight = 1.0`, with the badge and the no-evidence
  marker. เลขแนะนำ cannot fire for RLL alone (it needs ≥2 groups on the same field, ADR-0001) and the UI says so.
- **Backtest**: one prospective-only row — "—" for rate and edge, `draws-since × 5/10⁶` expected hits.
- **Failure**: "งวดนี้ไม่มีเลข (โมเดลไม่ตอบ) — ไม่มีการเติมเลขสำรอง".

## Fixed copy

- "สูตรนี้เรียนจากจำนวนหลักที่ตรง ไม่ใช่เงินรางวัล — ค่าสุ่มคาดหวัง 1.496 ต่องวด"
- "ยังไม่มีหลักฐานว่าสูตรนี้ดีกว่าการสุ่ม · การเห็นผลต่าง +50% ต้องใช้ประมาณ 480 งวด (~20 ปี)"
- "ทุกใบมี EV เท่ากัน (ประมาณ −40% ต่อใบ) — สูตรไม่เปลี่ยน EV"

## Cost

≤ 2 provider calls per target ever (one + one retry), ~1.7–2.5 k tokens per call, 18–24 s observed. At 24
draws/year that is ≤ 48 calls/year. Per-call price at the gateway is unverified; tokens are the recorded unit.

## Non-goals

- No historical backtest (would need one paid call per past draw and could not reproduce past responses).
- No underground-betting numbers, no "เลขเด็ด" language, no implied edge.
- No `seed`-based reproducibility claim — the provider ignores it (verified).
- No automatic registration on navigation; the first read of a target registers it, and the UI states that.

## Acceptance (met)

- [x] `rll.py` implements `rll-v1`; `scripts/test_rll.py` 11/11 with an injected model call (no network).
- [x] `scripts/test_rll_frontend_contract.js` 14/14; suites at baseline (5 pre-existing JS failures).
- [x] A live call returns 200 with five numbers and a verifiable `response_sha256`.
- [x] A second read returns the stored record with `cached: true` and no model call.
- [x] The Picks row renders with the badge, the no-evidence marker and weight 1.0.
- [x] The backtest row shows "—" and a computed draws-since.
