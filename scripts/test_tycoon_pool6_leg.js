// Group J pool6 leg — ISSUE-15. Run with: node scripts/test_tycoon_pool6_leg.js
// Verifies:
// 1. _tycoonPool6Formula reuses _buildPrize1to5Pool/_digitPosFreq directly (no duplicated
//    digit-position-frequency logic) and produces 10 unique 6-digit candidates.
// 2. Candidate 0's per-position blend (80% freq + 20% closeness to |BK2-DSUM|, padded to
//    6 digits) is independently recomputed and matches exactly.
// 3. Produces no output for an empty prize 1-5 pool (matches จักรพรรดิ/จักรพรรดิทองคำ skip).
// 4. Produces no output when back3_2 or target date parts are missing (matches ISSUE-13's
//    bottom2 leg no-fallback-substitution rule).
// 5. Genuinely disagrees with both จักรพรรดิ (I1) and จักรพรรดิทองคำ (I2) on realistic data —
//    proving the J-native blend is a distinct signal, not a relabeled duplicate.
// 6. Full-engine integration: appears in _computeFormulasBatch as a J2 entry, field=pool6,
//    trust=ทดลอง.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE_PATH = path.join(__dirname, '..', 'static', 'formula-engine.js');
const src = fs.readFileSync(ENGINE_PATH, 'utf8');

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

