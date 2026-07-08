// Regression check for เจ้าสัว (Group J) bottom2 leg — ISSUE-13, widened per the
// 2026-07-08 grilling session (see docs/adr/0003-...md "Update" section).
// Run with: node scripts/test_tycoon_formula.js
// Verifies:
// 1. _tycoonBottom2Formula computes the searched center pad2(|BK2 - DSUM|) (using Group
//    D's shared _dsumValue helper, not a second duplicate DSUM computation), then returns
//    that center value plus its +-1/+-2 mod-100 neighbors, 5 candidates, ascending order.
// 2. The mod-100 wraparound is correct at both boundaries (center near 0, center near 99).
// 3. It produces no output (skip, no fallback) when back3_2 is missing/blank.
// 4. It produces no output when the target date parts are missing.
// 5. Regression: _claudeFormulas' D1 output is unchanged after the _dsumValue
//    extraction (pure refactor, same DSUM formula).
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
  extract('_claudeFormulas'),
  extract('_tycoonBottom2Formula'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _dsumValue, _claudeFormulas, _tycoonBottom2Formula } = sandbox;

// --- 1. known-value check: BK2=531 (back3_2), DSUM=15+7+68=90 -> center=|531-90| mod 100=41
// -> 5 candidates = center +-1/+-2 = 39,40,41,42,43, ascending, no wraparound needed ---
const prevRow1 = { back3_2: '531' };
const j1 = _tycoonBottom2Formula(prevRow1, 15, 7, 68);
if (JSON.stringify(j1) !== JSON.stringify(['39', '40', '41', '42', '43'])) {
  throw new Error(`FAIL: expected ["39","40","41","42","43"] for center=41, got ${JSON.stringify(j1)}`);
}
console.log(`OK: _tycoonBottom2Formula(back3_2=531, 15/7/68) = ${JSON.stringify(j1)} (independently computed: center=|531-90| mod 100=41, +-2 spread)`);

// --- second known-value check, different fixture: BK2=42, DSUM=3+12+67=82 -> center=|42-82|=40
// -> 5 candidates = 38,39,40,41,42 ---
const prevRow2 = { back3_2: '042' };
const j2 = _tycoonBottom2Formula(prevRow2, 3, 12, 67);
if (JSON.stringify(j2) !== JSON.stringify(['38', '39', '40', '41', '42'])) {
  throw new Error(`FAIL: expected ["38","39","40","41","42"] for center=40, got ${JSON.stringify(j2)}`);
}
console.log(`OK: _tycoonBottom2Formula(back3_2=042, 3/12/67) = ${JSON.stringify(j2)} (independently computed: center=|42-82|=40, +-2 spread)`);

// --- 2. mod-100 wraparound at both boundaries ---
// center=0: back3_2=090 (BK2=90), nextDay=1,nextMonth=1,nextYear2=88 -> DSUM=90 -> center=|90-90|=0
// -> raw offsets -2,-1,0,1,2 -> 98,99,00,01,02 -> ascending lexical sort (all 2-digit zero-padded,
// so lexical order = numeric order) -> ["00","01","02","98","99"]
const wrapLowRow = { back3_2: '090' };
const wrapLow = _tycoonBottom2Formula(wrapLowRow, 1, 1, 88);
if (JSON.stringify(wrapLow) !== JSON.stringify(['00', '01', '02', '98', '99'])) {
  throw new Error(`FAIL: expected ["00","01","02","98","99"] for center=0 wraparound, got ${JSON.stringify(wrapLow)}`);
}
console.log(`OK: _tycoonBottom2Formula wraps correctly at center=0: ${JSON.stringify(wrapLow)}`);

// center=99: back3_2=101 (BK2=101), nextDay=1,nextMonth=1,nextYear2=0 -> DSUM=2 -> center=|101-2|=99
// -> raw offsets -2,-1,0,1,2 -> 97,98,99,00,01 -> ascending -> ["00","01","97","98","99"]
const wrapHighRow = { back3_2: '101' };
const wrapHigh = _tycoonBottom2Formula(wrapHighRow, 1, 1, 0);
if (JSON.stringify(wrapHigh) !== JSON.stringify(['00', '01', '97', '98', '99'])) {
  throw new Error(`FAIL: expected ["00","01","97","98","99"] for center=99 wraparound, got ${JSON.stringify(wrapHigh)}`);
}
console.log(`OK: _tycoonBottom2Formula wraps correctly at center=99: ${JSON.stringify(wrapHigh)}`);

