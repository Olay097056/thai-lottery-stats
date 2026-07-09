// จัดชุดซื้อ (Buy Plan) — resolution + ledger seams: bpResolvePlan + bpLedger (ISSUE-18).
// Run with: node scripts/test_buyplan_resolve.js
//
// Same vm harness as test_buyplan_build.js — exercises the real pure seams from app.js. Covers:
//   1. bpResolvePlan hit definitions per bet type: bottom2 vs 2 ตัวล่าง, prize1_last2 vs last-2 of
//      รางวัลที่ 1, back3 vs last-3 of รางวัลที่ 1; a winning row pays stake × the FROZEN payout.
//   2. Per-plan net = returned − spent (spent = the money actually staked across the rows).
//   3. Unpublished draw (no history row) → status Pending, nothing returned.
//   4. แก้เอง (hand) flag survives resolution.
//   5. Config immutability: a plan carries its payout config by value, so a plan frozen at ×80
//      resolves at ×80 regardless of the current default/global config.
//   6. bpLedger over a mix of pending/won/lost plans: totals sum over RESOLVED plans only, and the
//      random-play expectation is the theoretical EV of the amounts ACTUALLY wagered.
//   7. Pending → resolved is driven purely by whether dcActualForDate finds the draw row.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrcRaw = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
const appSrc = appSrcRaw.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');

const stubEl = new Proxy({}, { get: () => () => stubEl, set: () => true });
const sandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => stubEl, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(new Error('no network in test sandbox')),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);

const { bpResolvePlan, bpLedger, bpComputeEv, dcActualForDate } = sandbox;
['bpResolvePlan', 'bpLedger', 'bpComputeEv', 'dcActualForDate'].forEach(name => {
  if (typeof sandbox[name] !== 'function') throw new Error(`FAIL: ${name} not loaded from app.js`);
});

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

