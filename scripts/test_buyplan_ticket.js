// จัดชุดซื้อ (Buy Plan) — ลอตเตอรี่ใบ (ticket) mode: candidate merge, ticket allocation, govt-table
// EV, and full-prize-table resolution (ISSUE-19). Run: node scripts/test_buyplan_ticket.js
//
// Same vm harness as the other buyplan tests. Covers:
//   1. bpMergeTicketCandidates: I/J2 pool6 + prize-1 predictions + Mix merge by 6-digit number with
//      source labels; Mix is a labeled SOURCE, never a formula group (never inflates group count);
//      a J2-sourced number carries the ทดลอง badge; ranking = source-agreement then group count.
//   2. bpBuildPlan ticket mode: budget → whole tickets at the configured price; each row carries the
//      เต็ม 6 → ท้าย 3 → ท้าย 2 ladder; plan sums to ticketCount × price.
//   3. Risk presets reshape distribution: เซฟ spreads across distinct ท้าย 2 endings, ใจถึง stacks
//      tickets on the top candidate, กลาง sits in between.
//   4. bpComputeTicketEv: theoretical ~ −40% per 80฿ ticket (expected govt payout 48฿); a large
//      supporting Edge pushes the adjusted line positive and trips the same noise warning as ISSUE-17.
//   5. bpResolvePlan ticket rows: ที่ 1 / ข้างเคียง / ที่ 2–5 / หน้า 3 / ท้าย 3 / ท้าย 2 each pay the
//      correct government amount and stack; qty multiplies; a draw missing sanook columns marks those
//      checks unverifiable (not missed); แก้เอง survives; the ledger stays mode-aware.
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

const { bpMergeTicketCandidates, bpBuildPlan, bpComputeTicketEv, bpResolvePlan, bpResolveTicket, bpLedger, dcActualForDate, bpEditableTicketHtml, bpTicketExplainHtml } = sandbox;
['bpMergeTicketCandidates', 'bpBuildPlan', 'bpComputeTicketEv', 'bpResolvePlan', 'bpResolveTicket', 'bpLedger', 'bpEditableTicketHtml', 'bpTicketExplainHtml'].forEach(name => {
  if (typeof sandbox[name] !== 'function') throw new Error(`FAIL: ${name} not loaded from app.js`);
});

let passed = 0;
function check(label, cond) { if (!cond) throw new Error('FAIL: ' + label); passed++; }
const CFG = { pay2: 95, pay3: 950, minStake: 20, roundUnit: 10, tierCap: 10, ticketPrice: 80 };

// ── 1. candidate merge ────────────────────────────────────────────────────────────
const sources = [
  { num: '123456', label: 'I จักรพรรดิ', kind: 'group', group: 'I', trust: null },
  { num: '123456', label: 'Predict ที่ 1', kind: 'predict', trust: null },
  { num: '123456', label: 'Mix', kind: 'mix', trust: null },
  { num: '999999', label: 'J2 เจ้าสัว', kind: 'group', group: 'J', trust: 'ทดลอง' },
  { num: '555544', label: 'I จักรพรรดิ', kind: 'group', group: 'I', trust: null },
  { num: '555522', label: 'Mix', kind: 'mix', trust: null },
];
const merged = bpMergeTicketCandidates(sources);
const top = merged[0];
check('most-agreed number ranks first (3 sources)', top.num === '123456' && top.sources.length === 3);
check('Mix is present as a source label on the top candidate', top.sources.includes('Mix'));
check('Mix does NOT count as a formula group (top has exactly 1 group: I)', top.groups.length === 1 && top.groups[0] === 'I');
const mixOnly = merged.find(c => c.num === '555522');
check('a Mix-only number has 0 formula groups (Mix never a group)', mixOnly.groups.length === 0 && mixOnly.sources.includes('Mix'));
const j2 = merged.find(c => c.num === '999999');
check('a J2-sourced number carries the ทดลอง badge', j2.trust === 'ทดลอง');
check('ranking: single-source group numbers order by group count then num (555544 before 999999 before 555522)',
  merged[1].num === '555544' && merged[2].num === '999999' && merged[3].num === '555522');

