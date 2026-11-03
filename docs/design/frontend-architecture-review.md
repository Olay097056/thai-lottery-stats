# Frontend architecture review

Date: 2026-10-14. Applied skill: `frontend-architecture`.

The initial audit is retained below. The owner subsequently requested the three
main fixes; their implementation is recorded in ADR-0006. Native ES modules and
co-located page styling remain separate future migrations.
The application is Vanilla JS, not React or React Native. The transferable
principles are feature ownership, explicit public interfaces, separation of
server data from UI state, and styles owned by the feature that uses them.
React hooks, TypeScript naming and library-specific store examples are not
requirements for the current runtime.

## Current findings

| Priority | Finding | Evidence | Consequence |
|---|---|---|---|
| High | File separation does not enforce module boundaries | All 16 scripts in `static/scripts.json` share classic-script global bindings | A page can access another feature's private state; order remains part of correctness |
| High | API data and UI state share the same file and global scope | `buyplan-ui.js` declares `_bpHistRows`, `_bpSources`, `_bpWorkingPlan` and `_bpLoadRequestId` together | Data lifetime and editable draft lifetime are difficult to manage independently |
| Medium | Network access has two owners | `api()` in `app.js`; direct refresh `fetch()` in `dashboard-ui.js` | Refresh uses a separate error/transport path |
| Medium | Shared utilities belong to unrelated page files | `chartOpts()` in `history-ui.js` is used by Dashboard, Decision Center and Mix | Shared charts depend on loading a history page script |
| Medium | The shell includes domain computations | `app-shell.js` contains `dcComputeFormulaResults`, `dcFormulaHit`, `dcFormulaBaseP` and `dcFormulaBacktestRows` | Shell/init and Decision Center responsibilities are mixed |
| Medium | Report persistence belongs to Decision Center | `savePageSnapshot()` and `renderPageSnapshots()` in `decision-center.js` serve Predict and Formula | Independent views depend on Decision Center implementation |
| Medium | Styling lacks clear ownership | The HTML shell has 111 lines containing `style=`; feature CSS and shared tokens live in one stylesheet | Theme and responsive changes require searching across markup and generated HTML |

The existing last-request guards, explicit Astra inference and pure Buy Plan
functions are useful boundaries and should be retained. Browser report snapshots
are intentional immutable client artifacts; they are not a second live cache of
server state. Backend Astra snapshots remain server-owned data.

## Proposed ownership

Keep one lottery domain and organize frontend capabilities within it:

| Owner | Responsibility | Public interface |
|---|---|---|
| App shell | Navigation, boot, theme and shared target selection | Mount/navigate and target-change events |
| Shared API client | HTTP, JSON parsing, standardized transport failures | Request/query/mutation methods |
| Shared query layer | Server data keyed by endpoint and normalized parameters | Read, invalidate and subscribe |
| Shared presentation | Number/date formatting, charts, status presentation | Pure helpers and reusable renderers |
| Reports | Saved browser artifacts, provenance, quota handling and export | Save/read/export; no prediction execution |
| Formula | Formula input drafts, computation and formula view | Compute/read results; private formula UI state |
| Astra | Version choice, requested target and report rendering | Select version, read status, explicit calculate |
| Predict | Prediction options and ranked report rendering | Mount, calculate and capture a report |
| Decision Center | Combine sources and render its existing prospective record | Public score/source view models |
| Mix | Vote aggregation and its existing first-per-target record | Compute/render Mix output |
| Buy Plan | Budget/config draft, allocation, saved plans and resolution | Pure `bpBuildPlan` / `bpResolvePlan` plus page actions |
| History / Frequency | Read historical tables and frequency reports | Page mount/filter actions |

Once native ES modules are introduced, each feature can expose an `index.js`.
Cross-feature imports should use that entry point. Pages should be directories
with their renderer, styles and route/data README together. Private state stays
inside its feature. Create these folders when moving their actual owners; empty
framework-style scaffolding is unnecessary for this existing application.

## Server data versus UI state

- Server/query state: historical rows, summaries, cache health, prediction
  responses and backend automation status. Store these in the query layer.
- UI state: selected method/version/target, sorting, filters, open disclosures,
  budget settings and editable plan. Keep one cohesive UI state boundary per feature.
- Derived values: calculate from query data and UI settings; do not keep another
  independently mutable copy when they can be derived.
- Saved reports/plans: explicit immutable or editable client records, according
  to their existing domain contract. Store these in the Reports/Buy Plan boundary.

An API cache must not change statistical behavior. Do not automatically fetch
prediction endpoints, infer Astra on selection, reuse a report for a different
target, or evaluate a holdout. Cache ordinary history reads by their actual
parameters; define mutation invalidation explicitly. A raw-cache digest and an
eligible-input digest identify different objects and must remain distinct.

## Refactor order

1. Extract the shared API client and route refresh through it. Preserve quiet
   request behavior and strict Astra domain validation.
2. Extract chart/format helpers and report storage into their actual shared owners.
   Keep saved record schemas and existing storage keys readable.
3. Introduce native ES module entry points and thin page mounting. Remove the
   inline-event dependency on global functions gradually, using event delegation.
4. Migrate one feature at a time, starting with Astra's existing isolated report
   path. Separate its query data from its version/target UI state before repeating
   the pattern for Predict and Buy Plan.
5. Move each migrated page's styles beside it; retain shared HyperUI tokens.
   Remove static inline styling as the corresponding renderer is migrated.
6. Enforce public-entry imports, network ownership and query/UI state boundaries
   with source checks. Add real module integration coverage: assembled VM sources
   alone do not enforce native import boundaries.

This order follows ADR-0005's current no-build runtime. Native ES modules are a
later runtime change and require updating that ADR, HTML loading, script manifest
contracts and VM test loading together. React or a new state library is not needed
to resolve the findings above.


## Implemented follow-up

- Shared transport, queries, charts and reports now have explicit public owners.
- API-derived source views and UI controls/drafts live in separate fixed state surfaces.
- Loose UI globals were replaced by feature state; Astra and shared implementations
  keep their backing state private inside closures.
- Decision Center domain helpers moved out of shell/init into their own entry point.
- Source checks enforce ownership and private boundaries; runtime tests use actual
  isolated files. Compatibility handler aliases retain the existing HTML runtime.

See `../adr/0006-frontend-state-and-public-contracts.md` for current contracts.
