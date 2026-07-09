// จัดชุดซื้อ (Buy Plan) — แทงรายเลข mode seam: bpBuildPlan + EV คู่ + rendering (ISSUE-17).
// Run with: node scripts/test_buyplan_build.js
//
// Loads the REAL app.js (trailing boot calls stripped) alongside formula-engine.js into a
// vm sandbox — same harness as test_experimental_badge_propagation.js — so we exercise the
// actual pure seam, not a re-implementation. Covers:
//   1. Allocation: stakes sum exactly to budget; 6-digit rows excluded in แทงรายเลข mode.
//   2. Tier split follows the risk preset (เซฟ 80/20, กลาง 50/50, ใจถึง 20/80), 2-digit vs 3-digit.
//   3. Proportional-to-(boosted)-score ordering within a tier.
//   4. เลขแนะนำ ×1.5 boost changes allocation vs the same fixture without it.
//   5. Constraints: sub-minimum dropped + redistributed, rounding unit respected, tier cap,
//      remainder to rank 1, tiny budget still valid, budget below min → empty-but-valid plan.
//   6. เลขแนะนำ-empty fixture still yields a full plan from Picks alone.
//   7. EV คู่: theoretical headline negative and = −5%/baht at default payouts for both tiers;
//      adjusted EV with a large positive Edge trips the noise warning; zero-Edge stays negative.
//   8. Rendering: plan table shows numbers/stakes and the ทดลอง trust badge (display-only,
//      ADR-0003); EV card shows the honest per-100฿ loss headline and the noise warning.
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
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl,
    addEventListener: () => {},
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(new Error('no network in test sandbox')),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);

const { bpBuildPlan, bpComputeEv, bpPlanTableHtml, bpEvCardHtml } = sandbox;
['bpBuildPlan', 'bpComputeEv', 'bpPlanTableHtml', 'bpEvCardHtml'].forEach(name => {
  if (typeof sandbox[name] !== 'function') throw new Error(`FAIL: ${name} not loaded from app.js`);
});

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}
const CFG = { pay2: 95, pay3: 950, minStake: 20, roundUnit: 10, tierCap: 10 };
const sum = rows => rows.reduce((a, r) => a + r.stake, 0);
const tier = (plan, t) => plan.rows.filter(r => r.tier === t);

// ── fixtures ──────────────────────────────────────────────────────────────────
const scoreRows = [
  { num: '15', type: '2 หลัก', score: 100, topEdge: 5, trust: null, sources: ['Predict 2 ตัวล่าง'] },
  { num: '23', type: '2 หลัก', score: 60, topEdge: 2, trust: null, sources: [] },
  { num: '47', type: '2 หลัก', score: 40, topEdge: null, trust: null, sources: [] },
  { num: '884', type: '3 หลัก', score: 90, topEdge: 3, trust: null, sources: [] },
  { num: '215', type: '3 หลัก', score: 50, topEdge: 1, trust: null, sources: [] },
  { num: '123456', type: '6 หลัก', score: 80, topEdge: 9, trust: null, sources: [] }, // ใบ mode only
];
const build = (over = {}) => bpBuildPlan({ mode: 'perNumber', budget: 1000, risk: 'mid', config: CFG, scoreRows, recoNums: [], ...over });

// ── 1. sum-to-budget + 6-digit exclusion ───────────────────────────────────────
const p = build();
check('stakes sum exactly to budget (1000)', sum(p.rows) === 1000 && p.totalStake === 1000);
check('every stake is a positive number', p.rows.every(r => r.stake > 0));
check('6-digit numbers are excluded from แทงรายเลข mode', p.rows.every(r => r.num.length !== 6));
check('rows are tagged with a 2d/3d tier', p.rows.every(r => r.tier === '2d' || r.tier === '3d'));
check('2-digit rows carry field=bottom2, 3-digit carry field=back3',
  tier(p, '2d').every(r => r.field === 'bottom2') && tier(p, '3d').every(r => r.field === 'back3'));

