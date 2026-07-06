// Regression check for จักรพรรดิ (Group I) digit-position frequency scorer (ISSUE-6).
// Run with: node scripts/test_imperial_formula.js
// Verifies:
// 1. The reusable scorer (_digitPosFreq) produces a known ranked-digit-per-position
//    result for a fixed synthetic pool array.
// 2. จักรพรรดิ (_imperialFormula) generates ~10 six-digit candidates from a fixed
//    synthetic previous-draw row object, built from the shared pool builder
//    (_buildPrize1to5Pool) + scorer.
// 3. จักรพรรดิ produces no output for a previous-draw row with empty prize-pool
//    fields (matching the Sanook-dependent-formula skip behavior).
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

const code = [
  extract('_buildPrize1to5Pool'),
  extract('_digitPosFreq'),
  extract('_imperialFormula'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _buildPrize1to5Pool, _digitPosFreq, _imperialFormula } = sandbox;

// --- 1. scorer produces a known ranked-digit-per-position result for a fixed pool ---
// Pool chosen so each position has an unambiguous frequency winner, plus one
// position with a 2-1 split (position 0: digit '1' x2, digit '2' x1) and one
// position with an all-zero tie broken by ascending digit value (position 5:
// '4','5','6' all count 1, '0' should sort first among the zero-count digits,
// but the tie-break must resolve deterministically ascending for equal counts).
const fixedPool = ['123456', '123457', '223456'];
const ranked = _digitPosFreq(fixedPool);
if (!Array.isArray(ranked) || ranked.length !== 6) {
  throw new Error(`FAIL: expected 6 position arrays, got ${JSON.stringify(ranked)}`);
}
// Position 0: '1' appears twice (123456, 123457), '2' appears once (223456) -> '1' ranks first.
if (ranked[0][0].digit !== '1' || ranked[0][0].count !== 2) {
  throw new Error(`FAIL: position 0 top digit should be '1' (count 2), got ${JSON.stringify(ranked[0][0])}`);
}
if (ranked[0][1].digit !== '2' || ranked[0][1].count !== 1) {
  throw new Error(`FAIL: position 0 second digit should be '2' (count 1), got ${JSON.stringify(ranked[0][1])}`);
}
// Position 1: all three numbers have '2' -> count 3, clear winner.
if (ranked[1][0].digit !== '2' || ranked[1][0].count !== 3) {
  throw new Error(`FAIL: position 1 top digit should be '2' (count 3), got ${JSON.stringify(ranked[1][0])}`);
}
// Position 5 (last digit): '6' appears twice (123456, 223456), '7' appears once (123457).
if (ranked[5][0].digit !== '6' || ranked[5][0].count !== 2) {
  throw new Error(`FAIL: position 5 top digit should be '6' (count 2), got ${JSON.stringify(ranked[5][0])}`);
}
if (ranked[5][1].digit !== '7' || ranked[5][1].count !== 1) {
  throw new Error(`FAIL: position 5 second digit should be '7' (count 1), got ${JSON.stringify(ranked[5][1])}`);
}
// Tie-break check: among zero-count digits at position 0 ('0','3','4','5','6','7','8','9'),
// ascending digit value must win — '0' should appear before '3' in the remainder of the ranking.
const zeroCountDigitsPos0 = ranked[0].slice(2).map(d => d.digit);
const sortedAscending = [...zeroCountDigitsPos0].sort((a, b) => Number(a) - Number(b));
if (JSON.stringify(zeroCountDigitsPos0) !== JSON.stringify(sortedAscending)) {
  throw new Error(`FAIL: tied (zero-count) digits at position 0 not in ascending order: ${JSON.stringify(zeroCountDigitsPos0)}`);
}
console.log('OK: _digitPosFreq produces known ranked-digit-per-position result for fixed synthetic pool');

// --- 2. จักรพรรดิ generates ~10 six-digit candidates from a fixed synthetic previous-draw row ---
const fixtureRow = {
  near1_1: '111111', near1_2: '222222',
  prize2_1: '111112', prize2_2: '111113', prize2_3: '111114', prize2_4: '111115', prize2_5: '111116',
  prize3_1: '211111', prize3_2: '211112', prize3_3: '211113', prize3_4: '211114', prize3_5: '211115',
  prize3_6: '211116', prize3_7: '211117', prize3_8: '211118', prize3_9: '211119', prize3_10: '211120',
  prize4: '311111 311112 311113',
  prize5: '411111 411112',
};
const pool15 = _buildPrize1to5Pool(fixtureRow);
if (pool15.length !== 22) {
  throw new Error(`FAIL: expected 22 pool entries from fixture row, got ${pool15.length}`);
}
if (!pool15.every(n => /^\d{6}$/.test(n))) {
  throw new Error('FAIL: pool15 contains a non-6-digit entry');
}

const candidates = _imperialFormula(fixtureRow, 10);
if (!Array.isArray(candidates)) throw new Error('FAIL: _imperialFormula did not return an array');
if (candidates.length < 8 || candidates.length > 10) {
  throw new Error(`FAIL: expected ~10 (8-10) candidates, got ${candidates.length}: ${JSON.stringify(candidates)}`);
}
if (!candidates.every(c => /^\d{6}$/.test(c))) {
  throw new Error(`FAIL: candidates must all be 6-digit strings, got ${JSON.stringify(candidates)}`);
}
if (new Set(candidates).size !== candidates.length) {
  throw new Error('FAIL: candidates contain duplicates');
}
// Top-ranked candidate must be the position-wise highest-frequency digit string.
const rankedFixture = _digitPosFreq(pool15);
const expectedTop = rankedFixture.map(posRanked => posRanked[0].digit).join('');
if (candidates[0] !== expectedTop) {
  throw new Error(`FAIL: top candidate should be "${expectedTop}" (highest freq per position), got "${candidates[0]}"`);
}
// Candidates must be sorted by descending score (recomputed independently here).
const scoreOf = (digits) => digits.split('').reduce((sum, d, pos) => {
  const entry = rankedFixture[pos].find(e => e.digit === d);
  return sum + (entry ? entry.count : 0);
}, 0);
const scores = candidates.map(scoreOf);
for (let i = 1; i < scores.length; i++) {
  if (scores[i] > scores[i - 1]) {
    throw new Error(`FAIL: candidates not sorted by descending score at index ${i}: ${scores[i - 1]} -> ${scores[i]}`);
  }
}
console.log(`OK: _imperialFormula produced ${candidates.length} unique 6-digit candidates, correctly ranked by score`);
console.log(`  top candidates: ${candidates.slice(0, 5).join(' ')}`);

// --- 3. จักรพรรดิ produces no output for a previous-draw row with empty prize-pool fields ---
const emptyRow = {
  near1_1: '', near1_2: '',
  prize2_1: '', prize2_2: '', prize2_3: '', prize2_4: '', prize2_5: '',
  prize3_1: '', prize3_2: '', prize3_3: '', prize3_4: '', prize3_5: '',
  prize3_6: '', prize3_7: '', prize3_8: '', prize3_9: '', prize3_10: '',
  prize4: '', prize5: '',
  prize1: '287184', top3: '184', bottom2: '48',
};
const emptyPool = _buildPrize1to5Pool(emptyRow);
if (emptyPool.length !== 0) {
  throw new Error(`FAIL: expected empty pool for row with blank Sanook fields, got ${JSON.stringify(emptyPool)}`);
}
const emptyCandidates = _imperialFormula(emptyRow, 10);
if (!Array.isArray(emptyCandidates) || emptyCandidates.length !== 0) {
  throw new Error(`FAIL: expected no candidates for a previous draw with empty prize 1-5 pool data, got ${JSON.stringify(emptyCandidates)}`);
}
console.log('OK: จักรพรรดิ produces no output for a previous draw with empty prize 1-5 pool fields');

// --- also check the fully-absent-row case (missing keys entirely, e.g. undefined) ---
const missingKeysRow = { prize1: '287184' };
const missingCandidates = _imperialFormula(missingKeysRow, 10);
if (missingCandidates.length !== 0) {
  throw new Error(`FAIL: expected no candidates when Sanook keys are entirely absent, got ${JSON.stringify(missingCandidates)}`);
}
console.log('OK: จักรพรรดิ produces no output when Sanook fields are entirely absent from the row');
