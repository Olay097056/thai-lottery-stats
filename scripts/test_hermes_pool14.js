// HM · Hermes Pool 1-4 — value-weighted digit-position frequency over the prize 1-4 pool.
// Run with: node scripts/test_hermes_pool14.js
// Verifies (PRD-hermes-pool-1-4.md):
//  A. _buildPrize1to4Pool — 65-number input pool (prize2×5 + prize3×10 + prize4×50), excludes
//     near1/prize1/prize5, skips blank fields, carries declared tier weights (5:2:1 = 1.0/0.4/0.2).
//  B. _hermesPool14Formula — 10 unique 6-digit candidates, K=8 distinct per position, weighted
//     ranking matches hand computation, skips empty pool, distinct from I1/I2/J2/Mix.
//  C. Backtest integration — field pool6_14 (baseline 66/1e6), hit branch, batch row with
//     group:'HM' + trust:'ทดลอง', skipped when prev draw has no pool 1-4.
//  D. H-pollution guard — dcRecommendedNumbers group key = fr.group || name[0]: มิสเตอร์ซี ('H')
//     เลขแนะนำ must NOT inherit a false ทดลอง badge from Hermes; HM-supported ones DO get it;
//     rows without group field keep the old name[0] behavior (J1/J2 → 'J').
//  E. สูตรคำนวณ tab card — _hermesCards renders one card, data-group="HM", trust-badge present.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrcRaw = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
// Strip boot calls (same pattern as test_experimental_badge_propagation.js).
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

const need = ['_buildPrize1to4Pool', '_hermesPool14Formula', '_hermesCards', '_formulaGroupKey',
  '_imperialFormula', '_imperialGoldFormula', '_tycoonPool6Formula', '_computeMixRow',
  '_computeFormulasBatch', '_formulaBaselineForField', '_formulaHitForField', 'dcRecommendedNumbers'];
need.forEach(name => { if (typeof sandbox[name] !== 'function') throw new Error(`FAIL: ${name} not loaded`); });

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// ─── fixtures (realistic, same shape as test_tycoon_pool6_leg.js) ────────────
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

// ═══ A. _buildPrize1to4Pool ══════════════════════════════════════════════════
const pool = sandbox._buildPrize1to4Pool(prevFull);
check('pool has 5+10+3 = 18 entries', Array.isArray(pool) && pool.length === 18);
check('every entry is {num, w} with 6-digit num', pool.every(e => e && /^\d{6}$/.test(e.num) && typeof e.w === 'number'));
const poolNums = new Set(pool.map(e => e.num));
check('excludes near1_1', !poolNums.has('582307'));
check('excludes near1_2', !poolNums.has('519818'));
check('excludes prize1', !poolNums.has('287184'));
check('excludes prize5', !poolNums.has('451212') && !poolNums.has('281179'));
const w2 = pool.filter(e => ['914939', '698715', '753081', '689433', '521116'].includes(e.num));
const w3 = pool.filter(e => ['151823', '049061', '226315', '287363', '997032', '710403', '671381', '361886', '256329', '104572'].includes(e.num));
const w4 = pool.filter(e => ['899458', '849824', '839752'].includes(e.num));
check('prize2 entries carry w=1.0', w2.length === 5 && w2.every(e => e.w === 1.0));
check('prize3 entries carry w=0.4', w3.length === 10 && w3.every(e => e.w === 0.4));
check('prize4 entries carry w=0.2', w4.length === 3 && w4.every(e => e.w === 0.2));
check('blank pool fields are skipped (no manufactured 000000)', sandbox._buildPrize1to4Pool(prevNoPool).length === 0);

