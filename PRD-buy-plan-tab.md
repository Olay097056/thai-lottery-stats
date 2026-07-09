# PRD: จัดชุดซื้อ (Buy Plan) page

Status: ready-for-agent
Governing docs: `docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md`, ADR-0003 (ทดลอง badge semantics), CONTEXT.md glossary (จัดชุดซื้อ, ชุดซื้อ, EV คู่, แก้เอง, เลขแนะนำ, ทดลอง, Mix).

## Problem Statement

The dashboard already answers "what does the system think will come up" (Picks, เลขแนะนำ, Mix), but the owner's actual question every draw is different: **"I have X baht — what exactly should I buy, how much on each number, and how much am I really expected to lose?"** Today that translation from signal to spending is done in the owner's head, the expected cost of playing is never shown honestly, and there is no record of whether following the system actually made or lost real money over time.

## Solution

A new top-level sidebar page **จัดชุดซื้อ** with two modes behind a toggle:

- **แทงรายเลข** — per-number betting (2 ตัวล่าง, 2 ตัวบน, 3 ตัวบน). User enters a budget and picks a risk preset; the system allocates money across the best numbers from Picks/เลขแนะนำ, proportional to score.
- **ลอตเตอรี่ใบ** — online government tickets, where exact 6-digit numbers are searchable/buyable. The system produces a ranked list of full 6-digit numbers (I/J2 pool candidates + prize-1 beam predictions + Mix), each with a fallback ladder (เต็ม 6 → ท้าย 3 → ท้าย 2) for when the exact ticket is sold out.

Every plan shows **EV คู่**: a blunt theoretical expected loss headline, plus a backtest-adjusted secondary line that warns about its own noise. The user can hand-edit the plan to match what they actually bought (rows get a แก้เอง label), then save it; saved plans lock, auto-resolve in baht when the draw publishes, and feed an all-time real-money ledger.

## User Stories

