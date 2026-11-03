# Decision Center domain interface

One lottery domain; this folder owns reusable Decision Center calculations and
source formatting. The public entry point is `DecisionDomain` from `index.js`.
Compatibility function aliases remain available to the existing HTML/feature code.

It combines supplied prediction/formula results, formats supporting sources and
performs the existing field-specific baseline calculations. It makes no network
requests and owns no page navigation or editable UI state. Inputs are passed by
callers; it must not select new formulas or reopen a holdout evaluation.

The Decision Center view remains in `static/decision-center.js`; its client state
is `LotteryUiState.decision` and source history is `LotteryServerData.decision`.
The legacy view keeps separate state and storage. Boot and script order are owned
by the shell/manifest, not this module.
