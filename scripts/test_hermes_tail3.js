// HM2 · Hermes ท้าย3 ใต้ดิน + HM3 · Hermes ท้าย3 ทางการ — PRD-hm2-hermes-tail3.md
// Run with: node scripts/test_hermes_tail3.js
// Verifies:
//  A. _hermesTail3Formula — 10 unique 3-digit candidates, K=8 per position, TAIL positions
//     (3,4,5) only (front-digit changes don't affect output), candidate 0 hand-computed '013'.
//  B. _hermesOfficialTail3Formula — same shape but FRONT positions (0,1,2) only (tail-digit
//     changes don't affect output), candidate 0 starts with '6' (top weighted front digit).
//  C. Distinctness — HM2 may overlap tail3(HM) ≤ 8 (lap=0 round-robin, documented in PRD),
//     HM3 fully distinct from HM2/HM/I1/I2/J2/Mix.
//  D. Backtest integration — field pool14_tail3 (typeLabel ท้าย3 ใต้ดิน, board Pool 1-4,
//     baseline 1-(1-0.06390)^k) + HM3 field back3 (existing board); hit branches; batch rows
//     with group:'HM' + trust:'ทดลอง'; both omitted when prev draw lacks pool.
//  E. Target labels — HM2 → 'ท้าย 3 ตัว pool 1-4 (ใต้ดิน)', HM3 → 'เลขท้าย 3 ตัวทางการ',
//     HM unchanged (เลขเต็ม 6 หลัก).
//  F. สูตรคำนวณ tab cards — _hermesCards returns 3 cards (HM/HM2/HM3), HM2 carries the
//     ใต้ดิน marker, all data-group="HM".
//  G. bpGroupsForSources — HM2/HM3 prefixes map to group dot HM (not H).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrcRaw = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
const appSrc = appSrcRaw.replace(/^startCountdown\(\);?\s*$/m, '').replace(/^init\(\);?\s*$/m, '');

const stubEl = new Proxy({}, { get: () => () => stubEl, set: () => true });
const sandbox = {
  console,
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl,
    addEventListener: () => {},
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: () => Promise.reject(new Error('no network in test sandbox')),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);

const need = ['_hermesTail3Formula', '_hermesOfficialTail3Formula', '_hermesCards', '_hermesPool14Formula',
  '_imperialFormula', '_imperialGoldFormula', '_tycoonPool6Formula', '_computeMixRow',
  '_computeFormulasBatch', '_formulaBaselineForField', '_formulaHitForField', '_formulaTargetLabel',
  '_formulaGroupKey', 'bpGroupsForSources'];
need.forEach(name => { if (typeof sandbox[name] !== 'function') throw new Error(`FAIL: ${name} not loaded`); });

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// ─── fixtures (same realistic shape as test_hermes_pool14.js) ────────────────
const prevFull = {
  date: '16/07/2568',
  near1_1: '582307', near1_2: '519818',
  prize2_1: '914939', prize2_2: '698715', prize2_3: '753081', prize2_4: '689433', prize2_5: '521116',
  prize3_1: '151823', prize3_2: '049061', prize3_3: '226315', prize3_4: '287363', prize3_5: '997032',
  prize3_6: '710403', prize3_7: '671381', prize3_8: '361886', prize3_9: '256329', prize3_10: '104572',
  prize4: '899458 849824 839752',
  prize5: '451212 281179',
  prize1: '287184',
  top3: '184', bottom2: '84', back3_1: '184', back3_2: '531',
};
const prevNoPool = {
  date: '16/07/2568',
  prize1: '287184', top3: '184', top2: '84', front3_1: '287', front3_2: '184',
  back3_1: '184', back3_2: '531', bottom2: '84',
};

// Front-flipped copy: same tails, front 3 digits → '999' (tail-only proof).
const flipFront = {};
for (const k of Object.keys(prevFull)) {
  if (k.startsWith('prize2') || k.startsWith('prize3')) {
    flipFront[k] = '999' + prevFull[k].slice(3);
  } else if (k === 'prize4') {
    flipFront[k] = prevFull[k].split(/\s+/).map(t => '999' + t.slice(3)).join(' ');
  } else flipFront[k] = prevFull[k];
}
// Tail-flipped copy: same fronts, tail 3 digits → '999' (front-only proof).
const flipTail = {};
for (const k of Object.keys(prevFull)) {
  if (k.startsWith('prize2') || k.startsWith('prize3')) {
    flipTail[k] = prevFull[k].slice(0, 3) + '999';
  } else if (k === 'prize4') {
    flipTail[k] = prevFull[k].split(/\s+/).map(t => t.slice(0, 3) + '999').join(' ');
  } else flipTail[k] = prevFull[k];
}

