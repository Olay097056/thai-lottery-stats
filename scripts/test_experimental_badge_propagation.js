// ทดลอง badge propagation onto Picks and เลขแนะนำ — ISSUE-14.
// Run with: node scripts/test_experimental_badge_propagation.js
// Loads the REAL app.js (with its trailing init() boot call stripped, since we only need
// the function declarations, not a live app) into a vm sandbox alongside formula-engine.js
// (app.js's own init() is defined in app.js itself but formula-engine.js must load first per
// index.html's script order / project convention). Exercises dcBuildScoreRows and
// dcRecommendedNumbers directly with hand-crafted fixtures — the real aggregation functions,
// not a hand-rolled mock of their logic, per this issue's own testing decision.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrcRaw = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
// Strip the two top-level boot calls (startCountdown() sets a DOM element with no null
// guard and would also start a setInterval; init() fetches over the network) — we only
// need the function declarations, not a live-booting app.
const appSrc = appSrcRaw.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');

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

const { dcBuildScoreRows, dcRecommendedNumbers, dcRecoTopOverall, dcTrustBadge, dcScoreHtml, dcRecoCardHtml } = sandbox;
['dcBuildScoreRows', 'dcRecommendedNumbers', 'dcRecoTopOverall', 'dcTrustBadge', 'dcScoreHtml', 'dcRecoCardHtml'].forEach(name => {
  if (typeof sandbox[name] !== 'function') throw new Error(`FAIL: ${name} not loaded from app.js`);
});

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// ============================================================================
// 1. dcBuildScoreRows — Pick aggregation, via the formulaMatches path (loop with
//    no edge gate — the path that fires regardless of a ทดลอง formula's own edge sign)
// ============================================================================
const formulaResultsFixture = [
  { name: 'J1 เจ้าสัว · ท้าย2', preds: ['41'], field: 'bottom2', baseline: 1, trust: 'ทดลอง' },
  { name: 'D1 สายธาร · ท้าย2', preds: ['62'], field: 'bottom2', baseline: 1 },
  { name: 'G4 แม่นขั้นเทพ · 2ตัวล่าง', preds: ['77'], field: 'bottom2', baseline: 1 },
];
const formulaMatchesFixture = [
  { num: '41', predict: [], formula: [{ label: 'J1 เจ้าสัว · ท้าย2', detail: 'bottom2' }] }, // only ทดลอง
  { num: '62', predict: [], formula: [{ label: 'D1 สายธาร · ท้าย2', detail: 'bottom2' }] }, // only trusted
  { num: '77', predict: [], formula: [
    { label: 'J1 เจ้าสัว · ท้าย2', detail: 'bottom2' },
    { label: 'G4 แม่นขั้นเทพ · 2ตัวล่าง', detail: 'bottom2' },
  ] }, // mixed
];
const scored1 = dcBuildScoreRows({
  cats: {}, formulaResults: formulaResultsFixture, formulaMatches: formulaMatchesFixture,
  btRows: [], mode: 'balanced', secondarySignals: {},
});
const row41 = scored1.all.find(r => r.num === '41');
const row62 = scored1.all.find(r => r.num === '62');
const row77 = scored1.all.find(r => r.num === '77');
check('Pick with only ทดลอง support carries trust=ทดลอง', row41 && row41.trust === 'ทดลอง');
check('Pick with only trusted support carries trust=null', row62 && row62.trust === null);
check('Pick with mixed support still carries trust=ทดลอง (propagation is "any")', row77 && row77.trust === 'ทดลอง');
// Independently computed from the documented add() point formula (10*weight per formula
// match via the formulaMatches loop, weight=1 with no matching btRows entry, no
// predict/formula-weight bonuses since cats={} and formulaWeight<=2 in every case here):
check('Pick score for single-formula-match number = 10 (10*weight=1, no bonuses)', row41.score === 10 && row62.score === 10);
check('Pick score for two-formula-match number = 20 (10+10, formulaWeight=2 not >2, no bonus)', row77.score === 20);
console.log(`OK: dcBuildScoreRows (formulaMatches path) propagates trust with "any" semantics; scores independently verified (41=${row41.score}, 62=${row62.score}, 77=${row77.score})`);

