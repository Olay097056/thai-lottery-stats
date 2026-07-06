# ISSUE-1: Extract rolling-window (W50/W100/W200) evaluation into a reusable function

## Parent

PRD-fable-promotion-gate.md

## What to build

FABLE's single-config gate check (`/api/fable-backtest?gate=true`) currently computes tail2/tail3 edge across W50/W100/W200 rolling windows, but this logic is only reachable through that one endpoint's code path. Extract it into a standalone, reusable function that takes a config (window + weights) and the draw data, and returns `{w50: {tail2_edge, tail3_edge}, w100: {...}, w200: {...}}` — so both the existing gate endpoint and the upcoming grid-search comparison (ISSUE-2) can call the same code.

This is a regression-safe refactor: the gate endpoint's behavior and output must be identical before and after.

## Acceptance criteria

- [ ] Rolling-window (W50/W100/W200) tail2/tail3 edge computation lives in one function, callable independently of the `/api/fable-backtest` endpoint
- [ ] `/api/fable-backtest?gate=true` produces byte-identical output to before the refactor, for the same input data and config
- [ ] A test asserts the extracted function returns correct `w50`/`w100`/`w200` edge values against a fixture with known expected output
- [ ] No change to any API response shape or UI behavior in this issue — purely internal extraction

## Blocked by

None - can start immediately
