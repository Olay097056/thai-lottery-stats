# astra automation — owner-approved follow-up

Status: Locally implemented and verified on 2026-10-08, including authorized new-draw ingestion, one actual automatic capture, persisted/API/DOM readback. No commit, push, deployment or always-on service installation.

## Authorization and unchanged boundaries

The owner approved: detect newly released results -> update the cache -> compute frozen astra for the next draw -> save the prediction automatically. This explicitly expands the original PRD-astra.md read-only delivery permission for this follow-up only. It authorizes ingestion of NEW draws and future-only inference, not rescraping/correcting existing draws, historical prediction, backtesting, holdout reuse, tuning, promotion, deployment, staging, committing, or publishing.

Keep astra.py's formula, constants, ranking, version, and pure/read-only interfaces unchanged. Keep analyzer.py, formula-engine.js, default rankers, the old prospective cohort, prior astra capture, real-result demo files, and restricted CLAUDE.md untouched. Existing manual refresh retains its behavior, but must serialize against the new writer. No new packages or paid integrations.

## Runtime and persistence

- Start one cooperative background worker per FastAPI process using lifespan; importing modules or reading an API endpoint must not start jobs.
- Enabled by default for this owner-approved local app; ASTRA_AUTO_ENABLED=0 is a startup kill switch. No OS task/service/remote cron is installed. The backend and network must be available; closing only a browser tab does not stop the backend, but stopping the backend or computer does.
- Check on startup and every 900 seconds. Persist the next-check time, serialize writers across threads/processes, and do not multiply source polling on reload/multiple workers.
- Use existing integrated provider Sanook for new full draw records. Do not call scraper.load_data/incremental_update/force_refresh from this worker: those paths can scrape the past or overwrite old results. Fixed HTTPS hosts/paths only, bounded response bodies/timeouts, no redirects to arbitrary origins, sanitized errors, no secrets.
- Source index discovery reads dates; download draw details only for dates strictly newer than the existing cache maximum and no later than the Thailand day. Catch-up is oldest-first and capped at four new draw pages per check; never generate predictions for elapsed targets or skip a missing/incomplete draw silently.
- Require valid complete astra categories in a newly ingested draw: prize1, front3, official back3, bottom2, prize2 x5 unique, prize3 x10 unique, prize4 x50 unique; preserve ASCII digit strings including leading zeros. Validate available additional prize fields too. Missing/invalid/duplicate/incorrect-date source data remains pending/error and is retried without storing a partial draw.
- Preserve existing CSV bytes/rows and column order; append new complete records through same-directory temporary-file fsync + atomic replacement, verify the original has not changed, and share a cross-process lock with the manual refresh route. An absent/malformed cache is an explicit blocker, never permission to download all history.
- Store automatic reports in ignored astra_runtime/automation.sqlite3, separately from real outcomes and all older prediction stores. Unique key (formula version, source draw date, target date). Reports are immutable; status updates are separate. Store the full engine report, generation time, cache and engine SHA-256, source identity, and calendar provenance. Reading back the persisted report is part of successful capture.
- A crash between cache append and snapshot save must recover on a later check. Repeated checks/restarts must not re-infer or duplicate an already captured key. Never overwrite the earlier manually captured astra report.
- Resolve dates from the GLO website's own read-only POST /api/lottery/getLotteryMasterDataList (no credentials or submitted personal data). Its public frontend calls this endpoint; verified HTTP 200 returns response.data with date/month/year strings, including a future date and shifted dates. Use the earliest listed date strictly after the latest ingested draw, never the next nominal 1/16 date. Discovery uses calendar metadata only; result details still come from the existing Sanook provider. Fail closed when that date is absent, elapsed, inconsistent, or not strictly future in Thailand. Do not skip an unreceived intermediate draw. The endpoint and its source format were checked on 2026-10-08, including the 2026-10-16 upcoming date and January/May shifted metadata; no outcomes were evaluated.
- Invalidate/reload the in-memory dataframe when the result cache changes; do not alter the default prediction algorithms.

## Additive read-only API and UI

- GET /api/astra/automation?date=YYYY-MM-DD returns worker status and an optional saved snapshot for that target, without creating storage, polling sources, modifying results, or invoking inference.
- Status includes enabled/running, phase, polling interval, last/next check, last success, latest source/target dates, snapshot count, and an allowlisted safe error; never return internal paths or raw exception strings.
- Snapshot envelope holds version, source draw, target, capture time, provenance hashes, and the unchanged astra report schema (report.source remains existing_local_cache).
- The astra tab shows the actual auto status and prefers the stored automatic report for the selected target. Keep manual read-only recomputation available and label it distinctly. No old result should be presented under a new target. Validate and escape the status/snapshot payload, preserve existing request-generation and target-race protections, and show stale/error states honestly.
- Offer an explicit astra-only automatic-target button when the GLO target differs from the nominal shared selector. Reading status must not silently change the shared target; choosing the button is GET-only, and changing the shared date clears the override.
- Do not connect astra to historical scoring, Mix, Picks, Buy Plan, or backtest tables. Update all three static cache-bust versions together if static assets change.