const code = [
  extract('_dsumValue'),
  extract('_buildPrize1to5Pool'),
  extract('_digitPosFreq'),
  extract('_imperialRoundRobin'),
  extract('_imperialFormula'),
  extract('_imperialGoldFormula'),
  extract('_tycoonPool6Formula'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _buildPrize1to5Pool, _digitPosFreq, _imperialFormula, _imperialGoldFormula, _tycoonPool6Formula } = sandbox;

function perPositionDistinctCounts(candidates) {
  const sets = Array.from({ length: 6 }, () => new Set());
  candidates.forEach(c => { for (let i = 0; i < 6; i++) sets[i].add(c[i]); });
  return sets.map(s => s.size);
}

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// --- fixture: same shape as test_imperial_formula.js's realisticPoolRow, plus back3_2 ---
const fixtureRow = {
  near1_1: '582307', near1_2: '519818',
  prize2_1: '914939', prize2_2: '698715', prize2_3: '753081', prize2_4: '689433', prize2_5: '521116',
  prize3_1: '151823', prize3_2: '049061', prize3_3: '226315', prize3_4: '287363', prize3_5: '997032',
  prize3_6: '710403', prize3_7: '671381', prize3_8: '361886', prize3_9: '256329', prize3_10: '104572',
  prize4: '899458 849824 839752',
  prize5: '451212 281179',
  prize1: '287184',
  back3_2: '531',
};
const nextDay = 1, nextMonth = 1, nextYear2 = 65;

// --- 1. 10 unique 6-digit candidates, reusing the shared pool/scorer functions ---
const j2 = _tycoonPool6Formula(fixtureRow, nextDay, nextMonth, nextYear2, 10);
check('produces exactly 10 candidates', Array.isArray(j2) && j2.length === 10);
check('all candidates are 6-digit strings', j2.every(c => /^\d{6}$/.test(c)));
check('all candidates unique', new Set(j2).size === j2.length);
const spread = perPositionDistinctCounts(j2);
check('exactly 8 distinct digits per position (K=8 round-robin)', spread.every(n => n === 8));
console.log(`OK: _tycoonPool6Formula produced 10 unique candidates, spread ${JSON.stringify(spread)}`);
console.log(`  candidates: ${j2.join(' ')}`);

// --- 2. candidate 0's per-position blend independently recomputed ---
const pool = _buildPrize1to5Pool(fixtureRow);
const ranked = _digitPosFreq(pool);
const BK2 = parseInt(fixtureRow.back3_2, 10);
const DSUM = nextDay + nextMonth + nextYear2;
const target = String(Math.abs(BK2 - DSUM) % 1000000).padStart(6, '0');
const expectedTop = ranked.map((posRanked, p) => {
  const maxCount = posRanked[0].count || 1;
  const targetDigit = Number(target[p]);
  const blended = [...posRanked].map(e => ({
    digit: e.digit, count: e.count,
    blended: 0.8 * (e.count / maxCount) + 0.2 * ((9 - Math.abs(Number(e.digit) - targetDigit)) / 9),
  })).sort((a, b) => b.blended - a.blended || b.count - a.count || (a.digit < b.digit ? -1 : a.digit > b.digit ? 1 : 0));
  return blended[0].digit;
}).join('');
if (j2[0] !== expectedTop) {
  throw new Error(`FAIL: candidate 0 should be "${expectedTop}" (independently recomputed |BK2-DSUM| blend), got "${j2[0]}"`);
}
console.log(`OK: candidate 0 ("${j2[0]}") matches independent per-position |BK2-DSUM| blend recomputation (target=${target})`);

// --- 3. no output for empty prize 1-5 pool ---
const emptyRow = {
  near1_1: '', near1_2: '', prize2_1: '', prize2_2: '', prize2_3: '', prize2_4: '', prize2_5: '',
  prize3_1: '', prize3_2: '', prize3_3: '', prize3_4: '', prize3_5: '', prize3_6: '', prize3_7: '',
  prize3_8: '', prize3_9: '', prize3_10: '', prize4: '', prize5: '',
  prize1: '287184', back3_2: '531',
};
check('no output for empty prize 1-5 pool', _tycoonPool6Formula(emptyRow, nextDay, nextMonth, nextYear2, 10).length === 0);
console.log('OK: _tycoonPool6Formula produces no output for a previous draw with empty prize 1-5 pool fields');

// --- 4. no output when back3_2 or date parts are missing (no fallback substitution) ---
check('no output for blank back3_2', _tycoonPool6Formula({ ...fixtureRow, back3_2: '' }, nextDay, nextMonth, nextYear2, 10).length === 0);
check('no output for missing back3_2 key', _tycoonPool6Formula({ ...fixtureRow, back3_2: undefined }, nextDay, nextMonth, nextYear2, 10).length === 0);
check('no output for missing nextDay', _tycoonPool6Formula(fixtureRow, null, nextMonth, nextYear2, 10).length === 0);
check('no output for NaN nextMonth', _tycoonPool6Formula(fixtureRow, nextDay, NaN, nextYear2, 10).length === 0);
console.log('OK: _tycoonPool6Formula produces no output (no fallback) when back3_2 or target date parts are missing');

// --- 5. genuinely disagrees with I1/I2 on the same realistic fixture ---
const jak = _imperialFormula(fixtureRow, 10);
const gold = _imperialGoldFormula(fixtureRow, nextDay, nextMonth, nextYear2, 10);
check('J2 top candidate differs from จักรพรรดิ (I1)', j2[0] !== jak[0]);
check('J2 top candidate differs from จักรพรรดิทองคำ (I2)', j2[0] !== gold[0]);
console.log(`OK: J2 (top: ${j2[0]}) genuinely disagrees with I1 (top: ${jak[0]}) and I2 (top: ${gold[0]})`);

// --- 6. full-engine integration: appears in _computeFormulasBatch as pool6/ทดลอง ---
const stubEl = new Proxy({}, { get: () => () => stubEl, set: () => true });
const engineSandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, createElement: () => stubEl, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
};
engineSandbox.window = engineSandbox;
vm.createContext(engineSandbox);
vm.runInContext(src, engineSandbox);
const _computeFormulasBatch = engineSandbox._computeFormulasBatch;
const batchResults = _computeFormulasBatch(fixtureRow, '2026-07-16', []) || [];
const j2Result = batchResults.find(r => String(r.name || '').startsWith('J2'));
check('J2 appears in _computeFormulasBatch output', !!j2Result);
check('J2 field is pool6', j2Result && j2Result.field === 'pool6');
check('J2 trust is ทดลอง', j2Result && j2Result.trust === 'ทดลอง');
check('J1 (bottom2 leg) still present alongside J2', batchResults.some(r => String(r.name || '').startsWith('J1')));
console.log(`OK: _computeFormulasBatch includes J2 (field=pool6, trust=ทดลอง), J1 still present alongside it`);

console.log(`\nOK: ${passed} checks passed`);