// ── 2. build: budget → whole tickets + ladder ──────────────────────────────────────
const tp = (over = {}) => bpBuildPlan({ mode: 'ticket', budget: 400, risk: 'safe', config: CFG, ticketSources: sources, ...over });
const pSafe = tp();
const totTickets = pl => pl.rows.reduce((a, r) => a + r.qty, 0);
const totStake = pl => pl.rows.reduce((a, r) => a + r.stake, 0);
check('budget 400 at 80฿ → 5 tickets', pSafe.ticketCount === 5 && totTickets(pSafe) === 5);
check('plan sums to ticketCount × price (5 × 80 = 400)', totStake(pSafe) === 400 && pSafe.totalStake === 400);
check('every ticket row carries a เต็ม6 → ท้าย3 → ท้าย2 ladder', pSafe.rows.every(r => Array.isArray(r.ladder) && r.ladder.length === 3 && r.ladder[0].length === 6 && r.ladder[1].length === 3 && r.ladder[2].length === 2));
check('leftover under one ticket is not spent (410฿ → still 5 tickets, 400฿)', totStake(tp({ budget: 410 })) === 400);
check('ticket rows are tagged field=ticket', pSafe.rows.every(r => r.field === 'ticket'));

// prioritizeSource (Mix-page entry) floats candidates carrying that source to the front, even past a
// number with MORE source agreement — so arriving from Mix, a Mix number is always buyable/visible.
const prioSources = [
  { num: '111111', label: 'I จักรพรรดิ', kind: 'group', group: 'I', trust: null },
  { num: '111111', label: 'J2 เจ้าสัว', kind: 'group', group: 'J', trust: 'ทดลอง' }, // 2 groups → normally rank 1
  { num: '222222', label: 'Mix', kind: 'mix', trust: null },                          // Mix-only → normally last
];
const natural = bpBuildPlan({ mode: 'ticket', budget: 400, risk: 'bold', config: CFG, ticketSources: prioSources });
check('without prioritizeSource the higher-agreement number leads', natural.rows[0].num === '111111');
const prioritized = bpBuildPlan({ mode: 'ticket', budget: 400, risk: 'bold', config: CFG, ticketSources: prioSources, prioritizeSource: 'Mix' });
check('prioritizeSource:Mix floats the Mix number to the top ticket (verifiable in labels)',
  prioritized.rows[0].num === '222222' && prioritized.rows[0].sources.includes('Mix'));

// ── 3. risk reshapes distribution ──────────────────────────────────────────────────
const distinctEndings = pl => new Set(pl.rows.flatMap(r => Array(r.qty).fill(r.num.slice(-2)))).size;
const pBold = tp({ risk: 'bold' });
const pMid = tp({ risk: 'mid' });
check('เซฟ spreads across the most distinct ท้าย 2 endings', distinctEndings(pSafe) === 4);
check('ใจถึง stacks tickets on the top candidate', pBold.rows[0].qty === pBold.ticketCount && pBold.rows[0].qty > 1);
check('ใจถึง collapses to a single ท้าย 2 ending', distinctEndings(pBold) === 1);
check('กลาง sits between เซฟ and ใจถึง', distinctEndings(pMid) < distinctEndings(pSafe) && distinctEndings(pMid) > distinctEndings(pBold));

// ── 4. ticket EV vs govt prize table ───────────────────────────────────────────────
const ev = pSafe.ev;
check('theoretical expected govt payout is 48฿/ticket', ev.theoretical.expectedReturn === 48);
check('theoretical EV ≈ −32฿/ticket at 80฿', ev.theoretical.perTicket === 48 - 80);
check('theoretical EV ≈ −40% per baht (≈ 8× แทงรายเลข\'s −5%)', Math.abs(ev.theoretical.per100 - (-40)) < 1e-9);
check('zero supporting Edge → no noise warning', bpComputeTicketEv(pSafe.rows, CFG, 0).warning === false);
const evEdge = bpComputeTicketEv(pSafe.rows, CFG, 5); // +5pp on the ท้าย2 ending
check('a large supporting Edge pushes adjusted EV positive → warning fires', evEdge.adjusted.positive === true && evEdge.warning === true);

// ── 5. resolution against the full government prize table ───────────────────────────
const drawFull = {
  date: '16/07/2026', prize1: '123456', top3: '456',
  near1_1: '123455', near1_2: '123457',
  prize2_1: '222222', prize2_2: '200002', prize2_3: '200003', prize2_4: '200004', prize2_5: '200005',
  prize3_1: '333333', prize3_2: '300002', prize3_3: '300003', prize3_4: '300004', prize3_5: '300005',
  prize3_6: '300006', prize3_7: '300007', prize3_8: '300008', prize3_9: '300009', prize3_10: '300010',
  prize4: '444444 400004 400040', prize5: '555555 500005 500050',
  front3_1: '789', front3_2: '012', back3_1: '456', back3_2: '111', bottom2: '56',
};
const amt = num => bpResolveTicket(num, drawFull).amount;
check('ที่ 1 exact match pays 6,000,000 (stacked with ท้าย3 456 + ท้าย2 56)', amt('123456') === 6000000 + 4000 + 2000);
check('ข้างเคียงที่ 1 pays 100,000', amt('123455') === 100000);
check('รางวัลที่ 2 pays 200,000', amt('222222') === 200000);
check('รางวัลที่ 3 pays 80,000', amt('333333') === 80000);
check('รางวัลที่ 4 (space-separated column) pays 40,000', amt('400004') === 40000);
check('รางวัลที่ 5 (space-separated column) pays 20,000', amt('500050') === 20000);
check('เลขหน้า 3 ตัว pays 4,000', amt('789321') === 4000);
check('เลขท้าย 3 ตัว pays 4,000 (only)', bpResolveTicket('220111', drawFull).amount === 4000);
check('เลขท้าย 2 ตัว alone pays 2,000', amt('110056') === 2000);
check('a total miss pays 0', amt('080808') === 0);
check('a winning ticket flags unverifiable=false when sanook columns exist', bpResolveTicket('123456', drawFull).unverifiable === false);

