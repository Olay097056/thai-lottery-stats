# ADR 0007: Prospective first-prize protocol

Status: accepted (user authorized implementation, 2026-10-14)

## Decision

Use `prize1-prospective-v1-k5`: five distinct six-digit candidates per method,
first submission per method and target, server Bangkok timestamp before the
calendar day of the target. No historical registrations, holdout evaluation,
weight searches, automatic promotion or automatic registration on page load.
Uniform reference is 5/1,000,000 per draw. Duplicate tickets do not add coverage.

`first_prize.py` stores immutable application-level records in the ignored
`astra_runtime/first_prize.sqlite3`; reports include SHA256, settings, input
fingerprint for server Astra and source-code fingerprints. SQLite is local
storage, not a tamper-proof external timestamp authority. Back up this database;
JSON export is a review artifact and has no import/overwrite endpoint.

The server experiment registers Astra v1, Astra-Σ v0.1 (Sigma), Luna v1, the
Fano-inspired family (v1-v5), and five Sigma
leave-one-component-out variants (H/D/N/L/B), renormalizing the
remaining Sigma weights. The original Sigma defaults stay fixed. All
server-generated prospective methods use every accessible,
valid prize-1 result in the existing local cache strictly before the target;
at least 20 valid draws are required. Astra's and Sigma's base probability model
and Luna use this full history. Sigma's H/D signals retain their fixed
24-valid-draw window. Training start and cutoff dates, row and valid-draw counts,
and a history fingerprint are stored. This full-history rule applies to this
prospective experiment; the normal Astra report remains capped at 200 draws.
Luna v1 is a separate final-digit hypothesis: add one count to
each last digit, keep the first five positions uniform, and sample five distinct
prefixes without replacement because the data do not rank those prefixes.
Experiments are exploratory, correlated and multiple comparisons: no winner
or promotion is selected from these results. Failed/interrupted runs may leave
already-registered methods; retry retains those first records and fills gaps.

Client formula/Mix and current Predict submissions are marked client_unverified:
the server validates digits/date/count, but does not certify their input history
or recompute their candidates. Short-output and tail-only formulas are excluded.
Pool-generating methods can contribute six-digit lists, but their evaluations
here match only prize1. Names, settings, code hash and original target accompany
records. Code versions are summarized separately; settings remain inspectable.

Astra v1 and Luna v1's full joint scores are normalized with a forward partition
sum. Store their q/t models before outcomes; report joint log loss versus
log(1,000,000), and aggregate predicted top-five probability mass versus
observed hits as an initial calibration diagnostic. Small samples cannot
establish calibration or edge. Sigma/Mix heuristic scores are not probabilities
and receive no log loss.
Partial-digit matches are explicitly diagnostic, never first-prize wins.

## API and UI

GET /api/first-prize reads the registry and resolves its targets from the existing
cache only; it never refreshes or scores unregistered historical predictions.
POST /api/first-prize/experiment?date= registers server-generated Astra, Sigma,
Luna, Fano v1-v5 and Sigma ablation predictions.
POST /api/first-prize/register accepts explicitly labeled client submissions.
The normal same-origin mutation middleware applies. The prediction page contains
explicit compute/register/read/export actions. No requests execute at script load.
Mix's older pool track record remains labeled Pool 1–5 and vote agreement is not
shown as independent evidence or winning probability.

## Limits

Future draw dates are user-selected; a target without an actual draw remains
pending. Conflicting cache prize1 values remain pending. Cache results are not
independently certified. Rare six-digit hits require very large prospective
samples. This protocol does not assert or guarantee improved winning chances.
No tests or live inference were run in this implementation request.

## Verification follow-up (2026-10-14)

Owner authorized tests and chose synthetic-only backtests. Registry/engine/API suites passed 75 test executions; JS syntax, six cache checks and architecture contract passed. Fixed SQLite connection cleanup discovered on Windows. Five seeded synthetic walk-forward runs per scenario show no advantage for uniform iid and detectable deliberately planted biases. No historical outcomes or holdout were evaluated; production weights unchanged. Experiments are reproducible with `scripts/explore_first_prize_synthetic.py`.

## Backtest navigation follow-up

Formula Backtest and sidebar Backtest contain read-only registry views for the server-generated prospective methods with explicit empty/pending states. Navigation reads existing registry/outcomes only; it does not infer, register or evaluate historical targets. Registration remains an explicit action on the prediction page. Existing automation snapshots are not silently imported as experiment registrations. UI requests use per-view generation guards. This UI change has not been browser-tested.

## Luna v1 follow-up (2026-10-14)

Added `luna-v1-hypothesis` to the explicit server experiment action. Astra,
Sigma, and Luna in this registry now use every accessible valid prior prize-1
draw; the normal Astra report remains capped at 200. Luna uses fixed Dirichlet(1)
add-one smoothing and gives no learned preference to the first five digits. Its
five prefixes are reproducibly sampled without replacement. The full
independent six-position distribution is normalized and scored prospectively;
records disclose counts, sample size, training date range, favored digit, and
history fingerprint. This is a hypothesis only: the full-history digit tests
were inspected during discovery and are not independent validation. Older draws
may mix historical regimes. No historical evaluation, new backtest, real
inference, or tests were run for this change.

## Luna formula-tab follow-up

The Formula calculation tab has a separate Luna v1 group. Its read-only API
uses the same Luna hypothesis and candidate construction as the prospective
experiment, but accepts the formula page's selected target date and uses every
accessible valid first-prize result strictly before that date. Calculation
never writes to the registry. The group is excluded from consensus Picks and
the existing historical formula Backtest so experimental candidates cannot be
mistaken for validated or comparable results.

## Fano v4 follow-up (2026-10-15)

The canonical Fano-inspired pair-cover formula now uses deterministic
variable-neighborhood search initialized from v3's joint coordinate-ascent
portfolio. It explores one-to-three digit changes and whole-number replacements,
then polishes each restart with coordinate ascent. Preserve Fano v1-v3 as
separate methods in future-only comparisons. This remains an experimental
ranking heuristic; it does not change the five-number baseline or assert that
the UK Lotto construction transfers to Thai prize 1. Every formula and
walk-forward Backtest still uses only valid history strictly before its target.
No tests or backtests were run for this update.

## Fano v5 adaptive rank codebook follow-up (2026-10-15)

Added `fano-v5-adaptive-rank-codebook` while preserving v1-v4. It fixes the
best configuration from the prior search: previous-digit transition, EWM-24,
all-history, rolling-240, rolling-120, rolling-120; zero-based rank pairs 6/7,
5/8, 1/6, 2/3, 7/9, 2/8; puncture line 7 and omit points 1 and 6. Its five tickets are
produced from the punctured Fano incidence codebook, using prior valid draws
only for each target.

The configuration was selected from one million variants using these same 759
historical outcomes and scored 2/759. The Formula tab and normal formula
Backtest now expose it only as a post-hoc exploratory result with that warning;
this changes the earlier exclusion of experimental Fano candidates from the
historical formula Backtest. It remains outside consensus Picks. The explicit
first-prize experiment also registers v5 for future-only tracking, so future
draws are reported separately from the discovery sample. This result is not an
independent accuracy estimate and does not change the five-ticket uniform
baseline. No tests or new backtests were run for this implementation.