1. As the dashboard owner, I want a dedicated จัดชุดซื้อ page in the sidebar, so that "what to buy" has its own home separate from "what the system predicts".
2. As a bettor, I want to switch between แทงรายเลข and ลอตเตอรี่ใบ modes with a toggle, so that I can plan each purchase channel separately.
3. As a bettor, I want to enter my budget via quick buttons (200 / 500 / 1,000) or a free-text field, so that starting a plan takes one tap.
4. As a bettor, I want to pick a risk preset (เซฟ / กลาง / ใจถึง), so that the split between 2-digit and 3-digit money (80/20, 50/50, 20/80) matches my appetite without me doing arithmetic.
5. As a bettor in แทงรายเลข mode, I want the system to pick numbers from the same Picks the Decision Center computes, so that the plan reflects everything the formulas know.
6. As a bettor, I want numbers that qualified as เลขแนะนำ to receive extra money (×1.5 score boost), so that the strongest convergence signal carries the most weight.
7. As a bettor, I want money within a tier allocated proportionally to score — not equally — so that the system's confidence shows up in stake sizes, not just in which numbers appear.
8. As a bettor, I want stakes rounded to 10฿ with a 20฿ minimum and at most 10 numbers per tier, so that the plan is actually placeable with a real bookie.
9. As a bettor, I want numbers allocated below the minimum dropped and their money redistributed, so that the pick count scales naturally with my budget.
10. As a bettor, I want leftover rounding baht assigned to the top-ranked number, so that the plan always sums exactly to my budget.
11. As an honest gambler, I want the plan's headline EV computed from pure theoretical probability — always negative, phrased as "ระยะยาวเสีย X฿ ต่อ 100฿" — so that I am never lied to about the house edge.
12. As a data-driven gambler, I want a secondary EV line computed from `p = baseline + rolling Edge`, so that I can see what the backtest implies about this specific plan.
13. As a skeptic, I want the UI itself to warn me when the backtest-adjusted EV goes positive that this is likely window noise and not profit, so that the page never becomes a false promise machine.
14. As a bettor, I want the EV card to note that at ×95/×950 both bet types cost exactly −5% per baht, so that I understand risk level changes variance, not cost.
15. As a user with a specific bookie, I want payout rates (default 2 ตัว ×95, 3 ตัวตรง ×950), minimum stake, rounding unit, and ticket price (default 80฿) editable in a settings flyout and persisted locally, so that EV matches my real rates.
16. As a bettor, I want rows produced by ทดลอง formulas to carry their badge in the plan table, so that the trust level stays visible all the way to the money (per ADR-0003, never excluded or down-weighted).
17. As an online ticket buyer, I want ลอตเตอรี่ใบ mode to give me a ranked list of exact 6-digit numbers I can paste into the shop's search box, so that the recommendation is directly actionable.
18. As an online ticket buyer, I want the 6-digit list drawn from I1/I2/J2 pool candidates, the prize-1 beam-search predictions, and Mix, so that all full-number producers in the system feed one shopping list.
19. As an online ticket buyer, I want Mix numbers labeled with their source (and never treated as a formula group), so that the ranking doesn't double-count Mix's parent formulas.
20. As an online ticket buyer, I want each 6-digit number to show its fallback ladder (เต็ม 6 → ท้าย 3 → ท้าย 2) in the same card, so that when the exact ticket is sold out I know what to search next.
21. As an online ticket buyer, I want my budget converted to a ticket count at the configured ticket price, and the risk preset to shape the plan (เซฟ = spread across different ท้าย 2, ใจถึง = chase full 6-digit matches / stack duplicate tickets), so that ticket-world planning mirrors betting-world planning.
22. As an honest gambler, I want ลอตเตอรี่ใบ mode's theoretical EV (~−40% per ticket, derived from the government prize table) shown next to แทงรายเลข's −5%, so that I see plainly that tickets cost ~8× more per baht played.
23. As a real-world buyer, I want to edit any row before saving — change a stake, delete a row, add a hand-typed number with type and stake — so that the saved plan matches the money that actually left my pocket.
24. As a real-world buyer, I want hand-touched rows labeled แก้เอง, so that the ledger can later separate system-pure results from my own improvisations.
25. As a bettor, I want EV คู่ recomputed live as I edit rows or change budget/risk/config, so that the numbers on screen always describe the plan as it currently stands.
26. As a record keeper, I want a manual "บันทึกชุดนี้" button (no auto-save), so that only plans I actually intend to buy enter the history — not every exploratory budget fiddle.
27. As a record keeper, I want the saved record to freeze the payout config, mode, budget, risk, every row, and the EV คู่ shown at save time, so that later config changes never rewrite history.
28. As a record keeper, I want saved plans to be immutable (delete-whole-plan only), so that the cumulative ledger cannot be hindsight-edited.
29. As a record keeper, I want each saved plan resolved automatically when I open the page after the draw: per-row ถูก/ผิด and baht won, per-plan net P/L, so that I never have to check results by hand.
30. As a record keeper, I want ลอตเตอรี่ใบ plans resolved against the full government prize table (ที่ 1, ข้างเคียง, ที่ 2–5, หน้า 3, ท้าย 3, ท้าย 2) from the draw cache, so that ticket winnings are counted completely.
31. As an honest gambler, I want an all-time ledger at the bottom of the page — "ซื้อ N ชุด รวม X฿ ได้คืน Y฿ = net −Z฿" — compared against the random-play expectation, so that whether the Edge shows up in real money is answered with real money.
32. As a Mix-page user, I want a "จัดชุดซื้อจากเลขชุดนี้ →" button on the ไม่รู้ซื้ออะไรดี page that opens จัดชุดซื้อ pre-filled with Mix as the source, so that the two pages connect without duplicating each other.
33. As a bettor whose bookie refuses a number (เลขอั้น), I want to delete that row and have its stake redistributed (or edit stakes by hand), so that the plan survives contact with reality.
34. As a returning user, I want my last-used mode, budget, risk preset, and config remembered locally, so that each draw's planning starts where the last one ended.

## Implementation Decisions

- **Client-side only.** No new backend endpoints. The page reuses data the SPA already fetches: the formula batch results, backtest rows/Edge map, เลขแนะนำ, prize-1 beam predictions, prize history, and Mix candidates. Follows the Decision Center precedent.
- **Two pure core functions are the seams** (checked with owner):
  - `bpBuildPlan(input) → plan`: input carries mode, budget, risk preset, config, and pre-fetched sources; output is the full ชุดซื้อ (rows with number/field type/stake/source/trust/แก้เอง flag, plus EV คู่ and metadata). All allocation logic — tier split by risk, proportional-to-score stakes, เลขแนะนำ ×1.5 boost, min/round/cap rules, remainder-to-rank-1, ใบ-mode ladder construction — lives behind this one function.
  - `bpResolvePlan(plan, actualDrawRow) → resolution`: per-row hit + baht returned, per-plan net; plus a small ledger aggregator over all saved plans. ใบ-mode resolution reads the full prize table columns from the draw row.
