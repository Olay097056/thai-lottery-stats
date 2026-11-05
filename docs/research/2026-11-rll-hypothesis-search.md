# Offline hypothesis search — RLL · 2026-11

**TL;DR (ไทย)** — ให้ LLM คิดสมมติฐาน 587 ข้อในสามรุ่นของ protocol (ต่อหลัก → joint/sum/exclude →
shape/structure/lagged-markov) แล้ววัด walk-forward บนเป้าที่วัดได้ (3 หลักท้ายของ pool รางวัล 1-4)
ด้วย gate 60/20/20: **ไม่มีข้อไหนผ่านทั้งสามรุ่น** ตัวที่ดีที่สุดยังเป็นตัวเดิม z = +3.00 และ permutation
control 200 รอบให้ **p = 0.567** — ต่ำกว่ามัธยฐานของการสุ่มเสียอีก · ข้อสรุปที่หนักแน่นขึ้นเรื่อย ๆ:
**เป้านี้ไม่มีสัญญาณให้พบ และการเพิ่มสมมติฐาน/โทเคนไม่เปลี่ยนข้อสรุป**

Status: complete · 2026-11-03/04 · `scripts/rll_hypothesis_search.py` (protocol `hs-v3`),
`scripts/generate_rll_hypotheses.py`

---

## 1. Why this experiment exists

RLL predicts exact prize 1 with five tickets: 761 historical draws expect **0.004 hits**, so no amount of
inference can separate skill from luck there (ADR-0009). The owner asked for the third option — spend the LLM
budget **offline** searching a hypothesis space, freeze whatever survives — on the condition that a
**measurable field** decides. This is that run, three times, each time widening the operator family.

## 2. Field and data

| item | value |
| :--- | :--- |
| field | last 3 digits of the prize 1-4 pool of the target draw |
| chance per candidate | ~62 distinct tails / 1000 |
| chance per draw (10 candidates) | **48.3 %** |
| all draws in the cache | 761 (1995-01-16 → 2026-11-01) |
| usable draws | **464** (2006-12-30 → 2026-11-01) |

Before the Sanook era a draw carries only `prize1`, so its "pool" is a single number and the field has one
tail instead of ~62. `Corpus.usable` keeps draws with ≥ 55 distinct tails and the split is computed *inside*
that set.

## 3. Hypothesis space — data, never code

A hypothesis is JSON, scored over all 1000 possible tails; the top k are the tickets.

```json
{"name": "...", "k": 10,
 "positions": [[{"op":"freq","source":"pool","window":60,"weight":1.0}], [], []],
 "joints":    [{"op":"pair01","source":"pool","window":60,"weight":-0.8}],
 "shapes":    [{"op":"pairsum12","source":"prize1","window":30,"weight":0.7}],
 "sums":      [{"source":"prize1","window":120,"weight":0.5}],
 "structs":   [{"name":"even","weight":0.4}],
 "exclude":   [{"draws":2,"weight":-0.6}]}
```

| kind | what it adds | added in |
| :--- | :--- | :--- |
| `positions[p]` | `w × feature(digit at p)` — freq / gap / markov / weekday | v1 |
| `joints` | `w × P(exact digit pair)` — 100 cells | v2 |
| `sums` | `w × P(a+b+c)` | v2 |
| `exclude` | `w` on tails seen in the last 1-5 draws' pool | v2 (1-3), v3 (5) |
| `shapes` | `w × P(a+b)`, `P((b-a) mod 10)`, `P((a+b+c) mod 10)` — 19/10/10 cells | v3 |
| `structs` | `w × (pairwise-equal digits, ascending, even count)` — no history | v3 |
| `markov2` / `markov3` | `P(digit at p in t \| digit at p in t-2 or t-3)` | v3 |

v1 assembled candidates by ranking each position separately and weaving (round-robin). v2 and v3
**enumerate all 1000 triples**, because a joint term makes the positions inseparable. The assembler is part
of the protocol, so scores are only comparable inside one protocol.

Two properties matter more than expressiveness:

