// Self-verifying guard for DC_RECO_PRODUCER_GROUPS (app.js) — ISSUE-10 follow-up.
// Run with: node scripts/test_reco_producer_groups.js
//
// The เลขแนะนำ baseline (dcRecoBaseline) is group-count-aware: it scales with the number of
// DISTINCT top-level formula groups (name[0]) that produce each field type. That count lives
// in a hand-maintained constant, DC_RECO_PRODUCER_GROUPS, which is easy to get wrong — a
// literal grep of `field:'…'` UNDERCOUNTS groups emitted through dynamic loops (e.g. the E
// สายมู belief formulas, whose names come from f.name, not a string literal). This test runs
// the REAL engine (_computeFormulasBatch) over a rich fixture, derives the actual distinct
// name[0] set per field type, and asserts DC_RECO_PRODUCER_GROUPS matches — so any future
// drift between the engine and the constant fails here instead of silently skewing the Edge.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');

// --- load the whole engine in a vm with minimal browser-global stubs (it defines
// _computeFormulasBatch plus every group helper; extracting one function wouldn't work) ---
const stubEl = new Proxy({}, { get: () => () => stubEl, set: () => true });
const engineSandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, createElement: () => stubEl, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
};
engineSandbox.window = engineSandbox;
vm.createContext(engineSandbox);
vm.runInContext(engineSrc, engineSandbox);
const _computeFormulasBatch = engineSandbox._computeFormulasBatch;
if (typeof _computeFormulasBatch !== 'function') throw new Error('FAIL: _computeFormulasBatch not loaded');

// --- pull DC_RECO_PRODUCER_GROUPS out of app.js ---
const m = /const DC_RECO_PRODUCER_GROUPS=\{[^}]*\};/.exec(appSrc);
if (!m) throw new Error('FAIL: DC_RECO_PRODUCER_GROUPS not found in app.js');
const constSandbox = {};
vm.createContext(constSandbox);
vm.runInContext(m[0].replace('const ', 'this.'), constSandbox);
const DC_RECO_PRODUCER_GROUPS = constSandbox.DC_RECO_PRODUCER_GROUPS;

// --- rich prev draw + synthetic history so every formula family fires (A–E, G, X/Codex,
// Pattern Link, H) — Sanook-dependent pool fields present so nothing skips ---
const prev = {
  date: '01/07/2026', prize1: '751495', top3: '495', top2: '95',
  front3_1: '001', front3_2: '980', back3_1: '304', back3_2: '531', bottom2: '62',
  near1_1: '751494', near1_2: '751496', prize2_1: '111112', prize2_2: '222223',
  prize3_1: '333334', prize4: '444445 555556', prize5: '666667 777778',
};
const hist = [];
for (let i = 0; i < 60; i++) {
  hist.push({
    date: `${String((i % 28) + 1).padStart(2, '0')}/06/2026`,
    prize1: String(100000 + i * 137).slice(0, 6), top3: '123', top2: '23',
    front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444', bottom2: String(i % 100).padStart(2, '0'),
  });
}
const results = _computeFormulasBatch(prev, '2026-07-16', hist) || [];

// --- derive actual distinct top-level groups per field type ---
const actual = {};
results.forEach(r => {
  if (!r || !r.field) return;
  const g = String(r.name || '')[0];
  (actual[r.field] = actual[r.field] || new Set()).add(g);
});

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// Every field the constant claims must match the engine's real distinct-group count.
Object.keys(DC_RECO_PRODUCER_GROUPS).forEach(field => {
  const real = actual[field] ? actual[field].size : 0;
  check(`${field}: constant ${DC_RECO_PRODUCER_GROUPS[field]} matches engine reality ${real} (groups ${[...(actual[field] || [])].sort().join(',')})`,
    real === DC_RECO_PRODUCER_GROUPS[field]);
});

// Specifically pin the bottom2 = 8 case (7 was correct until Group J's bottom2 leg shipped,
// ISSUE-13): E must be among producers, proving the dynamic-loop สายมู group is counted.
check('bottom2 producers include E (สายมู, emitted via dynamic loop)', actual.bottom2 && actual.bottom2.has('E'));
check('bottom2 producers include J (เจ้าสัว bottom2 leg, ISSUE-13, ทดลอง)', actual.bottom2 && actual.bottom2.has('J'));
check('bottom2 has exactly 8 distinct producing groups', actual.bottom2 && actual.bottom2.size === 8);

console.log(`OK: ${passed} checks passed`);
