# PRD: จัดชุดซื้อ (Buy Plan) — Explainability ("ทำไมได้เลขนี้ เงินเท่านี้")

Status: ready-for-agent
Governing docs: `docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md` (Buy Plan seams, EV คู่, honest P/L), ADR-0003 (ทดลอง badge semantics), CONTEXT.md glossary (จัดชุดซื้อ, ชุดซื้อ, เลขแนะนำ, ทดลอง, Mix).
Supersedes nothing — additive layer on top of the shipped Buy Plan arc (ISSUE-17→20).

## Problem Statement

The จัดชุดซื้อ page already turns budget + risk into a concrete spending plan, but it presents the result as a bare table — **เลข · ประเภท · เงิน**. The owner's own words for what's missing: **"ไม่รู้ว่าทำไมได้เลขนี้ เงินเท่านี้."** The page hands over numbers and stakes with no visible reasoning, so the owner cannot judge, trust, or confidently override them.

This is not a prediction-accuracy problem (exact prize1 > chance is mathematically impossible here — accepted). It is a **transparency** problem: every baht should explain itself well enough that the owner either agrees with it or edits it on purpose.

## Key Insight (why this is small, not a rewrite)

The reasoning already exists and is thrown away mid-pipeline:

- `dcBuildScoreRows` (app.js ~451) already accumulates, per number: `sources[]` (which formulas/signals pushed it), `reasons[]` (full Thai sentences, e.g. *"สูตร G แม่นขั้นเทพ สนับสนุน (backtest edge +2.1%)"*), `topEdge`, `formulaCount`, `predictCount`, `trust`, `warnings[]` (e.g. *"ไม่มีแรงหนุนจาก Predict"*).
- `bpBuildPlan` → `mk()` (app.js ~2924) copies only `num/field/len/tier/score/topEdge/trust/boosted/boostedScore` and **drops `reasons`, `sources`, `formulaCount`, `predictCount`, `warnings`**.
- `bpAllocateTier` (app.js ~2759) computes `boostedScore`, tier `total`, `share`, the floored stake, and the rank-1 remainder — then **discards every intermediate**, keeping only final `stake`.
- Ticket rows (`bpBuildPlan` ticket branch ~2910) already carry `sources`, `groups`, `trust`, `ladder` — none are rendered.

So "ทำไมได้เลขนี้" is **already computed** (just un-threaded), and "ทำไมเงินเท่านี้" needs only to **capture arithmetic that already runs**. No scoring, allocation, EV, resolution, or ledger logic changes.

## Solution

Surface a per-row explanation in both modes, using the **Inline + expand** shape the owner chose:

- **Collapsed row:** `เลข ⭐ · ●กลุ่มที่ตรง · <คำ+Edge> · เงิน · ▸`
  - `⭐` when the number is a เลขแนะนำ (already `r.boosted`).
  - `●กลุ่มที่ตรง` = colored dots for the distinct top-level formula groups backing the number, derived from `sources` via the existing `_GRP` map (name[0] → letter/color).
  - `<คำ+Edge>` = a plain-Thai strength word paired with the number, e.g. `หนุนแรง +2.1%`. Word thresholds on `topEdge`: `≥ +1.0% → หนุนแรง`, `0 to +1.0% → หนุนกลาง`, `≤ 0 or null → หนุนเบา`. The signed Edge number always renders next to the word.
  - `▸` toggles the expand.
- **Expanded row (two blocks):**
  - **ทำไมเลขนี้** — the `reasons[]` list rendered verbatim, plus any `warnings[]` shown as a muted caution line.
  - **ทำไมเงินนี้** — the money trace as one readable chain: `คะแนน 8.2 → สัดส่วนในกอง 12% → ×1.5 เลขแนะนำ → ปัดลงหน่วย 10 = 40฿`, appending `· +เศษที่เหลือของกอง` when the row received the rank-1 remainder.

**ลอตเตอรี่ใบ mode** reuses the same collapsed/expand pattern with ticket-appropriate content: dots/labels from `sources`/`groups`, an "เห็นตรงกัน N แหล่ง" line (agreement count), the ทดลอง badge from `trust`, and the fallback ladder เต็ม 6 → ท้าย 3 → ท้าย 2 from `ladder`.

The ทดลอง badge, แก้เอง label, EV คู่ card, save/resolve/ledger, and all existing stakes are unchanged. A hand-edited row (`r.hand`) shows a neutral "แก้เอง — ตัวเลขนี้คุณกำหนดเอง" note in place of the system money-trace.

## User Stories