- **Bet types in แทงรายเลข mode**: 2 ตัวล่าง (`bottom2`), 2 ตัวบน (`prize1_last2`), 3 ตัวบน (`back3`). Risk tiers group them as "2-digit money" vs "3-digit money". `front3`/`back3exact` deliberately belong to ใบ mode only; `pool6`/`prize1_last4_digits`/`bottom2_unit` have no direct bet market and stay out of this mode.
- **Number sources in แทงรายเลข mode**: the Decision Center's aggregated score rows (same scoring, untouched), with เลขแนะนำ membership applying a ×1.5 multiplier for allocation ranking only. ทดลอง trust propagates onto rows as a display badge, never a filter or weight (ADR-0003).
- **Backtest-adjusted EV**: `p = field-type baseline + the supporting formulas' rolling Edge` (per number, using the highest-Edge supporter already tracked on score rows). Theoretical EV uses pure baselines. Both lines render on one card; theory is typographically dominant; a fixed warning renders whenever the adjusted EV ≥ 0.
- **Config object** (payouts ×95/×95/×950 defaults, min stake 20฿, rounding 10฿, tier cap 10, ticket price 80฿) lives in localStorage under its own key, edited via a flyout, and is copied by value into every saved plan.
- **Saved plans** live in localStorage under a new key (`lottery_buyplan_history` naming style, separate from all Decision Center snapshot keys), manual save only, immutable after save, delete-whole-plan allowed. Existing snapshot stores and the frozen OLD VER page are not touched.
- **Resolution reuses the established actual-result lookup convention** (ISO target date → Thai-formatted history row) already used by the Decision Center track record, extended to read the sanook full-prize columns for ใบ mode. Plans whose draw hasn't published stay Pending.
- **Mix page integration** is one button that navigates to จัดชุดซื้อ with Mix pre-selected as source. The Mix page's own budget-cuts feature is left untouched.
- **New sidebar page** wired the same way existing pages are (nav entry + page section + loader function), placed after ไม่รู้ซื้ออะไรดี. All three static assets get their `?v=` cache-bust bumped on every edit (hard project rule).

## Testing Decisions

- Tests exercise **external behavior of the two seams only**: given budget/risk/config/sources fixtures, assert the allocated rows (counts, stakes summing to budget, min/round/cap respected, boost ordering, ladder shape) and the EV numbers; given a plan + draw fixture, assert baht outcomes and ledger totals. No assertions on internal helpers or DOM internals beyond light HTML string/badge presence checks where prior art does the same.
- **Prior art to copy**: `scripts/test_decision_track_record.js` (vm extraction of pure functions from `app.js`, fixture-driven), `scripts/test_recommended_numbers.js`, `scripts/test_experimental_badge_propagation.js` (badge rendering checks, stripping top-level auto-invocations before vm load).
- Key scenario coverage: budget too small for both tiers; all numbers dropped below min in one tier; เลขแนะนำ empty (Picks-only fallback); ทดลอง badge present on rows; hand-edited rows keep แก้เอง through save/resolve; adjusted EV positive triggers the warning; ใบ-mode plan wins a minor prize (e.g. ท้าย 2 only); config change after save does not alter a saved plan's recorded P/L; pending → resolved transition.
- Runner: `node scripts/test_buyplan_*.js`, added alongside the existing 10-file suite; full suite must stay green.

## Out of Scope

- Cross-mode budget splitting or any EV conversion between the two worlds (rejected at grilling; one plan = one mode).
- Any change to Pick scoring, เลขแนะนำ convergence rules, backtest engine, or the frozen OLD VER page.
- Reworking or removing the Mix page's budget-cuts feature (future issue if ever).
- New backend endpoints, server-side storage, or multi-device sync of plans/config.
- เลขวิ่ง or โต๊ด bet types (no formula produces them; adding โต๊ด would need its own hit definition — future work).
- Editing saved plans (immutability is a design decision, not a limitation).
- Automated purchase or any integration with betting/ticket platforms.

## Further Notes

- The cumulative ledger will normally show a growing loss. Per ADR-0004 this is the feature working: the page's job is honest planning and honest accounting, not the illusion of profit.
- Payout defaults come from the owner's real dealer (×95 / ×950 — both exactly −5%/baht). The "same cost, different variance" framing is worth a sentence on the EV card.
- Per-number betting at these rates is off-book gambling; this page is a personal calculator/ledger for the owner, and payout rates stay configurable precisely because they are dealer-specific.
