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

1. **Data, never code.** A hypothesis is `{name, k, positions: [[term×3]×3]}` with
   `term = {op, source, window, weight}`. Operators (`freq`, `gap`, `markov`, `weekday`), sources (`pool`,
   `prize1`) and windows (30/60/120) are owned by the harness in
   `scripts/rll_hypothesis_search.py`. Adding an operator is a contract change and needs a new ADR.
2. **The field decides, and it must exist.** Target is the last three digits of the prize 1-4 pool on draws
   with ≥ 55 distinct tails (464 of 761, 2006-12-30 onward). Earlier draws carry a one-number pool and are
   excluded, not silently down-weighted.
3. **Fixed 60/20/20 split inside the usable set**, screen at z ≥ 3.5 on train (206 draws), confirm at
   z ≥ 2.0 on validation (69), evaluate the holdout (69) once and never use it to select. Thresholds are
   one-sided against a per-draw chance baseline, so varying pool sizes cannot flatter a hypothesis.
4. **Permutation control is mandatory** for any sweep that is reported: shuffle the target outcomes 200
   times, rerun the whole sweep, publish `p(best z ≥ observed)` and the null's max-z quantiles.
5. **A null result is a result.** The report is committed even when nothing survives, with the detection
   floor stated (at n = 206 and z = 3.5, a real effect must be ≥ +12 pp / +25 % relative to be visible).
6. **Generation is recorded**: model id, per-round usage, raw-response SHA-256, and the validated JSON set,
   archived under `docs/research/` so the run reproduces without the key.

## Consequences

- The 2026-11 sweep (152 hypotheses from `deepseek/deepseek-v4.1-flash`) found **nothing**: 0 passed,
  best z = +2.45, permutation p = 0.219. One of 200 shuffles reached the gate (3.53), which is the measured
  false-positive rate of the procedure.
- The search is a research tool, not a feature: it never runs in the server, never touches `rll.sqlite3`,
  and does not appear in the UI. Promoting a survivor would need its own ADR — a survivor is a candidate
  formula, not an arm.
- More tokens do not buy evidence here. Generation cost 38 k tokens; the binding constraint is n, not the
  size of the search.
- The operator family is the real ceiling of this ADR. A rule that needs digit sums, cross-position
  constraints or exclusion logic cannot be expressed, and the null result must be read with that in mind.