// --- 3. skip on missing/blank back3_2, no fallback substitution ---
const missingBk2 = _tycoonBottom2Formula({ back3_2: '' }, 15, 7, 68);
if (!Array.isArray(missingBk2) || missingBk2.length !== 0) {
  throw new Error(`FAIL: expected no output for blank back3_2, got ${JSON.stringify(missingBk2)}`);
}
const absentBk2 = _tycoonBottom2Formula({}, 15, 7, 68);
if (!Array.isArray(absentBk2) || absentBk2.length !== 0) {
  throw new Error(`FAIL: expected no output for absent back3_2 key, got ${JSON.stringify(absentBk2)}`);
}
console.log('OK: _tycoonBottom2Formula produces no output (no fallback) when back3_2 is missing/blank');

// --- 4. skip when target date parts are missing ---
const missingDate = _tycoonBottom2Formula({ back3_2: '531' }, null, 7, 68);
if (!Array.isArray(missingDate) || missingDate.length !== 0) {
  throw new Error(`FAIL: expected no output for missing nextDay, got ${JSON.stringify(missingDate)}`);
}
const nanDate = _tycoonBottom2Formula({ back3_2: '531' }, NaN, 7, 68);
if (!Array.isArray(nanDate) || nanDate.length !== 0) {
  throw new Error(`FAIL: expected no output for NaN nextDay, got ${JSON.stringify(nanDate)}`);
}
console.log('OK: _tycoonBottom2Formula produces no output when target date parts are missing');

// --- 5. regression: D1 output unchanged after _dsumValue extraction (pure refactor) ---
const ctx = { p6: '751495', t3: '495', b2: '62', bk1: '304', bk2: '531', drawday: 1, nextDay: 15, nextMonth: 7, nextYear2: 68 };
const D = _claudeFormulas(ctx);
// Independently hand-computed D1 set (pre-refactor formula, unchanged by the DSUM extraction):
// B2=62, P=751495, BK1=304, BK2=531, DSUM=90, b2a=6, b2b=2
const expectedD1 = [
  '62',                          // pad2(B2)
  '26',                          // rev(pad2(B2))
  '37',                          // pad2(99-B2)
  '57',                          // pad2(P%100 + B2) = pad2(95+62=157) -> 57
  '35',                          // pad2(BK1%100+BK2%100) = pad2(4+31=35)
  '95',                          // pad2(P%100)
  '04',                          // pad2(BK1%100)
  '92',                          // pad2(DSUM+b2b) = pad2(90+2=92)
  '11',                          // pad2(nextDay*nextMonth+b2a) = pad2(105+6=111) -> 11
  '14',                          // pad2(floor(P/100)%100) = pad2(7514%100=14)
];
if (JSON.stringify(D.d1) !== JSON.stringify(expectedD1)) {
  throw new Error(`FAIL: _claudeFormulas D1 regression — expected ${JSON.stringify(expectedD1)}, got ${JSON.stringify(D.d1)}`);
}
console.log('OK: _claudeFormulas D1 output unchanged after _dsumValue extraction (pure refactor confirmed)');

// --- 6. full-engine integration: J1 appears in _computeFormulasBatch with field=bottom2,
// trust='ทดลอง', and no other A-I formula gained a trust value ---
const vmFull = require('vm');
const stubEl = new Proxy({}, { get: () => () => stubEl, set: () => true });
const engineSandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, createElement: () => stubEl, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
};
engineSandbox.window = engineSandbox;
vmFull.createContext(engineSandbox);
vmFull.runInContext(src, engineSandbox);
const _computeFormulasBatch = engineSandbox._computeFormulasBatch;
if (typeof _computeFormulasBatch !== 'function') throw new Error('FAIL: _computeFormulasBatch not loaded');

