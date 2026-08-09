# Thai Lottery Stats Dashboard

A prediction and decision-support dashboard for Thai government lottery draws. Combines statistical prediction, formula-based calculators, and backtest evidence into per-draw recommendations.

## Language

**Pick**:
A single lottery number (2, 3, or 6 digits) surfaced by the Decision Center as worth playing for the target draw, carrying a Final Confidence Score and supporting evidence.
_Avoid_: candidate, recommendation, entry (when referring to a scored number on the สรุปงวดนี้ page)

**Final Confidence Score**:
A 0–100 score for a Pick, combining agreement between Predict output, matching formula results, and secondary-prize signals, weighted by selection mode (ปลอดภัย/สมดุล/ลุ้นสูง).
_Avoid_: score, rating (use the full term when referring to this specific metric)

**Edge**:
A formula's backtest accuracy minus the random baseline for its field type (e.g. 2-digit baseline = n/100). The comparable fairness metric across formula groups A–I. Displayed per Pick as the edge of its highest-weight supporting formula.
_Avoid_: accuracy, hit rate (Edge is baseline-adjusted; hit rate is not)

**Hit** (Decision Center track record):
Whether a past Pick matched the actual draw result once it becomes known. Definition depends on digit length: 6-digit Picks hit only on an exact รางวัลที่ 1 match; 3-digit Picks hit if they match *any* of the five 3-digit result slots (3 ตัวบน, 3 ตัวหน้า×2, 3 ตัวล่าง×2) drawn that period; 2-digit Picks hit only on an exact 2 ตัวล่าง match. This is a coarser, single-line yes/no check — not the per-field-type breakdown used on the Backtest page.
_Avoid_: win, correct (use "hit" consistently to distinguish from formula-level backtest hits)

**Auto-snapshot**:
A record of the Decision Center's picks, mode, and target draw date, saved automatically every time the สรุปงวดนี้ page loads (not on manual action). Stored client-side, capped to the most recent 60. Backs both the track record list and the hit-rate trend chart.
_Avoid_: snapshot save, manual snapshot (removed as a user-triggered action — saving is now always automatic)

**Hit-rate trend**:
A chart of the % of auto-snapshotted Picks that turned out to be Hits, over the recent history of draws — answers "is this system getting more or less accurate," as opposed to any single draw's score.

**เลขแนะนำ** (Recommended Number):
A number surfaced because 2 or more *different top-level formula groups* (A–J) independently produced the exact same number for the exact same field type (e.g. two groups both said `bottom2 = "23"`). Distinct from Pick: a Pick is a Final-Confidence-Score blend of Predict + formula + secondary signals; เลขแนะนำ is a raw formula-vs-formula agreement signal only, computed and shown separately. When multiple numbers qualify within one field type, ranked by (1) number of agreeing groups, (2) tie-break on combined Edge of the agreeing groups — top 1 shown per field type, rest viewable on demand. Tracked in the same Track Record (Auto-snapshot, Hit, Hit-rate trend) as Picks, with its own Edge computed against its own baseline (not exempt from backtest fairness).
_Avoid_: convergence pick, consensus number (use "เลขแนะนำ" consistently as the UI-facing term; "convergence"/"consensus" are fine as internal/engineering shorthand for the mechanism)

**Formula group** (for เลขแนะนำ purposes):
The top-level letter (A, B, C, D, E, F/Codex, G, H, I, J/เจ้าสัว, HM/Hermes) — not the individual sub-formula (e.g. D1–D4, I1/I2). Two sub-formulas from the *same* letter group agreeing does not count as เลขแนะนำ agreement, since they share the same underlying method. Group key resolution: explicit `fr.group` field wins (Hermes carries `'HM'`), else the first character of the formula name (J1/J2 → 'J', X1.. → 'X') — see PRD-hermes-pool-1-4.md for why 'HM' must not collapse into 'H' (มิสเตอร์ซี).

**Field type**:
The exact prize-slot shape a formula's output is checked against in backtest — `bottom2`, `bottom2_unit`, `top3`, `front3`, `back3`, `back3exact`, `prize1_last2`, `prize1_last4_digits`, `pool6`, `pool6_14`. เลขแนะนำ agreement requires an exact field-type match, not just equal digit-length (e.g. a `front3` guess and a `back3exact` guess of the same digits do NOT count as agreeing, even though Hit tracking for ordinary 3-digit Picks already treats all five 3-digit slots as interchangeable).
_Avoid_: field, format (use "field type" for this specific backtest-comparability tag)

**Hermes Pool 1-4 (HM)**:
A ทดลอง formula (PRD-hermes-pool-1-4.md) predicting 10 six-digit numbers against the combined prize 1–4 pool of the target draw (66 numbers: prize1 ×1 + prize2 ×5 + prize3 ×10 + prize4 ×50 — strictly excluding ข้างเคียงรางวัลที่ 1 and prize5). Signature: digit-position frequency over the *previous draw's* prize 2/3/4 pool (65 numbers), weighted by prize money in a fixed 5:2:1 ratio (prize2 ×1.0, prize3 ×0.4, prize4 ×0.2) so the 50 prize-4 numbers cannot drown out the higher-value prizes — assembled via the shared `_imperialRoundRobin` (K=8). Permanently ทดลอง per ADR-0003: at ~457 pool-covered draws, 10 candidates expect ≈0.30 chance hits across all history, so no gate could distinguish skill from luck (same verdict as J2). Verified result (2026-08-08): 2 real hits (both prize 4: 685863 @ 01/02/2024, 086093 @ 30/12/2021) vs 0.30 expected → edge +0.37% — interesting but far too small n to conclude anything.
_Avoid_: calling it a "recommended" formula, implying the hits prove an edge (n=2; the ทดลอง label is permanent)

