# Frontend state ownership and public contracts

Date: 2026-10-14. Owner requested all three architecture improvements.

The no-build Vanilla JS runtime is retained. This applies feature/state boundaries
without requiring React, TypeScript or an ES-module conversion.

## Public surfaces and private implementation

`LotteryApi`, `LotteryCharts`, `LotteryReports`, `AstraFeature` and `DecisionDomain`
expose frozen public contracts. Their backing counters, registries, constants and
implementation state live inside closures. Astra exposes a copied, frozen UI
state projection and a version getter; routing does not read its private variables.

Existing inline HTML handlers and feature functions use compatibility aliases.
These are public entry points, not access to the modules' backing state. The
application still uses classic scripts; this is not an ES import/barrel migration.

`static/shared/` owns transport, queries, state surfaces, charts and browser
reports. Decision Center's reusable domain helpers have their public entry point
at `static/modules/decision-center/index.js`, instead of living in shell/init.
The script manifest and HTML load the same files, with boot last.

## State origins

- `LotteryQueries`: canonical response records keyed by method, endpoint and
  sorted query parameters. Response copies are deeply frozen. Newer requests
  win; invalidation generations prevent pending responses repopulating an old
  cache. Records are bounded to 32 keys.
- `LotteryServerData`: feature-owned filtered/derived source views, including
  history rows, computed backtest rows, prediction display rows and Buy Plan
  source data. Its backing values are private; each feature has a fixed surface.
- `LotteryUiState`: feature-owned controls, sorting, navigation, request generations,
  editable drafts and explicit client report artifacts. It contains no raw history
  or query responses. Its backing values are private and its public shape is fixed.
- Astra has a closed local UI store. Its reports pass through the query layer and
  render from local request results; they are not mirrored into its UI store.

The fixed surfaces use property accessors. Freezing a surface fixes the available
fields; owning controllers can still update values through setters. Editable
drafts remain editable. Saved browser reports remain explicit client artifacts.

The query layer records responses; it does not automatically reuse responses,
deduplicate explicit calculations, prefetch predictions or invoke Astra. Existing
page request guards and user-initiated inference rules remain in force.

## Network and persistence

All `fetch()` calls live in `shared/api-client.js`. Refresh is a POST through the
same client and invalidates query records after success. Quiet request options,
spinner concurrency and strict Astra HTTP/domain validation remain supported.
Charts are created/destroyed through public chart methods. Browser report storage,
provenance, export and generic saved-report rendering are owned by Reports.

## Enforcement and evidence

`scripts/test_frontend_architecture.js` checks network ownership, data/UI write
ownership, absence of loose UI declarations, private-state visibility and frozen
public surfaces. It executes the actual isolated shared/Astra files and tests
transport, query races, invalidation, immutable response copies and UI/data separation.

Existing VM fixtures initialize the public state surfaces through
`scripts/frontend_source.js::prepareContext`. The legacy fixture-name mapping is
test-only. Formula calculations, rankings, statistical decisions, stored report
schemas and backend outcome data were not changed by this refactor.