// ═══ A. _hermesTail3Formula ═════════════════════════════════════════════════
const hm2 = sandbox._hermesTail3Formula(prevFull, 10);
check('produces exactly 10 candidates', Array.isArray(hm2) && hm2.length === 10);
check('all candidates are 3-digit strings', hm2.every(c => /^\d{3}$/.test(c)));
check('all candidates unique', new Set(hm2).size === hm2.length);
const perPos3 = Array.from({ length: 3 }, () => new Set());
hm2.forEach(c => { for (let i = 0; i < 3; i++) perPos3[i].add(c[i]); });
check('exactly 8 distinct digits per position (K=8 round-robin)', perPos3.every(s => s.size === 8));
// Hand-computed weighted ranking (5:2:1) over TAIL positions of the fixture:
//   pos3 totals: 0=1.8, 3=1.6, 4=1.6, 7=1.2, 1=1.0, 8=1.0, 9=1.0, 5=0.4 → top '0'
//   pos4 totals: 1=2.4, 3=2.4, 8=1.8, 2=1.0, 6=0.8, 0/5/7=0.4 → top '1'
//   pos5 totals: 3=2.2, 1=1.8, 5/6/9=1.4, 2=1.0, 4/8=0.2 → top '3'
check('candidate 0 = "013" (hand-computed)', hm2[0] === '013');
check('front-digit changes do NOT affect output (tail-only signal)',
  JSON.stringify(hm2) === JSON.stringify(sandbox._hermesTail3Formula(flipFront, 10)));
check('skips empty pool (no fallback)', sandbox._hermesTail3Formula(prevNoPool, 10).length === 0);

// ═══ B. _hermesOfficialTail3Formula ═════════════════════════════════════════
const hm3 = sandbox._hermesOfficialTail3Formula(prevFull, 10);
check('produces exactly 10 candidates', Array.isArray(hm3) && hm3.length === 10);
check('all candidates are 3-digit strings', hm3.every(c => /^\d{3}$/.test(c)));
check('all candidates unique', new Set(hm3).size === hm3.length);
const perPosF = Array.from({ length: 3 }, () => new Set());
hm3.forEach(c => { for (let i = 0; i < 3; i++) perPosF[i].add(c[i]); });
check('exactly 8 distinct digits per position (K=8 round-robin)', perPosF.every(s => s.size === 8));
// pos0 top weighted digit = '6' (from test_hermes_pool14.js hand computation) → candidate 0 starts '6'
check('candidate 0 starts with top weighted FRONT digit 6', hm3[0][0] === '6');
check('tail-digit changes do NOT affect output (front-only signal)',
  JSON.stringify(hm3) === JSON.stringify(sandbox._hermesOfficialTail3Formula(flipTail, 10)));
check('skips empty pool (no fallback)', sandbox._hermesOfficialTail3Formula(prevNoPool, 10).length === 0);

// ═══ C. Distinctness ════════════════════════════════════════════════════════
const hm = sandbox._hermesPool14Formula(prevFull, 10);
const hmTails = hm.map(c => c.slice(3));
const overlapWithHM = hm2.filter(c => hmTails.includes(c)).length;
check('HM2 overlaps tail3(HM) ≤ 8 (documented lap=0 round-robin property)', overlapWithHM <= 8);
check('HM2 has ≥ 2 candidates NOT in HM tails (lap=1 variants add value)', hm2.length - overlapWithHM >= 2);
check('HM3 fully distinct from HM2', hm3.every(c => !hm2.includes(c)));
const nextIso = '2568-08-01';
const i1 = sandbox._imperialFormula(prevFull, 10);
const i2 = sandbox._imperialGoldFormula(prevFull, 1, 8, 68, 10);
const j2 = sandbox._tycoonPool6Formula(prevFull, 1, 8, 68, 10);
const mixRow = sandbox._computeMixRow(sandbox._computeFormulasBatch(prevFull, nextIso, []));
const rivals = [['I1', i1], ['I2', i2], ['J2', j2], ['Mix', mixRow ? mixRow.preds : []]];
for (const [label, preds] of rivals) {
  if (!preds || !preds.length) { check(`HM3 distinct from ${label}: rival produced nothing (skip)`, true); continue; }
  check(`HM3 candidates fully distinct from ${label} (same draw)`, preds.every(p => !hm3.includes(p)));
}
check('HM3 also distinct from HM itself', hm3.every(c => !hm.includes(c)));

// ═══ D. Backtest integration ════════════════════════════════════════════════
const meta = sandbox._formulaBaselineForField('pool14_tail3', 10);
const p1 = 1 - Math.pow(0.999, 66);
check('pool14_tail3 baseline ≈ 1-(1-0.06390)^10', Math.abs(meta.baseP - (1 - Math.pow(1 - p1, 10)) * 100) < 1e-6);
check('pool14_tail3 typeLabel marks ใต้ดิน', String(meta.typeLabel).includes('ใต้ดิน'));
check('pool14_tail3 board = Pool 1-4', String(meta.board).includes('1-4'));
const tailPools = { pool14Tail3Set: new Set(['013', '777']) };
check('hit branch: candidate in pool14Tail3Set → true',
  sandbox._formulaHitForField({ preds: hm2, field: 'pool14_tail3' }, prevFull, tailPools) === true);
check('hit branch: no overlap → false',
  sandbox._formulaHitForField({ preds: ['000'], field: 'pool14_tail3' }, prevFull, { pool14Tail3Set: new Set(['013']) }) === false);