// ── 2. tier split follows the risk preset ───────────────────────────────────────
const pSafe = build({ risk: 'safe' });
const pMid = build({ risk: 'mid' });
const pBold = build({ risk: 'bold' });
check('เซฟ splits 80/20 (2-digit money = 800, 3-digit = 200)', sum(tier(pSafe, '2d')) === 800 && sum(tier(pSafe, '3d')) === 200);
check('กลาง splits 50/50', sum(tier(pMid, '2d')) === 500 && sum(tier(pMid, '3d')) === 500);
check('ใจถึง splits 20/80', sum(tier(pBold, '2d')) === 200 && sum(tier(pBold, '3d')) === 800);
check('risk never changes which numbers appear — same num set across presets',
  new Set(pSafe.rows.map(r => r.num + r.tier)).size === new Set(pBold.rows.map(r => r.num + r.tier)).size);

// ── 3. proportional-to-score ordering within a tier ─────────────────────────────
const t2 = tier(pMid, '2d');
check('within 2-digit tier stakes are non-increasing by (boosted) score (15 ≥ 23 ≥ 47)',
  t2[0].num === '15' && t2[0].stake >= t2[1].stake && (t2.length < 3 || t2[1].stake >= t2[2].stake));
check('higher score gets a strictly higher stake somewhere (not equal-weight)', t2[0].stake > t2[t2.length - 1].stake);

// ── 4. เลขแนะนำ ×1.5 boost changes allocation ───────────────────────────────────
const noBoost = build({ budget: 1000, risk: 'safe' });
const boosted = build({ budget: 1000, risk: 'safe', recoNums: ['23'] });
const stake23 = pl => tier(pl, '2d').find(r => r.num === '23').stake;
check('boosting เลขแนะนำ "23" raises its stake vs the same fixture without the boost', stake23(boosted) > stake23(noBoost));
check('the boosted row is flagged boosted=true', tier(boosted, '2d').find(r => r.num === '23').boosted === true);
check('an un-boosted row stays boosted=false', tier(noBoost, '2d').find(r => r.num === '23').boosted === false);

// ── 5. constraints ──────────────────────────────────────────────────────────────
// small tier budget forces sub-minimum drops + redistribution
const small = build({ budget: 100, risk: 'mid' }); // b2=50, b3=50
check('sub-minimum numbers dropped so survivors clear the 20฿ min', small.rows.every(r => r.stake >= CFG.minStake));
check('non-rank-1 stakes respect the 10฿ rounding unit', small.rows.slice(1).every(r => r.stake % CFG.roundUnit === 0));
check('constrained plan still sums exactly to budget', sum(small.rows) === 100);

// tier cap: 12 equal-score candidates, big budget → at most 10 per tier
const many2 = Array.from({ length: 12 }, (_, i) => ({ num: String(20 + i), type: '2 หลัก', score: 50, topEdge: 0, trust: null, sources: [] }));
const capped = bpBuildPlan({ mode: 'perNumber', budget: 2000, risk: 'safe', config: CFG, scoreRows: many2, recoNums: [] });
check('at most 10 numbers per tier (cap enforced)', tier(capped, '2d').length === 10);
check('capped plan still sums to budget', sum(capped.rows) === 2000);

// remainder goes to rank 1 (top-scored number absorbs the leftover baht)
check('rank-1 number carries a stake ≥ every other in its tier (remainder lands on rank 1)',
  tier(capped, '2d')[0].stake >= Math.max(...tier(capped, '2d').map(r => r.stake)));

// tiny budget still valid
const tiny = build({ budget: 40, risk: 'mid' });
check('tiny 40฿ budget still yields a valid plan summing to 40', tiny.rows.length >= 1 && sum(tiny.rows) === 40);

