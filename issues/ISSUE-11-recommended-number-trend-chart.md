# ISSUE-11: เลขแนะนำ-specific hit-rate trend chart

## Parent

PRD-decision-center-rebrand-recommended-number.md

## What to build

Add a hit-rate trend chart specific to เลขแนะนำ, separate from the existing Pick hit-rate trend chart, so a user can directly judge whether เลขแนะนำ is actually more accurate than an ordinary Pick over time rather than assuming it. Built with Chart.js (consistent with the existing trend chart and the Backtest page's lift chart — no new charting dependency), computed from the same resolved-snapshot history now carrying เลขแนะนำ hit data (per ISSUE-10), using the same last-20-resolved / 5-round rolling average convention as the existing Pick trend chart.

## Acceptance criteria

- [ ] A new line chart renders เลขแนะนำ hit rate over the last 20 resolved (non-Pending) snapshots
- [ ] Includes a 5-round rolling average series, matching the existing Pick trend chart's convention
- [ ] Rendered as a genuinely separate chart/series from the existing Pick hit-rate trend — not merged into the same line
- [ ] Built with Chart.js, no new charting library added
- [ ] Manual browser check: chart renders without console errors once at least a few resolved rounds with เลขแนะนำ data exist

## Blocked by

- ISSUE-10 (needs resolved snapshot history with เลขแนะนำ hit data to chart)
