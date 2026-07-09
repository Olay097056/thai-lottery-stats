# ISSUE-18: แก้ก่อนเซฟ + บันทึก/ล็อกชุดซื้อ + resolve เป็นบาท + ledger สะสม

## Parent

PRD-buy-plan-tab.md (governing ADR: docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md)

## What to build

The full lifecycle of a ชุดซื้อ on top of ISSUE-17's page, for the แทงรายเลข mode: edit → save (lock) → auto-resolve in baht → all-time ledger.

**Edit before save.** Every row in the generated plan is editable: change a stake, delete a row (its money is NOT silently redistributed after manual edits — the user is now in control; just show the new total and recomputed EV), and add a hand-typed number (digits + bet type + stake). Any hand-touched or hand-added row carries the แก้เอง label, kept through save and into history so system-pure P/L stays separable from human-adjusted P/L. EV คู่ recomputes live as rows change.

**Manual save, then immutable.** A "บันทึกชุดนี้" button (never auto-save — this records the user's spending decision, unlike the Decision Center's auto-snapshot which records the system's opinion) writes the plan to a NEW localStorage key (own key, separate from every existing snapshot store): mode, budget, risk, target draw date, every row (number, type, stake, source, trust, แก้เอง), the payout config copied by value, and the EV คู่ shown at save time. Saved plans cannot be edited — delete-whole-plan is the only mutation. Later config changes must never alter a saved plan's recorded numbers.

**Resolution in baht.** The second seam, `bpResolvePlan(plan, actualDrawRow) → resolution`: per-row ถูก/ผิด and baht returned (hit = stake × the payout frozen in the plan), per-plan net P/L (returned − budget). Hit definitions are exact per bet type: `bottom2` vs the draw's 2 ตัวล่าง, `prize1_last2` vs the last 2 of รางวัลที่ 1, `back3` vs the last 3 of รางวัลที่ 1. Reuse the established ISO-target-date → history-row lookup convention from the Decision Center track record; plans whose draw hasn't published stay Pending. Resolution runs automatically when the page loads.

**All-time ledger.** A history section at the bottom lists saved plans (Pending/resolved with net P/L, แก้เอง labels visible) and a cumulative header: "ซื้อ N ชุด รวม X฿ ได้คืน Y฿ = net −Z฿", shown next to the random-play expectation for the same stakes (theoretical EV of the money actually wagered) — the honest answer to whether the system's Edge shows up in real money.

## Acceptance criteria

- [ ] Rows are editable (stake change, delete, hand-add with number/type/stake validation) and EV คู่ recomputes live; hand-touched rows carry แก้เอง
- [ ] Save writes a complete frozen record (including payout config by value and save-time EV) to its own new localStorage key; saved plans render read-only with delete-whole-plan only
- [ ] Changing the payout config after saving does NOT change any saved plan's stakes, recorded EV, or later-resolved P/L (fixture test)
- [ ] `bpResolvePlan` fixture tests: each bet type's hit definition; a winning row pays stake × frozen payout; plan net = returned − budget; unpublished draw → Pending
- [ ] แก้เอง flag survives save and resolution and is visible in the history list
- [ ] Ledger fixture test: totals over a mix of pending/won/lost plans sum correctly and the random-play comparison uses the actually-wagered amounts
- [ ] Pending → resolved transition happens automatically on page load once the draw exists in history
- [ ] Full test suite stays green

## Blocked by

- ISSUE-17