const prevDraw = {
  date: '01/07/2026', prize1: '751495', top3: '495', top2: '95',
  front3_1: '001', front3_2: '980', back3_1: '304', back3_2: '531', bottom2: '62',
  near1_1: '751494', near1_2: '751496', prize2_1: '111112', prize2_2: '222223',
  prize3_1: '333334', prize4: '444445 555556', prize5: '666667 777778',
};
const batchResults = _computeFormulasBatch(prevDraw, '2026-07-16', []) || [];
const j1Result = batchResults.find(r => String(r.name || '').startsWith('J1'));
if (!j1Result) throw new Error('FAIL: no J1 result found in _computeFormulasBatch output');
if (j1Result.field !== 'bottom2') throw new Error(`FAIL: J1 field should be 'bottom2', got '${j1Result.field}'`);
if (j1Result.trust !== 'ทดลอง') throw new Error(`FAIL: J1 trust should be 'ทดลอง', got ${JSON.stringify(j1Result.trust)}`);
// Exact arithmetic correctness is already independently verified in checks 1-2 above via
// direct _tycoonBottom2Formula calls; this integration check only confirms the wiring shape.
if (!Array.isArray(j1Result.preds) || j1Result.preds.length !== 5 || !j1Result.preds.every(p => /^\d{2}$/.test(p))) {
  throw new Error(`FAIL: J1 preds should be 5 two-digit strings, got ${JSON.stringify(j1Result.preds)}`);
}
// baseline (backtest bottom2 baseP = k/100) tracks candidate count automatically — no code
// change needed for this, but pin it here so a future accidental change to preds.length is caught.
if (j1Result.baseline !== 5) {
  throw new Error(`FAIL: J1 baseline should be 5 (tracks preds.length), got ${j1Result.baseline}`);
}
const nonJTrusted = batchResults.filter(r => !String(r.name || '').startsWith('J') && r.trust);
if (nonJTrusted.length) {
  throw new Error(`FAIL: non-J formulas should have no trust value, but found: ${JSON.stringify(nonJTrusted.map(r => r.name))}`);
}
console.log(`OK: _computeFormulasBatch includes J1 (field=bottom2, trust=ทดลอง, preds=${JSON.stringify(j1Result.preds)}); no A-I formula carries a trust value`);

// --- 7. _GRP has a 'J' entry with a color distinct from every other group's color ---
const grpMatch = /const _GRP=\{[^}]*\};/.exec(src);
if (!grpMatch) throw new Error('FAIL: _GRP literal not found in formula-engine.js');
const grpSandbox = {};
vmFull.createContext(grpSandbox);
vmFull.runInContext(grpMatch[0].replace('const ', 'this.'), grpSandbox);
const _GRP = grpSandbox._GRP;
if (!_GRP.J) throw new Error('FAIL: _GRP has no "J" entry');
const allColors = Object.values(_GRP).map(([, color]) => color);
const jColor = _GRP.J[1];
const dupes = allColors.filter(c => c === jColor);
if (dupes.length !== 1) throw new Error(`FAIL: _GRP.J color "${jColor}" is not distinct from other group colors: ${JSON.stringify(_GRP)}`);
console.log(`OK: _GRP.J = ${JSON.stringify(_GRP.J)}, color distinct from all other groups`);

// --- 8. _mkFormulaCard renders a ทดลอง badge when trust is passed, and none when it isn't ---
// (reuse engineSandbox from check 5 above — the full engine, so every helper _mkFormulaCard
// transitively calls, e.g. _formulaBacktestRowsByName, is already defined)
const cardWithTrust = engineSandbox._mkFormulaCard('J1 เจ้าสัว · ท้าย2', 'J. เจ้าสัว', ['step'], [], 'note', 'ทดลอง');
if (!cardWithTrust.includes('class="trust-badge"') || !cardWithTrust.includes('>ทดลอง<')) {
  throw new Error(`FAIL: expected a trust-badge with "ทดลอง" text when trust param passed, got: ${cardWithTrust.slice(0, 400)}`);
}
const cardNoTrust = engineSandbox._mkFormulaCard('D1 สายธาร', 'D. เจ้าพ่อ Claude', ['step'], [], 'note');
if (cardNoTrust.includes('trust-badge')) {
  throw new Error(`FAIL: expected no trust-badge when trust param omitted (existing A-I formulas), got: ${cardNoTrust.slice(0, 400)}`);
}
console.log('OK: _mkFormulaCard renders a ทดลอง badge only when a trust value is explicitly passed');

