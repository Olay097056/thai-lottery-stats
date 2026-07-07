// Fixture tests for เลขแนะนำ (Recommended Number) convergence engine — ISSUE-9.
// Run with: node scripts/test_recommended_numbers.js
//
// Rule under test (ADR docs/adr/0001-convergence-definition-for-recommended-number.md):
// 2+ DISTINCT top-level formula groups (A-I, name[0]; Codex's X-prefixed formulas all
// count as one group 'X') must independently produce the exact same number for the
// exact same field type. Same-length-different-field-type never merges. Sub-formulas
// within the same top-level group agreeing never counts. Field types with only one
// historical producing group (pool6, back3, prize1_last4_digits, bottom2_unit) can
// therefore never produce a result — no special-case code should be needed for that.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');

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

// dcRecoExplainText depends on dcRecoGroupLabel + the DC_RECO_GROUP_DISPLAY const, so
// pull those in too. extract() only grabs functions, so add the const line separately.
function extractConst(name) {
  const re = new RegExp('const ' + name + '=[^;]*;', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found const: ' + name);
  return m[0];
}

const code = [
  extract('dcRecommendedNumbers'),
  extractConst('DC_RECO_FIELDS'),
  extractConst('DC_RECO_GROUP_DISPLAY'),
  extract('dcRecoGroupLabel'),
  extract('dcRecoExplainText'),
  extract('dcRecoTopOverall'),
].join('\n\n');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { dcRecommendedNumbers, dcRecoExplainText, dcRecoTopOverall } = sandbox;

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

const btMap = new Map([
  ['A1 formula', { edge: 10 }],
  ['B1 formula', { edge: 5 }],
  ['C1 formula', { edge: 20 }],
  ['D2 formula', { edge: 8 }],
  ['X3 Codex formula', { edge: 12 }],
  ['I1 จักรพรรดิ', { edge: 30 }],
  ['I2 จักรพรรดิทองคำ', { edge: 25 }],
]);

// --- 1. distinct-group agreement produces a result ---
{
  const results = [
    { name: 'A1 formula', field: 'bottom2', preds: ['23'] },
    { name: 'D1 formula', field: 'bottom2', preds: ['23'] },
  ];
  const reco = dcRecommendedNumbers(results, btMap);
  check('distinct groups (A,D) agreeing on bottom2 "23" produces a result',
    reco.bottom2?.length === 1 && reco.bottom2[0].num === '23');
  check('result records both agreeing groups',
    JSON.stringify(reco.bottom2[0].groups) === JSON.stringify(['A', 'D']));
}

// --- 2. same-group sub-formula agreement does NOT count ---
{
  const results = [
    { name: 'I1 จักรพรรดิ', field: 'pool6', preds: ['211112'] },
    { name: 'I2 จักรพรรดิทองคำ', field: 'pool6', preds: ['211112'] },
  ];
  const reco = dcRecommendedNumbers(results, btMap);
  check('two sub-formulas of the SAME group (I1+I2) agreeing does not produce a เลขแนะนำ',
    !reco.pool6 || reco.pool6.length === 0);
}

// --- 3. same-digit-different-field-type does NOT merge ---
{
  const results = [
    { name: 'D2 formula', field: 'front3', preds: ['123'] },
    { name: 'X3 Codex formula', field: 'back3exact', preds: ['123'] },
  ];
  const reco = dcRecommendedNumbers(results, btMap);
  check('front3 "123" alone does not qualify (only 1 group produced it for that field)',
    !reco.front3 || reco.front3.length === 0);
  check('back3exact "123" alone does not qualify either',
    !reco.back3exact || reco.back3exact.length === 0);
}

// --- 4. ranking: more agreeing groups wins; tie-break by combined edge ---
{
  const results = [
    // "23": A + B + C agree (3 groups) — should rank first
    { name: 'A1 formula', field: 'bottom2', preds: ['23'] },
    { name: 'B1 formula', field: 'bottom2', preds: ['23'] },
    { name: 'C1 formula', field: 'bottom2', preds: ['23'] },
    // "45": D + X agree (2 groups, lower combined edge than a 2-group tie below)
    { name: 'D1 formula', field: 'bottom2', preds: ['45'] },
    { name: 'X3 Codex formula', field: 'bottom2', preds: ['45'] },
    // "67": A + D agree (2 groups) — same group-count as "45", higher combined edge (10+8=18 vs 45's edge lookup uses D+X = 8+12=20)
    { name: 'A1 formula', field: 'bottom2', preds: ['67'] },
    { name: 'D1 formula', field: 'bottom2', preds: ['67'] },
  ];
  const reco = dcRecommendedNumbers(results, btMap);
  check('3-group candidate ("23") ranks first regardless of edge', reco.bottom2[0].num === '23');
  check('all 3 qualifying numbers present in ranked list', reco.bottom2.length === 3);
  // "45" combined edge = D(8) + X(12) = 20; "67" combined edge = A(10) + D(8) = 18 -> "45" ranks above "67"
  const secondAndThird = reco.bottom2.slice(1).map(c => c.num);
  check('2-group candidates tie-broken by combined edge (45 before 67)',
    secondAndThird[0] === '45' && secondAndThird[1] === '67');
}

// --- 5. structural exclusion: single-producer field types can never qualify ---
{
  const singleProducerCases = [
    { field: 'pool6', names: ['I1 จักรพรรดิ', 'I2 จักรพรรดิทองคำ'], num: '211112' },
    { field: 'back3', names: ['C1 formula', 'C1 formula variant'], num: '215' },
    { field: 'prize1_last4_digits', names: ['C1 formula', 'C1 formula variant'], num: '2154' },
    { field: 'bottom2_unit', names: ['A1 formula', 'A2 formula'], num: '5' },
  ];
  singleProducerCases.forEach(({ field, names, num }) => {
    const results = names.map(name => ({ name, field, preds: [num] }));
    const reco = dcRecommendedNumbers(results, btMap);
    check(`${field} (single-producer-group field) never produces a เลขแนะนำ even with 2 same-group sub-formulas agreeing`,
      !reco[field] || reco[field].length === 0);
  });
}

// --- edge cases: empty/missing input doesn't throw ---
{
  check('empty formulaResults returns an object with no truthy field arrays',
    Object.keys(dcRecommendedNumbers([], btMap)).every(k => dcRecommendedNumbers([], btMap)[k].length === 0));
  check('missing btMap defaults edge to 0 without throwing', (() => {
    const reco = dcRecommendedNumbers([
      { name: 'A1 formula', field: 'bottom2', preds: ['23'] },
      { name: 'D1 formula', field: 'bottom2', preds: ['23'] },
    ], undefined);
    return reco.bottom2?.length === 1;
  })());
}

// --- 6. explainer display ordering (X->F mapped BEFORE sort, so shown alphabetically) ---
{
  // Codex 'X' displays as 'F'; when it co-occurs with G and H, the shown order must be
  // alphabetical by DISPLAYED label (F + G + H), not by raw key (which would give G + H + F).
  check('explainer maps X->F and sorts by displayed label (F + G + H, not G + H + F)',
    dcRecoExplainText({ num: '123', groups: ['G', 'H', 'X'], combinedEdge: 0 }) === 'F + G + H เห็นตรงกัน');
  check('explainer of a plain 2-group agreement reads correctly',
    dcRecoExplainText({ num: '23', groups: ['A', 'D'], combinedEdge: 0 }) === 'A + D เห็นตรงกัน');
  check('explainer of null candidate is empty', dcRecoExplainText(null) === '');
}

// --- 7. dcRecoTopOverall — #1 เลขแนะนำ across all field types (ISSUE-12) ---
// Same ranking rule as within a field type: more agreeing groups wins, tie-break by
// combined Edge. Used by the comparison strip against the #1 Pick.
{
  const reco = {
    bottom2: [{ num: '23', groups: ['A', 'D'], combinedEdge: 18 }],
    top3: [{ num: '495', groups: ['G', 'H', 'X'], combinedEdge: 5 }],
    front3: [{ num: '471', groups: ['D', 'X'], combinedEdge: 20 }],
  };
  const top = dcRecoTopOverall(reco);
  check('3-group agreement wins across field types regardless of edge', top.num === '495' && top.field === 'top3');

  const recoTie = {
    bottom2: [{ num: '23', groups: ['A', 'D'], combinedEdge: 18 }],
    front3: [{ num: '471', groups: ['D', 'X'], combinedEdge: 20 }],
  };
  const topTie = dcRecoTopOverall(recoTie);
  check('equal group-count tie broken by combined Edge across field types', topTie.num === '471' && topTie.field === 'front3');

  check('no qualifying number anywhere -> null', dcRecoTopOverall({ bottom2: [], top3: [] }) === null);
  check('empty/missing reco object -> null, no throw', dcRecoTopOverall(undefined) === null);
  check('only the TOP candidate per field competes (rank-2 candidates never outrank a field winner)',
    dcRecoTopOverall({ bottom2: [{ num: '11', groups: ['A', 'B'], combinedEdge: 1 }, { num: '99', groups: ['A', 'B', 'C', 'D'], combinedEdge: 99 }] }).num === '11');

  // Full tie on group count AND combined Edge -> resolved by num asc (same third key as the
  // within-field comparator), not by DC_RECO_FIELDS ordering. '471' < '95' lexicographically.
  const topFullTie = dcRecoTopOverall({
    bottom2: [{ num: '95', groups: ['A', 'D'], combinedEdge: 10 }],
    front3: [{ num: '471', groups: ['D', 'X'], combinedEdge: 10 }],
  });
  check('complete tie resolved by num asc (471 beats 95 lexicographically), not field order',
    topFullTie.num === '471' && topFullTie.field === 'front3');
}

console.log(`OK: ${passed} checks passed`);