// ═══ B. _hermesPool14Formula ═════════════════════════════════════════════════
const hm = sandbox._hermesPool14Formula(prevFull, 10);
check('produces exactly 10 candidates', Array.isArray(hm) && hm.length === 10);
check('all candidates are 6-digit strings', hm.every(c => /^\d{6}$/.test(c)));
check('all candidates unique', new Set(hm).size === hm.length);
const perPos = Array.from({ length: 6 }, () => new Set());
hm.forEach(c => { for (let i = 0; i < 6; i++) perPos[i].add(c[i]); });
check('exactly 8 distinct digits per position (K=8 round-robin)', perPos.every(s => s.size === 8));
// Hand-computed weighted ranking for position 0 on this fixture:
//   prize2 leading digits {9:1,6:2,7:1,5:1} ×1.0 → 6:2.0, 9:1.4, 7:1.4, 5:1.0
//   prize3 leading digits {1:2,0:1,2:3,9:1,7:1,6:1,3:1} ×0.4 → 2:1.2, 1:0.8, 0:0.4, 3:0.4, 9:0.4, 7:0.4, 6:0.4
//   prize4 leading digits {8:3} ×0.2 → 8:0.6
//   totals: 6=2.4, 2=1.2, 7=1.8, 9=1.8, 5=1.0, 8=0.6, 1=0.8, 0=0.4, 3=0.4, 4=0
//   sorted desc, tie → digit asc: [6, 7, 9, 2, 5, 1, 8, 0, 3, 4]
check('candidate 0 position 0 = top weighted digit 6 (hand-computed)', hm[0][0] === '6');
check('weighting actually reorders vs raw freq (unweighted top pos0 would be 2)', hm[0][0] !== '2');
check('skips empty pool (no fallback)', sandbox._hermesPool14Formula(prevNoPool, 10).length === 0);

// Distinct from existing pool6 producers on the same realistic fixture.
const nextIso = '2568-08-01';
const i1 = sandbox._imperialFormula(prevFull, 10);
const i2 = sandbox._imperialGoldFormula(prevFull, 1, 8, 68, 10);
const j2 = sandbox._tycoonPool6Formula(prevFull, 1, 8, 68, 10);
const mixRow = sandbox._computeMixRow(sandbox._computeFormulasBatch(prevFull, nextIso, []));
const rivals = [['I1', i1], ['I2', i2], ['J2', j2], ['Mix', mixRow ? mixRow.preds : []]];
for (const [label, preds] of rivals) {
  if (!preds || !preds.length) { check(`Hermes distinct from ${label}: rival produced nothing (skip)`, true); continue; }
  check(`Hermes candidates fully distinct from ${label} (same draw)`, preds.every(p => !hm.includes(p)));
}

// ═══ C. Backtest integration ═════════════════════════════════════════════════
const meta = sandbox._formulaBaselineForField('pool6_14', 10);
check('pool6_14 baseline ≈ 1-(1-66/1e6)^10 = 0.066%', Math.abs(meta.baseP - (1 - Math.pow(1 - 66 / 1e6, 10)) * 100) < 1e-9);
check('pool6_14 board label mentions pool 1-4', String(meta.board).includes('1-4') || String(meta.typeLabel).includes('1-4'));
const poolsFixture = { pool14Set: new Set(hm) };
check('hit branch: candidate in pool14Set → true', sandbox._formulaHitForField({ preds: hm, field: 'pool6_14' }, prevFull, poolsFixture) === true);
check('hit branch: no overlap → false', sandbox._formulaHitForField({ preds: ['000000'], field: 'pool6_14' }, prevFull, poolsFixture) === false);

const batchFull = sandbox._computeFormulasBatch(prevFull, nextIso, []);
const hmRow = batchFull.find(fr => fr.name === 'HM · Hermes Pool 1-4');
check('batch contains HM row when prev has pool', !!hmRow);
check('HM row: field pool6_14, baseline 10, group HM, trust ทดลอง',
  hmRow && hmRow.field === 'pool6_14' && hmRow.baseline === 10 && hmRow.group === 'HM' && hmRow.trust === 'ทดลอง');
const batchNoPool = sandbox._computeFormulasBatch(prevNoPool, nextIso, []);
check('batch omits HM row when prev lacks pool', !batchNoPool.find(fr => fr.name === 'HM · Hermes Pool 1-4'));

