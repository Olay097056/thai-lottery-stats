# Predict, Mix, and Buy Plan UX changes — 2026-10-16

## Scope

Desktop workflows for Predict / Formula (including Astra), Mix (ไม่รู้ซื้ออะไรดี), and Buy Plan. The existing HyperUI light and dark themes, lottery data, formula calculations, API response schema, and saved-plan schema remain the product contract. Mobile UX is out of scope for this effort.

## Changes

- Astra's calculate action no longer waits on unrelated legacy formula history autofill. The action stays available until Astra itself is loading. An invalid or empty target date now stops before the request; a valid date that is not after today rolls forward to the next draw date, and the UI reports that target.
- Astra v1, automation status, and Astra-Σ preserve HTTP 400/503 causes from the API and show only allowlisted Thai explanations. Network failures stay separately retryable; malformed successful reports say that data was not displayed and do not imply a network outage. Existing endpoints and payload schemas are unchanged.
- Mix separates loading, valid empty history, no generated predictions, ready, and API error states. Loading a new target clears old history/picks; failures offer retry and never leave stale picks available for selection.
- Mix's first-write-only snapshot behavior is stated accurately: a new draw confirms that its first set was recorded, while reopening a draw explains that the displayed calculation may be current but the registered first set remains unchanged.
- Mix checks for an existing first snapshot before checking whether browser storage is writable. Reopening a draw in read-only storage remains a retained-snapshot state instead of showing a false save failure; new snapshots still require writable storage.
- Mix describes its random picker as rank-weighted, says that earlier ranks have more weight, and shows the chosen rank's `weight/total`; selection logic remains unchanged.
- Buy Plan keeps a manually edited unsaved plan when the user re-enters the same target. Before a different target, purchase mode, budget, or risk replaces that draft, the UI asks for confirmation and restores the prior control values on cancel; Mix handoff follows the same rule. A saved plan is not mislabeled as an unsaved draft, and an explicit action rebuilds from fresh data. A confirmed target change clears old sources before loading; complete target-matching predictions are required, while partial/error/empty responses remain distinct and retryable.
- The Mix-to-Buy Plan action carries the selected Mix draw into Buy Plan, including first visits and restored/custom dates absent from the default draw options. Missing options are created with text-only DOM APIs. It continues to fetch fresh sources and does not auto-save a plan.
- Choosing Mix from Predict's method guide carries the selected shared Predict draw into Mix before calculation. First visits populate the Mix dates; restored targets outside its default options are added safely. Direct Mix navigation continues to preserve its independent target.
- Predict validates dates from `/api/predict/all` and every `/api/predict/prize1` mode-comparison response against the selected draw before rendering candidates or saving. Missing/mismatched main results clear the report, keep Snapshot disabled, and show a recoverable error; comparison responses show per-mode errors. Async comparison results also require their originating request ID, selected date, and mounted panel to remain current. `/api/predict/all` already returned the normalized target; `/api/predict/prize1` now adds the date it previously omitted.
- Predict and Formula snapshot panels distinguish unreadable or malformed local history from a valid empty list. Each panel offers a raw backup of its own original bytes and a retry; save, load, and delete actions are blocked while that store is unreadable.
- Formula view validates each Luna and Fano v4/v5 response against the selected target date before rendering or retaining its five distinct six-digit candidates. Missing or mismatched target metadata, malformed numbers, duplicates, and incomplete candidate lists stay in a per-formula error state; leading zeroes remain valid and no formula score or persistence schema changed.
- Predict news results are bound to the selected draw with a request generation and exact target check. Changing the local or shared target hides and clears previous news; the news section exposes its busy state and names the target. `/api/lucky-news` now returns its normalized ISO target date.
- `/api/lucky-news` retries the next configured source after HTTP or connection failure and stops after its first successful response. If all sources fail it returns `ok: false`, `news_source_unavailable`, and a retryable safe message, while a successful empty search remains a normal empty result. Dependency-free route-body tests exercise empty success, source fallback, HTTP failure, and connection failure with stubbed HTTP; the Predict contract confirms failed requests clear prior candidates.
- Predict prize-one and lucky-news section headings no longer add a second 3px accent beside the shared HyperUI section marker.
- Buy Plan source grouping recognizes Luna and Fano alongside existing formula sources so the displayed explanations remain intact.
- Buy Plan labels each per-number historical value `Edge ชุดสูตร` and places its meaning above the rows: it is the highest candidate-set Edge among formulas supporting the number, in percentage points against each formula's random baseline; it is not the number's odds and is not used for monetary EV. Ticket mode has no per-number Edge note. Expected return uses only the configured payout schedule and random baseline; ticket EV follows the configured ticket price, and empty plans do not show a misleading zero EV.
- Buy Plan disables saving when there are no wagers or when an identical target/mode/payout/wager set is already in the ledger. The saved state remains detectable after reload; changing the actual wager, target, or payout re-enables a new record. This blocks accidental duplicate ledger entries without changing the saved record format.
- Buy Plan treats malformed or inaccessible saved history as a storage error instead of an empty ledger. Save and delete are blocked until history is readable; the UI offers a raw JSON backup and retry while preserving original bytes, storage key, and record schema.
- Mix applies the same data-preservation rule to its first-snapshot history: malformed, unexpected, or unreadable storage is shown as a recoverable error; autosave and delete are blocked; raw backup and retry remain available. Missing keys, valid empty arrays, and legacy snapshots without `picks` retain their existing behavior.
- The combined browser-local report export reads stores independently. It continues with readable and missing stores when another is malformed, has an unexpected shape, or throws on read; malformed raw values are retained in optional per-store error metadata, inaccessible values are identified without exception details, and the UI reports a partial export. Fully readable exports retain the existing payload shape.
- Buy Plan calls out the exact amount over budget after manual edits in both wager modes. The warning disappears at or below budget, and saving remains available so the ledger can capture what was actually bought.
- Predict / Formula / Astra supporting panels now use the existing full 1px HyperUI borders instead of thick side or top accent rails; status and target meaning remains in text and semantic colors.
- Shared loading/error notices use existing HyperUI semantic color tokens and are announced as busy or alert states.
- Predict keeps method/version, generated time, history cutoff, and source visible in the report-origin card; the full SHA-256 fingerprint is available in a collapsed native details disclosure with a verification-scope label and copy action. The report and snapshot values do not change.
- Formula Backtest shows the active data/engine stage and elapsed time, explains why report selection can be smaller than the rolling forecast scope, marks incomplete formula results as partial, and offers retry in the same panel when an API failure is retryable. Candidate generation, scores, APIs, and saved data are unchanged. Two 20-draw desktop runs completed in 1:37 and 2:07; profiling/optimization is tracked separately.
- Rolling Edge now subtracts the formula's configured random baseline whenever that rolling window has valid scored targets, even if the selected report period has none. The empty-window Edge stays unavailable, as do the selected-period metrics.
- Fano v4 Backtest carries beam-search prefix mismatch counts forward and reuses row Hamming distances during coordinate optimization. A same-cache, same-target 200-draw comparison returned identical forecasts, skipped targets, provenance counts and hashes while reducing one run from 76.76 s to 64.38 s. This is an observed Fano-only generation-time improvement; forecast ranking and odds are unchanged.
- Formula's initial visit uses one `prize-history` response for both target-option dates and autofill values, removing a sequential duplicate history request. Manual refresh and re-entry still fetch fresh data; errors remain distinct from valid empty history.
- Buy Plan totals now state the exact remaining budget in both purchase modes after allocation or manual edits; over-budget warnings and exact-budget behavior remain distinct.

