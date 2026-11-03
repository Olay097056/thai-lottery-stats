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
//      candidate-set Edge does not become a per-number probability or monetary EV adjustment.
//   8. Rendering: plan table shows numbers/stakes and the ทดลอง trust badge (display-only,
//      ADR-0003); EV card shows the honest per-100฿ loss headline and the noise warning.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');
const appSrcRaw = require('./frontend_source').readFrontend('app.js');
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
sandbox.addEventListener = () => {};
require('./frontend_source').prepareContext(sandbox);
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
// Edge is historical evidence about a candidate set, so it must not alter per-number theoretical EV.
const zeroEdge = scoreRows.map(r => ({ ...r, topEdge: null }));
const pZero = bpBuildPlan({ mode: 'perNumber', budget: 1000, risk: 'mid', config: CFG, scoreRows: zeroEdge, recoNums: [] });
check('missing Edge leaves theoretical EV negative and warning off', pZero.ev.theoretical.perBaht < 0 && pZero.ev.warning === false);
check('legacy adjusted EV field mirrors theory for saved-record compatibility', pZero.ev.adjusted.perBaht === pZero.ev.theoretical.perBaht);
// Large positive candidate-set Edge must not shift any per-number monetary estimate.
const bigEdge = scoreRows.map(r => ({ ...r, topEdge: 20 }));
const pBig = bpBuildPlan({ mode: 'perNumber', budget: 1000, risk: 'mid', config: CFG, scoreRows: bigEdge, recoNums: [] });
check('large positive candidate-set Edge does not change theoretical EV', pBig.ev.theoretical.perBaht === pZero.ev.theoretical.perBaht);
check('large positive candidate-set Edge never creates an adjusted-profit warning', pBig.ev.adjusted.perBaht === pBig.ev.theoretical.perBaht && pBig.ev.warning === false);
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
check('EV card shows configured theoretical return per 100฿', cardTheory.includes('ต่อเงินเดิมพัน 100฿') && cardTheory.includes('คาดเสีย'));
check('EV card explains Edge is not converted into monetary EV', cardTheory.includes('ไม่ใช้ Edge ย้อนหลัง'));
const cardWarn = bpEvCardHtml(pBig);
check('EV card is unchanged by a large candidate-set Edge', cardWarn === cardTheory && !cardWarn.includes('ปรับตาม backtest'));
const emptyEvCard = bpEvCardHtml(bpBuildPlan({ mode: 'perNumber', budget: 0, risk: 'mid', config: CFG, scoreRows: [], recoNums: [] }));
check('empty plan does not display a zero as a meaningful EV', emptyEvCard.includes('ยังไม่มีเงินเดิมพัน') && !emptyEvCard.includes('คาดคุ้มทุน'));
const customPayoutCard = bpEvCardHtml(bpBuildPlan({ mode: 'perNumber', budget: 500, risk: 'mid', config: { ...CFG, pay2: 120, pay3: 1200 }, scoreRows, recoNums: [] }));
check('theoretical return copy follows configured payouts instead of hard-coded loss claims', customPayoutCard.includes('×120 (2 ตัว) / ×1200 (3 ตัว)') && customPayoutCard.includes('คาดสุทธิ +20.0฿'));
const customTicketCard = bpEvCardHtml(bpBuildPlan({ mode: 'ticket', budget: 120, risk: 'safe', config: { ...CFG, ticketPrice: 60 }, ticketSources: [{ num: '123456', label: 'Predict', kind: 'predict' }] }));
check('ticket EV copy follows configured ticket price and expected net', customTicketCard.includes('ราคาที่ตั้งไว้ 60฿') && customTicketCard.includes('คาดเสีย 12.0฿ ต่อใบ'));

