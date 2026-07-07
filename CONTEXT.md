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
