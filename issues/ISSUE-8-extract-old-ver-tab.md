# ISSUE-8: Extract current สรุปงวดนี้ page into a new "(OLD VER)" sub-tab

## Parent

PRD-decision-center-rebrand-recommended-number.md

## What to build

Add a 4th sub-tab, "(OLD VER)", to the existing ทำนาย/สูตร page's sub-tab group (currently: ทำนาย / สูตรคำนวณ / สรุปงวดนี้), using the same `switchPredTab()` mechanism already driving the other three. "(OLD VER)" gets its own panel div and its own copy of today's Decision Center loader and markup, renamed so it doesn't collide with the version that will be rebuilt in the "สรุปงวดนี้" slot by the next issue — byte-for-byte identical behavior to what ships today, with zero functional changes.

This is a pure extraction/duplication step. It exists so the rebrand work in ISSUE-9 can take over the "สรุปงวดนี้" tab's id/position cleanly, without needing to preserve or work around the old markup in place.

## Acceptance criteria

- [ ] A 4th sub-tab labeled "(OLD VER)" appears in the same tab group as ทำนาย / สูตรคำนวณ / สรุปงวดนี้, toggled via the existing `switchPredTab()` pattern
- [ ] "(OLD VER)" renders using a renamed copy of the current Decision Center loader/markup (own div id, own function name) — not a shared reference to code the next issue will modify
- [ ] Every feature currently on สรุปงวดนี้ (Hero/Confidence board, Edge badges, auto-save snapshot, merged Snapshot + Track Record card, Hit-rate trend chart, on-demand Backtest panel, Data Health, Predict × สูตรคำนวณ ตรงกัน, สัญญาณจากรางวัลรอง, ตัดเลขเสี่ยง) works identically under "(OLD VER)" as it does today
- [ ] No change to any shared function, data fetch, or localStorage key used elsewhere in the app — the copy is additive only
- [ ] Manual browser check: switching to "(OLD VER)" shows the exact same page a user would have seen on สรุปงวดนี้ before this change, including a working auto-snapshot and Track Record

## Blocked by

None - can start immediately
