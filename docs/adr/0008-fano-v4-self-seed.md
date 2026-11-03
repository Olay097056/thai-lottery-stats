# ADR-0008 — Fano v4 self-seeding (to retire v1–v3)

Status: accepted · 2026-11-02 · implemented 2026-11-02, seed policy amended
the same day after the first re-baseline (see below)

## Context

`fano.py` ships five "versions" that are not alternatives: v4 depends on a
chain of earlier versions for its starting point.

```
build (v4) → build_v3 → build_v2 → build_v1
```

`build_v3` returns `(incumbent_numbers, incumbent_settings)` and v4 optimises
from that incumbent. Deleting v1–v3 therefore removes v4's seed, and the
failure only appears at runtime (`NameError` inside `build`): the Python suite
stays green because no test exercises the full v4 path with real data.

The versions are no longer exposed as public methods (removed from
`_builder_for_version`, from the `first_prize.experiment` methods list and from
the UI label list). What remains is dead weight in the module.

## Decision

Replace the inherited incumbent with a **deterministic self-seed** built inside
v4, then delete `build_v1`, `build_v2`, `build_v3` and everything only they
used.

Seed policy (final): the greedy weighted pair-cover construction
(`_best_uncovered_candidate` over all digits 0–9, five rounds, minimum Hamming
distance 3) with tie-breaks taken from the target's existing seed, followed by
one coordinate-ascent polish (`_optimize_portfolio`). No history beyond the
target cutoff — same leak rules as today. v4's provenance reports
`optimizer_base_version: 'self-seeded'` plus the raw seed score
(`optimizer_seed_score`) and the polished base score (`optimizer_base_score`).

### Considered and rejected

The originally proposed seed — `random.Random(int(history_sha256[:16], 16))`,
`K = 8` perturbed random portfolios, best `_portfolio_coverage_score` wins —
was implemented first and measured. It works, but it degrades the objective v4
optimises:

| seed policy | mean incumbent coverage score (24 targets) |
|---|---|
| retired v3 incumbent | 1.14019 |
| 8 perturbed random portfolios | 0.80089 |
| those 8, each coordinate-ascented | 1.12768 |
| greedy pair-cover, polished (shipped) | 1.14055 |

The anneal recovers most of the gap (final mean 1.12697 vs 1.14019) but not
all, and it made the score worse on 22 of 24 targets. Greedy coverage — not
multi-start randomness — is what the retired v3 incumbent was actually worth
(measured: `optimized_start = v2-greedy` on every sampled target). Rebuilding
the greedy portfolio inside v4 keeps the quality without inheriting the
builders.

## Consequences

- v4's numbers change where the greedy tie-breaks differ from v2's old seed
  material: 18 of 24 re-baselined targets keep the identical five numbers, the
  other 6 change and share 1–4 of 5 candidates.
- `optimizer_base_version` provenance is `'self-seeded'`; old records keep
  `'fano-v3-joint-weighted-cover'` and stay readable.
- A re-baseline is required before the change is trusted: run the walk-forward
  backtest for the last N targets before and after, and record the difference.
- Tests must gain one assertion that exercises `build()` end-to-end, so a broken
  seed chain fails loudly instead of silently passing.
- `scripts/explore_fano_paircover_windows_759.py` scored the retired v3 builder;
  it now stops with an explicit message instead of an `AttributeError`.
- The greedy seed keeps `_best_uncovered_candidate`, `_tie_key` and `BEAM_WIDTH`
  alive; they are v4's seed now, not v2's leftovers.

## Steps

1. Add `_seed_portfolio(valid_draws, seed)` and `_greedy_pair_cover(...)`
   (deterministic, no dependency on a retired builder).
2. In `build()`, replace `build_v3(...)` with `_seed_portfolio(...)`.
3. Delete `build_v1`, `build_v2`, `build_v3`, `VERSION_V1..V3`, `NAME_V1..V3`
   and every helper with no remaining caller. In practice the orphans were
   none beyond the version constants and `OPTIMIZER_RANDOM_STARTS` — the beam
   search and `_perturbed_portfolio` are still reachable from v4.
4. Add the end-to-end `build()` test; run `python -m py_compile`, the Python
   suite, and a live `formula_forecast` for a real target.
5. Re-baseline: same targets, before/after hit lists; publish the diff.

## Result (2026-11-02, final policy)

24 walk-forward targets, 2025-11-16 … 2026-11-01, each built from a strictly
prior history window. "Before" is the pre-change file
(`.scratch/fano-adr-0008/before_fano.py`, sha256 `6f169a0d…`); "after" is this
change with the greedy seed. Raw data:
`.scratch/fano-adr-0008/baseline-{before,after}.json`,
`.scratch/fano-adr-0008/comparison.json`; the rejected literal-seed run is kept
as `fano-literal-seed.py` / `baseline-after-literal.json` / `comparison-literal.json`.

| metric | before | after |
|---|---|---|
| mean weighted pair-coverage score | 1.14019160 | 1.14055021 (+0.00036) |
| targets where the score fell | — | 2 / 24 |
| targets where the score rose | — | 3 / 24 |
| identical candidate set | — | 18 / 24 |
| mean shared candidates | — | 4.25 / 5 |
| exact prize-1 hits | 0 | 0 |
| mean build time | 0.32 s | 0.28 s |

Reading:

- Parity on the objective: the mean moves +0.03% and 19 of 24 targets are
  unchanged or tied. The 6 changed targets are tie-break drift, not a different
  formula — v2's old seed string is gone, so greedy choices that used to be
  decided by `fano-v2-weighted-pair-cover` are now decided by v4's own seed.
- Exact prize-1 hits are 0 before and 0 after. Over 24 targets the expected
  count is ≈0.0002, so **neither run says anything about predictive skill**;
  only the formula's own coverage objective was compared.
- Build time is unchanged in practice: the removed v3 work is replaced by the
  seed's greedy pass.

Post-decision measurement (60 targets,
`.scratch/fano-adr-0008/vns-value.json`): the coordinate-ascent polish never
improves on the greedy seed (0/60) because the beam already lands on a
coordinate optimum, and the anneal beats the seed on only 5/60 targets
(+0.00046 mean, +0.0087 max). Time split on 12 targets: seed 0.212 s of a
0.294 s mean build, search stages 0.082 s (28%). The polish pass is dead weight
today; it is kept as a cheap safety net for history windows where the beam
does not land on a coordinate optimum. Removing the anneal would change the
candidates on ~8% of targets — that is a separate decision, not part of
ADR-0008.
