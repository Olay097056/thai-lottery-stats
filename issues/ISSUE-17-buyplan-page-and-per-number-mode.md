# ISSUE-17: หน้าจัดชุดซื้อ + โหมดแทงรายเลข (tracer bullet)

## Parent

PRD-buy-plan-tab.md (governing ADR: docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md)

## What to build

The new top-level sidebar page **จัดชุดซื้อ** with its first working mode, แทงรายเลข, end-to-end: user enters a budget (quick buttons 200/500/1,000 + free text), picks a risk preset (เซฟ/กลาง/ใจถึง), and the page renders a complete ชุดซื้อ — a table of numbers with baht stakes — plus the EV คู่ card. Demoable on its own; saving comes in ISSUE-18 (the save button may render disabled or be absent).

The core seam is a pure function, `bpBuildPlan(input) → plan`, taking mode, budget, risk preset, config, and the pre-fetched sources the SPA already has (Decision Center score rows, เลขแนะนำ result, backtest Edge map). All allocation logic lives behind it:

- Risk preset controls ONLY the budget split between 2-digit money (`bottom2` + `prize1_last2`) and 3-digit money (`back3`): เซฟ 80/20, กลาง 50/50, ใจถึง 20/80. Risk never changes which numbers are chosen.
- Within a tier, numbers rank by their existing Pick score with a ×1.5 multiplier for numbers that qualified as เลขแนะนำ; stakes are proportional to (boosted) score.
- Constraints: minimum stake per number, stakes rounded to the rounding unit, at most 10 numbers per tier. Numbers falling below the minimum are dropped and their money redistributed among survivors; the final rounding remainder goes to the rank-1 number, so stakes always sum exactly to the budget.
- Rows carry their source and trust: any row supported by a ทดลอง formula shows the badge (display-only per ADR-0003, never a filter or weight).

The EV คู่ card follows ADR-0004 exactly: the headline is theoretical EV (pure baselines: 1/100 for 2-digit, 1/1000 for 3-digit), always negative, phrased bluntly as baht lost per 100฿ long-run; the secondary line is backtest-adjusted EV using `p = baseline + supporting Edge` per number, labeled as window-limited; whenever the adjusted EV is ≥ 0 a fixed warning renders saying it is likely noise, not profit. With the default ×95/×950 payouts both bet types cost exactly −5%/baht — the card notes that risk changes variance, not cost.

Config lives in a settings flyout persisted in localStorage: payouts (defaults 2 ตัว ×95, 3 ตัวตรง ×950), minimum stake (default 20฿), rounding unit (default 10฿). The page also remembers the last-used mode/budget/risk locally. Changing config recomputes the on-screen plan live.

Wire the page like existing sidebar pages (nav entry + section + loader), after ไม่รู้ซื้ออะไรดี. No new backend endpoints — reuse the fetches the Decision Center already performs. Bump the `?v=` cache-bust on every touched static asset.

## Acceptance criteria

- [ ] New sidebar page จัดชุดซื้อ renders with budget input (quick buttons + free text), risk preset buttons, mode toggle (ลอตเตอรี่ใบ side may be a disabled placeholder), plan table, and EV คู่ card
- [ ] `bpBuildPlan` fixture tests: stakes sum exactly to budget; tier split matches the risk preset; proportional allocation ordering follows boosted scores; เลขแนะนำ boost changes allocation vs the same fixture without it
- [ ] `bpBuildPlan` fixture tests for constraints: sub-minimum numbers dropped with money redistributed, rounding unit respected, 10-per-tier cap enforced, remainder assigned to rank 1, tiny budget (e.g. 40฿) still yields a valid plan
- [ ] เลขแนะนำ-empty fixture still produces a full plan from Picks alone
- [ ] A row supported only by a ทดลอง formula renders the badge in the plan table (fixture test on the rendered HTML, prior art: test_experimental_badge_propagation.js)
- [ ] Theoretical EV headline is negative on every fixture and equals −5%/baht at default payouts for both tiers; adjusted-EV fixture with large positive Edge triggers the noise warning text
- [ ] Config flyout edits (payout/min/round) persist across reload via localStorage and recompute the displayed plan; last-used budget/risk/mode restored on reload
- [ ] Existing 10-file test suite stays green; new tests run as `node scripts/test_buyplan_*.js`

## Blocked by

None - can start immediately
