# Shared cache status, immutable reports and classic-script modules

Date: 2026-10-14. Scope authorized by the owner: implement all six project improvements.

The SPA now displays one read-only cache status across pages. Structural category
validation and chronology checks are separated from prediction and evaluation.
The status endpoint never refreshes or repairs results. Missing data, invalid data
and a successful empty cache remain distinct states.

The method guide explains each view and exposes the existing shared target/action
controls. Astra uses its own read-only report and hides irrelevant manual formula
inputs. Selection itself does not infer an Astra report.

New manually saved browser reports append independent records. Decision Center
and Mix preserve their first record for a target date. Existing prospective
resolution math remains unchanged; a report is not evidence of an advantage.
Old records remain readable; missing lineage stays explicitly unknown. Storage
errors never show a success notice, and corrupt existing stores are not overwritten
by a new save. Export contains browser stores only, not backend Astra SQLite.

Statistical provenance captures settings, generation time, input cutoff, a hash of
the actual eligible dataframe and analyzer source hash. The raw-cache fingerprint
in the shared status describes a different object and is not substituted for it.
Manual formulas capture their input fields; missing input fingerprints remain null.
Saved Predict reports include full categories as well as their compact summary.

Frontend code is split into classic scripts, preserving source order and existing
global bindings. This avoids a framework/build migration while reducing file size.
`static/scripts.json` describes the order; HTML loads the same files. Boot is last.
VM tests assemble these sources using `scripts/frontend_source.js`; the asset
contract independently checks browser order, existence, uniqueness and versions.

Whole-request calculation failures use safe structured HTTP 500 responses.
Partial prediction failures stay attached to their categories. Strict Astra
contracts continue to validate their own domain-state errors; a worker's error
phase is not treated as a failed HTTP request.

No formula constants, ranking rules, old statistical evidence, outcome CSV or
holdout evaluation were changed by this work.
