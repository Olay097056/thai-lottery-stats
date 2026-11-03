# Luna v1 · สมมติฐาน

## Purpose

Record a falsifiable, future-only hypothesis for exact six-digit first prize.
Luna is a separate experimental method. In the prospective registry, Astra's
and Sigma's base model and Luna use all accessible prior draws. Sigma's H/D
features retain their fixed 24-valid-draw signal window. Luna also appears in
the “สูตรคำนวณ” tab when the user calculates formulas, using a read-only
server request over all accessible valid prior first-prize draws. Its formula
card is experimental and excluded from consensus Picks. The ordinary formula
Backtest includes Luna only as an explicitly exploratory row, scored against an
exact six-digit first-prize match. Calculating the formula does not register a
forecast; historical scoring happens only when the user runs Backtest.

## Fixed rule

- Use every accessible valid prize-1 draw in the local cache before the target,
  with at least 20 valid results. Store the valid training start and cutoff
  dates, counts, and a fingerprint of all prior cache rows.
- Count only the final digit. For digit `d`, use the posterior predictive
  probability `(count[d] + 1) / (n + 10)` (Dirichlet(1) / add-one smoothing).
- Keep each of the first five positions uniform at 10%.
- Select the most frequent smoothed final digit, breaking a tie by the smaller
  digit. Create five distinct five-digit prefixes through reproducible SHA256
  sampling without replacement. Prefixes are tied; the formula makes no claim
  that their digits are more likely.
- Save five six-digit strings, the normalized independent probability model,
  counts, sample size, settings, history fingerprint, and code fingerprint in
  the first-prize registry. The existing first-submission-per-method-and-target
  rule applies.

## Hypothesis and evidence

The hypothesis is that a smoothed final-digit frequency from the available
history may predict a future final digit better than a uniform 10% distribution.
The other five positions remain uniform, so Luna does not claim a way to
forecast the full number's prefix.

Exploration of 759 valid historical results found an unusual full-history
final-digit distribution (raw chi-square p about 0.0022; Holm-adjusted p about
0.037 in an exploratory family of 17 tests). This is discovery-only: the test
family was inspected during exploration, which leaves selection and broader
multiple-comparison risk. In the last 200 draws the final-digit test was not
significant (chi-square p about 0.375). These results do not establish an edge
and must not be presented as validated prediction accuracy. Using all history
can also mix changes across lottery eras; only future registered outcomes can
evaluate this fixed rule independently.

## Evaluation

Only results registered before future draw dates count. The primary outcome is
exact six-digit prize-1 hits among five candidates; random reference is
5/1,000,000 per draw. Since Luna has a normalized model, prospective log loss
and predicted top-five probability mass may also be accumulated against the
uniform reference. Partial-digit matches are diagnostic only. There is no
automatic promotion, weight search, or claim of improved odds. The user later
requested Luna in the ordinary historical formula Backtest. That row uses the
same fixed rule with walk-forward, strictly pre-target history and the exact
5/1,000,000 random baseline. However, Luna's hypothesis was informed by
historical frequency exploration, so these retrospective results are not an
independent holdout, cannot be used to tune the method, and cannot establish a
promotion decision. Only future registered outcomes can provide independent
evidence for this hypothesis.
