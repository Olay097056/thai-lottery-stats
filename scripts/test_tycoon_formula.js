// Regression check for เจ้าสัว (Group J) bottom2 leg — ISSUE-13.
// Run with: node scripts/test_tycoon_formula.js
// Verifies:
// 1. _tycoonBottom2Formula computes pad2(|BK2 - DSUM|) using Group D's shared
//    _dsumValue helper (not a second, duplicate DSUM computation).
// 2. It produces no output (skip, no fallback) when back3_2 is missing/blank.
// 3. It produces no output when the target date parts are missing.
// 4. Regression: _claudeFormulas' D1 output is unchanged after the _dsumValue
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

// --- 1. known-value check: BK2=531 (back3_2), DSUM=15+7+68=90 -> |531-90|=441 -> pad2 -> '41' ---
const prevRow1 = { back3_2: '531' };
const j1 = _tycoonBottom2Formula(prevRow1, 15, 7, 68);
if (JSON.stringify(j1) !== JSON.stringify(['41'])) {
  throw new Error(`FAIL: expected ["41"] for BK2=531/DSUM=90, got ${JSON.stringify(j1)}`);
}
console.log(`OK: _tycoonBottom2Formula(back3_2=531, 15/7/68) = ${JSON.stringify(j1)} (independently computed: |531-90| mod 100 = 41)`);

// --- second known-value check, different fixture: BK2=42, DSUM=3+12+67=82 -> |42-82|=40 -> pad2 -> '40' ---
const prevRow2 = { back3_2: '042' };
const j2 = _tycoonBottom2Formula(prevRow2, 3, 12, 67);
if (JSON.stringify(j2) !== JSON.stringify(['40'])) {
  throw new Error(`FAIL: expected ["40"] for BK2=42/DSUM=82, got ${JSON.stringify(j2)}`);
}
console.log(`OK: _tycoonBottom2Formula(back3_2=042, 3/12/67) = ${JSON.stringify(j2)} (independently computed: |42-82| mod 100 = 40)`);

// --- 2. skip on missing/blank back3_2, no fallback substitution ---
const missingBk2 = _tycoonBottom2Formula({ back3_2: '' }, 15, 7, 68);
if (!Array.isArray(missingBk2) || missingBk2.length !== 0) {
  throw new Error(`FAIL: expected no output for blank back3_2, got ${JSON.stringify(missingBk2)}`);
}
const absentBk2 = _tycoonBottom2Formula({}, 15, 7, 68);
if (!Array.isArray(absentBk2) || absentBk2.length !== 0) {
  throw new Error(`FAIL: expected no output for absent back3_2 key, got ${JSON.stringify(absentBk2)}`);
}
console.log('OK: _tycoonBottom2Formula produces no output (no fallback) when back3_2 is missing/blank');

// --- 3. skip when target date parts are missing ---
const missingDate = _tycoonBottom2Formula({ back3_2: '531' }, null, 7, 68);
if (!Array.isArray(missingDate) || missingDate.length !== 0) {
  throw new Error(`FAIL: expected no output for missing nextDay, got ${JSON.stringify(missingDate)}`);
}
const nanDate = _tycoonBottom2Formula({ back3_2: '531' }, NaN, 7, 68);
if (!Array.isArray(nanDate) || nanDate.length !== 0) {
  throw new Error(`FAIL: expected no output for NaN nextDay, got ${JSON.stringify(nanDate)}`);
}
console.log('OK: _tycoonBottom2Formula produces no output when target date parts are missing');

// --- 4. regression: D1 output unchanged after _dsumValue extraction (pure refactor) ---
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

// --- 5. full-engine integration: J1 appears in _computeFormulasBatch with field=bottom2,
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
if (!Array.isArray(j1Result.preds) || j1Result.preds.length !== 1 || !/^\d{2}$/.test(j1Result.preds[0])) {
  throw new Error(`FAIL: J1 preds should be a single 2-digit string, got ${JSON.stringify(j1Result.preds)}`);
}
const nonJTrusted = batchResults.filter(r => !String(r.name || '').startsWith('J') && r.trust);
if (nonJTrusted.length) {
  throw new Error(`FAIL: non-J formulas should have no trust value, but found: ${JSON.stringify(nonJTrusted.map(r => r.name))}`);
}
console.log(`OK: _computeFormulasBatch includes J1 (field=bottom2, trust=ทดลอง, preds=${JSON.stringify(j1Result.preds)}); no A-I formula carries a trust value`);

// --- 6. _GRP has a 'J' entry with a color distinct from every other group's color ---
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

// --- 7. _mkFormulaCard renders a ทดลอง badge when trust is passed, and none when it isn't ---
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

// --- 8. _renderBtTable (app.js) renders the trust badge for a ทดลอง row and not for others ---
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
