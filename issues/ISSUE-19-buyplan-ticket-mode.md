# ISSUE-19: โหมดลอตเตอรี่ใบ (online tickets, exact-number search ladder)

## Parent

PRD-buy-plan-tab.md (governing ADR: docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md)

## What to build

The second mode behind ISSUE-17's toggle. The owner buys government tickets **online**, so exact 6-digit numbers are searchable and buyable — the mode's output is a ranked list of full 6-digit numbers ready to paste into the shop's search box, each presented with its fallback ladder for sold-out tickets: เต็ม 6 → ท้าย 3 → ท้าย 2, in one card.

Sources for the 6-digit list: I1/I2/J2 `pool6` candidates, the prize-1 beam-search predictions the SPA already fetches, and **Mix** — included as a labeled *source*, never as a formula group (it is built from the other groups; counting it in any "distinct groups agree" logic would double-count its parents, per the CONTEXT.md Mix entry). Ranking uses cross-source agreement plus each source's own backtest Edge row; ทดลอง sources (J2) carry their badge on the row.

Budget converts to a ticket count at the configured ticket price (new config field, default 80฿ — real shops charge more, so it's editable in the same flyout). Risk presets reinterpret for this world: เซฟ spreads tickets across different ท้าย 2 endings; ใจถึง chases full 6-digit matches / stacks duplicate tickets on the top candidate; กลาง in between. `bpBuildPlan` handles this mode behind the same seam — same function, mode-switched behavior, same constraint honesty (plan sums to budget in whole tickets).

EV คู่ for this mode: theoretical EV per ticket derived from the government prize-table structure (~−40% per 80฿ ticket), displayed side-by-side with แทงรายเลข's −5%/baht so the ~8× cost difference is stated plainly; the backtest-adjusted secondary line covers the digits the plan's endings control, same noise warning rules as ISSUE-17.

Resolution (extending ISSUE-18's `bpResolvePlan`): a ticket resolves against the FULL government prize table from the draw cache — ที่ 1, ข้างเคียง, ที่ 2–5, เลขหน้า 3 ตัว, เลขท้าย 3 ตัว, เลขท้าย 2 ตัว — paying real government prize amounts (a ticket can win multiple prizes only where the rules allow; use the standard prize table). Note prize4/prize5 are stored as single space-separated strings in the cache, and sanook prize columns exist only for ~456 of the draws — a ticket-mode plan resolving against a draw with missing sanook columns resolves the myhora-covered prizes and flags the rest as unverifiable rather than silently counting them as misses. Editing/saving/ledger from ISSUE-18 must work unchanged for ticket plans, including แก้เอง on hand-typed ticket numbers.

## Acceptance criteria

- [ ] Mode toggle activates ลอตเตอรี่ใบ: budget → ticket count at configured price; plan lists ranked 6-digit numbers each showing the เต็ม 6 → ท้าย 3 → ท้าย 2 ladder in one card
- [ ] Fixture tests: the 6-digit list merges I/J2 + prize-1 predictions + Mix with source labels; Mix never counts as a formula group in ranking; J2-sourced rows carry ทดลอง
- [ ] Risk presets change ticket distribution (เซฟ = distinct ท้าย 2 spread, ใจถึง = duplicate/top-candidate stacking) verified on fixtures
- [ ] Theoretical EV per ticket computed from the government prize table (~−40% at 80฿) and displayed against แทงรายเลข's −5% comparison; noise warning behavior matches ISSUE-17
- [ ] `bpResolvePlan` ticket fixtures: ที่ 1 exact, ข้างเคียง, a prize-2–5 hit, หน้า 3/ท้าย 3, ท้าย 2 — each pays the correct government amount; draw missing sanook columns marks those prize checks unverifiable, not missed
- [ ] Ticket plans save, lock, resolve, and enter the cumulative ledger exactly like แทงรายเลข plans, with แก้เอง intact
- [ ] Full test suite stays green

## Blocked by

- ISSUE-17
- ISSUE-18