1. **No code execution.** The model cannot import, loop, read files or reach the network, because it never
   writes code. The DSL is the sandbox.
2. **No peeking.** Features are built from `rows[:index]`; a test pins it, and `--selftest` shows a
   target-reading rule would score 100 % instead of 48 %.

## 4. Protocol

| stage | draws | dates | rule |
| :--- | :--- | :--- | :--- |
| train | 206 | 2012-04-16 → 2021-02-01 | screen at z ≥ 3.5 (provisional — see §7) |
| validation | 69 | 2021-02-16 → 2023-12-16 | confirm at **z ≥ 2.0** |
| holdout | 69 | 2023-12-30 → 2026-11-01 | evaluated **once**, never used to select |

z is one-sided against the *per-draw* chance baseline (pool sizes vary), never a fixed average.

## 5. Generation

`deepseek/deepseek-v4.1-flash` via CommandCode, temperature 0.9, 40 requested per round:

| run | operator family | rounds | returned | unique kept | tokens |
| :--- | :--- | ---: | ---: | ---: | ---: |
| v1 | per-position | 3 | 120 | 152 | 38,363 |
| v2 | + joint, sum, exclude | 6 | 240 | 216 | 53,999 |
| v3 | + shape, structure, lag | 6 | 240 | 219 | 59,820 |
| **merged** | | **15** | 600 | **587** | **152,182** |

Three generation bugs were found and fixed, each now pinned by a test:

- **Truncated JSON** at `max_tokens` 8 000 lost a whole round → brace-scanner salvage parser.
- **A validator that demanded three `positions` lists** dropped 20 pure-exclusion hypotheses, which
  legitimately have none.
- **`markov2`/`markov3` were stripped silently** by the validator's operator allowlist, so the entire "lag"
  round produced hypotheses without their lag term. Caught by a per-family z breakdown, fixed, regenerated.

## 6. Results

| run | hypotheses | max z | rate at max | passed screen | confirmed |
| :--- | ---: | ---: | ---: | ---: | ---: |
| hs-v1 | 152 | +2.45 | 56.8 % | 0 | 0 |
| hs-v2 | 368 | +3.00 | 58.7 % | 0 | 0 |
| **hs-v3** | **587** | **+3.00** | 58.7 % | **0** | **0** |

**The winner never changed.** Adding 219 hypotheses in v3 did not produce a single better candidate than the
v2 leader `gap120-sum-prize1-120-excl2` — the strongest evidence yet that the leader is noise, not signal.

Best z per family (train window, 206 draws; chance 48.3 %):

| family | n | best z | leader |
| :--- | ---: | ---: | :--- |
| pos + exclude + sum | 3 | **+3.00** | `gap120-sum-prize1-120-excl2` |
| shape + structure | 28 | +2.45 | `even-summod-pool30-neg` |
| joint (exact pairs) | 38 | +2.17 | `pair01-hot-prize1-30` |
| shape alone | 57 | +2.17 | `prize1-summod-cold120-negative` |
| joint + shape | 21 | +2.17 | `prize1-pairsum01-hot30-joint-pair12` |
| pos + sum | 56 | +2.03 | `sum-pool60-plus2-gap-pool60-pos2-minus2` |
| pos + structure + lag | 6 | +2.03 | `ascending-markov2-prize1-120-all` |
| positions alone | 152 | +1.89 | `hot60-prize1-all` |
| structure alone | 22 | +0.36 | `ascending-plus-even` |
| exclude alone | 4 | −0.20 | `pure-exclude-last2` |

All 46 hypotheses that carry a lag term peak at +2.03. Pure structure is the weakest family by far (+0.36) —
what a shape-only rule should look like when there is nothing to learn.

The v3 z distribution over all 587: **mean −0.17, sd 0.94, min −2.71, max +3.00** — the shape of 587 draws
from a null with a slight negative drift, which is what stacking many correlated weak features produces.

## 7. Randomisation control — and the bug it caught in itself

The control keeps the features and shuffles the **target outcomes** within the usable era, 200 times, then
reports the distribution of the best z across all hypotheses.