// ═══ D. H-pollution guard (dcRecommendedNumbers, group key = fr.group || name[0]) ═══
// มิสเตอร์ซี ('H') supported เลขแนะนำ must stay clean even though Hermes (group HM) is ทดลอง.
const recoFixture1 = [
  { name: 'HM · Hermes Pool 1-4', group: 'HM', preds: ['123456'], field: 'pool6_14', baseline: 10, trust: 'ทดลอง' },
  { name: 'H1 มิสเตอร์ซี · 3 ตัวบนตรงชุดเดียว', preds: ['789'], field: 'top3', baseline: 1 },
  { name: 'G4 แม่นขั้นเทพ · 3 ตัวบน', preds: ['789'], field: 'top3', baseline: 1 },
];
const reco1 = sandbox.dcRecommendedNumbers(recoFixture1, new Map());
const top3Entry = (reco1.top3 || []).find(e => e.num === '789');
check('H-only เลขแนะนำ does NOT inherit false ทดลอง badge', top3Entry && top3Entry.trust === null);
// HM key works for propagation when a pool6_14 candidate converges (2 producers).
const recoFixture2 = [
  { name: 'HM · Hermes Pool 1-4', group: 'HM', preds: ['123456'], field: 'pool6_14', baseline: 10, trust: 'ทดลอง' },
  { name: 'XYZ · ผู้ผลิตสอง', preds: ['123456'], field: 'pool6_14', baseline: 10 },
];
const reco2 = sandbox.dcRecommendedNumbers(recoFixture2, new Map());
const p14Entry = (reco2.pool6_14 || []).find(e => e.num === '123456');
check('HM-supported เลขแนะนำ DOES carry ทดลอง badge (via group HM)', p14Entry && p14Entry.trust === 'ทดลอง');
// Backward compat: rows without group field keep name[0] (J1/J2 → 'J', X1 → 'X').
const recoFixture3 = [
  { name: 'J1 เจ้าสัว · ท้าย2', preds: ['41'], field: 'bottom2', baseline: 1, trust: 'ทดลอง' },
  { name: 'D1 สายธาร · ท้าย2', preds: ['41'], field: 'bottom2', baseline: 1 },
];
const reco3 = sandbox.dcRecommendedNumbers(recoFixture3, new Map());
const b2Entry = (reco3.bottom2 || []).find(e => e.num === '41');
check('backward compat: name[0] group key still works (J1 → J, badge propagates)',
  b2Entry && b2Entry.groups.includes('J') && b2Entry.trust === 'ทดลอง');

// ═══ E. สูตรคำนวณ tab card ═══════════════════════════════════════════════════
// Note: _hermesCards now returns 3 cards — HM (full 6-digit) + HM2 (ท้าย3 ใต้ดิน) + HM3
// (ท้าย3 ทางการ) per PRD-hm2-hermes-tail3.md. Card[0] remains HM; new cards are covered by
// test_hermes_tail3.js (section F).
const cards = sandbox._hermesCards(prevFull);
check('_hermesCards returns 3 cards (HM + HM2 + HM3)', Array.isArray(cards) && cards.length === 3);
check('card contains formula name', cards[0].includes('HM · Hermes Pool 1-4'));
check('card carries trust-badge', cards[0].includes('trust-badge') && cards[0].includes('ทดลอง'));
check('card data-group="HM"', cards[0].includes('data-group="HM"'));
check('_formulaGroupKey("HM …") → HM', sandbox._formulaGroupKey('HM · Hermes Pool 1-4') === 'HM');
check('_GRP badge map contains HM (drift-guard mirror test will enforce app.js side)',
  /'HM':\s*\[/.test(engineSrc));

// ═══ F. Buy-plan group dots (bpGroupsForSources) — HM prefix must not collapse to H ═══
const bpGroups = sandbox.bpGroupsForSources(['HM · Hermes Pool 1-4', 'D1 สายธาร · ท้าย2']);
const hmDot = bpGroups.find(g => g.letter === 'HM');
const dDot = bpGroups.find(g => g.letter === 'D');
check('bpGroupsForSources: HM source → group dot HM (not H)', !!hmDot && hmDot.label.includes('Hermes'));
check('bpGroupsForSources: normal source still letter-based (D)', !!dDot);
check('bpGroupsForSources: มิสเตอร์ซี H still maps to H (no HM collision)',
  sandbox.bpGroupsForSources(['H1 มิสเตอร์ซี · 3 ตัวบนตรงชุดเดียว']).some(g => g.letter === 'H'));

console.log(`OK: ${passed} checks passed`);