// --- 9. _renderBtTable (app.js) renders the trust badge for a ทดลอง row and not for others ---
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
function extractFrom(fileSrc, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{', 'm');
  const m = re.exec(fileSrc);
  if (!m) throw new Error('not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (fileSrc[i] === '{') depth++;
    else if (fileSrc[i] === '}') depth--;
    i++;
  }
  return fileSrc.slice(m.index, i);
}
let capturedHtml = '';
const btStubEl = { innerHTML: '' };
const btSandbox = {
  console,
  document: {
    getElementById: (id) => (id === 'formula-bt-table' ? btStubEl : { getElementById: () => null }),
    querySelector: () => null,
  },
};
btSandbox.window = btSandbox;
vmFull.createContext(btSandbox);
vmFull.runInContext(src, btSandbox); // full formula-engine.js: globals _btRowData etc, _formulaBtSummaryHtml, _formulaMappingBannerHtml
vmFull.runInContext(extractFrom(appSrc, '_renderBtTable'), btSandbox);
// _btRowData etc are `let`-declared module globals inside the vm's lexical scope, not own
// properties of the sandbox object — must assign via vm-executed code, not host-side property sets.
const fixtureRows = [
  { name: 'J1 เจ้าสัว · ท้าย2', group: 'J · เจ้าสัว', groupColor: '#10b981', field: 'bottom2', typeLabel: 'เต็ม 2หลัก', board: '2-digit exact', total: 100, hits: 1, pct: 1, baseP: 1, baseLabel: '1/100', edge: 0, ciLow: 0, ciHigh: 2, subHits: 0, subTotal: 0, subPct: null, rolling: {}, edge50: null, edge100: null, edge200: null, degraded: false, trust: 'ทดลอง' },
  { name: 'D1 สายธาร · ท้าย2', group: 'D · Claude', groupColor: '#22d3ee', field: 'bottom2', typeLabel: 'เต็ม 2หลัก', board: '2-digit exact', total: 100, hits: 5, pct: 5, baseP: 10, baseLabel: '10/100', edge: -5, ciLow: 1, ciHigh: 9, subHits: 0, subTotal: 0, subPct: null, rolling: {}, edge50: null, edge100: null, edge200: null, degraded: false, trust: null },
];
vmFull.runInContext(
  `_btRowData=${JSON.stringify(fixtureRows)};_btSortKey='edge';_btSortAsc=false;_btTested=100;_btFieldCheck=null;_renderBtTable();`,
  btSandbox
);
capturedHtml = btStubEl.innerHTML;
if (!capturedHtml.includes('trust-badge')) throw new Error('FAIL: expected trust-badge to appear in rendered backtest table HTML');
// Anchor on the row's own group-badge closing tag (unique to the <tr><td> cell, unlike the
// formula name which also appears in the "Best edge/hit" summary mini-cards above the table).
const j1Anchor = capturedHtml.indexOf('J · เจ้าสัว</span>');
if (j1Anchor === -1) throw new Error('FAIL: could not find J1 table row (group badge) in rendered HTML');
const j1CellHtml = capturedHtml.slice(j1Anchor, capturedHtml.indexOf('</td>', j1Anchor));
if (!j1CellHtml.includes('trust-badge')) throw new Error(`FAIL: J1's own table-cell should carry the trust-badge, got: ${j1CellHtml}`);
const d1Anchor = capturedHtml.indexOf('D · Claude</span>');
if (d1Anchor === -1) throw new Error('FAIL: could not find D1 table row (group badge) in rendered HTML');
const d1CellHtml = capturedHtml.slice(d1Anchor, capturedHtml.indexOf('</td>', d1Anchor));
if (d1CellHtml.includes('trust-badge')) throw new Error(`FAIL: D1's table-cell should NOT carry the trust-badge, got: ${d1CellHtml}`);
console.log('OK: _renderBtTable shows the trust-badge only on the ทดลอง row (J1), not on the trusted row (D1)');