## Buy Plan Edge sample context

Buy Plan shows the number of historical target draws behind the highest supporting formula-set Edge beside each number. The page context distinguishes total source history from the existing maximum 80-target Backtest window. Sample counts are derived from existing backtest rows and remain transient; ranking, allocation, EV, API responses, and saved-plan records are unchanged. The live desktop review showed the 260-row history, 80-draw window, and `80/80 งวด` row sample without saving a plan.
## Formula Snapshot action state

The Formula Snapshot action is disabled until a completed calculation has saveable candidates. Loading, calculation, invalidation, empty results, and the separate Astra report flow are reflected in the disabled state and adjacent status text. No save-handler, API, or persisted snapshot schema change is required.

## Formula calculation progress

The existing Formula loading/status region announces five ordered stages: local formulas, Luna v1, Fano v4, Fano v5, and final summary/provenance. These messages expose the work already performed without changing any calculation or API contract.

## Buy Plan announcement scope

The editable plan and history ledger are not a live region, since each plan paint replaces both. A separate screen-reader-only atomic status announces loading and a short summary of row count and spend versus budget. Empty, partial, and error states retain their in-context status or alert announcements.

The unsaved-draft guidance is ordinary visible content rather than another live region; it contains a rebuild button and is repainted with every edit. The separate atomic plan summary continues to announce concise row-count and spend changes, avoiding repeated long warnings while keeping the rebuild action keyboard-accessible.

