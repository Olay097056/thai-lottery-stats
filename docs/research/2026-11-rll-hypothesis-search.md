# Offline hypothesis search — RLL · 2026-11

**TL;DR (ไทย)** — ให้ LLM คิดสมมติฐานการทายเลข 152 ข้อในรูปแบบ data spec แล้ววัดแบบ walk-forward
บนเป้าที่วัดได้ (3 หลักท้ายของ pool รางวัล 1-4) ด้วย gate 60/20/20: **ไม่มีข้อไหนผ่าน**
ตัวที่ดีที่สุด z = +2.45 แต่ permutation control 200 รอบให้ p = 0.219 — คือผลที่ "ดีที่สุด" นี้ธรรมดากว่าการสุ่ม
78 % ของรอบ สรุปตามหลักฐาน: ในพื้นที่สมมติฐานขนาดนี้ ไม่มีอะไรเหนือความบังเอิญ และนี่คือคำตอบ ไม่ใช่ความล้มเหลว

Status: complete · 2026-11-03 · scripts `rll_hypothesis_search.py`, `generate_rll_hypotheses.py`

---

## 1. Why this experiment exists

The RLL formula predicts exact prize 1 with five tickets: 761 historical draws expect **0.004 hits**, so no
amount of inference can separate skill from luck there (ADR-0009, and the power table in
`.scratch/rll-llm-formula/`). The owner asked for the *third* option: spend the full LLM budget offline to
search a hypothesis space, then freeze whatever survives — on the one condition that a **measurable field**
decides. This document is that run.

## 2. Field and data

| item | value |
| :--- | :--- |
| field | last 3 digits of the prize 1-4 pool of the target draw |
| chance per candidate | ~62 distinct tails / 1000 |
| chance per draw (10 candidates) | **48.3 %** |
| all draws in the cache | 761 (1995-01-16 → 2026-11-01) |
| usable draws | **464** (2006-12-30 → 2026-11-01) |

Why only 464: before the Sanook era a draw carries only `prize1`, so its "pool" is a single number and the
field has one tail instead of ~62. Scoring those draws would compare a 1-tail target with a 62-tail target.
`Corpus.usable` keeps draws with ≥ 55 distinct tails; the split is computed *inside* that set.

## 3. Hypothesis space — data, never code

A hypothesis is a JSON spec:

```json
{"name": "hot60-all", "k": 10,
 "positions": [[{"op":"freq","source":"pool","window":60,"weight":1.0}], [], []]}
```

