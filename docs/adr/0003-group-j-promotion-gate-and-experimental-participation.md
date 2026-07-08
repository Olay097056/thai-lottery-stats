# Group J promotion gate: FABLE-strict with a one-shot holdout; ทดลอง is a badge, not a gate

Group J (เจ้าสัว) is the first formula *derived by systematic search* (arithmetic family over prev-draw digits + target date), which makes overfitting the default failure mode — FABLE died exactly this way in Phase 4 (positive on its rolling window, negative on validation/live). We therefore split draw history into train (search) / validation (finalist selection) / holdout (newest tail), and the bottom2 leg ships as แนะนำ only with positive Edge on **both** validation and holdout. The pool6 leg wears ทดลอง **permanently**: at ~456 pool-covered draws, 10 candidates expect ~0.8 chance-hits in the entire history, so no gate on this field type can distinguish skill from luck — a "passed" gate would be theater.

Separately, ทดลอง was decided to be a **trust badge only**: experimental legs feed Picks and เลขแนะนำ from day one, with the badge propagating onto any chip they support.

## Considered options

For ทดลอง scope, excluding experimental legs from the Decision Center (so passing the gate is what *earns* influence over the "what to play" surface) was recommended and rejected — the owner prefers maximum signal there, with honesty carried by the propagated badge rather than by exclusion. The gate therefore governs the label users see, not participation.

## Consequences

- The holdout is spent the moment it is evaluated (or leaked into search). Re-running the search after seeing holdout results silently converts the gate into theater — any future re-derivation of Group J needs a *new* untouched tail, i.e. wait for more draws to accumulate.
- Failing the gate keeps the formula shipped under ทดลอง (unlike FABLE, which was deleted): the search harness is offline Python, the shipped artifact is cheap fixed arithmetic in formula-engine.js.

## Update (2026-07-08): J1 widened to a 5-candidate spread, holdout not re-touched

J1 shipped with exactly one candidate (`pad2(|BK2 − DSUM|)`, the searched finalist). Widened to 5 by taking that value ± 1, ± 2 (mod 100, ascending) — a fixed, predetermined transformation of the finalist, not a new search. The expansion lives inside `_tycoonBottom2Formula` itself, so it's uniform everywhere the formula is used (backtest, Picks, เลขแนะนำ, the live "ทำนาย" tab) — no group in this codebase has ever shown a different candidate set on the live tab than what backtest/Picks/เลขแนะนำ actually score against, and J1 doesn't start now.

**The documented holdout Edge (train +0.72% / validation +1.67% / holdout −0.21%) is not being recomputed for the 5-candidate version, and holdout is not being re-evaluated.** Those numbers remain the permanent historical record of what the original 1-candidate search found and describe the center value only — the ±1/±2 neighbors have never been independently measured against train, validation, or holdout. A case could be made that scoring a *fixed, already-decided* transformation against holdout isn't the same risk as the search-and-cherry-pick pattern this ADR's gate exists to catch (nothing is being chosen *by looking at* holdout here) — but the owner chose not to rely on that distinction and left holdout untouched rather than debate it later. The live rolling-window backtest table (already in the app, recomputed on demand) is the ongoing honest signal for whatever candidate set is actually shipping — read it, don't infer accuracy from the frozen holdout number once the candidate set has moved.

No visual distinction was added between the tested center value and the four unverified neighbors in the UI — the ทดลอง badge already covers the whole card as one signal, per this ADR's original decision that ทดลอง is a single flat trust label, not a graded one.