1. As the owner, I want each number in the plan to show which formula groups backed it (colored dots), so that I can see at a glance whether it rests on one signal or many.
2. As the owner, I want a plain-Thai strength word next to each number (หนุนแรง/กลาง/เบา) with the real Edge beside it, so that I understand the confidence without decoding a percentage.
3. As the owner, I want a ⭐ on numbers that are เลขแนะนำ, so that the convergence signal that earns extra money is visible where the money is.
4. As the owner, I want to expand any row to read the full list of reasons the system already recorded, so that "why this number" is answerable in the owner's own language, not inferred.
5. As the owner, I want the expand to also show why a number got *this much money* as a step-by-step chain (score → share → boost → rounding → baht), so that stake sizes stop feeling arbitrary.
6. As the owner, I want the top-ranked number's "leftover remainder" called out in its money trace, so that the one row that doesn't follow the clean proportion is explained rather than looking like a bug.
7. As the owner, I want numbers with a warning (e.g. no Predict support) to surface that warning in the expand, so that weak picks are honestly flagged, not hidden.
8. As an online ticket buyer, I want each 6-digit ticket to show its sources, how many sources agreed, and its fallback ladder in the same expand pattern, so that ใบ mode is as explainable as แทงรายเลข mode.
9. As a careful editor, I want hand-edited (แก้เอง) rows to say plainly that I set the number myself instead of showing a system reason, so that the explanation never lies about a row I typed.
10. As the owner, I want the reasoning to be reading-only detail that defaults collapsed, so that the plan stays scannable and the numbers-first view I already have is unchanged.

## Technical Design

### Data (additive plumbing only)
- **`mk()` in `bpBuildPlan`:** carry `reasons`, `sources`, `formulaCount`, `predictCount`, `warnings` from each score row onto the candidate object (they already exist on the `dcBuildScoreRows` output). No new computation.
- **`bpAllocateTier`:** attach a `reason` object to each returned row: `{score, boostedScore, tierTotal, share, rawStake, roundedStake, gotRemainder:boolean, boostApplied:boolean}`. Every field is a value the existing loop already computes; `gotRemainder` is true only for index 0 (the row that absorbs `tierBudget − Σstakes`). This is the one genuinely new output.
- **Group derivation:** a small pure helper `bpGroupsForSources(sources) → [{letter,color,label}]` maps each source label to its top-level group via the existing `_GRP`/name[0] convention, de-duplicated, non-group sources (Predict/รางวัลรอง) excluded from the dots but still visible in `reasons`.
- **Ticket rows:** no data change — `sources`/`groups`/`trust`/`ladder` are already present on the row.

### Render
- New pure helpers returning HTML strings, mirroring existing `bp*Html` prior art: `bpRowExplainHtml(row)` (the expand body for แทงรายเลข), `bpTicketExplainHtml(row)` (expand for ใบ), and `bpStrengthWord(topEdge) → {word,cls}`.
- `bpPlanTableHtml` (app.js ~2954) and the ticket table renderer gain the collapsed-row extras (dots, ⭐, strength word) and a `▸` toggle wired to a lightweight `bpToggleRow(idx)` that expands/collapses the detail cell. Toggle state is view-only; it must survive `bpPaint` re-renders is **not** required (collapsing on repaint is acceptable — YAGNI).
- CSS in `app.css`: `.bp-group-dot`, `.bp-strength`, `.bp-row-detail`, `.bp-why-money`, reusing the existing macOS-dark palette and the `.trust-badge`/`.bp-handedit` styles already defined. Bump the `?v=` cache-bust on all touched static assets (project hard rule — CLAUDE.md).

### Testing
- Extend `scripts/test_buyplan_build.js` (vm-extracted, fixture-driven, no DOM): assert built rows now carry `reasons` (array) and a `reason` trace object; assert `reason.gotRemainder` is true for exactly the rank-1 row of each tier and false elsewhere; assert `bpGroupsForSources` de-dupes and maps a known source label to the right group letter; assert `bpStrengthWord` thresholds.
- **Regression guard:** existing assertions on stakes, tier sums, drop/redistribute, and remainder MUST remain green unchanged — the plan's numbers are identical, only new fields are added.
- Browser: verify collapsed row renders dots/word/⭐, expand shows reasons + money chain, ทดลอง badge still appears, and a แก้เอง row shows the neutral note.

## Scope / Non-Goals (YAGNI)
- **No** changes to scoring, allocation math, boost factor, EV formulas, resolution, or ledger — stakes and outcomes are byte-for-byte identical.
- **No** new persisted data; explanation is derived at render time from data the plan already holds. Saved-plan localStorage shape is unchanged (new fields are additive and ignorable by old resolve/ledger code).
- **No** narrative/paragraph summary (Approach C) and **no** separate side panel (Approach B) — inline + expand only.
- **No** visual redesign of the EV card, config flyout, controls, or ledger.

## Open Decisions — Resolved
- Collapsed-row confidence shows **word + Edge number together** (owner-approved default), not word-only or number-only.
- Strength thresholds: `≥ +1.0% หนุนแรง / 0–1.0% หนุนกลาง / ≤ 0 or null หนุนเบา` (proposal; adjustable in implementation, single source of truth in `bpStrengthWord`).
- Expand collapses on repaint (no persisted open-state) — acceptable per YAGNI.

## Implementation Order (for /to-issues)
1. Data plumbing: `mk()` carry-through + `bpAllocateTier` reason trace + `bpGroupsForSources`/`bpStrengthWord` pure helpers + their tests (no UI yet). Tracer, no blockers.
2. แทงรายเลข render: collapsed extras + expand (`bpRowExplainHtml`) + CSS. Blocked by 1.
3. ลอตเตอรี่ใบ render: `bpTicketExplainHtml` + collapsed extras for ticket rows. Blocked by 1 (parallel with 2).
4. Docs (CONTEXT.md note if a new term is coined, CHANGELOG, CLAUDE.md Buy Plan section) + `?v=` bump + browser verification. Blocked by 2+3.