// budget below the minimum stake → empty but valid (no throw, sums to 0)
const broke = build({ budget: 10, risk: 'mid' });
check('budget below min stake → empty plan, totalStake 0, no throw', Array.isArray(broke.rows) && broke.rows.length === 0 && broke.totalStake === 0);

// ── 6. เลขแนะนำ-empty fixture still produces a full plan ─────────────────────────
check('เลขแนะนำ empty → plan still allocates the full budget from Picks alone', sum(build({ recoNums: [] }).rows) === 1000);

// ── 7. EV คู่ ────────────────────────────────────────────────────────────────────
const ev = p.ev;
check('theoretical EV headline is negative', ev.theoretical.perBaht < 0);
check('at default ×95/×950 both tiers cost exactly −5%/baht → −5% overall', Math.abs(ev.theoretical.perBaht - (-0.05)) < 1e-9);
check('theoretical per-100฿ loss ≈ 5฿', Math.abs(ev.theoretical.per100 - (-5)) < 1e-9);
check('a bold (mostly 3-digit) plan is ALSO −5%/baht — risk changes variance not cost',
  Math.abs(pBold.ev.theoretical.perBaht - (-0.05)) < 1e-9);
// zero-Edge fixture: adjusted EV equals theoretical, no warning
const zeroEdge = scoreRows.map(r => ({ ...r, topEdge: null }));
const pZero = bpBuildPlan({ mode: 'perNumber', budget: 1000, risk: 'mid', config: CFG, scoreRows: zeroEdge, recoNums: [] });
check('zero-Edge → adjusted EV stays negative and no warning', pZero.ev.adjusted.perBaht < 0 && pZero.ev.warning === false);
// large positive Edge → adjusted EV positive → noise warning fires
const bigEdge = scoreRows.map(r => ({ ...r, topEdge: 20 }));
const pBig = bpBuildPlan({ mode: 'perNumber', budget: 1000, risk: 'mid', config: CFG, scoreRows: bigEdge, recoNums: [] });
check('large positive Edge → adjusted EV goes positive', pBig.ev.adjusted.perBaht > 0 && pBig.ev.adjusted.positive === true);
check('positive adjusted EV trips the noise warning flag', pBig.ev.warning === true);
// bpComputeEv is callable directly on a row set (the seam ADR-0004 names)
const evDirect = bpComputeEv([{ len: 2, stake: 100, topEdge: 0 }], CFG);
check('bpComputeEv direct: single 2-digit row at default payout = −5%/baht', Math.abs(evDirect.theoretical.perBaht - (-0.05)) < 1e-9);

// ── 8. rendering ────────────────────────────────────────────────────────────────
const expRows = [
  { num: '41', type: '2 หลัก', score: 100, topEdge: 3, trust: 'ทดลอง', sources: ['J1 เจ้าสัว'] },
  { num: '62', type: '2 หลัก', score: 80, topEdge: 2, trust: null, sources: ['D1'] },
];
const pExp = bpBuildPlan({ mode: 'perNumber', budget: 500, risk: 'safe', config: CFG, scoreRows: expRows, recoNums: [] });
const tableExp = bpPlanTableHtml(pExp);
check('plan table renders each number', tableExp.includes('41') && tableExp.includes('62'));
check('plan table shows a stake with the ฿ unit', /\d+\s*฿/.test(tableExp) || tableExp.includes('฿'));
check('a ทดลอง-supported row renders the trust badge in the plan table (ADR-0003)', tableExp.includes('trust-badge'));
const tableNoExp = bpPlanTableHtml(bpBuildPlan({ mode: 'perNumber', budget: 500, risk: 'safe', config: CFG, scoreRows: [expRows[1]], recoNums: [] }));
check('a plan with no ทดลอง rows renders no trust badge', !tableNoExp.includes('trust-badge'));