// ── 9. explainability data (PRD-buy-plan-explainability) ─────────────────────────
const { bpGroupsForSources, bpStrengthWord, bpAttachEdgeSampleCounts } = sandbox;
['bpGroupsForSources', 'bpStrengthWord', 'bpAttachEdgeSampleCounts'].forEach(n => {
  if (typeof sandbox[n] !== 'function') throw new Error('FAIL: ' + n + ' not loaded from app.js');
});
const sampledRows=bpAttachEdgeSampleCounts([
  {num:'45',topEdge:5,sources:['A1','B1']},
  {num:'12',topEdge:-2,sources:['C1']},
  {num:'09',topEdge:null,sources:['Predict']},
], [
  {name:'A1',edge:5,total:35},{name:'B1',edge:5,total:78},
  {name:'C1',edge:-2,total:49},{name:'Predict',edge:99,total:80},
]);
check('Edge sample count follows the strongest supporting formula',sampledRows[0].topEdgeDraws===78);
check('equal strongest Edges choose the larger valid sample',sampledRows[0].topEdgeDraws!==35);
check('negative Edge keeps the sample count that produced it',sampledRows[1].topEdgeDraws===49);
check('rows without a supporting formula Edge have no sample count',sampledRows[2].topEdgeDraws===null);
const richRows = [
  { num: '45', type: '2 หลัก', score: 82, topEdge: 2.1, topEdgeDraws: 78, trust: null,
    sources: ['C1 พิชิตโชค', 'G แม่นขั้นเทพ', 'I1 จักรพรรดิ', 'Predict 2 ตัวล่าง'],
    reasons: ['สูตร C ให้เลขนี้', 'สูตร G สนับสนุน (backtest edge +2.1%)'], warnings: [], formulaCount: 3, predictCount: 1 },
  { num: '12', type: '2 หลัก', score: 40, topEdge: 0.4, topEdgeDraws: 47, trust: null,
    sources: ['C1 พิชิตโชค'], reasons: ['สูตร C สนับสนุน'], warnings: ['ไม่มีแรงหนุนจาก Predict'], formulaCount: 1, predictCount: 0 },
];
const pRich = bpBuildPlan({ mode: 'perNumber', budget: 500, risk: 'safe', config: CFG, scoreRows: richRows, recoNums: ['45'] });
const r45 = pRich.rows.find(r => r.num === '45');
const t2rich = pRich.rows.filter(r => r.tier === '2d');
check('row carries reasons array through from the score row', Array.isArray(r45.reasons) && r45.reasons.length === 2);
check('row carries sources array through', Array.isArray(r45.sources) && r45.sources.includes('G แม่นขั้นเทพ'));
check('row carries the strongest Edge sample count into the unsaved plan',r45.topEdgeDraws===78);
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
check('positive formula-set Edge is labeled as a set-level metric', bpStrengthWord(2.1).word === 'Edge ชุดสูตร');
check('small positive formula-set Edge keeps its lower-strength color', bpStrengthWord(0.4).cls === 'bp-str-mid');
check('zero/negative Edge keeps a neutral color without implying individual odds',
  bpStrengthWord(0).word === 'Edge ชุดสูตร' && bpStrengthWord(-1).word === 'Edge ชุดสูตร' && bpStrengthWord(null).word === 'ไม่มี Edge');
check('tiny Edge rounds to the same neutral presentation shown to users', bpStrengthWord(0.04).word === 'Edge ชุดสูตร');

