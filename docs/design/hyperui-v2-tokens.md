# lottery_stats — HyperUI v2 token port

**_Source of truth:** `switch-wr-tool/docs/design/hyperui-v2-tokens.md` (canonical,
cross-project). This file records ONLY this project's port specifics.

**Governing design system:** HyperUI (hyperui.dev) — light-first, flat, single
brand primary. Applied 2026-08-11 per `.scratch/hyperui-redesign/` (grilling
D1/D2/D3). Same rollout as switch-wr-tool / portfolio-tracker / printer-monitor /
Line_auto_msg.

## This port's decisions (grilling, .scratch/hyperui-redesign/issues/02)

- **D1 — Single brand primary = GOLD** (lottery golden-ticket identity):
  - LIGHT: `--gold:#b45309` (amber-700, readable on white), hover `--gold2:#d97706`.
  - DARK: `--gold:#ffd60a` (bright gold), hover `--gold2:#ffe14d`.
  - `--accent` (was blue `#0a84ff`) retired from interactive role → re-valued to the
    theme gold primary. Blue accent tints swept to `--gold-soft`/`--accent`.
  - **Group/formula colors stay literal hex** (#3dd68c/#4d9de0/#fbbf24/#f05454/…) —
    never routed through theme vars (semantic, untouched per lock).
- **D2 — Dark = HyperUI gray** (consistent cross-project):
  `--bg:#111827` / `--surface:#1f2937` / `--surface2:#374151` / `--surface3:#4b5563`.
- **D3 — Scope:** full re-token (tickets 03–07) single pass, combined review.

## Token mapping (re-value, don't rename)
Kept every existing `--var` name; only VALUES changed, plus two new semantic
tokens `--gold-soft` and `--fill` (nested-card fill):
- `:root` = light (gray-50 page #f9fafb, white cards, slate text, gold primary).
- `[data-theme='dark']` = HyperUI gray overrides + bright gold.
- Status: added `--<color>-soft` / `--<color>-text` pairs (green/red/orange).
- Glass retired: `--surface-glass` → solid surface, `--glass-blur → none`
  (flat rule); macOS glass sidebar → solid `var(--surface)`.

## Theme mechanism (vanilla JS SPA)
- DOM: `<html data-theme="light|dark">`; no-FOUC inline `<script>` in
  `static/index.html` `<head>` reads `localStorage['lottery_theme']` before paint.
- Storage key `lottery_theme`; default **light** (HyperUI light-first).
- `app.js`: `_applyTheme/getTheme/toggleTheme` + sidebar `#theme-toggle` button
  (🌙/☀️) in the sidebar footer.

## Verification (2026-08-11)
- Node suite 17/17 green (theme is display-only; no behavior change).
- Headless-CDP (port 9223): default light body `rgb(249,250,251)`, card white,
  toggle → dark `rgb(17,24,39)`, persists after reload, toggle back, predict page
  renders, **0 JS errors**.
- cache-bust: `?v=hermes3 → hermes5` (app.css / app.js / index.html).

## Follow-ups (known, cosmetic)
- A few nested dividers (consensus section) still use subtle white-alpha borders —
  read acceptably in light but intentionally left (deliberate restraint).
- A couple light group-chip hexes have lower contrast on white (locked by D1 —
  semantic colors unchanged). Eyeball on real device if strict.
