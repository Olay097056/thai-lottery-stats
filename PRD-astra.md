# PRD: astra — seven-category next-draw prediction

Status: Approved by owner on 2026-10-08: formula + separate tab + synthetic verification + one next-draw inference from existing read-only cache. Implementation and synthetic verification complete; focused independent re-review APPROVE. One read-only inference captured on 2026-10-08 for target 2026-10-16. Local commit still requires owner delivery review below.

## Objective

Build a distinct experimental formula named **astra** for the next draw. This is a new feature, not a promotion of `equal-signal-percentile-v1`, not a replacement for the current `/api/predict/all` default, and not a reopening of the old prospective-validation tickets.

Owner-confirmed outputs (unique within each category; strings preserve leading zeros):

| Category key | Thai label | Digits | Requested picks |
|---|---|---:|---:|
| prize1 | รางวัลที่ 1 | 6 | 5 |
| front3 | เลขหน้า 3 ตัว | 3 | 2 |
| back3 | เลขท้าย 3 ตัวทางการ | 3 | 2 |
| bottom2 | เลขท้าย 2 ตัว | 2 | 1 |
| prize2 | รางวัลที่ 2 | 6 | 5 |
| prize3 | รางวัลที่ 3 | 6 | 5 |
| prize4 | รางวัลที่ 4 | 6 | 5 |

Total requested output: 25 numbers across seven categories. Category lists are not predictions of particular prize-slot order. A number may appear in more than one category; do not distort rankings merely to force cross-category diversity. No prize5 or near1 output. Official front3/back3 are separate prize draws, not substrings of prize1.

## Confirmed data permission

Owner explicitly authorized: read existing historical results **read-only as inputs to astra for a future target only**; no refresh, result changes, backtest, or tuning from holdout. Lock this method and constants before inspecting real history. Develop and verify with synthetic fixtures first. Then execute the frozen method once for the next-draw target using the existing cache; do not choose variants after seeing the output.

This permission does not reopen the old holdout, authorize accuracy evaluation against old outcomes, authorize writing any result CSV, or authorize publishing. If real data is missing or invalid, report the blocker and never synthesize missing results.

## Fixed formula: astra-v1

This is a proposed engineering heuristic, not a claim of a new statistical discovery or proven predictive advantage. It combines smoothed positional digit frequencies and adjacent-digit dependence, separately per prize category. It does not reuse/relabel an existing formula's predictions.

### Constants declared before reading outcomes

- At most 200 most recent dated draws strictly before the target; filter by date before selecting the window.
- Minimum 20 valid draws for each category; otherwise return an explicit insufficient-data category with an empty number list.
- Draw weight at age `a` (zero at the latest eligible draw): `w(a) = 0.5 + 0.5 * 2**(-a/24)`.
- Positional additive prior: 1 per digit (total prior mass 10).
- Adjacent-pair backoff strength: 10.
- Positional/conditional blend: equal log weights 0.5 / 0.5.
- No date-digit numerology, overdue boost, exclusion of repeated winners, random search, or hyperparameter selection.
- Stale-input warning threshold: latest eligible history more than 35 calendar days before generation. Report each category's own last valid input date as well.
- Final rank: descending unrounded log score, digit-string ascending for exact ties.

These are design constants, not empirically optimal settings. Changing them later requires a new formula version and explicit approval; never change them because a past outcome or the displayed predictions look undesirable.

### Category source validation

Use only the corresponding category's historical outcomes:

- `prize1`: one exact ASCII six-digit string.
- `front3`: both `front3_1` and `front3_2`, each an exact ASCII three-digit string.
- `back3`: both `back3_1` and `back3_2`, each an exact ASCII three-digit string.
- `bottom2`: one exact ASCII two-digit string.
- `prize2`: five unique exact ASCII six-digit strings in `prize2_1` through `prize2_5`.
- `prize3`: ten unique exact ASCII six-digit strings in `prize3_1` through `prize3_10`.
- `prize4`: exactly fifty unique exact ASCII six-digit tokens in the existing whitespace-separated field.

