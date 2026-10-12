# PRD: Astra-Σ Mythic Blend v0.1 — isolated experimental ranker

## Status and decision

Approved in conversation by the owner to apply the proposed Astra-Σ formula. Implementation may proceed as a separate experimental version. Historical backtesting is **not authorized until the old holdout boundary is recovered**: do not measure historical accuracy, score the formula against holdout outcomes, or tune from any outcomes. Separately, the owner authorized exactly one read-only forward inference from the existing cache for the next target only.

## Goal

Add an isolated experimental ranking path for the same seven prize categories already defined by `PRD-astra.md`. Rank all fixed-width digit strings in each category; preserve leading zeros; show the requested counts already defined there. Each category remains independent. The first-prize ranking is the primary product focus; prizes 2–4 and front3/back3/bottom2 remain separately reported, never combined into one score or metric.

This is a heuristic blend of statistical and numerology-inspired signals. It is not evidence of a higher chance of winning. A composite score is a ranking score, not a probability.

## Frozen formula

For candidate string `x`, target date `d`, and category `c`:

`S_c(x,d) = 0.50 A_c(x) + 0.10 H_c(x) + 0.10 D_c(x) + 0.12 N(x,d) + 0.08 L(x) + 0.10 B(x)`.

Weights sum to 1.00. No search or outcome-based weight selection is allowed.

Use the same validated, category-specific, newest-first window and fixed `astra-v1` base model: at most 200 dated draws strictly before the future target, minimum 20 valid draws per category. Historical evaluation is out of scope until a reproducible, holdout-safe boundary is supplied.

- `A_c`: empirical CDF percentile of the unrounded `astra-v1` score among **every** fixed-width candidate in the category domain: `count(base_score(y) <= base_score(x)) / 10^digits`. Ties are included. Compute per category from its own frozen `astra-v1` model.
- `H_c`: for each position, the fraction of result tokens matching that candidate digit among the latest 24 valid draws in the category; average the positional fractions. Within a draw, result slots contribute equally. If fewer than 24 valid draws exist, use those available.
- `D_c`: for each position, count newer valid category draws since that position's candidate digit last appeared; cap each gap at 24, use 24 when absent, divide each by 24, then average positions. This intentionally balances the hot signal rather than claiming both are predictive.
- `N`: sum the ASCII digits of the candidate and of the canonical target date `YYYYMMDD`, reduce each modulo 9 (residues 0–8), then score `1 - circular_distance/4` on the 9-residue cycle. This is explicitly a numerology heuristic.
- `L`: count candidate digits equal to 8 or 9, divided by candidate width. This is explicitly a superstition-inspired heuristic.
- `B`: average three 0–1 components: `1 - abs(odd_count-even_count)/digits`; `1 - abs(low_count-high_count)/digits` with low digits 0–4 and high digits 5–9; and `distinct_digit_count/digits`.

Rank by descending unrounded binary64 composite score, then ascending digit string for exact ties. Return component values for transparency. Do not round before sorting.

## Integration and boundaries

- Add a new module/version `astra-sigma-v0.1`; do not edit or replace `astra.py` / `astra-v1`, its automation snapshots, existing formulas, or default prediction behavior.
- Expose the separate ranker in the existing Astra page as a distinct selectable version and a future-target-only endpoint. Reuse the existing read-only cache loader and category validation; never call refresh-capable loaders, scrape, repair, write result data, or enter historical scoring, Mix, Picks, Buy Plan, or existing backtest tables.
- Use only synthetic fixtures for implementation and integration verification. Separately, the owner's explicit authorization permits exactly the next-draw inference using the existing local cache through the read-only CLI; do not refresh, create, repair, rewrite, backtest, or tune from historical/holdout outcomes. The real-cache run is inference only, not implementation verification.
- No historical backtest, holdout scoring, outcome-based tuning, promotion claim, commit, push, or deployment.

## Verification

1. Synthetic unit tests assert all component bounds, exact weights, leading-zero handling, deterministic ties, category isolation, target-date behavior, valid/invalid category handling, and full-domain `A_c` percentile against an exhaustive small-domain oracle.
2. API/UI contract tests use an isolated synthetic fixture only; reject malformed payloads and ensure version switching/target changes cannot display stale results.
3. Run every current `scripts/test_*.js` file and relevant Astra Python suites; record existing failures separately.
4. Run static cache-bust synchronization if static files change. Verify the scoped diff and preserve all pre-existing worktree modifications.

## Historical evaluation gate

The old Group J record says 464 train + 150 validation + 127 holdout from 742 pairs (counts total 741), while ADR-0003 defines the holdout only as the newest tail and says it is spent. The original search artifacts are absent from reachable history. Until the original 742-pair snapshot/order and exact protected holdout boundary plus treatment of the unaccounted pair are reproducibly identified, do not choose an inferred cutoff or inspect outcomes. Any future evaluation requires a precommitted split and category-specific metrics before opening outcomes.
