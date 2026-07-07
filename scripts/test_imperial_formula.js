// Regression check for จักรพรรดิ / จักรพรรดิทองคำ (Group I) digit-position frequency
// scorer + round-robin candidate construction. Run with: node scripts/test_imperial_formula.js
// Verifies:
// 1. The reusable scorer (_digitPosFreq) produces a known ranked-digit-per-position
//    result for a fixed synthetic pool array.
// 2. จักรพรรดิ (_imperialFormula) generates exactly 10 six-digit candidates from a fixed
//    synthetic previous-draw row object, candidate 0 is the pure highest-frequency
//    digit per position, and every position shows exactly 8 distinct digits across
//    the 10 candidates (the per-position diversity guarantee).
// 3. จักรพรรดิ produces no output for a previous-draw row with empty prize-pool
//    fields (matching the Sanook-dependent-formula skip behavior).
// 4. จักรพรรดิทองคำ (_imperialGoldFormula) re-ranks each position by its own 80%
//    frequency + 20% arithmetic-closeness blend (not a whole-candidate blend), and
//    candidate 0 matches that independently-recomputed per-position ranking exactly.
// 5. จักรพรรดิ and จักรพรรดิทองคำ produce genuinely different top-ranked candidates
//    for the same fixture + a target date chosen so the arithmetic signal flips
//    the per-position ranking (proving the blend changes behavior, not just cosmetically).
// 6. จักรพรรดิทองคำ produces no output for an empty-pool previous draw, same as จักรพรรดิ.
// 7. _imperialRoundRobin (candidate diversity, round 2): candidate 0 always uses rank-0
//    at every position, all topN candidates are unique, every position shows exactly K
//    distinct digits, ranks below K never appear, the mechanism is collision-free even
//    on an adversarial fixture where every position shares an identical ranking, and it
//    degenerates correctly when topN <= K.
// 8. _imperialCandidates / _imperialDiverseSelect (round-1 mechanism, superseded by
//    _imperialRoundRobin) no longer exist anywhere in formula-engine.js.
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
  extract('_buildPrize1to5Pool'),
  extract('_digitPosFreq'),
  extract('_imperialRoundRobin'),
  extract('_imperialFormula'),
  extract('_imperialGoldFormula'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _buildPrize1to5Pool, _digitPosFreq, _imperialRoundRobin, _imperialFormula, _imperialGoldFormula } = sandbox;