Do not cast complete lottery-number tokens to integers, repair decimal-looking values, pad incomplete values, or merge secondary prizes into prize1. Keep independent validity counts per category. In a multi-result category each valid draw contributes total weight `w`, split equally among its result slots; the fifty prize4 values do not create fifty independent draw observations. Two official 3-digit slots are processed as slots, without silently requiring uniqueness.

Dates must be valid calendar dates in the cache's ISO date or ISO midnight form. Duplicate draw dates fail closed. Reject malformed dated records rather than guessing their chronology. Reject future-dated history relative to the generation day. Sort copies, never mutate input records.

### Score definition

For one category, count position digits and adjacent digit pairs using the fixed draw weights above. For a draw with `m` result slots each number has weight `w/m`.

Let `C_j(d)` be the weighted count of digit `d` at position `j`, `W` the total valid draw weight, and `C_j(a,b)` the adjacent pair count between positions `j-1` and `j`.

```
q_j(d) = (C_j(d) + 1) / (W + 10)
t_j(b | a) = (C_j(a,b) + 10*q_j(b)) / (C_(j-1)(a) + 10)
S(x) = log(q_0(x_0))
       + sum over j>=1 of [0.5*log(q_j(x_j)) + 0.5*log(t_j(x_j | x_(j-1)))]
```

Find the exact top-k strings under this fixed first-order score using k-best dynamic programming per last-digit state. Retain the best k prefixes plus any additional prefixes needed to preserve final binary64 raw-score/string ordering: later additions can collapse distinct prefix scores into an exact tie. Prune only when k competitors dominate for every common suffix, using an outward-rounded bound on possible future gap closure, never rounding scores or treating near scores as ties. This numerical safeguard was added after a failing synthetic six-digit exhaustive check, before any real inference; the score formula, constants, and final tie rule are unchanged. This avoids a heuristic beam that could discard the actual top-k. Prove the implementation against exhaustive synthetic 2-/3-digit reference enumeration. Return raw finite `log_score` as a ranking measure; do not label it a chance of winning or convert it into a fabricated confidence percentage.

## Integration scope

### Backend

- Add a dependency-light pure `astra.py`: constants, validators, weighted count/score builder, exact top-k ranker, report builder, and a strictly read-only existing-CSV loader.
- Add `GET /api/predict/astra?date=YYYY-MM-DD` in `main.py`.
- Require a canonical future target date (strictly after the current Thailand calendar day). Reject past/today/alias dates before opening history. This is a next-draw inference endpoint, not a backtest endpoint.
- Use the read-only loader directly; do not call `get_df()`, `scraper.load_data()`, incremental update, or any network-enabled loader. Missing cache returns an explicit safe error and creates nothing.
- Response includes `formula: astra`, `version: astra-v1`, `trust: ทดลอง`, target/generation/cutoff dates, locked settings, warnings, and all seven categories. Each category includes requested count, digit width, valid/invalid draw counts, its last valid input date, status, and ranked number strings.
- Add a CLI `scripts/predict_astra.py --target-date YYYY-MM-DD` using the same engine and read-only loader. Output is a prediction report, never written into result data or the old prospective snapshot file.

### Frontend

- Add a separate **astra** subtab within the existing ทำนาย-สูตร page, with the seven category cards in the order above, experiment badge, target/cutoff metadata, explicit missing/stale-data states, and expandable Thai method explanation.
- Use the existing app theme and shared draw selector; changing target invalidates old results and stale in-flight responses.
- astra loads only when its tab/action requests it, not during dashboard startup.
- Do not put astra into `_computeFormulasBatch`, automatic historical scoring, Mix, Picks/Buy Plan, or existing backtest tables in this version. Existing code computes retrospective rows eagerly in several of these paths; wiring astra there would exceed the no-backtest permission and misattribute prize2/3/4 results to prize1.
- No new spending recommendations, fake accuracy badges, or percentages presented as winning probabilities.
- Keep all seven headings visible when a category has no data; show an explicit unavailable state, not fabricated zero-padded numbers.
- Bump all three existing static asset cache-bust versions together.

## Files and boundaries

