# Offline hypothesis search — RLL · 2026-11

**TL;DR (ไทย)** — ให้ LLM คิดสมมติฐาน 368 ข้อ (สองรุ่นของ protocol: v1 ต่อหลัก, v2 เพิ่ม joint ระหว่างหลัก /
digit sum / exclusion) แล้ววัดแบบ walk-forward บนเป้าที่วัดได้ (3 หลักท้ายของ pool รางวัล 1-4) ด้วย gate 60/20/20:
**ไม่มีข้อไหนผ่านทั้งสองรุ่น** ตัวที่ดีที่สุด z = +3.00 และ permutation control 200 รอบให้ **p = 0.468** —
คืออยู่ที่ *มัธยฐานพอดี* ของการสุ่ม บทเรียนสำคัญที่ได้จาก v2: **gate ต้องมาจาก null ไม่ใช่ค่าคงที่** เพราะที่ 368
สมมติฐาน z ≥ 3.5 ถูกยิงโดยความบังเอิญถึง **14 % ของรอบ**

Status: complete · 2026-11-03/04 · `scripts/rll_hypothesis_search.py` (protocol `hs-v2`),
`scripts/generate_rll_hypotheses.py`

---

## 1. Why this experiment exists

RLL predicts exact prize 1 with five tickets: 761 historical draws expect **0.004 hits**, so no amount of
inference can separate skill from luck there (ADR-0009). The owner asked for the third option — spend the LLM
budget **offline** searching a hypothesis space, freeze whatever survives — on the condition that a
**measurable field** decides. This is that run, twice: first with per-position features (v1), then with the
wider family the owner asked for (v2).

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
 "sums":      [{"source":"prize1","window":120,"weight":0.5}],
 "exclude":   [{"draws":2,"weight":-0.6}]}
