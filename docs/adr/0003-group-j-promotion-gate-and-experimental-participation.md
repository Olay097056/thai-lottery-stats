# Group J promotion gate: FABLE-strict with a one-shot holdout; ทดลอง is a badge, not a gate

Group J (เจ้าสัว) is the first formula *derived by systematic search* (arithmetic family over prev-draw digits + target date), which makes overfitting the default failure mode — FABLE died exactly this way in Phase 4 (positive on its rolling window, negative on validation/live). We therefore split draw history into train (search) / validation (finalist selection) / holdout (newest tail), and the bottom2 leg ships as แนะนำ only with positive Edge on **both** validation and holdout. The pool6 leg wears ทดลอง **permanently**: at ~456 pool-covered draws, 10 candidates expect ~0.8 chance-hits in the entire history, so no gate on this field type can distinguish skill from luck — a "passed" gate would be theater.

Separately, ทดลอง was decided to be a **trust badge only**: experimental legs feed Picks and เลขแนะนำ from day one, with the badge propagating onto any chip they support.

## Considered options

For ทดลอง scope, excluding experimental legs from the Decision Center (so passing the gate is what *earns* influence over the "what to play" surface) was recommended and rejected — the owner prefers maximum signal there, with honesty carried by the propagated badge rather than by exclusion. The gate therefore governs the label users see, not participation.

## Consequences

- The holdout is spent the moment it is evaluated (or leaked into search). Re-running the search after seeing holdout results silently converts the gate into theater — any future re-derivation of Group J needs a *new* untouched tail, i.e. wait for more draws to accumulate.
- Failing the gate keeps the formula shipped under ทดลอง (unlike FABLE, which was deleted): the search harness is offline Python, the shipped artifact is cheap fixed arithmetic in formula-engine.js.
