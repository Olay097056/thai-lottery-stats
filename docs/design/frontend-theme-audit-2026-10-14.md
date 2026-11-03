# Frontend theme audit — 2026-10-14

Scope: supplied dark-theme Backtest screenshot plus static code inspection.
No live browser, light/mobile rendering, contrast measurements or historical
backtests were performed. Runtime source files unchanged during this audit.
Reference: project HyperUI v2 tokens; flat gray surfaces, one gold primary,
semantic formula colors preserved.

## Findings

1. High — native white sort buttons. `history-ui.js:16` emits `.bt-sort-btn`
   but app.css has no matching style. Global button min-height/min-width at
   app.css:970 enlarges unstyled native controls. Define a transparent/inherited
   table-header button, token text, font inherit, hover/focus states and preserve
   44px hit areas and existing aria-sort/keyboard semantics.
2. High — dark status text uses raw `--red:#dc2626` on dark gray, including
   rolling losses, warnings and result badges. Inspect history-ui.js:18–45 and
   :70–78. Use paired --red-text/--red-soft, green equivalents. Group/formula
   palette is separately locked and must not be globally recolored. Visual
   contrast is suspect, not measured against WCAG in this static audit.
3. Medium — legacy macOS skin remains as later cascade in app.css:613 onward;
   typography, controls, segmented tabs, tables and shadows have overlapping
   rules. It does not mean the current entire page is macOS: base gray/gold
   tokens already match HyperUI. Consolidate per-component rules into one
   source, keeping theme vars, before adding further overriding CSS.
4. Medium — excessive text density: labels .66rem, summary detail .68rem,
   CI/baseline .72rem and rolling .7rem; truncated summary formula names.
   Enlarge reading text, establish heading/body/metadata hierarchy, use tabular
   numerals, retain complete formula names with wrapping where space allows.
5. Medium — active tab gold underline with orange fill inherited from
   data-color=orange; app.css:385 and :390. Navigation state should use the
   brand gold tokens consistently, retaining semantic colors for formula chips.
6. Medium — overall best hit rate compares different target boards, while the
   renderer also gives board-local summaries. formula-evaluation.js:464 ranks
   all fields by raw pct; misleading as a universal 'best formula' headline.
   Prefer board-local summaries or label target/type prominently. No metric
   formulas or scoring should be changed as part of theme repair.
7. Medium — mapping diagnostics banner dominates user content, repeated outer
   card + four summaries + per-board summaries + 11-column table. Collapse
   successful technical mapping into details, expose errors clearly, move
   uncertainty legend to an expandable explanation, lead with board selection.
8. Low — Thai/English labels mix without consistent hierarchy; wide screenshot
   has unused right margin because .page max-width:1400px (app.css:53).
   Right margin is not inherently wrong; choose a deliberate desktop content
   width and check table scrolling at mobile widths rather than making every
   panel full viewport width.

## Suggested sequence

A. Restore themed sort controls, paired status colors and gold active states.
B. Consolidate conflicting skin rules and typography/spacing tokens.
C. Reduce repeated summaries and technical diagnostics, clarify target boards.

## Review criteria for a future implementation

Verify light/dark, keyboard sorting and visible focus, responsive table scroll
at 390/768/1440px, no native white buttons, legible state colors, unchanged
sorting/statistics/API behavior. Use synthetic fixture rows; do not trigger
historical inference/backtests merely to review the appearance.

## Implementation follow-up

Applied theme sort buttons, paired red/green text tokens, gold tab states,
merged duplicate exact core selectors, flat body background/subtle dark shadow,
consistent body/mono font tokens and removed traffic-light decoration.
Backtest summaries stay within target boards; diagnostics and metric legend
collapse, target anchors support navigation, text/name wrapping is larger.
Edge display uses percentage points (pp), without altering scoring or sorting.
Cache version bumped. No browser verification or tests run in this change;
light/dark/mobile visual review remains unverified. No inference/backtest run.