// ── 10. แทงรายเลข explain rendering ───────────────────────────────────────────────
const { bpRowExplainHtml, bpEditablePlanHtml, bpEditableTicketHtml, bpEdgeSignalNoteHtml, bpBudgetRemainingHtml } = sandbox;
['bpRowExplainHtml', 'bpEditablePlanHtml', 'bpEditableTicketHtml', 'bpEdgeSignalNoteHtml', 'bpBudgetRemainingHtml'].forEach(n => {
  if (typeof sandbox[n] !== 'function') throw new Error('FAIL: ' + n + ' not loaded from app.js');
});
const editableExp = bpEditablePlanHtml(pExp);
check('editable rows identify Edge as a formula-set metric in percentage points', editableExp.includes('Edge ชุดสูตร +3.0 pp') && editableExp.includes('pp = จุดเปอร์เซ็นต์'));
check('visible note explains strongest supporting set Edge, sample window, individual odds, and EV scope', editableExp.includes('ค่าสูงสุดย้อนหลังจากสูตรที่รองรับเลขนี้') && editableExp.includes('80 งวดล่าสุด') && editableExp.includes('จำนวนจริงข้างค่า') && editableExp.includes('ไม่ใช่โอกาสของเลขรายตัว') && editableExp.includes('ไม่นำไปคำนวณ EV'));
const ticketPlanForEdge={mode:'ticket',config:{ticketPrice:80},risk:'safe',ticketCount:1,totalStake:80,budget:100,rows:[{num:'123456',qty:1,stake:80,sources:['Predict'],ladder:['123456','456','56']}]};
check('ticket mode does not render a per-number formula-set Edge note', !bpEditableTicketHtml(ticketPlanForEdge).includes('bp-edge-note'));
const exHtml = bpRowExplainHtml(r45, 10);
check('explain body lists each recorded reason', exHtml.includes('สูตร C ให้เลขนี้') && exHtml.includes('สูตร G สนับสนุน'));
check('detail reasons use percentage-point units for formula Edge', exHtml.includes('backtest edge +2.1 pp') && !exHtml.includes('backtest edge +2.1%'));
check('row explanation says formula Edge belongs to the candidate set, not the number', exHtml.includes('ผลย้อนหลังของชุดผู้สมัครสูตร') && exHtml.includes('ไม่ใช่โอกาสถูกรางวัลของเลขนี้'));
check('explain body shows the money chain with คะแนน and สัดส่วน', exHtml.includes('คะแนน') && exHtml.includes('สัดส่วน'));
check('explain body shows the ×1.5 เลขแนะนำ step for a boosted row', exHtml.includes('×1.5'));
check('explain body shows a group dot for a backing group', exHtml.includes('bp-group-dot'));
const warnHtml = bpRowExplainHtml(pRich.rows.find(r => r.num === '12'), 10);
check('a row with a warning surfaces it in the explain body', warnHtml.includes('ไม่มีแรงหนุนจาก Predict'));
const handRow = { ...r45, hand: true };
check('a hand-edited row shows the แก้เอง note instead of the system money math', bpRowExplainHtml(handRow, 10).includes('แก้เอง'));
const planHtml = bpEditablePlanHtml(pRich);
check('per-number Edge row shows the actual sample as a fraction of the 80-draw window',planHtml.includes('Edge ชุดสูตร +2.1 pp · 78/80 งวด'));
check('editable plan renders a ⭐ on the เลขแนะนำ row', planHtml.includes('bp-reco-star'));
const overBudgetPlanHtml = bpEditablePlanHtml({ ...pRich, budget: pRich.totalStake - 10 });
check('per-number plan shows the exact budget overrun alongside actual spend and budget', overBudgetPlanHtml.includes('รวมที่จะซื้อจริง') && overBudgetPlanHtml.includes(`จากงบ ${pRich.totalStake - 10}฿`) && overBudgetPlanHtml.includes('เกินงบ 10฿'));
check('per-number plan omits overrun status when actual spend is within budget', !bpEditablePlanHtml({ ...pRich, budget: pRich.totalStake }).includes('bp-budget-overrun'));
const underBudgetPlanHtml = bpEditablePlanHtml({ ...pRich, budget: pRich.totalStake + 50 });
check('per-number plan states the exact unspent amount after an edit', underBudgetPlanHtml.includes(`เหลืองบ 50฿`) && underBudgetPlanHtml.includes('bp-budget-remaining'));
check('per-number plan shows neither remaining nor overrun status at exact budget', !bpEditablePlanHtml({ ...pRich, budget: pRich.totalStake }).includes('bp-budget-remaining') && !bpEditablePlanHtml({ ...pRich, budget: pRich.totalStake }).includes('bp-budget-overrun'));
check('editable plan labels historical Edge as set-level rather than number-level', /Edge ชุดสูตร/.test(planHtml) && !/Edge (เด่น|บวก|ติดลบ|ใกล้ศูนย์)/.test(planHtml));
check('editable plan renders a why-toggle and a hidden detail row', planHtml.includes('bp-why-toggle') && planHtml.includes('bp-row-detail'));
check('editable plan detail row carries the matching id', planHtml.includes('id="bp-detail-'));

console.log(`OK: ${passed} checks passed`);
