// Regression: dcFormulaBaseP must share FORMULA_BT_FIELD_META's baseline definition, so a
// six-digit or pool formula can never earn an edge — and a Picks slot — from a missing baseline.
// Run with: node scripts/test_dc_formula_basep.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');

function check(label, condition) {
  if (!condition) throw new Error('FAIL: ' + label);
  console.log('OK: ' + label);
}

const sandbox = {
  console,
  document: {
    getElementById: () => ({ style: {}, innerHTML: '' }),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: () => {},
  },
  escHtml: value => String(value ?? ''),
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: () => Promise.reject(new Error('network is disabled in this test')),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'static', 'modules', 'decision-center', 'index.js'), 'utf8'),
  sandbox,
);

// Every field the batch can emit. back3 is asserted separately because its baseline is null.
const FIELDS = [
  'bottom2', 'prize1_last2',
  'bottom2_unit', 'front3_unit', 'back3_unit', 'prize1_unit',
  'top3', 'prize1_exact', 'front3', 'back3exact', 'back3_suffix2',
  'prize1_last4_digits', 'pool6', 'pool_tail3', 'pool6_14',
];

for (const k of [1, 5, 10]) {
  for (const field of FIELDS) {
    const meta = sandbox._formulaBaselineForField(field, k);
    const got = sandbox.dcFormulaBaseP(field, k);
    check(
      `${field} k=${k} matches the backtest table baseline (${meta.baseP})`,
      Math.abs(got - meta.baseP) < 1e-12,
    );
  }
}

check('back3 keeps its explicit no-baseline null', sandbox.dcFormulaBaseP('back3', 3) === null);
check('an unregistered field returns null, not a 0% baseline', sandbox.dcFormulaBaseP('not_a_field', 5) === null);

for (const field of ['prize1_exact', 'pool6', 'pool6_14', 'pool_tail3']) {
  check(`${field} has a non-zero baseline`, sandbox.dcFormulaBaseP(field, 10) > 0);
}

check(
  'prize1_exact with five candidates is 5/1,000,000 = 0.0005%',
  Math.abs(sandbox.dcFormulaBaseP('prize1_exact', 5) - 5 / 1e6 * 100) < 1e-15,
);

// The gate that matters: dcBuildScoreRows self-nominates only when pct - baseP > 0.
const tail3Base = sandbox.dcFormulaBaseP('pool_tail3', 10);
const belowChancePct = 50; // a formula that hits half the draws, well under the 81.2% pool baseline
check('a below-chance tail-3 rate gets a negative edge and fails the Picks gate', belowChancePct - tail3Base < 0);
check('the old 0 baseline would have turned that same rate into a +50 edge', belowChancePct - 0 > 0);

console.log('PASS: dcFormulaBaseP contract');
