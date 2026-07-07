// Regression check for จักรพรรดิ / จักรพรรดิทองคำ (Group I) digit-position frequency
// scorer (ISSUE-6 + ISSUE-7). Run with: node scripts/test_imperial_formula.js
// Verifies:
// 1. The reusable scorer (_digitPosFreq) produces a known ranked-digit-per-position
//    result for a fixed synthetic pool array.
// 2. จักรพรรดิ (_imperialFormula) generates ~10 six-digit candidates from a fixed
//    synthetic previous-draw row object, built from the shared pool builder
//    (_buildPrize1to5Pool) + scorer.
// 3. จักรพรรดิ produces no output for a previous-draw row with empty prize-pool
//    fields (matching the Sanook-dependent-formula skip behavior).
// 4. จักรพรรดิทองคำ (_imperialGoldFormula) reuses the same scorer/candidate
//    generation (no duplicated frequency logic), and its blended score (80%
//    freqScore + 20% arithmetic closeness) is independently verifiable.
// 5. จักรพรรดิ and จักรพรรดิทองคำ produce genuinely different top-ranked candidates
//    for the same fixture + a target date chosen so the arithmetic signal flips
//    the ranking (proving the blend changes behavior, not just cosmetically).
// 6. จักรพรรดิทองคำ produces no output for an empty-pool previous draw, same as จักรพรรดิ.
// 7. _imperialDiverseSelect (candidate diversity fix): always keeps the top scorer,
//    spreads the rest of the set out (higher average pairwise Hamming distance than
//    naive top-N-by-score over the same input), relaxes minDist automatically rather
//    than returning short of topN, and is genuinely wired into both _imperialFormula
//    and _imperialGoldFormula (not just present but unused).
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
  extract('_imperialCandidates'),
  extract('_imperialDiverseSelect'),
  extract('_imperialFormula'),
  extract('_imperialGoldFormula'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _buildPrize1to5Pool, _digitPosFreq, _imperialCandidates, _imperialDiverseSelect, _imperialFormula, _imperialGoldFormula } = sandbox;

function hammingDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
function avgPairwiseDistance(digitsList) {
  let sum = 0, pairs = 0;
  for (let i = 0; i < digitsList.length; i++) {
    for (let j = i + 1; j < digitsList.length; j++) {
      sum += hammingDistance(digitsList[i], digitsList[j]);
      pairs++;
    }
  }
  return pairs ? sum / pairs : 0;
}

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

// --- 4. จักรพรรดิทองคำ reuses _imperialCandidates/_digitPosFreq and its blend is verifiable ---
const goldFixtureRow = { ...fixtureRow, prize1: '999999' };
const nextDay = 1, nextMonth = 9, nextYear2 = 68;
const goldCandidates = _imperialGoldFormula(goldFixtureRow, nextDay, nextMonth, nextYear2, 10);
if (!Array.isArray(goldCandidates) || goldCandidates.length < 8 || goldCandidates.length > 10) {
  throw new Error(`FAIL: expected ~10 (8-10) gold candidates, got ${JSON.stringify(goldCandidates)}`);
}
if (!goldCandidates.every(c => /^\d{6}$/.test(c))) {
  throw new Error(`FAIL: gold candidates must all be 6-digit strings, got ${JSON.stringify(goldCandidates)}`);
}
if (new Set(goldCandidates).size !== goldCandidates.length) {
  throw new Error('FAIL: gold candidates contain duplicates');
}
// Independently recompute the 80/20 blend for every raw candidate (via the shared
// _imperialCandidates + _digitPosFreq, proving no duplicated frequency logic) and
// confirm the formula's own ranking matches this independent computation exactly.
const goldPool = _buildPrize1to5Pool(goldFixtureRow);
const goldRanked = _digitPosFreq(goldPool);
const rawCandidates = _imperialCandidates(goldRanked);
const maxFreq = goldRanked.reduce((sum, posRanked) => sum + posRanked[0].count, 0);
const P = parseInt(goldFixtureRow.prize1, 10);
const target = String(((P + nextDay * nextMonth * nextYear2) % 1000000 + 1000000) % 1000000).padStart(6, '0');
const blendedOf = (digits) => {
  // Distance-based closeness (9-|digit-targetDigit| per position, /54 max), not exact-match —
  // candidates only ever contain the top-2 frequency digits per position, so an exact-match
  // closeness is almost always 0 for every candidate against an arbitrary arithmetic target
  // (verified against real production data), collapsing the blend to freqScore-only ranking.
  const closeness = [...digits].reduce((n, d, i) => n + (9 - Math.abs(Number(d) - Number(target[i]))), 0);
  const raw = rawCandidates.find(c => c.digits === digits);
  return 0.8 * (raw.freqScore / maxFreq) + 0.2 * (closeness / 54);
};
const blendedScores = goldCandidates.map(blendedOf);
for (let i = 1; i < blendedScores.length; i++) {
  if (blendedScores[i] > blendedScores[i - 1] + 1e-9) {
    throw new Error(`FAIL: gold candidates not sorted by descending blended score at index ${i}: ${blendedScores[i - 1]} -> ${blendedScores[i]}`);
  }
}
console.log(`OK: _imperialGoldFormula produced ${goldCandidates.length} unique candidates, blend independently verified`);