**ทดลอง (Experimental)**:
A trust badge worn by a formula that has not passed (or cannot pass) the Promotion Gate. Display-only: a ทดลอง formula still participates fully in Picks and เลขแนะนำ, and the badge propagates onto any Pick or เลขแนะนำ whose supporting evidence includes it.
_Avoid_: beta, disabled, excluded (ทดลอง never blocks participation — it only labels trust)

**Promotion Gate**:
The standard a new formula must meet to shed the ทดลอง badge and ship as แนะนำ: positive Edge on both the validation window (the draws used to select finalists) and the Holdout. Failing the gate keeps the formula in the app under ทดลอง — it does not delete it.
_Avoid_: backtest pass (the gate is stricter than a positive row in the rolling backtest table)

**Holdout**:
The newest tail of draw history, never touched during formula search or finalist selection, evaluated exactly once per formula to produce the Promotion Gate's deciding Edge. Once evaluated — or leaked into search — it is spent and cannot serve as a holdout again.
_Avoid_: test set, live window

**ไม่รู้ซื้อเหี้ยไรดี (Mix)**:
A derived meta-formula that builds ~10 six-digit candidates by digit-position voting over the outputs of all formula groups A–J (Predict-page output excluded). One group = one vote regardless of how many numbers it produced. Positions 1–3 are voted only by `front3` outputs (groups D, F), falling back to I/J2 votes when both are empty; positions 4–6 by all matching field types plus I/J2's full 6-digit candidates. Deliberately NOT a Formula group: it never votes in เลขแนะนำ and never joins Picks (it would double-count its own parent formulas); its only central-system presence is a Backtest row under `pool6`. Lives on its own sidebar page named ไม่รู้ซื้ออะไรดี.
_Avoid_: Group K, สูตร K (it is not a formula group), เลขรวมมิตร

**ไม่รู้ซื้ออะไรดี (page)**:
The sidebar page presenting the Mix formula: hero top-1 candidate + 9 secondary candidates, per-position vote breakdown, consensus meter, its own track record (Auto-snapshot/Hit/hit-rate trend scoped to Mix), budget cuts (2–3 digit tails cut from the top candidate — labeled as cuts, never called Picks), and a weighted random-pick button.

**เจ้าสัว (Group J)**:
The formula group derived by systematic search over a declared arithmetic family — inputs limited to the previous single draw and the target draw's date — rather than handed down as folk wisdom. Two legs: a `bottom2` leg subject to the Promotion Gate, and a `pool6` leg that wears ทดลอง permanently because its Edge is statistically unverifiable at current sample size.
_Avoid_: Tycoon formula, searched formula (use เจ้าสัว in UI, Group J in engineering shorthand)

**จัดชุดซื้อ (Buy Plan, page)**:
The sidebar page that turns Picks/เลขแนะนำ into an actual spending plan: user enters a budget + risk preset, the system allocates money across numbers, shows Dual EV, and (on manual save) locks the plan into a real-money track record. Two modes behind a toggle — แทงรายเลข (per-number betting) and ลอตเตอรี่ใบ (online government tickets) — each planned separately, never one budget split across both. See ADR-0004.
_Avoid_: portfolio tab, betting tab (use จัดชุดซื้อ as the UI-facing name)

**ชุดซื้อ (Buy Plan, record)**:
One saved plan: mode, budget, risk preset, every number with its stake, the payout config frozen at save time, and the Dual EV shown at save time. Editable freely *before* save (hand-edited rows carry a แก้เอง label); immutable after save — delete-whole-plan is the only allowed change, so the cumulative baht ledger can't be hindsight-edited.
_Avoid_: snapshot (that word means the Decision Center's *automatic* record of the system's opinion; a ชุดซื้อ is the user's *manual* record of a spending decision)

**EV คู่ (Dual EV)**:
The two expected-value lines shown on every ชุดซื้อ. Headline: theoretical EV (p = pure math), always negative, stated as baht lost per 100฿ long-run. Secondary: backtest-adjusted EV (p = baseline + rolling Edge), labeled as window-limited noise-prone — and when it goes positive, the UI itself says so rather than implying profit. Theory leads; Edge informs allocation and ranking but never replaces the honest headline number.
_Avoid_: expected profit, ROI (both smuggle in the idea that the number can be trusted positive)

**แก้เอง (hand-edited)**:
A label on any ชุดซื้อ row the user changed or added by hand before saving (stake changed, number typed in, row deleted-and-replaced). Exists so the cumulative ledger can separate system-pure P/L from human-adjusted P/L — without it, the ledger can't answer whether the *system's* Edge shows up in real money.
_Avoid_: custom, manual override (use แก้เอง consistently in UI and record fields)

**หนุนแรง/หนุนกลาง/หนุนเบา**:
คำบอกความมั่นใจของเลขในหน้าจัดชุดซื้อ ได้จาก Edge ของ backtest ที่ดีสุดที่หนุนเลขนั้น (≥+1.0% แรง / 0–1.0% กลาง / ≤0 หรือไม่มี เบา); เป็นแค่การแสดงผล ไม่กระทบการให้คะแนนหรือจัดเงิน.