const cardTheory = bpEvCardHtml(pZero);
check('EV card shows the honest per-100฿ loss headline', cardTheory.includes('ต่อ 100฿') && cardTheory.includes('เสีย'));
check('EV card (zero-Edge) does NOT show the noise warning', !cardTheory.includes('ไม่ใช่กำไรจริง'));
const cardWarn = bpEvCardHtml(pBig);
check('EV card shows the noise warning when adjusted EV is positive', cardWarn.includes('ไม่ใช่กำไรจริง'));

// ── 9. explainability data (PRD-buy-plan-explainability) ─────────────────────────
const { bpGroupsForSources, bpStrengthWord } = sandbox;
['bpGroupsForSources', 'bpStrengthWord'].forEach(n => {
  if (typeof sandbox[n] !== 'function') throw new Error('FAIL: ' + n + ' not loaded from app.js');
});
const richRows = [
  { num: '45', type: '2 หลัก', score: 82, topEdge: 2.1, trust: null,
    sources: ['C1 พิชิตโชค', 'G แม่นขั้นเทพ', 'I1 จักรพรรดิ', 'Predict 2 ตัวล่าง'],
    reasons: ['สูตร C ให้เลขนี้', 'สูตร G สนับสนุน (backtest edge +2.1%)'], warnings: [], formulaCount: 3, predictCount: 1 },
  { num: '12', type: '2 หลัก', score: 40, topEdge: 0.4, trust: null,
    sources: ['C1 พิชิตโชค'], reasons: ['สูตร C สนับสนุน'], warnings: ['ไม่มีแรงหนุนจาก Predict'], formulaCount: 1, predictCount: 0 },
];
const pRich = bpBuildPlan({ mode: 'perNumber', budget: 500, risk: 'safe', config: CFG, scoreRows: richRows, recoNums: ['45'] });
const r45 = pRich.rows.find(r => r.num === '45');
const t2rich = pRich.rows.filter(r => r.tier === '2d');
check('row carries reasons array through from the score row', Array.isArray(r45.reasons) && r45.reasons.length === 2);
check('row carries sources array through', Array.isArray(r45.sources) && r45.sources.includes('G แม่นขั้นเทพ'));
check('row carries warnings array through', Array.isArray(pRich.rows.find(r => r.num === '12').warnings));
check('row carries a money-trace reason object', r45.reason && typeof r45.reason.share === 'number' && typeof r45.reason.tierTotal === 'number');
check('rank-1 row of a tier is flagged gotRemainder when a remainder exists', t2rich[0].reason.gotRemainder === true);
check('non-rank-1 rows are not flagged gotRemainder', t2rich.slice(1).every(r => r.reason.gotRemainder === false));
check('boosted (เลขแนะนำ) row records boostApplied=true', r45.reason.boostApplied === true);
check('reason.finalStake equals the row stake', t2rich.every(r => r.reason.finalStake === r.stake));
// group dots
const g45 = bpGroupsForSources(r45.sources);
check('bpGroupsForSources returns distinct formula groups only (C,G,I — Predict excluded)',
  g45.length === 3 && g45.map(x => x.letter).sort().join('') === 'CGI');
check('bpGroupsForSources de-dupes repeated group letters', bpGroupsForSources(['C1', 'C2 พิชิตโชค', 'C3']).length === 1);
check('Codex X* source maps to the F group', bpGroupsForSources(['X5 Pattern Link'])[0].label.startsWith('F'));
check('non-formula sources yield no group dots', bpGroupsForSources(['Predict หน้า 3', 'รางวัลรอง 10 งวด', 'พิมพ์เอง']).length === 0);
// strength words
check('strong edge (≥1.0) → หนุนแรง', bpStrengthWord(2.1).word === 'หนุนแรง');
check('mid edge (0<e<1) → หนุนกลาง', bpStrengthWord(0.4).word === 'หนุนกลาง');
check('zero/negative/null edge → หนุนเบา',
  bpStrengthWord(0).word === 'หนุนเบา' && bpStrengthWord(-1).word === 'หนุนเบา' && bpStrengthWord(null).word === 'หนุนเบา');

console.log(`OK: ${passed} checks passed`);