// missing sanook columns → those checks unverifiable, myhora prizes still counted
const drawNoSanook = { date: '16/07/2026', prize1: '123456', top3: '456', front3_1: '789', front3_2: '012', back3_1: '456', back3_2: '111', bottom2: '56' };
const rNo = bpResolveTicket('123456', drawNoSanook);
check('draw missing sanook columns → unverifiable=true', rNo.unverifiable === true);
check('missing sanook still counts myhora prizes (ที่1 + ท้าย3 + ท้าย2)', rNo.amount === 6000000 + 4000 + 2000);

// ── plan-level resolve + ledger (mode-aware) ────────────────────────────────────────
const ticketPlan = {
  mode: 'ticket', date: '2026-07-16', budget: 240, risk: 'bold', config: { ...CFG, ticketPrice: 80 },
  rows: [
    { num: '123456', field: 'ticket', tier: 'ticket', qty: 2, stake: 160, ladder: ['123456', '456', '56'], trust: null, hand: false },
    { num: '110056', field: 'ticket', tier: 'ticket', qty: 1, stake: 80, ladder: ['110056', '056', '56'], trust: null, hand: true },
  ],
};
const histRows = [drawFull, { date: '01/07/2026', prize1: '111111', top3: '111', front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444', bottom2: '11' }];
const rTicket = bpResolvePlan(ticketPlan, dcActualForDate(histRows, '2026-07-16'));
check('ticket plan resolves: row1 pays 2 × 6,006,000', rTicket.rows[0].returned === 2 * (6000000 + 4000 + 2000));
check('ticket plan row2 (ท้าย2 only) pays 1 × 2,000', rTicket.rows[1].returned === 2000);
check('ticket plan net = returned − spent', rTicket.net === rTicket.returned - 240);
check('แก้เอง survives ticket resolution', rTicket.rows[1].hand === true);
const led = bpLedger([ticketPlan], histRows);
check('ledger random-play expectation is mode-aware for tickets (−32฿ × 3 tickets = −96)', Math.abs(led.randomExpectedNet - (-96)) < 1e-9);
check('ledger sums the ticket plan', led.resolved === 1 && led.spent === 240 && led.returned === rTicket.returned);

// ── ticket explainability (PRD-buy-plan-explainability) ──────────────────────────
const tSources = [
  { num: '123456', label: 'I1', kind: 'group', group: 'I · จักรพรรดิ', trust: null },
  { num: '123456', label: 'Mix', kind: 'mix' },
  { num: '778899', label: 'beam', kind: 'predict' },
];
const CFGT = { pay2: 95, pay3: 950, minStake: 20, roundUnit: 10, tierCap: 10, ticketPrice: 80 };
const pT = bpBuildPlan({ mode: 'ticket', budget: 240, risk: 'safe', config: CFGT, ticketSources: tSources });
const tRow = pT.rows.find(r => r.num === '123456');
const tEx = bpTicketExplainHtml(tRow);
check('ticket explain shows the agreement count (2 แหล่ง for 123456)', tEx.includes('2') && tEx.includes('แหล่ง'));
check('ticket explain lists the sources', tEx.includes('I1') && tEx.includes('Mix'));
check('ticket explain shows the fallback ladder', tEx.includes('เต็ม 6') && tEx.includes('ท้าย 2'));
check('ticket explain shows a group dot for group I', tEx.includes('bp-group-dot'));
const ticketHtml = bpEditableTicketHtml(pT);
check('ticket card renders a why-toggle', ticketHtml.includes('bp-why-toggle'));
check('ticket card renders a hidden detail block with matching id', ticketHtml.includes('id="bp-tdetail-'));

console.log(`OK: ${passed} checks passed`);