| run | hypotheses | null p50 | p95 | max | observed | p | nulls ≥ 3.5 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v1 set | 152 | +2.46 | +3.43 | +4.53 | +1.89 | **0.94** | 7/200 |
| v2 set | 368 | +3.00 | +3.85 | +4.69 | +3.00 | **0.468** | 28/200 |
| v3 set | 587 | **+3.14** | **+3.99** | +4.69 | +3.00 | **0.567** | 36/200 |

Three things this exposed:

1. **The first v1 control (p = 0.219) was wrong** and is superseded. It permuted outcomes across all 761
   draws, so pool-era targets received the one-tail sets of 1995-2006 and every z collapsed to about −3. The
   corrected control permutes within the usable era; `--selftest` now asserts the null is centred (`+0.06`).
2. **The gate must be calibrated, not assumed.** At 587 hypotheses, z ≥ 3.5 fires on **18 %** of pure-noise
   sweeps (36/200). The honest threshold is the null's 95th percentile: **z ≥ 4.0**.
3. **The winner is below the median of the null.** Observed +3.00 against a null median of +3.14, p = 0.567.

## 8. What this does and does not prove

**Does:** across three protocol generations and 587 hypotheses covering per-position frequency, gap, markov
(1-3 lags), weekday, exact pairs, pair sums, pair differences, digit sums, structure and exclusion, nothing
beats chance by more than noise, and the machinery that says so is calibrated against a permutation null it
also passes. The leader did not improve when the family grew threefold — the signature of a noise winner.

**Does not:** forbid a rule outside the family. The space is large but still hand-made: no multi-draw patterns
beyond three lags, no arithmetic across neighbouring numbers, no per-number structure inside a single prize.
It also cannot exclude an effect below the detection floor: at n = 206 the honest gate of z = 4.0 requires
**+13.9 pp (+29 % relative)** to be visible. Anything smaller is invisible here, whatever the mechanism.

## 9. Reproduce

```bash
python scripts/rll_hypothesis_search.py --selftest
python scripts/generate_rll_hypotheses.py --out .scratch/rll-llm-formula/hypotheses-v3.json
python scripts/rll_hypothesis_search.py --hypotheses .scratch/rll-llm-formula/hypotheses-all3.json \
    --null-shuffles 200 --json .scratch/rll-llm-formula/search-v3.json
python scripts/test_rll_hypothesis_search.py        # 21 tests, no network
```

The 587-hypothesis set is archived at `docs/research/rll-hypotheses-2026-11.json`, so the run reproduces
without the key or the model.

## 9b. Keeping the result fresh

The sweep is only as current as the data, so `scripts/rll_hypothesis_watch.py` re-runs the **frozen**
hypothesis set on the **same protocol** whenever a new draw lands:

```bash
python scripts/rll_hypothesis_watch.py                     # refuses when the data has not changed
python scripts/rll_hypothesis_watch.py --force --null-shuffles 200
```

- one JSONL record per run (`.scratch/rll-hypothesis-watch/log.jsonl`), so "run it again until it looks
  good" is visible in the log rather than hidden;
- the alert gate is the run's own null 95th percentile when `--null-shuffles` is used (3.99 today), else
  the frozen 4.0;
- exit code 2 means something cleared the gate — the only outcome that would justify promoting a hypothesis
  to a candidate formula, and it would need its own ADR;
- a repeat run on unchanged data prints `no new draw since …` and appends nothing.

Baseline recorded 2026-11-04: data as of 2026-11-01, 464 usable draws, best z +3.00, gate 3.99, p 0.567.

## 10. What would change the answer

1. **A field with more information per draw** — tail3 already hits 48 % of the time; the limit is n = 206
   train draws, and only time fixes that (+24/year).
2. **An operator family built by someone else** — every family here was designed in one afternoon by one
   model. A different generative process (per-number features, multi-draw motifs) is the only remaining
   lever inside this dataset.
3. **Not more tokens.** All three generations cost **152 k tokens** for 587 hypotheses; 100× that buys
   ~60 000 hypotheses that the same gate rejects, because the binding constraint is the number of draws.