## Buy Plan deletion focus

After deleting a number, focus moves to the row now occupying its index, or the preceding final row if the deleted row was last. When no rows remain, focus moves to the manual number field for the current purchase mode.

Deleting a saved ledger entry follows the same pattern and returns focus to the next available delete action; an empty ledger returns focus to its heading. The existing undo action remains available.

Saved Buy Plan IDs are rendered only as escaped data attributes. Delete handlers read them from `dataset`, avoiding inline-JavaScript interpolation for values restored from browser storage.

Predict and Formula Snapshot controls also keep stored IDs in escaped data attributes. After deleting a Snapshot, focus moves to the next item or to the empty-state message when the list becomes empty. Confirmed clear-all moves focus to that same empty state; canceling preserves the record list and focus.

Mix history deletion follows the same keyboard pattern: after rerendering, focus moves to the next record at the deleted index, or to the preceding last record. Removing the final entry or clearing all history focuses the empty-state message; canceling clear-all leaves focus and history unchanged. The existing undo action and snapshot records are unchanged.

## Backend contract

The additive backend response changes in the follow-up are a normalized `date` on `/api/lucky-news`, an exact target on `/api/predict/prize1` (previously omitted), and a retryable safe API error when the news source is unavailable. Astra's existing 400/503 details are now preserved and mapped by the client without changing route contracts. `/api/predict/all` already returns `report_status: partial` and its normalized requested date. Buy Plan rejects partial reports and any prediction response whose target date is missing or differs from the selected draw before it makes a plan available. Predict applies exact-target checks to its main report, mode comparisons, and news before it renders candidates, and only enables Snapshot for a matching report. The Edge-to-EV correction is also client-side: Backtest exposes a set-level hit-rate difference and Buy Plan no longer treats it as a per-number probability. The prize-one and lucky-news production route bodies and GET declarations have dependency-free regressions; both target-bound Predict routes pass synthetic FastAPI `TestClient` request/response regressions covering dates, leading-zero candidates, report envelope/provenance, safe partial failures, and invalid-date errors.

Missing backend target dates and next-draw options use the shared fixed UTC+7 Thailand clock. Legacy calculations continue to receive naive Thailand wall time, and explicit ISO-date requests and JSON shapes remain unchanged.

Analysis GETs read only an existing local cache. A missing file returns structured `cache_missing` with refresh guidance: DataFrame-backed analysis endpoints use 503, while `/api/data-status` uses 404. An unreadable or malformed file returns structured `cache_invalid` 422 without parser internals. Neither condition starts a network scrape. `POST /api/refresh` remains the explicit cache creation/update path, including first-time bootstrap.

## Validation

See the active issue log at `.scratch/three-tabs-ux-2026-10-16/progress.md` for the commands and outcomes. Focused Node contracts cover Astra button/date behavior, HTTP failure normalization and safe error copy, malformed report and network states, Mix empty/error and immutable first-snapshot states, cross-tab date transfer, Buy Plan stale-state invalidation/partial-data rejection, duplicate-save prevention, corrupt-history preservation, source group mapping, candidate-set Edge / monetary EV separation, visible set-level Edge wording, ticket-mode separation, and report-provenance disclosure/copy behavior. The Predict API contracts use synthetic fixtures; the HTTP-boundary contract uses FastAPI `TestClient` without opening the real cache. Desktop review at 1440 × 900 used isolated local origins with synthetic or read-only data; the EV and duplicate-save follow-ups also reviewed Buy Plan at 1270 × 720. The local server was unavailable during the corrupt-history state review; its rendered DOM behavior is covered by focused contracts. No production snapshot or plan was saved.

## Limits

Forecast or recommendation quality was not changed or implied. The observed Fano v4 Backtest latency reduction is from one cache snapshot and does not establish an identical improvement on other machines or cache states; Luna and Fano v5 request costs remain. The fixture's generated statistics are presentation-only. The global accessibility contract now passes after its matchers were aligned with native headings and buttons. The Impeccable detector remains degraded because parser modules are unavailable; its one flat-type warning points to sidebar draw metadata already reviewed in issue 41.