// ============================================================================
// 2. dcBuildScoreRows — via the formulaResults-direct path (edge>0 gated), the OTHER
//    place add() is called with meta.formula=true
// ============================================================================
const scored2 = dcBuildScoreRows({
  cats: {},
  formulaResults: [{ name: 'J1 เจ้าสัว · ท้าย2', preds: ['41'], field: 'bottom2', baseline: 1, trust: 'ทดลอง' }],
  formulaMatches: [],
  btRows: [{ name: 'J1 เจ้าสัว · ท้าย2', edge: 5.0, weight: 1 }],
  mode: 'balanced', secondarySignals: {},
});
const directRow41 = scored2.all.find(r => r.num === '41');
check('Pick via the formulaResults-direct (edge-gated) path also carries trust=ทดลอง', directRow41 && directRow41.trust === 'ทดลอง');
console.log('OK: dcBuildScoreRows (formulaResults-direct path) also propagates trust');

// ============================================================================
// 3. Regression: a fixture with NO ทดลอง formulas anywhere scores/ranks exactly as the
//    documented add() formula predicts — proving the trust-field addition is purely additive.
// ============================================================================
const scored3 = dcBuildScoreRows({
  cats: {},
  formulaResults: [],
  formulaMatches: [
    { num: '10', predict: [], formula: [{ label: 'A1', detail: 'bottom2' }, { label: 'B1', detail: 'bottom2' }] }, // score 20
    { num: '20', predict: [], formula: [{ label: 'A1', detail: 'bottom2' }] }, // score 10
  ],
  btRows: [], mode: 'coverage', secondarySignals: {},
});
check('regression: no-ทดลอง fixture — every row has trust=null', scored3.all.every(r => r.trust === null));
check('regression: no-ทดลอง fixture — scores match independently-computed values (20, 10)',
  scored3.all.find(r => r.num === '10').score === 20 && scored3.all.find(r => r.num === '20').score === 10);
check('regression: no-ทดลอง fixture — sort order is score desc (10 before 20)',
  scored3.all[0].num === '10' && scored3.all[1].num === '20');
console.log('OK: regression — a ทดลอง-free fixture scores/ranks unchanged (trust field is purely additive)');

// ============================================================================
// 4. dcRecommendedNumbers — เลขแนะนำ candidates, "any" semantics across agreeing groups
// ============================================================================
const recoFormulas = [
  { name: 'A1 บวกเลขบนล่าง', preds: ['41'], field: 'bottom2' },
  { name: 'D1 สายธาร · ท้าย2', preds: ['41'], field: 'bottom2' },
  { name: 'J1 เจ้าสัว · ท้าย2', preds: ['62'], field: 'bottom2', trust: 'ทดลอง' },
  { name: 'G4 แม่นขั้นเทพ · 2ตัวล่าง', preds: ['62'], field: 'bottom2' },
];
const reco = dcRecommendedNumbers(recoFormulas, new Map());
const reco41 = reco.bottom2.find(c => c.num === '41');
const reco62 = reco.bottom2.find(c => c.num === '62');
check('เลขแนะนำ candidate agreed only by trusted groups (A+D) has trust=null', reco41 && reco41.trust === null);
check('เลขแนะนำ candidate agreed by a group with a ทดลอง formula (G+J) has trust=ทดลอง', reco62 && reco62.trust === 'ทดลอง');
console.log('OK: dcRecommendedNumbers propagates trust based on agreeing groups, "any" semantics');