Expected implementation: `astra.py`, `main.py`, `scripts/predict_astra.py`, synthetic Python/JS test files, `static/app.js`, `static/app.css`, `static/index.html`, this PRD, CHANGELOG, DEVELOPMENT_PLAN, and a scoped CONTEXT glossary entry if approved.

Do not modify `analyzer.py`, the frozen percentile candidate, production shared weights, formula-engine formulas/metrics, lottery result CSVs, old snapshot JSONL, or previous evaluation decisions. Do not edit `CLAUDE.md` under this approval; its previously restricted documentation discrepancies remain out of scope. No new dependencies, deployment, push, or CLI/login/authentication flow.

## Verification plan

| Claim | Evidence command/path | Expected |
|---|---|---|
| Exact counts/widths/uniqueness and deterministic scores | `python scripts/test_astra.py` using synthetic records only | 7 categories; requested 5/2/2/1/5/5/5 when data sufficient |
| No future leakage | Same suite; mutate target/post-target rows, check rank invariance or explicit refusal | No future outcome affects ranking |
| Correct exact top-k | Synthetic exhaustive 2-/3-digit comparison | Exact rank and score agreement |
| No I/O in scorer | Test denied file/network access around pure inference | No file/network attempts |
| Read-only loader and endpoint | Synthetic temp cache; snapshot bytes before/after; network loader forbidden; missing-file test | Unchanged bytes; no refresh; explicit error on absence |
| Strict input handling | Synthetic malformed dates/tokens, missing categories, duplicate dates/tier values, leading zeroes | Explicit rejection/unavailable states, no repaired lottery tokens |
| UI correctness/security | New Node vm contract tests: malformed payloads, XSS, target races, loading/error/empty, category count | Correct escaped content and no stale output |
| Existing behavior unchanged | Existing offline Python regression tests + every `scripts/test_*.js` | No new failure; pre-existing CLAUDE docs failures reported separately |
| Browser UI | Isolated fixture-only API/server; desktop + narrow viewport; clicks/keyboard/console/DOM and screenshots | Correct astra cards, no overflow, honest experiment/data labels |
| Real inference after synthetic proof | Project venv `scripts/predict_astra.py --target-date 2026-10-16` once with frozen source | Actual requested prediction report, category data counts, cutoff warning if stale; no accuracy claim |
| Scoped changes | `git diff --check`, `git status --short`, named-path review | No protected data/default-ranker changes |

Run Python tests with `env -u PYTHONPATH -u VIRTUAL_ENV "$LOCALAPPDATA/lottery_stats_runtime/.venv/Scripts/python.exe" ...` from the repository root. Run Node tests by enumerating the current `scripts/test_*.js` files, never by assuming the old suite count. Browser proof must use synthetic-only API responses; the real app's existing startup/data-loader behavior is not authorized for this task.

The existing generic `hermes verify` recipe can install into the Hermes environment and does not run this project's actual tests. Do not equate its bootstrap success or null readiness with feature verification.

## Delivery and approval gates

1. Owner approves this formula/data/UI scope before implementation.
2. Implement and run synthetic unit/API/UI verification; independent source review; resolve blocking findings.
3. Execute the fixed method for the configured next-draw target using the permitted existing read-only cache. Deliver the actual astra output with source cutoff and version, or honest per-category data blockers.
4. Present scoped diff/results for owner review before a local commit; do not push without an explicit request.

## Statistical interpretation

Passing synthetic tests proves the code implements this design, not that the design predicts lottery outcomes better. The feature may operate under the experimental label without waiting for the unrelated prospective T07. No historical validation or holdout evaluation is part of this delivery. A later claim of improved accuracy requires a separately authorized evidence protocol.

Primary technical background consulted: scikit-learn official Naive Bayes documentation (additive categorical smoothing, not endorsement of astra or a lottery-accuracy claim) and Common Pitfalls (keep evaluation outcomes out of model selection). This implementation uses no scikit-learn estimator or new library dependency.

- `https://scikit-learn.org/stable/modules/naive_bayes.html`
- `https://scikit-learn.org/stable/common_pitfalls.html`