## Verification plan

| Claim | Verification | Expected |
|---|---|---|
| Only complete, correctly dated new draws enter | Synthetic Sanook HTML + mocked real HTTP transport tests | Strict counts/ASCII/date identity; no token repairs; bounded requests |
| Old data remains unchanged | Synthetic CSV bytes before/after, malformed/conflict/failure injection | Original bytes are a prefix; no partial writes or duplicate dates |
| Concurrency and retry are safe | Separate-process lock test; repeated ticks/restarts; partial-draw and persistence-failure fixtures | One successful capture per key; recoverable pending state |
| Formula untouched | SHA-256 and git path checks for protected engine/default files | Same astra core and default formulas |
| Future-only automatic capture | Fixed Thailand clock, shifted-date fixture, elapsed target | No inference for today/past; calendar provenance retained |
| Background lifecycle is real | FastAPI lifespan with synthetic source + temporary storage | Runs without opening UI; startup/shutdown/disabled verified |
| GET is read-only | Count source/inference calls and storage before/after status/snapshot GET | Zero work dispatched by GET; malformed storage fails closed |
| UI is honest | Node VM contract tests and isolated synthetic browser server | Status and saved-report provenance, target races, mobile/desktop, no console errors |
| No regression | Affected Python suites and each current scripts/test_*.js | No new failure; protected legacy docs failures reported separately |
| Real source integration | Parent-only bounded live cycle AFTER synthetic proof/review | Actual source/capture or explicit blocker, never fabricated data |

Use the configured project Python with inherited PYTHONPATH/VIRTUAL_ENV removed. Tests/reviewers must never open real result CSVs, demo outcomes, old snapshot JSONL, or old captured reports. Use synthetic fixtures in temporary storage. Preserve the pre-existing uncommitted astra delivery; do not stage/commit/push this follow-up.

## Work slices and ownership

1. New-draw source adapter and synthetic HTTP/parser tests: independent of storage/calendar. No file I/O or inference in adapter.
2. Cross-process lock, append-only CSV transaction, immutable snapshot store: synthetic-only tracer bullets.
3. Calendar seam + cooperative worker + lifespan/status API: wire verified pieces, test crash/retry/restart and data-cache invalidation.
4. Existing astra tab: truthful auto status and saved-report preference, synthetic tests/browser proof.
5. Regression, parent cross-layer source review (including independent UI handoff verification), then bounded parent live execution/readback and delivery evidence.

## Framework references

- FastAPI lifespan: https://fastapi.tiangolo.com/advanced/events/
- Python 3.12 threading.Event: https://docs.python.org/3.12/library/threading.html#threading.Event
- SQLite transactions/read-only connections: https://docs.python.org/3.12/library/sqlite3.html
- Atomic same-filesystem replacement: https://docs.python.org/3.12/library/os.html#os.replace

## Delivery evidence

- Direct regression: `.scratch/astra-automation-2026-10-08/regression-final.json` — 177 Python unittest cases in 13 suites passed; Node 30/31 files passed. The sole failing file has the two pre-existing protected CLAUDE.md documentation mismatches.
- DOM proof: `browser-proof.json` in the same directory, with synthetic worker/lifespan/API, persisted-report preference, keyboard actions, shifted targets and responsive checks. `final-review.md` records the parent review and its limits.
- Live integration: two earlier checks failed closed before append/inference due to a wrapped publisher disclaimer; both audits are retained. After the strict wrapped-footer fix, the naturally due check at 2026-10-08T18:21:04+07:00 appended only 2026-09-16 and 2026-10-01 (781 -> 783 cached rows), preserved every old byte, and invoked frozen astra once.
- Capture: target 2026-10-16, generated 2026-10-08T18:21:05.026539+07:00, source cutoff 2026-10-01, one immutable snapshot in astra_runtime/automation.sqlite3. Immediate repeat tick dispatched no source or inference calls. Evidence: live-cycle-182104.json.
- Actual readback: browser-actual-proof.json confirms every displayed chip matches the saved report (25 in 7 categories), the production GET handler returns the exact persisted snapshot with no-store, and storage bytes remain unchanged. The readback server explicitly forbids worker start, inference and historical UI boot; it is not a deployed/always-on app.
- The prior manual capture and all seven protected source hashes remain unchanged. Exported automatic report: .scratch/astra-automation-2026-10-08/astra-auto-v1-2026-10-16.json.

Synthetic tests prove implementation behavior, not lottery accuracy. This feature remains experimental.
