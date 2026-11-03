# ระนาบฟาโน · Fano-inspired formula family (v1–v5)

## Purpose

Apply the source paper's pair-covering idea to an isolated Thai exact-first-prize
formula. Treat a draw as six ordered positions with ten possible digits per
position, then optimize five distinct six-digit candidates together so their
union covers high-weight historical patterns across the 15 position pairs.
The weighted pair-cover and codebook lineage is Fano-inspired; v4 is not a
literal construction of the seven-point Fano plane, nor the paper's 27-ticket
UK Lotto system.

The canonical v4 formula appears in its own formula-page group, stays separate
from combined Picks, participates in ordinary walk-forward Backtest, and is
included in the future-only five-candidate experiment. Keep v1 (incidence
codebook), v2 (greedy pair-cover), and v3 (multi-start coordinate ascent)
separately named so prior records and future comparisons remain interpretable.

## Fixed rule

- Read every accessible valid six-digit prize-1 draw strictly before the target;
  require at least 20 valid draws. Retain the history fingerprint and training
  start/cutoff dates.
- For each of the 15 ordered-position pairs, count the observed two-digit
  patterns and apply alpha=0.5 smoothing across 100 possible patterns.
- Score a portfolio by summing the smoothed historical weight of each distinct
  pair pattern it covers across all 15 position pairs.
- Start with v3's deterministic multi-start coordinate-ascent result, then run
  five seeded variable-neighborhood searches. Proposals replace one to three
  digits or a complete six-digit candidate; simulated-annealing acceptance can
  temporarily accept a lower objective to cross a local optimum. Polish the
  best candidate from each search with coordinate ascent.
- Keep five distinct candidates and require pairwise Hamming distance of at
  least three after every proposal. Use deterministic seeds tied to the target
  date and prior-history fingerprint; report the v3 score, restart scores,
  accepted moves, pair coverage, and final objective.
- Use this same canonical rule for the formula tab, historical Backtest, and
  future-only experiment. Every historical target uses only data strictly
  before that target.
- Seed v4 from the history fingerprint alone (greedy weighted pair-cover,
  polished by coordinate ascent). v1-v3 builders were deleted with ADR-0008; old
  records stay readable through their `optimizer_base_version` string.

## Evaluation

The variable-neighborhood heuristic searches more than one-digit moves but
does not prove a global optimum or a predictive advantage. The source paper's
27-ticket guarantee does not apply: that construction uses six distinct
unordered balls, while the Thai target is an ordered six-digit string.
Backtest remains walk-forward and exploratory; do not tune the formula against
a reserved holdout. Score only exact six-digit prize-1 matches against the
fixed five-candidate baseline of 5/1,000,000 per draw.

## UI

Show the selected number set, history dates, number of valid draws, optimizer
restarts, v3 starting score, final pair-cover score, pair-pattern coverage, and
minimum candidate distance. Keep the formula separate from combined Picks.
Label v4 and v5 distinctly in the prospective registry.

## v5 · Adaptive Rank Codebook

Keep v4 as the weighted pair-cover version and add v5 as a separately named
experimental variant. v5 fixes the best configuration found by the one-million
variant prior-only search: previous-digit-transition, EWM-24, all-history,
rolling-240, rolling-120, rolling-120; zero-based rank pairs 6/7, 5/8, 1/6, 2/3, 7/9,
2/8; puncture line 7 and omit points 1 and 6. The five retained Fano incidence
codewords are generated from history strictly before each target.

That configuration was selected after scoring the same 759 historical draws
and recorded 2/759 hits. Show it in the formula tab and ordinary formula
Backtest only with an adjacent post-hoc disclosure; the retrospective score is
not an independent estimate. Keep v5 outside consensus Picks and track future
registrations separately. It does not alter the five-ticket 5/1,000,000
uniform baseline.