// --- 5. จักรพรรดิ and จักรพรรดิทองคำ produce genuinely different top-ranked candidates ---
// Uses a separate, less-peaked synthetic pool (deterministic LCG-generated, not hand-picked)
// because the tiny hand-picked fixture above has huge freqScore gaps between candidates —
// realistic enough that no arithmetic target can ever flip its top-1 ranking, which is
// exactly the trap the original exact-match closeness design fell into (see comment on
// _imperialGoldFormula): with candidates drawn only from the top-2 frequency digit per
// position, an exact-digit-match closeness against an arbitrary target is 0 for nearly
// every candidate on realistic data, silently collapsing the blend to freqScore-only
// ranking. This fixture + target combo is confirmed (by direct search) to flip the top-1
// ranking under the corrected distance-based closeness — proving the blend has a real,
// non-cosmetic effect, not just on a fixture engineered to make the old broken formula pass.
const realisticPoolRow = {
  near1_1: '582307', near1_2: '519818',
  prize2_1: '914939', prize2_2: '698715', prize2_3: '753081', prize2_4: '689433', prize2_5: '521116',
  prize3_1: '151823', prize3_2: '049061', prize3_3: '226315', prize3_4: '287363', prize3_5: '997032',
  prize3_6: '710403', prize3_7: '671381', prize3_8: '361886', prize3_9: '256329', prize3_10: '104572',
  prize4: '899458 849824 839752',
  prize5: '451212 281179',
  prize1: '287184',
};
const realisticNextDay = 1, realisticNextMonth = 1, realisticNextYear2 = 65;
const jakRealistic = _imperialFormula(realisticPoolRow, 10);
const goldRealistic = _imperialGoldFormula(realisticPoolRow, realisticNextDay, realisticNextMonth, realisticNextYear2, 10);
if (jakRealistic[0] === goldRealistic[0]) {
  throw new Error(`FAIL: expected จักรพรรดิ and จักรพรรดิทองคำ to disagree on the top candidate for this realistic fixture, both got "${jakRealistic[0]}"`);
}
console.log(`OK: จักรพรรดิ (top: ${jakRealistic[0]}) and จักรพรรดิทองคำ (top: ${goldRealistic[0]}) genuinely disagree on realistic data — blend changes ranking`);

// --- 6. จักรพรรดิทองคำ produces no output for a previous draw with empty prize 1-5 pool fields ---
const goldEmptyCandidates = _imperialGoldFormula(emptyRow, nextDay, nextMonth, nextYear2, 10);
if (!Array.isArray(goldEmptyCandidates) || goldEmptyCandidates.length !== 0) {
  throw new Error(`FAIL: expected no gold candidates for a previous draw with empty prize 1-5 pool data, got ${JSON.stringify(goldEmptyCandidates)}`);
}
console.log('OK: จักรพรรดิทองคำ produces no output for a previous draw with empty prize 1-5 pool fields');

// --- 7. _imperialDiverseSelect: diversity, top-scorer priority, minDist relaxation ---