// ============================================================================
// 5. Regression: เลขแนะนำ ranking order (groups.length desc -> combinedEdge desc -> num asc)
//    unaffected by the trust field, for a fixture with no ทดลอง groups involved.
// ============================================================================
const recoRegressionFormulas = [
  { name: 'A1', preds: ['10'], field: 'bottom2' },
  { name: 'B1', preds: ['10'], field: 'bottom2' },
  { name: 'C1', preds: ['10'], field: 'bottom2' },
  { name: 'D1', preds: ['20'], field: 'bottom2' },
  { name: 'G1', preds: ['20'], field: 'bottom2' },
];
const recoRegression = dcRecommendedNumbers(recoRegressionFormulas, new Map());
check('regression: เลขแนะนำ order — 3-group "10" ranks before 2-group "20"',
  recoRegression.bottom2[0].num === '10' && recoRegression.bottom2[1].num === '20');
check('regression: เลขแนะนำ — every candidate has trust=null with no ทดลอง groups in the fixture',
  recoRegression.bottom2.every(c => c.trust === null));
console.log('OK: regression — เลขแนะนำ ranking order unchanged, trust=null throughout a ทดลอง-free fixture');

// ============================================================================
// 6. dcRecoTopOverall propagates the winning field's trust value through
// ============================================================================
const bestTrusted = dcRecoTopOverall({ bottom2: [{ num: '41', groups: ['A', 'D'], combinedEdge: 0, trust: null }] });
const bestExperimental = dcRecoTopOverall({ bottom2: [{ num: '62', groups: ['G', 'J'], combinedEdge: 0, trust: 'ทดลอง' }] });
check('dcRecoTopOverall propagates trust=null for a fully-trusted winner', bestTrusted && bestTrusted.trust === null);
check('dcRecoTopOverall propagates trust=ทดลอง for a ทดลอง-supported winner', bestExperimental && bestExperimental.trust === 'ทดลอง');
console.log('OK: dcRecoTopOverall carries the winning candidate\'s trust value through');

// ============================================================================
// 7. Rendering — dcTrustBadge, dcScoreHtml (Pick chip), dcRecoCardHtml (เลขแนะนำ chip)
// ============================================================================
check('dcTrustBadge(ทดลอง) renders the trust-badge pill', dcTrustBadge('ทดลอง').includes('trust-badge') && dcTrustBadge('ทดลอง').includes('ทดลอง'));
check('dcTrustBadge(null) renders nothing', dcTrustBadge(null) === '');

const pickHtmlWithBadge = dcScoreHtml([{ num: '41', score: 80, topEdge: 5, trust: 'ทดลอง', sources: ['J1'], reasons: [], warnings: [] }]);
const pickHtmlNoBadge = dcScoreHtml([{ num: '62', score: 80, topEdge: 5, trust: null, sources: ['D1'], reasons: [], warnings: [] }]);
check('Pick chip (dcScoreHtml) shows trust-badge when row.trust=ทดลอง', pickHtmlWithBadge.includes('trust-badge'));
check('Pick chip (dcScoreHtml) shows no trust-badge when row.trust=null', !pickHtmlNoBadge.includes('trust-badge'));
console.log('OK: Pick chip (dcScoreHtml) renders the trust badge only when supported by a ทดลอง formula');

const recoHtmlWithBadge = dcRecoCardHtml('bottom2', '2 ตัวล่าง', [{ num: '62', groups: ['G', 'J'], combinedEdge: 0, trust: 'ทดลอง' }]);
const recoHtmlNoBadge = dcRecoCardHtml('bottom2', '2 ตัวล่าง', [{ num: '41', groups: ['A', 'D'], combinedEdge: 0, trust: null }]);
check('เลขแนะนำ chip (dcRecoCardHtml) shows trust-badge when top candidate trust=ทดลอง', recoHtmlWithBadge.includes('trust-badge'));
check('เลขแนะนำ chip (dcRecoCardHtml) shows no trust-badge when top candidate trust=null', !recoHtmlNoBadge.includes('trust-badge'));
console.log('OK: เลขแนะนำ chip (dcRecoCardHtml) renders the trust badge only when the top candidate is ทดลอง-supported');

console.log(`\nOK: ${passed} checks passed`);
