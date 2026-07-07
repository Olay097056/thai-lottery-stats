# ISSUE-10: Track Record + own Edge/baseline for เลขแนะนำ

## Parent

PRD-decision-center-rebrand-recommended-number.md

## What to build

เลขแนะนำ must never be presented as inherently trustworthy just because it converges — it gets tracked and backtested exactly like a Pick, with no exemption (per `docs/adr/0002-recommended-number-gets-honest-backtest.md`).

Extend the existing auto-snapshot write (the same one `loadDecisionCenter`/its rebranded equivalent already performs on every load, same `lottery_dc_snapshots` localStorage key) to also capture this round's เลขแนะนำ results per field type. Extend the existing shared hit-check function (already built for Pick tracking: `hit`/`miss`/`pending` by digit length) to classify each snapshotted เลขแนะนำ the same way — reused, not duplicated.

Compute a new Edge specific to เลขแนะนำ: actual เลขแนะนำ hit rate minus a new baseline that accounts for how many groups produce each field type (e.g. `bottom2` has 6 possible producing groups so coincidental agreement is more likely than `front3`'s 2-group ceiling — these need different baselines, not one shared number). Render this as its own metric, distinct from and never merged into an individual formula's Edge or a Pick's Final Confidence Score.

## Acceptance criteria

- [ ] Auto-snapshot now captures เลขแนะนำ results (per field type) alongside existing Pick/mode/date data, on every page load, using the existing snapshot-dedup-by-date behavior
- [ ] The existing shared hit-check function is reused (not reimplemented) to classify each snapshotted เลขแนะนำ as hit/miss/pending
- [ ] A new baseline is computed per field type reflecting that field type's known producing-group count (not one flat baseline shared across all field types)
- [ ] เลขแนะนำ's Edge = actual hit rate − its own baseline, rendered as its own labeled metric, never displayed as or merged into an existing Edge/score number
- [ ] Fixture-based test extends the existing Track Record test script (`scripts/test_decision_track_record.js`) with เลขแนะนำ hit/miss/pending cases, reusing existing hit-check fixtures rather than introducing new hit logic
- [ ] Manual browser check: at least one already-resolved past round shows correct เลขแนะนำ Hit/Miss status, and the current unresolved round shows Pending

## Blocked by

- ISSUE-9 (needs the computed เลขแนะนำ ranked results to snapshot and track)
