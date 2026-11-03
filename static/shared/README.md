# Shared frontend owners

These are application-wide infrastructure and presentation contracts.

| File | Public surface | Ownership |
|---|---|---|
| `api-client.js` | `LotteryApi.request`, compatibility `api` | Only network transport; GET and POST, failures and spinner lifecycle |
| `queries.js` | `LotteryQueries` | Bounded, immutable response records and invalidation generations |
| `server-data.js` | `LotteryServerData` | Feature-owned source/derived data views; no editable UI drafts |
| `ui-state.js` | `LotteryUiState` | Feature-owned controls, navigation, sort and draft state; no raw API rows |
| `charts.js` | `LotteryCharts` | Chart registry, theme options, create and destroy |
| `reports.js` | `LotteryReports` | Browser saved-report persistence, provenance, export and presentation |

Backing values are private. Fixed data/UI surfaces allow owning controllers to
write their own fields. Architecture tests enforce ownership across all manifest
files. Do not introduce raw `fetch`, loose UI-state declarations or private-state
access in a page. Use the public methods or state surface for the corresponding
owner. Query records do not trigger inference or automatically reuse predictions.

Load order is recorded in `../scripts.json`; all infrastructure must be available
before application boot. Existing public handler aliases support the no-build
HTML shell. See ADR-0006 for the current classic-script contract and its limits.