// (a) diversity: a base candidate plus 6 near-duplicates (each 1 digit off the base,
// decreasing score) plus 4 genuinely distant candidates (much lower score, but spread
// across the digit space). Diverse-select (minDist=2) should prefer the distant ones
// over the near-duplicates once the base is taken, giving a higher average pairwise
// distance than naive top-5-by-score over the same input.
const diversityInput = [
  { digits: '555555', score: 100 },
  { digits: '555556', score: 99 },
  { digits: '555565', score: 98 },
  { digits: '555655', score: 97 },
  { digits: '556555', score: 96 },
  { digits: '565555', score: 95 },
  { digits: '655555', score: 94 },
  { digits: '012345', score: 50 },
  { digits: '987654', score: 49 },
  { digits: '246801', score: 48 },
  { digits: '864213', score: 47 },
];
const diverse5 = _imperialDiverseSelect(diversityInput, 'score', 5, 2);
if (!Array.isArray(diverse5) || diverse5.length !== 5) {
  throw new Error(`FAIL: expected exactly 5 diverse candidates, got ${JSON.stringify(diverse5)}`);
}
if (diverse5[0].digits !== '555555') {
  throw new Error(`FAIL: top scorer must always be admitted first, got ${JSON.stringify(diverse5[0])}`);
}
const naive5 = [...diversityInput].sort((a, b) => b.score - a.score).slice(0, 5);
const diverseAvgDist = avgPairwiseDistance(diverse5.map(c => c.digits));
const naiveAvgDist = avgPairwiseDistance(naive5.map(c => c.digits));
if (!(diverseAvgDist > naiveAvgDist)) {
  throw new Error(`FAIL: expected diverse selection avg distance (${diverseAvgDist}) > naive top-N avg distance (${naiveAvgDist})`);
}
console.log(`OK: _imperialDiverseSelect spreads candidates wider than naive top-N (diverse avg dist ${diverseAvgDist.toFixed(2)} vs naive ${naiveAvgDist.toFixed(2)}), always keeps the top scorer`);

// (b) minDist relaxation: 10 candidates that all differ from each other in exactly one
// digit (only the last position varies) — no two can ever satisfy minDist=2, so the
// first pass must relax to minDist=1 (where all pairs qualify) and still return exactly
// topN, never fewer.
const relaxInput = Array.from({ length: 10 }, (_, i) => ({ digits: `00000${i}`, score: 10 - i }));
const relaxed = _imperialDiverseSelect(relaxInput, 'score', 5, 2);
if (!Array.isArray(relaxed) || relaxed.length !== 5) {
  throw new Error(`FAIL: expected minDist relaxation to still return exactly 5 candidates, got ${JSON.stringify(relaxed)}`);
}
if (relaxed[0].digits !== '000000') {
  throw new Error(`FAIL: top scorer must still be admitted first after relaxation, got ${JSON.stringify(relaxed[0])}`);
}
console.log('OK: _imperialDiverseSelect relaxes minDist automatically rather than returning fewer than topN');

// (c) end-to-end wiring: on the realistic fixture already used above, จักรพรรดิ's actual
// output must be measurably more spread out than naive top-10-by-freqScore over the exact
// same raw candidate pool — proving _imperialDiverseSelect is genuinely wired in, not just
// defined and unused.
const realisticRankedForDiversity = _digitPosFreq(_buildPrize1to5Pool(realisticPoolRow));
const realisticRawCandidates = _imperialCandidates(realisticRankedForDiversity);
const naiveTop10 = [...realisticRawCandidates].sort((a, b) => b.freqScore - a.freqScore || (a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0)).slice(0, 10);
const actualTop10 = _imperialFormula(realisticPoolRow, 10);
const naiveTop10AvgDist = avgPairwiseDistance(naiveTop10.map(c => c.digits));
const actualAvgDist = avgPairwiseDistance(actualTop10);
if (!(actualAvgDist > naiveTop10AvgDist)) {
  throw new Error(`FAIL: expected _imperialFormula's actual output (avg dist ${actualAvgDist}) to be more spread out than naive top-10-by-score (avg dist ${naiveTop10AvgDist}) over the same candidate pool`);
}
console.log(`OK: _imperialFormula is genuinely wired to _imperialDiverseSelect (actual avg dist ${actualAvgDist.toFixed(2)} > naive ${naiveTop10AvgDist.toFixed(2)})`);
