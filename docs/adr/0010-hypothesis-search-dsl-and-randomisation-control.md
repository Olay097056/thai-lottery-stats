# ADR-0010 — Hypothesis search is a data DSL with a randomisation control

Status: accepted · 2026-11-03 · implemented 2026-11-03

## Context

ADR-0009 shipped RLL as a six-arm bandit on exact prize 1, where five tickets expect **0.004** hits over 761
draws. The owner then asked the obvious follow-up — is this the best that can be done, with an unlimited
token budget — and chose the third option: spend inference **offline** to search a hypothesis space and
freeze whatever survives, judged on a *measurable* field.

Four ways to do that are tempting and all four are wrong here:

1. Let the model write Python and execute it. Fast to build, arbitrary code execution on the owner's machine
   in a repo that already ships to a public remote.
2. Search on every draw and report the best. That is a fitted maximum, not a finding; the holdout stops
   existing the moment it is used for selection.
3. Report the top result of a 150-hypothesis sweep with a single-test threshold. 152 × 2.33e-4 already means
   ~3.5 % of pure-noise sweeps produce a "winner" at z = 3.5.
4. Skip the null. Without one, "nothing passed" and "the machinery is broken" look identical.

## Decision

**Hypotheses are JSON data over a fixed operator menu, the split is fixed, and every sweep ships with a
permutation control.**

1. **Data, never code.** A hypothesis is `{name, k, positions, joints, shapes, sums, structs, exclude}`
   with `term = {op, source, window, weight}`. The harness owns every operator: per-position `freq`, `gap`,
   `markov`, `markov2`, `markov3`, `weekday`; exact pairs `pair01/02/12`; coarse pair shapes `pairsum01/02/12`,
   `diff01/02/12`, `summod`; digit sums; within-tail structure `repeat/ascending/even`; and exclusion masks
   over the last 1-5 draws. Candidates are the top k of an enumeration over all 1000 tails, because a joint
   term makes the positions inseparable. Adding an operator changes the protocol and needs a new ADR;
   results are only comparable within one protocol.
2. **The field decides, and it must exist.** Target is the last three digits of the prize 1-4 pool on draws
   with ≥ 55 distinct tails (464 of 761, 2006-12-30 onward). Earlier draws carry a one-number pool and are
   excluded, not silently down-weighted.
3. **Fixed 60/20/20 split inside the usable set**, screen at z ≥ 3.5 on train (206 draws), confirm at
   z ≥ 2.0 on validation (69), evaluate the holdout (69) once and never use it to select. Thresholds are
   one-sided against a per-draw chance baseline, so varying pool sizes cannot flatter a hypothesis.
   **The screen threshold is provisional**: the authoritative gate is the 95th percentile of the run's own
   permutation null. A fixed z is a convention, not a calibration — at 368 hypotheses z ≥ 3.5 fires on
   14 % of pure-noise sweeps.
4. **Permutation control is mandatory** for any sweep that is reported: shuffle the target outcomes 200
   times **within the usable era** (permuting across the 1995-2006 one-tail draws is a size mismatch, not a
   null, and drives every z to −3), rerun the whole sweep, publish `p(best z ≥ observed)` and the null's
   max-z quantiles. The harness's own `--selftest` must print a centred null.
5. **A null result is a result.** The report is committed even when nothing survives, with the detection
   floor stated (at n = 206 and z = 4.0, a real effect must be ≥ +14 pp / +29 % relative to be visible).
6. **Generation is recorded**: model id, per-round usage, raw-response SHA-256, and the validated JSON set,
   archived under `docs/research/` so the run reproduces without the key.

## Consequences

- The 2026-11 sweep found **nothing**, across three protocol generations: v1 (152 hypotheses, per-position
  features, round-robin assembly) peaked at z = +2.45; v2 (368, adding joint pairs, digit sums, exclusion)
  peaked at **+3.00**; v3 (587, adding pair sums/differences, within-tail structure and lagged markov at 2
  and 3 draws) peaked at the **same +3.00**, against a permutation null whose median is +3.14 —
  **p = 0.567**. No hypothesis reached validation, so the holdout was never touched.
- **The leader did not improve when the family grew threefold.** That is the clearest signal available that
  it is noise: a real effect would be found by more hypotheses, a noise maximum would not move.
- The control was wrong once and the run says so. The first v1 control permuted outcomes across all 761
  draws, including the one-tail 1995-2006 era, and reported p = 0.219 on a null that was an artefact. The
  corrected control permutes within the usable era and scores the same 152 hypotheses at p = 0.94. The
  lesson is in the code as a self-test that refuses an off-centre null.
- A fixed z threshold is not a gate. At 587 correlated hypotheses, z ≥ 3.5 is exceeded by 18 % of pure-noise
  sweeps (36/200). The gate must come from the null: **z ≥ 4.0** for this family, and it rises as the family
  grows. Reporting "nothing passed at z ≥ 3.5" would have been true and misleading at the same time.
- The search is a research tool, not a feature: it never runs in the server, never touches `rll.sqlite3`,
  and does not appear in the UI. Promoting a survivor would need its own ADR — a survivor is a candidate
  formula, not an arm.
- More tokens do not buy evidence here. All 587 hypotheses cost 152 k tokens; the binding constraint is
  n = 206 train draws, not the size of the search.
- The operator family is the real ceiling of this ADR, and it is now wide enough that further widening
  inside this dataset has diminishing value: the next honest step is a different field or more draws, not
  another operator.