function perPositionDistinctCounts(candidates) {
  const sets = Array.from({ length: 6 }, () => new Set());
  candidates.forEach(c => { for (let i = 0; i < 6; i++) sets[i].add(c[i]); });
  return sets.map(s => s.size);
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
if (ranked[0][0].digit !== '1' || ranked[0][0].count !== 2) {
  throw new Error(`FAIL: position 0 top digit should be '1' (count 2), got ${JSON.stringify(ranked[0][0])}`);
}
if (ranked[0][1].digit !== '2' || ranked[0][1].count !== 1) {
  throw new Error(`FAIL: position 0 second digit should be '2' (count 1), got ${JSON.stringify(ranked[0][1])}`);
}
if (ranked[1][0].digit !== '2' || ranked[1][0].count !== 3) {
  throw new Error(`FAIL: position 1 top digit should be '2' (count 3), got ${JSON.stringify(ranked[1][0])}`);
}
if (ranked[5][0].digit !== '6' || ranked[5][0].count !== 2) {
  throw new Error(`FAIL: position 5 top digit should be '6' (count 2), got ${JSON.stringify(ranked[5][0])}`);
}
if (ranked[5][1].digit !== '7' || ranked[5][1].count !== 1) {
  throw new Error(`FAIL: position 5 second digit should be '7' (count 1), got ${JSON.stringify(ranked[5][1])}`);
}
const zeroCountDigitsPos0 = ranked[0].slice(2).map(d => d.digit);
const sortedAscending = [...zeroCountDigitsPos0].sort((a, b) => Number(a) - Number(b));
if (JSON.stringify(zeroCountDigitsPos0) !== JSON.stringify(sortedAscending)) {
  throw new Error(`FAIL: tied (zero-count) digits at position 0 not in ascending order: ${JSON.stringify(zeroCountDigitsPos0)}`);
}
console.log('OK: _digitPosFreq produces known ranked-digit-per-position result for fixed synthetic pool');

// --- 2. จักรพรรดิ generates exactly 10 six-digit candidates, top scorer first, K=8 spread ---
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
if (!Array.isArray(candidates) || candidates.length !== 10) {
  throw new Error(`FAIL: expected exactly 10 candidates, got ${JSON.stringify(candidates)}`);
}
if (!candidates.every(c => /^\d{6}$/.test(c))) {
  throw new Error(`FAIL: candidates must all be 6-digit strings, got ${JSON.stringify(candidates)}`);
}
if (new Set(candidates).size !== candidates.length) {
  throw new Error('FAIL: candidates contain duplicates');
}
// Candidate 0 must be the position-wise highest-frequency digit string.
const rankedFixture = _digitPosFreq(pool15);
const expectedTop = rankedFixture.map(posRanked => posRanked[0].digit).join('');
if (candidates[0] !== expectedTop) {
  throw new Error(`FAIL: top candidate should be "${expectedTop}" (highest freq per position), got "${candidates[0]}"`);
}
const posSpread = perPositionDistinctCounts(candidates);
if (posSpread.some(n => n !== 8)) {
  throw new Error(`FAIL: expected exactly 8 distinct digits at every position, got ${JSON.stringify(posSpread)}`);
}
console.log(`OK: _imperialFormula produced 10 unique 6-digit candidates, candidate 0 = "${candidates[0]}" (top freq per position), per-position spread ${JSON.stringify(posSpread)}`);
console.log(`  candidates: ${candidates.join(' ')}`);

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

const missingKeysRow = { prize1: '287184' };
const missingCandidates = _imperialFormula(missingKeysRow, 10);
if (missingCandidates.length !== 0) {
  throw new Error(`FAIL: expected no candidates when Sanook keys are entirely absent, got ${JSON.stringify(missingCandidates)}`);
}
console.log('OK: จักรพรรดิ produces no output when Sanook fields are entirely absent from the row');

// --- 4. จักรพรรดิทองคำ re-ranks per position by 80% freq + 20% arithmetic closeness ---
const goldFixtureRow = { ...fixtureRow, prize1: '999999' };
const nextDay = 1, nextMonth = 9, nextYear2 = 68;
const goldCandidates = _imperialGoldFormula(goldFixtureRow, nextDay, nextMonth, nextYear2, 10);
if (!Array.isArray(goldCandidates) || goldCandidates.length !== 10) {
  throw new Error(`FAIL: expected exactly 10 gold candidates, got ${JSON.stringify(goldCandidates)}`);
}
if (!goldCandidates.every(c => /^\d{6}$/.test(c))) {
  throw new Error(`FAIL: gold candidates must all be 6-digit strings, got ${JSON.stringify(goldCandidates)}`);
}
if (new Set(goldCandidates).size !== goldCandidates.length) {
  throw new Error('FAIL: gold candidates contain duplicates');
}
const goldPosSpread = perPositionDistinctCounts(goldCandidates);
if (goldPosSpread.some(n => n !== 8)) {
  throw new Error(`FAIL: expected exactly 8 distinct digits at every position for gold, got ${JSON.stringify(goldPosSpread)}`);
}
// Independently recompute จักรพรรดิทองคำ's per-position blended ranking (0.8 freq + 0.2
// per-digit arithmetic closeness, NOT a whole-candidate blend) and confirm candidate 0
// matches this recomputation exactly, proving the per-position blend is genuinely wired in.
const goldPool = _buildPrize1to5Pool(goldFixtureRow);
const goldRanked = _digitPosFreq(goldPool);
const P = parseInt(goldFixtureRow.prize1, 10);
const target = String(((P + nextDay * nextMonth * nextYear2) % 1000000 + 1000000) % 1000000).padStart(6, '0');
const expectedGoldTop = goldRanked.map((posRanked, p) => {
  const maxCount = posRanked[0].count || 1;
  const targetDigit = Number(target[p]);
  const blendedRanked = [...posRanked].map(e => ({
    digit: e.digit,
    count: e.count,
    blended: 0.8 * (e.count / maxCount) + 0.2 * ((9 - Math.abs(Number(e.digit) - targetDigit)) / 9),
  })).sort((a, b) => b.blended - a.blended || b.count - a.count || (a.digit < b.digit ? -1 : a.digit > b.digit ? 1 : 0));
  return blendedRanked[0].digit;
}).join('');
if (goldCandidates[0] !== expectedGoldTop) {
  throw new Error(`FAIL: gold candidate 0 should be "${expectedGoldTop}" (independently recomputed per-position blend), got "${goldCandidates[0]}"`);
}
console.log(`OK: _imperialGoldFormula produced 10 unique candidates, per-position blend independently verified, spread ${JSON.stringify(goldPosSpread)}`);

// --- 5. จักรพรรดิ and จักรพรรดิทองคำ produce genuinely different top-ranked candidates ---
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
console.log(`OK: จักรพรรดิ (top: ${jakRealistic[0]}) and จักรพรรดิทองคำ (top: ${goldRealistic[0]}) genuinely disagree on realistic data — per-position blend changes ranking`);

// --- 6. จักรพรรดิทองคำ produces no output for a previous draw with empty prize 1-5 pool fields ---
const goldEmptyCandidates = _imperialGoldFormula(emptyRow, nextDay, nextMonth, nextYear2, 10);
if (!Array.isArray(goldEmptyCandidates) || goldEmptyCandidates.length !== 0) {
  throw new Error(`FAIL: expected no gold candidates for a previous draw with empty prize 1-5 pool data, got ${JSON.stringify(goldEmptyCandidates)}`);
}
console.log('OK: จักรพรรดิทองคำ produces no output for a previous draw with empty prize 1-5 pool fields');

// --- 7. _imperialRoundRobin: construction correctness, K-spread guarantee, collision-free ---

// (a) basic correctness on varied (non-identical) per-position rankings.
const variedRanked = Array.from({ length: 6 }, (_, p) =>
  Array.from({ length: 10 }, (_, r) => String((9 - r + p) % 10))
);
const rr10 = _imperialRoundRobin(variedRanked, 10, 8);
if (!Array.isArray(rr10) || rr10.length !== 10) {
  throw new Error(`FAIL: expected exactly 10 round-robin candidates, got ${JSON.stringify(rr10)}`);
}
if (new Set(rr10).size !== 10) {
  throw new Error(`FAIL: round-robin candidates must all be unique, got ${JSON.stringify(rr10)}`);
}
const expectedRR0 = variedRanked.map(posRanked => posRanked[0]).join('');
if (rr10[0] !== expectedRR0) {
  throw new Error(`FAIL: round-robin candidate 0 should be "${expectedRR0}" (rank-0 at every position), got "${rr10[0]}"`);
}
const rrSpread = perPositionDistinctCounts(rr10);
if (rrSpread.some(n => n !== 8)) {
  throw new Error(`FAIL: expected exactly 8 distinct digits per position, got ${JSON.stringify(rrSpread)}`);
}
// Ranks 8-9 (the bottom 2 of each position's ranking) must never appear in any candidate.
for (let p = 0; p < 6; p++) {
  const excluded = new Set([variedRanked[p][8], variedRanked[p][9]]);
  if (rr10.some(c => excluded.has(c[p]))) {
    throw new Error(`FAIL: position ${p} should never use rank-8/9 digits ${JSON.stringify([...excluded])}, got candidates ${JSON.stringify(rr10)}`);
  }
}
console.log(`OK: _imperialRoundRobin produces 10 unique candidates, candidate 0 = rank-0 everywhere, exactly K=8 distinct digits per position, ranks 8-9 excluded`);

// (b) adversarial fixture: every position shares the identical ranking (worst case for
// accidental row collisions, hand-derived during grilling to still produce 10 distinct rows).
const identicalRanking = ['9', '8', '7', '6', '5', '4', '3', '2', '1', '0'];
const identicalRanked = Array.from({ length: 6 }, () => [...identicalRanking]);
const rrIdentical = _imperialRoundRobin(identicalRanked, 10, 8);
const expectedIdentical = ['999999', '888888', '777777', '666666', '555555', '444444', '333333', '222222', '876543', '765432'];
if (JSON.stringify(rrIdentical) !== JSON.stringify(expectedIdentical)) {
  throw new Error(`FAIL: adversarial identical-ranking fixture should produce ${JSON.stringify(expectedIdentical)}, got ${JSON.stringify(rrIdentical)}`);
}
if (new Set(rrIdentical).size !== 10) {
  throw new Error(`FAIL: adversarial identical-ranking fixture produced duplicate rows: ${JSON.stringify(rrIdentical)}`);
}
console.log('OK: _imperialRoundRobin is collision-free even when every position shares an identical ranking');

// (c) degenerate case: topN <= K (no lap/wraparound needed) — candidate i uses rank i everywhere.
const rr5 = _imperialRoundRobin(variedRanked, 5, 8);
if (rr5.length !== 5) throw new Error(`FAIL: expected 5 candidates for topN=5, got ${JSON.stringify(rr5)}`);
for (let i = 0; i < 5; i++) {
  const expected = variedRanked.map(posRanked => posRanked[i]).join('');
  if (rr5[i] !== expected) {
    throw new Error(`FAIL: topN<=K candidate ${i} should be "${expected}" (rank ${i} everywhere), got "${rr5[i]}"`);
  }
}
console.log('OK: _imperialRoundRobin degenerates correctly when topN <= K (no wraparound needed)');

// --- 8. round-1 mechanism (_imperialCandidates / _imperialDiverseSelect) fully removed ---
if (/function _imperialCandidates\(/.test(src)) {
  throw new Error('FAIL: _imperialCandidates should have been removed (superseded by _imperialRoundRobin)');
}
if (/function _imperialDiverseSelect\(/.test(src)) {
  throw new Error('FAIL: _imperialDiverseSelect should have been removed (superseded by _imperialRoundRobin)');
}
console.log('OK: round-1 mechanism (_imperialCandidates / _imperialDiverseSelect) no longer present in formula-engine.js');
