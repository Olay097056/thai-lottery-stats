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
The top-level letter (A, B, C, D, E, F/Codex, G, H, I, J/เจ้าสัว) — not the individual sub-formula (e.g. D1–D4, I1/I2). Two sub-formulas from the *same* letter group agreeing does not count as เลขแนะนำ agreement, since they share the same underlying method.

**Field type**:
The exact prize-slot shape a formula's output is checked against in backtest — `bottom2`, `bottom2_unit`, `top3`, `front3`, `back3`, `back3exact`, `prize1_last2`, `prize1_last4_digits`, `pool6`. เลขแนะนำ agreement requires an exact field-type match, not just equal digit-length (e.g. a `front3` guess and a `back3exact` guess of the same digits do NOT count as agreeing, even though Hit tracking for ordinary 3-digit Picks already treats all five 3-digit slots as interchangeable).
_Avoid_: field, format (use "field type" for this specific backtest-comparability tag)

**ทดลอง (Experimental)**:
A trust badge worn by a formula that has not passed (or cannot pass) the Promotion Gate. Display-only: a ทดลอง formula still participates fully in Picks and เลขแนะนำ, and the badge propagates onto any Pick or เลขแนะนำ whose supporting evidence includes it.
_Avoid_: beta, disabled, excluded (ทดลอง never blocks participation — it only labels trust)

**Promotion Gate**:
The standard a new formula must meet to shed the ทดลอง badge and ship as แนะนำ: positive Edge on both the validation window (the draws used to select finalists) and the Holdout. Failing the gate keeps the formula in the app under ทดลอง — it does not delete it.
_Avoid_: backtest pass (the gate is stricter than a positive row in the rolling backtest table)

**Holdout**:
The newest tail of draw history, never touched during formula search or finalist selection, evaluated exactly once per formula to produce the Promotion Gate's deciding Edge. Once evaluated — or leaked into search — it is spent and cannot serve as a holdout again.
_Avoid_: test set, live window

**เจ้าสัว (Group J)**:
The formula group derived by systematic search over a declared arithmetic family — inputs limited to the previous single draw and the target draw's date — rather than handed down as folk wisdom. Two legs: a `bottom2` leg subject to the Promotion Gate, and a `pool6` leg that wears ทดลอง permanently because its Edge is statistically unverifiable at current sample size.
_Avoid_: Tycoon formula, searched formula (use เจ้าสัว in UI, Group J in engineering shorthand)
