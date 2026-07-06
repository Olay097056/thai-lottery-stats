// Regression check for the fable6/fable_pool3 -> pool6/pool_tail3 rename (ISSUE-5).
// Run with: node scripts/test_pool_field_rename.js
// Verifies the renamed backtest field-type mechanism (baseline formula + hit-check)
// behaves identically to the pre-rename fable6/fable_pool3 values it replaced —
// this is a pure rename, not a behavior change, and the mechanism is now reused
// by any future formula targeting prizes 1-5 (not FABLE-specific anymore).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'formula-engine.js'), 'utf8');

function extract(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

const fieldMetaMatch = /const FORMULA_BT_FIELD_META=(\{[\s\S]*?\n\});/.exec(src);
if (!fieldMetaMatch) throw new Error('FORMULA_BT_FIELD_META not found');

const code = [
  'var FORMULA_BT_FIELD_META=' + fieldMetaMatch[1] + ';',
  extract('_formulaBtFieldMeta'),
  extract('_formulaBaselineForField'),
  extract('_formulaHitForField'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _formulaBaselineForField, _formulaHitForField } = sandbox;

// --- 1. baseline formula for pool6 (k=10) matches the pre-rename fable6 formula exactly ---
const pool6Baseline = _formulaBaselineForField('pool6', 10);
const expectedPool6BaseP = (1 - Math.pow(1 - 168 / 1e6, 10)) * 100;
if (Math.abs(pool6Baseline.baseP - expectedPool6BaseP) > 1e-9) {
  throw new Error(`FAIL: pool6 baseline drifted. got=${pool6Baseline.baseP} expected=${expectedPool6BaseP}`);
}
if (pool6Baseline.board !== 'Pool 1-5') throw new Error(`FAIL: pool6 board mismatch: ${pool6Baseline.board}`);
console.log('OK: pool6 baseline formula matches pre-rename fable6 formula exactly');

// --- 2. baseline formula for pool_tail3 (k=15) matches the pre-rename fable_pool3 formula exactly ---
const poolTail3Baseline = _formulaBaselineForField('pool_tail3', 15);
const p1 = 1000 * (1 - Math.pow(0.999, 168)) / 1000;
const expectedPoolTail3BaseP = (1 - Math.pow(1 - p1, 15)) * 100;
if (Math.abs(poolTail3Baseline.baseP - expectedPoolTail3BaseP) > 1e-9) {
  throw new Error(`FAIL: pool_tail3 baseline drifted. got=${poolTail3Baseline.baseP} expected=${expectedPoolTail3BaseP}`);
}
console.log('OK: pool_tail3 baseline formula matches pre-rename fable_pool3 formula exactly');

// --- 3. hit-check: pool6 hits when a prediction matches the combined pool6Set ---
const pool6Set = new Set(['751495', '803981', '123456']);
const poolTail3Set = new Set(['495', '981', '456']);
const pools = { pool6Set, poolTail3Set };

const hitPool6 = _formulaHitForField({ field: 'pool6', preds: ['999999', '803981'] }, {}, pools);
const missPool6 = _formulaHitForField({ field: 'pool6', preds: ['999999', '888888'] }, {}, pools);
if (!hitPool6) throw new Error('FAIL: pool6 should hit when a prediction is in pool6Set');
if (missPool6) throw new Error('FAIL: pool6 should not hit when no prediction is in pool6Set');
console.log('OK: pool6 hit-check works against pool6Set');

const hitPoolTail3 = _formulaHitForField({ field: 'pool_tail3', preds: ['999', '456'] }, {}, pools);
const missPoolTail3 = _formulaHitForField({ field: 'pool_tail3', preds: ['999', '888'] }, {}, pools);
if (!hitPoolTail3) throw new Error('FAIL: pool_tail3 should hit when a prediction is in poolTail3Set');
if (missPoolTail3) throw new Error('FAIL: pool_tail3 should not hit when no prediction is in poolTail3Set');
console.log('OK: pool_tail3 hit-check works against poolTail3Set');

// --- 4. old fable6/fable_pool3/fablePool names no longer exist anywhere in the field meta or hit-check ---
if (/fable/i.test(src)) throw new Error('FAIL: "fable" still appears somewhere in formula-engine.js');
console.log('OK: no "fable" references remain in formula-engine.js');
