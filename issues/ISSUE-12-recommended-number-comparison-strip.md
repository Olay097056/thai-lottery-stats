# ISSUE-12: Comparison strip — เลขแนะนำ vs #1 Pick

## Parent

PRD-decision-center-rebrand-recommended-number.md

## What to build

Add a comparison strip showing this round's top-ranked เลขแนะนำ side by side with the current #1 Pick (from the existing Final Confidence Score list), so a user can immediately see whether the two independent signals reinforce each other (same number) or point at different numbers this round. Both values are already computed on page load (เลขแนะนำ per ISSUE-9, Pick via the existing, unmodified `dcBuildScoreRows`) — no new data fetch or computation needed beyond reading both existing results.

## Acceptance criteria

- [ ] A comparison strip renders this round's top เลขแนะนำ next to the current #1 Pick
- [ ] Visually distinguishes the "same number" case from the "different numbers" case
- [ ] No new data fetch — reads only from เลขแนะนำ and Pick results already computed for this page load
- [ ] No modification to `dcBuildScoreRows` or the existing Pick ranking
- [ ] Manual browser check: strip renders correctly for a round where เลขแนะนำ and the #1 Pick agree, and for a round where they differ (can use a synthetic/mocked round for the differing case if a live example isn't available)

## Blocked by

- ISSUE-9 (needs the computed เลขแนะนำ ranked result; existing Pick computation is already live and unaffected)