// HM3 rides the EXISTING back3 board (back3_1/back3_2 official เลขท้าย 3 ตัว).
check('HM3 hit via existing back3 branch (back3_2 match)',
  sandbox._formulaHitForField({ preds: ['531'], field: 'back3' }, prevFull, {}) === true);
check('HM3 miss via back3 branch',
  sandbox._formulaHitForField({ preds: ['000'], field: 'back3' }, prevFull, {}) === false);

const batchFull = sandbox._computeFormulasBatch(prevFull, nextIso, []);
const hm2Row = batchFull.find(fr => fr.name === 'HM2 · Hermes ท้าย3 ใต้ดิน');
const hm3Row = batchFull.find(fr => fr.name === 'HM3 · Hermes ท้าย3 ทางการ');
check('batch contains HM2 row when prev has pool', !!hm2Row);
check('HM2 row: field pool14_tail3, baseline 10, group HM, trust ทดลอง',
  hm2Row && hm2Row.field === 'pool14_tail3' && hm2Row.baseline === 10 && hm2Row.group === 'HM' && hm2Row.trust === 'ทดลอง');
check('batch contains HM3 row when prev has pool', !!hm3Row);
check('HM3 row: field back3, baseline 10, group HM, trust ทดลอง',
  hm3Row && hm3Row.field === 'back3' && hm3Row.baseline === 10 && hm3Row.group === 'HM' && hm3Row.trust === 'ทดลอง');
check('HM2/HM3 preds are 3-digit strings', (hm2Row && hm3Row) && hm2Row.preds.every(p => /^\d{3}$/.test(p)) && hm3Row.preds.every(p => /^\d{3}$/.test(p)));
const batchNoPool = sandbox._computeFormulasBatch(prevNoPool, nextIso, []);
check('batch omits HM2 when prev lacks pool', !batchNoPool.find(fr => fr.name === 'HM2 · Hermes ท้าย3 ใต้ดิน'));
check('batch omits HM3 when prev lacks pool', !batchNoPool.find(fr => fr.name === 'HM3 · Hermes ท้าย3 ทางการ'));

// ═══ E. Target labels ═══════════════════════════════════════════════════════
const lbl2 = sandbox._formulaTargetLabel('HM2 · Hermes ท้าย3 ใต้ดิน', 'HM2 · Hermes ท้าย3 ใต้ดิน', hm2);
check('HM2 label mentions ใต้ดิน + pool 1-4', lbl2.includes('ใต้ดิน') && lbl2.includes('1-4'));
check('HM2 label does NOT claim เลขเต็ม 6 หลัก', !lbl2.includes('เลขเต็ม 6 หลัก'));
const lbl3 = sandbox._formulaTargetLabel('HM3 · Hermes ท้าย3 ทางการ', 'HM3 · Hermes ท้าย3 ทางการ', hm3);
check('HM3 label mentions ทางการ', lbl3.includes('ทางการ'));
const lblHM = sandbox._formulaTargetLabel('HM · Hermes Pool 1-4', 'HM · Hermes Pool 1-4', hm);
check('HM original label unchanged (เลขเต็ม 6 หลัก)', lblHM.includes('เลขเต็ม 6 หลัก'));

// ═══ F. สูตรคำนวณ tab cards ═════════════════════════════════════════════════
const cards = sandbox._hermesCards(prevFull);
check('_hermesCards returns 3 cards (HM + HM2 + HM3)', Array.isArray(cards) && cards.length === 3);
check('card[0] is HM with trust-badge', cards[0].includes('HM · Hermes Pool 1-4') && cards[0].includes('trust-badge'));
check('card[1] is HM2 with ใต้ดิน marker', cards[1].includes('HM2 · Hermes ท้าย3 ใต้ดิน') && cards[1].includes('ใต้ดิน'));
check('card[2] is HM3 with ทางการ marker', cards[2].includes('HM3 · Hermes ท้าย3 ทางการ') && cards[2].includes('ทางการ'));
check('all cards data-group="HM"', cards.every(c => c.includes('data-group="HM"')));
check('_formulaGroupKey("HM2 …") → HM', sandbox._formulaGroupKey('HM2 · Hermes ท้าย3 ใต้ดิน') === 'HM');
check('_formulaGroupKey("HM3 …") → HM', sandbox._formulaGroupKey('HM3 · Hermes ท้าย3 ทางการ') === 'HM');

// ═══ G. Buy-plan group dots (HM prefix must not collapse to H) ═══════════════
const bp2 = sandbox.bpGroupsForSources(['HM2 · Hermes ท้าย3 ใต้ดิน']).find(g => g.letter === 'HM');
const bp3 = sandbox.bpGroupsForSources(['HM3 · Hermes ท้าย3 ทางการ']).find(g => g.letter === 'HM');
check('bpGroupsForSources: HM2 → group dot HM', !!bp2);
check('bpGroupsForSources: HM3 → group dot HM', !!bp3);

console.log(`OK: ${passed} checks passed`);