`score(digit, position) = Σ weight × feature`, the top digits are assembled round-robin into 10 distinct
three-digit candidates. Operators are owned by the harness: `freq` (digit frequency in that tail position),
`gap` (draws since the digit last appeared there), `markov` (P(digit | previous draw's digit)), `weekday`
(frequency restricted to the target's weekday). Sources are `pool` (all 66 prize 1-4 numbers of a draw) and
`prize1` (the first prize only); windows are 30 / 60 / 120.

Two properties matter more than expressiveness:

1. **No code execution.** The model cannot import, loop, read files or reach the network, because it does not
   write code at all. The DSL is the sandbox.
2. **No peeking.** Features are built from `rows[:index]` — the target row is not in the history slice, and
   `test_features_never_change_when_the_target_row_is_in_the_corpus` pins that.

## 4. Protocol

| stage | draws | dates | rule |
| :--- | :--- | :--- | :--- |
| train | 206 | 2012-04-16 → 2021-02-01 | screen at **z ≥ 3.5** |
| validation | 69 | 2021-02-16 → 2023-12-16 | confirm at **z ≥ 2.0** |
| holdout | 69 | 2023-12-30 → 2026-11-01 | evaluated **once**, never used to select |

z is a one-sided two-proportion score against the *per-draw* chance baseline (the pool size varies slightly
by draw, so the baseline is averaged, not assumed).

Why z ≥ 3.5 and not 1.96: with 152 hypotheses the family-wise error at 1.96 would be ~7 false winners.
At 3.5 the expected count under pure noise is **152 × 2.33e-4 = 0.035**. The threshold is deliberately
harsher than a single-test α because a sweep is not a single test.

## 5. Generation

Model `deepseek/deepseek-v4.1-flash` via the CommandCode gateway, temperature 0.9, three rounds of 40 with
different instructions (single-feature purists, blends, contrarian/negative weights). 120 returned, 112
unique-new, merged with an earlier 40 → **152 hypotheses**, 115 of which produce genuinely different candidate
sets. Generation cost **38,363 tokens** total (≈ 0.3 THB at any sane price) — the token budget was never the
constraint.

Validation dropped nothing in the final set: unknown operators and zero-weight terms are stripped, and a
hypothesis with no surviving term is discarded (`test_validate_drops_unknown_operators_and_zero_weights`).

## 6. Results

```
hypotheses screened        152
passed screen (z >= 3.5)     0
confirmed (validation)       0
holdout evaluations          0   (nothing reached it)
z distribution: mean +0.07, sd 0.88, min -2.15, max +2.45
```

Best ten on the train window (rate vs chance 0.4828, n = 206):

| hypothesis | z | hit rate |
| :--- | ---: | ---: |
| `contrarian-pool-weekday-freq-mix` | +2.45 | 56.8 % |
| `asym-pool-markov30-prize1-markov120-pool-overdue120` | +2.31 | 56.3 % |
| `hot30-prize1-all` / `hot-prize1-freq-30-all` / `cold-freq120-prize1-allpos` | +1.89 | 54.9 % |
| `hot120-pool-all` family (3 near-duplicates) | +1.61 | 53.9 % |

The last two rows are the shape of the problem: several "different" hypotheses collapse onto the same
candidate set, so the effective number of independent tests is ~115, not 152.

## 7. Randomisation control — the part that makes the null readable

A sweep that finds nothing is only convincing if the machinery would have found something. The control keeps
the features and **shuffles the target outcomes** across draws, then reruns the whole 152-hypothesis screen,
200 times:

```
null max-z:  p50 +2.13 · p95 +2.85 · max +3.53
observed:    +2.45
p = 0.219
```

So a pure-noise world produces a best-z of +2.45 or higher **22 % of the time**. The winner is ordinary.

The gate is calibrated too, and the control says so precisely: **1 of 200 shuffles reached z ≥ 3.5** (max
+3.53), i.e. a false-positive rate of 0.5 % per sweep — below the 3.5 % a naive independent-tests calculation
would predict (152 × 2.33e-4), because the hypotheses are correlated and roughly 115 of them behave
differently. The observed data did not reach that bar at all (2.45 vs 3.5).

A second, cheaper control is built into the harness: a zero-weight hypothesis must score at chance. On the
464-draw era it returns 51.2 % against a 48.4 % baseline (z = +0.73), and a hypothesis that reads the target
scores 100 % — proving the metric would see a leak if one existed.

## 8. What this does and does not prove

**Does:** within this operator family, on this field, nothing beats chance by more than the noise floor, and
the pipeline that says so is calibrated against a permutation null. The measurement ceiling argument is now
backed by an experiment rather than an assertion.

**Does not:** forbid a rule outside the family. The DSL has four operators; an idea that needs, say,
digit-sum buckets or cross-position constraints cannot be expressed here. It also cannot exclude an effect
smaller than the detection floor: with 206 train draws, even a real +12 pp (+25 % relative) lift would sit
right at the gate, and anything below that is invisible at this sample size. A null result at n = 206 is an
absence of *evidence*, not evidence of absence.

## 9. Reproduce

```bash
python scripts/rll_hypothesis_search.py --selftest
python scripts/generate_rll_hypotheses.py            # needs COMMANDCODE_API_KEY in .env
python scripts/rll_hypothesis_search.py --hypotheses .scratch/rll-llm-formula/hypotheses.json \
    --null-shuffles 200 --json .scratch/rll-llm-formula/search-152.json
python scripts/test_rll_hypothesis_search.py         # 10 tests, no network
```

The generated set is archived at `docs/research/rll-hypotheses-2026-11.json` so the run is reproducible
without the key or the model.

## 10. What would change the answer

1. **A wider operator family** (digit-sum, cross-position, moving averages, exclusion rules) — the honest
   next step, and it needs a new ADR because the DSL is a contract.
2. **A different field** with a higher chance rate than 48 % — tail3 is already close to the ceiling; the
   gain would be in *per-draw information*, not in hit frequency.
3. **More draws** — 464 usable draws is the hard limit of this dataset; every year adds 24.
4. **Not more tokens.** Generation cost 38 k tokens; 100× that would buy 15,200 hypotheses that the same
   gate would still reject, because the constraint is n = 206, not the size of the search.