```

| kind | what it adds | why it exists |
| :--- | :--- | :--- |
| `positions[p]` | `w × feature(digit at position p)` — freq / gap / markov / weekday | the v1 family |
| `joints` | `w × P(digit pair)` for `pair01`, `pair02`, `pair12` | coupling between positions, which v1 could not express |
| `sums` | `w × P(a+b+c)` | gross shape of the tail, independent of order |
| `exclude` | `w` on tails that appeared in the last 1-3 draws' pool | the "ตัดเลขงวดก่อน" rule |

v1 assembled candidates by ranking each position separately and weaving (round-robin). v2 **enumerates all
1000 triples** because a joint term makes the positions inseparable; the assembler is part of the protocol,
so v1 and v2 scores are not comparable — that is why the same 152 hypotheses score differently below.

Two properties matter more than expressiveness:

1. **No code execution.** The model cannot import, loop, read files or reach the network, because it never
   writes code. The DSL is the sandbox.
2. **No peeking.** Features are built from `rows[:index]`; `test_features_never_change_when_the_target_row_is_in_the_corpus`
   pins it, and the leak probe in `--selftest` shows a target-reading rule would score 100 % (not 48 %).

## 4. Protocol

| stage | draws | dates | rule |
| :--- | :--- | :--- | :--- |
| train | 206 | 2012-04-16 → 2021-02-01 | screen at **z ≥ 3.5** (see §7 for why this is too loose) |
| validation | 69 | 2021-02-16 → 2023-12-16 | confirm at **z ≥ 2.0** |
| holdout | 69 | 2023-12-30 → 2026-11-01 | evaluated **once**, never used to select |

z is one-sided against the *per-draw* chance baseline (pool sizes vary), never a fixed average.

## 5. Generation

`deepseek/deepseek-v4.1-flash` via CommandCode, temperature 0.9, 40 per round:

| run | rounds | returned | valid | unique | tokens |
| :--- | :--- | ---: | ---: | ---: | ---: |
| v1 (per-position) | 3 | 120 | 120 | 152 (with a first 40) | 38,363 |
| v2 (joint / sum / exclude) | 6 | 240 | 220 | 216 | 53,999 |
| **merged** | | | | **368** | **92,362** |

v2 families: 80 joint, 80 sum, 56 exclude. One round was lost entirely at `max_tokens` 8 000 (truncated
JSON) which is why the generator has a brace-scanner salvage parser; a second round lost 20 hypotheses to a
validator bug that demanded three `positions` lists even when a hypothesis only had joint/sum/exclude terms
(a pure-exclusion rule legitimately has none). Both are fixed and covered by tests.

## 6. Results

| run | hypotheses | max z | hit rate at max | passed screen | confirmed |
| :--- | ---: | ---: | ---: | ---: | ---: |
| hs-v1 (round-robin assembler) | 152 | +2.45 | 56.8 % | 0 | 0 |
| hs-v2 (global top-k, wider family) | 368 | **+3.00** | 58.7 % | 0 | 0 |

The v2 z distribution is **mean −0.17, sd 0.96, min −2.71, max +3.00** — the shape of 368 draws from a
null. Top five:

| hypothesis | z | rate |
| :--- | ---: | ---: |
| `gap120-sum-prize1-120-excl2` | +3.00 | 58.7 % |
| `pair01-hot-prize1-30` | +2.17 | 55.8 % |
| `sum-pool60-plus2-gap-pool60-pos2-minus2` | +2.03 | 55.3 % |
| `pair01-pair12-hot-pool60` | +1.89 | 54.9 % |
| `sum60-gap60-p0-pos` | +1.89 | 54.9 % |

Note that 4 of the top 10 sit at exactly +1.89 with the same rate: different specs collapse onto the same
candidate set, so the effective number of independent tests is far below 368.

## 7. Randomisation control — and the bug it caught in itself

The control keeps the features and shuffles the **target outcomes** across draws, 200 times, then reports
the distribution of the best z over all hypotheses.

| run | null max-z p50 | p95 | max | observed | p | nulls ≥ 3.5 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| v1 set, 152 | +2.46 | +3.43 | +4.53 | +1.89 | **0.94** | 7/200 |
| v2 set, 368 | **+3.00** | +3.85 | +4.69 | +3.00 | **0.468** | **28/200** |

Three things this exposed:

1. **The first v1 control (p = 0.219) was wrong** and is superseded. It permuted outcomes across all 761
   draws, so pool-era targets received the one-tail sets of 1995-2006; every z collapsed to about −3. The
   corrected control permutes **within the usable era**, and `--selftest` now asserts the null is centred
   (it prints `+0.06`).
2. **The gate has to be calibrated, not assumed.** At 368 hypotheses, z ≥ 3.5 fires on **14 %** of pure-noise
   sweeps (28/200), not the 8.6 % a naive independent-tests calculation predicts. The honest threshold for
   this family is the null's 95th percentile, **z ≥ 3.9**.
3. **The winner is the median of the null.** Observed +3.0045 against a null median of +3.00, p = 0.468. Not
   "close to significant" — exactly typical.

## 8. What this does and does not prove

**Does:** across two protocol generations and 368 hypotheses (per-position, joint, digit-sum, exclusion),
nothing beats chance by more than noise, and the machinery that says so is calibrated against a permutation
null that it also passes.

**Does not:** forbid a rule outside the family. Four per-position operators, three joint tables, one sum
term and one exclusion mask is still a small space; a rule needing arithmetic on neighbours, multi-draw
patterns beyond N=3, or digit-level constraints inside a single number cannot be expressed. It also cannot
exclude an effect below the detection floor: at n = 206 even a real **+12 pp (+25 % relative)** lift would
sit right at z = 3.5, and the honest gate of 3.9 pushes that floor to about **+13 pp**.

## 9. Reproduce

```bash
python scripts/rll_hypothesis_search.py --selftest
python scripts/generate_rll_hypotheses.py --out .scratch/rll-llm-formula/hypotheses-v2.json
python scripts/rll_hypothesis_search.py --hypotheses .scratch/rll-llm-formula/hypotheses-all.json \
    --null-shuffles 200 --json .scratch/rll-llm-formula/search-v2.json
python scripts/test_rll_hypothesis_search.py        # 15 tests, no network
```

The 368-hypothesis set is archived at `docs/research/rll-hypotheses-2026-11.json`, so the run reproduces
without the key or the model.

## 10. What would change the answer

1. **A wider family still** — per-position hashing, multi-draw patterns (N > 3), arithmetic on neighbouring
   digits. Each needs a new protocol version because the DSL is a contract.
2. **A field with more draws or a denser signal** — tail3 sits at 48 % per draw, close to the ceiling; the
   limit is n = 206 train draws, which only time fixes (+24/year).
3. **Not more tokens.** All 368 hypotheses cost **92 k tokens**; 100× that would buy 36 800 hypotheses that
   the same gate rejects, because the binding constraint is the number of draws, not the size of the search.