// ── fixtures ────────────────────────────────────────────────────────────────────
// Two published draws (Thai DD/MM/YYYY, the dcActualForDate convention).
const histRows = [
  { date: '16/07/2026', prize1: '884215', top3: '215', front3_1: '884', front3_2: '123', back3_1: '215', back3_2: '999', bottom2: '15' },
  { date: '01/07/2026', prize1: '111111', top3: '111', front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444', bottom2: '11' },
];
const CFG = { pay2: 95, pay3: 950, minStake: 20, roundUnit: 10, tierCap: 10 };
// A plan on the 16/07 draw (prize1 884215 → last2 '15', last3 '215', bottom2 '15').
const wonPlan = {
  mode: 'perNumber', date: '2026-07-16', budget: 220, risk: 'mid', config: { ...CFG },
  rows: [
    { num: '15', field: 'bottom2', len: 2, tier: '2d', stake: 100, hand: false, trust: null, topEdge: 0 },      // HIT → 100×95
    { num: '99', field: 'bottom2', len: 2, tier: '2d', stake: 20, hand: false, trust: null, topEdge: 0 },       // miss
    { num: '15', field: 'prize1_last2', len: 2, tier: '2d', stake: 20, hand: false, trust: null, topEdge: 0 },  // HIT → 20×95
    { num: '215', field: 'back3', len: 3, tier: '3d', stake: 60, hand: true, trust: null, topEdge: 0 },         // HIT → 60×950, แก้เอง
    { num: '000', field: 'back3', len: 3, tier: '3d', stake: 20, hand: false, trust: null, topEdge: 0 },        // miss
  ],
};

// ── 1 & 2. hit definitions + net ─────────────────────────────────────────────────
const rWon = bpResolvePlan(wonPlan, dcActualForDate(histRows, '2026-07-16'));
check('status is resolved when the draw exists', rWon.status === 'resolved');
const byIdx = rWon.rows;
check('bottom2 "15" hits vs 2 ตัวล่าง and pays stake×95', byIdx[0].hit === true && byIdx[0].returned === 100 * 95);
check('bottom2 "99" misses', byIdx[1].hit === false && byIdx[1].returned === 0);
check('prize1_last2 "15" hits vs last-2 of รางวัลที่ 1 and pays stake×95', byIdx[2].hit === true && byIdx[2].returned === 20 * 95);
check('back3 "215" hits vs last-3 of รางวัลที่ 1 and pays stake×950', byIdx[3].hit === true && byIdx[3].returned === 60 * 950);
check('back3 "000" misses', byIdx[4].hit === false && byIdx[4].returned === 0);
check('plan returned = sum of winning rows', rWon.returned === 100 * 95 + 20 * 95 + 60 * 950);
check('plan spent = sum of every row stake (money that left the pocket)', rWon.spent === 220);
check('plan net = returned − spent', rWon.net === rWon.returned - 220);

// ── 3. unpublished draw → Pending ────────────────────────────────────────────────
const rPend = bpResolvePlan({ ...wonPlan, date: '2026-09-01' }, dcActualForDate(histRows, '2026-09-01'));
check('unpublished draw → status Pending', rPend.status === 'pending');
check('pending plan returns nothing and net 0', rPend.returned === 0 && rPend.net === 0);

// ── 4. แก้เอง survives resolution ─────────────────────────────────────────────────
check('the hand-edited (แก้เอง) row keeps hand=true after resolution', rWon.rows[3].hand === true);

// ── 5. config immutability — frozen payout wins over any global/default config ─────
const cheapPlan = {
  mode: 'perNumber', date: '2026-07-16', budget: 100, risk: 'mid', config: { ...CFG, pay2: 80 },
  rows: [{ num: '15', field: 'bottom2', len: 2, tier: '2d', stake: 100, hand: false, trust: null, topEdge: 0 }],
};
const rCheap = bpResolvePlan(cheapPlan, dcActualForDate(histRows, '2026-07-16'));
check('a plan frozen at ×80 pays 100×80 even though the default is ×95', rCheap.rows[0].returned === 100 * 80);
check('the frozen config object is left untouched by resolution', cheapPlan.config.pay2 === 80);

// ── 6 & 7. ledger over pending/won/lost ───────────────────────────────────────────
const lostPlan = {
  mode: 'perNumber', date: '2026-07-01', budget: 100, risk: 'mid', config: { ...CFG },
  rows: [{ num: '22', field: 'bottom2', len: 2, tier: '2d', stake: 100, hand: false, trust: null, topEdge: 0 }], // vs bottom2 '11' → miss
};
const pendingPlan = {
  mode: 'perNumber', date: '2026-12-16', budget: 100, risk: 'mid', config: { ...CFG },
  rows: [{ num: '15', field: 'bottom2', len: 2, tier: '2d', stake: 100, hand: false, trust: null, topEdge: 0 }],
};
const led = bpLedger([wonPlan, lostPlan, pendingPlan], histRows);
check('ledger counts all saved plans', led.totalPlans === 3);
check('ledger separates resolved (2) from pending (1)', led.resolved === 2 && led.pending === 1);
check('ledger spent = wagered over RESOLVED plans only (220 + 100)', led.spent === 320);
check('ledger returned = sum of resolved returns', led.returned === rWon.returned + 0);
check('ledger net = returned − spent', led.net === led.returned - 320);
// random-play expectation = theoretical EV (baht) of the amounts actually wagered on resolved plans.
const expTheo = bpComputeEv(wonPlan.rows, wonPlan.config).theoretical.perBaht * 220
              + bpComputeEv(lostPlan.rows, lostPlan.config).theoretical.perBaht * 100;
check('ledger random-play expectation uses actually-wagered amounts (≈ −5% × 320 = −16)',
  Math.abs(led.randomExpectedNet - expTheo) < 1e-9 && Math.abs(led.randomExpectedNet - (-16)) < 1e-9);
check('a fully-empty ledger does not throw', bpLedger([], histRows).totalPlans === 0 && bpLedger(null, histRows).resolved === 0);

console.log(`OK: ${passed} checks passed`);
