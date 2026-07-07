// Regression check for Decision Center track record / hit-rate trend (สรุปงวดนี้ page
// improvement). Run with: node scripts/test_decision_track_record.js
// Verifies:
// 1. dcActualForDate finds the history row matching an ISO target date (rows store
//    Thai-formatted DD/MM/YYYY dates in Gregorian year, matching dcIsoFromThaiDate
//    convention already used elsewhere in app.js) and returns null when unresolved.
// 2. dcCheckHit applies the digit-length-dependent hit definition agreed with the
//    user: 6-digit exact รางวัลที่ 1, 3-digit against any of the five 3-digit slots
//    (top3/front3_1/front3_2/back3_1/back3_2), 2-digit exact 2 ตัวล่าง, and 'pending'
//    when no actual result exists yet.
// 3. dcSnapshotResult rolls a snapshot's picks up into pending/hit/miss (hit = at
//    least one pick hit).
// 4. dcHitRateTrend computes a rolling-window % hit-rate series over only resolved
//    (non-pending) snapshots, respecting the `take` (recency) and `window` (rolling
//    size) parameters.
// 5. dcBuildScoreRows tracks r.topEdge per pick — the highest backtest edge among the
//    formulas that support it — without disturbing the existing score computation.
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

function extractConst(name) {
  const re = new RegExp('const ' + name + '=[^;]*;', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found const: ' + name);
  return m[0];
}

const code = [
  extract('dcActualForDate'),
  extract('dcBtActual3'),
  extract('dcCheckHit'),
  extract('dcSnapshotResult'),
  extract('dcHitRateTrend'),
  extract('dcBuildScoreRows'),
  // ISSUE-10: เลขแนะนำ Track Record + Edge
  extractConst('DC_RECO_FIELDS'),
  extractConst('DC_RECO_PRODUCER_GROUPS'),
  extract('dcRecoBaseline'),
  extract('dcRecoEdgeRows'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { dcActualForDate, dcCheckHit, dcSnapshotResult, dcHitRateTrend, dcBuildScoreRows, dcRecoBaseline, dcRecoEdgeRows } = sandbox;

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// --- fixtures ---
const rows = [
  { date: '16/07/2026', prize1: '884215', top3: '215', front3_1: '884', front3_2: '123', back3_1: '215', back3_2: '999', bottom2: '15' },
  { date: '01/07/2026', prize1: '111111', top3: '111', front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444', bottom2: '11' },
];

// --- 1. dcActualForDate ---
check('finds matching row by ISO date', dcActualForDate(rows, '2026-07-16')?.prize1 === '884215');
check('finds the other row too', dcActualForDate(rows, '2026-07-01')?.prize1 === '111111');
check('returns null for unresolved date', dcActualForDate(rows, '2026-08-01') === null);
check('returns null for empty rows', dcActualForDate([], '2026-07-16') === null);

// --- 2. dcCheckHit ---
const actual = rows[0];
check('6-digit exact hit', dcCheckHit('884215', actual) === 'hit');
check('6-digit miss', dcCheckHit('999999', actual) === 'miss');
check('3-digit hits via front3_1', dcCheckHit('884', actual) === 'hit');
check('3-digit hits via top3/back3_1 (shared value)', dcCheckHit('215', actual) === 'hit');
check('3-digit miss', dcCheckHit('777', actual) === 'miss');
check('2-digit exact hit', dcCheckHit('15', actual) === 'hit');
check('2-digit miss', dcCheckHit('99', actual) === 'miss');
check('pending when actual result unknown', dcCheckHit('15', null) === 'pending');

// --- 3. dcSnapshotResult ---
const snapHit = { date: '2026-07-16', picks: [{ num: '777' }, { num: '15' }] };
const rHit = dcSnapshotResult(snapHit, rows);
check('snapshot status=hit when >=1 pick hits', rHit.status === 'hit' && rHit.hits === 1 && rHit.total === 2);

const snapMiss = { date: '2026-07-16', picks: [{ num: '777' }, { num: '99' }] };
const rMiss = dcSnapshotResult(snapMiss, rows);
check('snapshot status=miss when 0 picks hit', rMiss.status === 'miss' && rMiss.hits === 0);

const snapPending = { date: '2026-09-01', picks: [{ num: '15' }] };
const rPending = dcSnapshotResult(snapPending, rows);
check('snapshot status=pending when draw not yet resolved', rPending.status === 'pending');

// --- 4. dcHitRateTrend ---
// 5 resolved draws with a known hit/miss pattern: hit, miss, hit, hit, miss
const trendRows = [
  { date: '01/01/2026', prize1: '000001', top3: '001', front3_1: '000', front3_2: '000', back3_1: '000', back3_2: '000', bottom2: '01' },
  { date: '02/01/2026', prize1: '000002', top3: '002', front3_1: '000', front3_2: '000', back3_1: '000', back3_2: '000', bottom2: '02' },
  { date: '03/01/2026', prize1: '000003', top3: '003', front3_1: '000', front3_2: '000', back3_1: '000', back3_2: '000', bottom2: '03' },
  { date: '04/01/2026', prize1: '000004', top3: '004', front3_1: '000', front3_2: '000', back3_1: '000', back3_2: '000', bottom2: '04' },
  { date: '05/01/2026', prize1: '000005', top3: '005', front3_1: '000', front3_2: '000', back3_1: '000', back3_2: '000', bottom2: '05' },
];
const trendSnaps = [
  { date: '2026-01-01', picks: [{ num: '01' }] }, // hit
  { date: '2026-01-02', picks: [{ num: '99' }] }, // miss
  { date: '2026-01-03', picks: [{ num: '03' }] }, // hit
  { date: '2026-01-04', picks: [{ num: '04' }] }, // hit
  { date: '2026-01-05', picks: [{ num: '99' }] }, // miss
  { date: '2026-06-01', picks: [{ num: '01' }] }, // pending — no matching row, must be excluded
];
const trend = dcHitRateTrend(trendSnaps, trendRows, 5, 20);
check('trend excludes pending snapshots', trend.length === 5);
check('trend point 1 = 100 (hit)', trend[0].value === 100);
check('trend point 2 = 50 (hit,miss)', trend[1].value === 50);
check('trend point 3 = 66.7 (hit,miss,hit)', Math.abs(trend[2].value - 66.7) < 0.1);
check('trend point 4 = 75 (hit,miss,hit,hit)', trend[3].value === 75);
check('trend point 5 = 60 (rolling window of last 5)', trend[4].value === 60);

// `take` truncates to most recent N resolved snapshots before windowing
const manySnaps = [];
const manyRows = [];
for (let i = 1; i <= 22; i++) {
  const dd = String(i).padStart(2, '0');
  manyRows.push({ date: `${dd}/02/2026`, prize1: `00000${dd}`.slice(-6), top3: dd + '0', front3_1: '999', front3_2: '999', back3_1: '999', back3_2: '999', bottom2: dd });
  // first 2 are misses, rest are hits — if `take` didn't truncate, average would be pulled down
  manySnaps.push({ date: `2026-02-${dd}`, picks: [{ num: i <= 2 ? '00' : dd }] });
}
const trend20 = dcHitRateTrend(manySnaps, manyRows, 5, 20);
check('take=20 truncates to 20 points', trend20.length === 20);
check('take truncation drops the oldest misses out of the window', trend20[0].value === 100);

// --- 5. dcBuildScoreRows edge tracking ---
const scored = dcBuildScoreRows({
  cats: {},
  formulaResults: [{ name: 'TestFormula', preds: ['482', '12'], field: 'front3' }],
  formulaMatches: [{ num: '482', formula: [{ label: 'TestFormula2' }], predict: [] }],
  btRows: [
    { name: 'TestFormula', edge: 15.5, weight: 1.2 },
    { name: 'TestFormula2', edge: 22, weight: 1 },
  ],
  mode: 'balanced',
  secondarySignals: {},
});
const row482 = scored.all.find(r => r.num === '482');
const row12 = scored.all.find(r => r.num === '12');
check('topEdge picks the max edge among supporting formulas', row482?.topEdge === 22);
check('topEdge is set for a single-formula pick too', row12?.topEdge === 15.5);

// --- 6. เลขแนะนำ Track Record + Edge (ISSUE-10) ---
// Baseline model: C(G,2) * pRandom^2, where pRandom is the random single-guess hit prob
// under dcCheckHit (2-digit fields = 1/100, 3-digit fields = 5/1000 ≈ 1/200). Group count
// G raises the baseline (coincidental convergence is cheaper with more producing groups).
check('baseline rises with producing-group count (bottom2 G=6 > prize1_last2 G=2, same pRandom)',
  dcRecoBaseline('bottom2', 6) > dcRecoBaseline('prize1_last2', 2));
check('baseline for a single-pair field (G=2) uses C(2,2)=1',
  Math.abs(dcRecoBaseline('front3', 2) - (1 * 0.005 * 0.005 * 100)) < 1e-9);
check('baseline for bottom2 (G=6, C(6,2)=15, pRandom=0.01) = 15*0.0001*100 = 0.15%',
  Math.abs(dcRecoBaseline('bottom2', 6) - 0.15) < 1e-9);
check('2-digit field has higher pRandom than 3-digit at equal group count',
  dcRecoBaseline('prize1_last2', 2) > dcRecoBaseline('front3', 2));

// dcRecoEdgeRows: unconditional per-field hit rate over RESOLVED snapshots, reusing dcCheckHit.
const recoRows = [
  { date: '16/07/2026', prize1: '884215', top3: '215', front3_1: '884', front3_2: '123', back3_1: '215', back3_2: '999', bottom2: '15' },
  { date: '01/07/2026', prize1: '111111', top3: '111', front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444', bottom2: '11' },
];
const recoSnaps = [
  // resolved (16/07): bottom2 reco "15" -> HIT (bottom2=15); front3 reco "884" -> HIT (front3_1)
  { date: '2026-07-16', reco: [{ field: 'bottom2', num: '15' }, { field: 'front3', num: '884' }] },
  // resolved (01/07): bottom2 reco "99" -> MISS (bottom2=11); no front3 reco this round (not shown)
  { date: '2026-07-01', reco: [{ field: 'bottom2', num: '99' }] },
  // pending (no matching row) -> excluded from totals entirely
  { date: '2026-09-01', reco: [{ field: 'bottom2', num: '15' }] },
];
const edgeRows = dcRecoEdgeRows(recoSnaps, recoRows);
const byField = Object.fromEntries(edgeRows.map(r => [r.field, r]));
check('edge rows cover exactly the 5 structurally-eligible fields', edgeRows.length === 5);
check('totalResolved excludes pending snapshots (2 resolved of 3)', byField.bottom2.totalResolved === 2);
check('bottom2: shown twice, 1 hit -> hitRate 50% over 2 resolved', byField.bottom2.shown === 2 && byField.bottom2.hits === 1 && Math.abs(byField.bottom2.hitRate - 50) < 1e-9);
check('front3: shown once (other round had no front3 reco), 1 hit -> hitRate 50% unconditional', byField.front3.shown === 1 && byField.front3.hits === 1 && Math.abs(byField.front3.hitRate - 50) < 1e-9);
check('top3: never shown -> hitRate 0, shown 0', byField.top3.shown === 0 && byField.top3.hits === 0 && byField.top3.hitRate === 0);
check('edge = hitRate - baseline for a shown field', Math.abs(byField.bottom2.edge - (byField.bottom2.hitRate - byField.bottom2.baseline)) < 1e-9);
check('each edge row carries its producing-group count', byField.bottom2.groupCount === 6 && byField.front3.groupCount === 2);
check('empty snapshots -> all fields 0 resolved, no throw', dcRecoEdgeRows([], recoRows).every(r => r.totalResolved === 0 && r.hitRate === 0));

console.log(`OK: ${passed} checks passed`);
