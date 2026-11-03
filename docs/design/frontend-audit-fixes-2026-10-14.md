# Full frontend audit fixes — verification 2026-10-14

## Changes completed

F01: global theme-aware button defaults + number-button backgrounds/focus.
F02: current/legacy Decision Center reject failed/partial required inputs before
scoring or save, clear current draft on error, refuse empty picks in auto-save,
and ignore stale requests via private UI-store request generations.
F03: shared strict canonicalReportDate/latestEligibleDate, ISO filtering/sorting;
new Formula/Decision provenance uses valid latest eligible date. Old immutable
records retained with explicit unverified legacy-date note.
F04: removed hardcoded Dashboard Lift; unavailable widgets show error state.
F05: 112px fixed mobile nav items, nowrap labels and scroll-snap, padding clear of footer.
F06: one primary Decision action; Beam/Pool inside advanced disclosure.
F07: metadata/control scale raised; small status/copy badges readable.
F08: flat surfaces, semantic status/chart colors, chart fonts/grids/tooltips follow
theme; chart registry synchronizes themed datasets and axes on theme changes.
Formula-group semantic palette remains defined separately.
F09: v1 score display rounded to four decimals only; full raw report unchanged;
Sigma components moved to labeled disclosure; duplicate 35-day warning removed.
F10: Buy Plan detail toggles name the number and point to controlled detail IDs.
F11: report timestamps rendered in Bangkok/Thai; registry source labels localized,
technical JSON/fingerprint nested in details, no separator without version hash.
F12: tests count real page containers and check agreed gold state/minimum badge
size; undefined --text1 references removed.

## Evidence

- All 36 Node frontend suites pass (test-results.json).
- New tests exercise invalid/calendar/cross-month/target-date normalization and
  both Decision API failure paths; no auto-save called and drafts clear.
- Final browser matrix: 150 view/theme/viewport checks, all 7 navigation targets
  match, no native rgb(240,240,240) buttons detected, no document horizontal
  overflow, no captured console errors/warnings.
- Viewports: 390x844, 768x1024, 1440x900; light/dark.
- Formula live cutoff now 2026-08-09 for synthetic rows where lexical cutoff was
  previously 20/07/2026. Existing saved metadata remains readable with caveat.
- Dark sampled green copy button contrast improves 1.23:1 to 10.45:1 against its
  actual surface. This is sampled contrast, not WCAG certification for all UI.
- Browser error fixture for a fresh target shows explicit 'ยังไม่บันทึก' in both
  Decision versions; no fake data/report rendering (browser-failure-proof.json).
- Additional Astra v1/Sigma and both Buy Plan modes inspected; screenshot
  decision-mobile-after.png captures fixed controls and mobile nav.
- git diff --check clean.

## Limits

Synthetic HTTP fixture only; no production API worker, history refresh, real
backtest, inference on real draws, commit or push. Not all storage quota/corrupt
store cases, every clipboard/export/destructive flow, every browser, zoom or
screen reader certified. Old stored snapshots not rewritten or deleted.
Initial cache asset version: `fullauditfix20261014`. The subsequent all-pages
semantic/responsive follow-up uses `frontendui20261014d`; see
`docs/design/frontend-ui-engineering-2026-10-14.md`.
