// Regression tests for Buy Plan draw completeness and resolution semantics.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrcRaw = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
const appSrc = appSrcRaw.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');
const sandbox = {
  console,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(new Error('network disabled in test sandbox')),
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
}
function near(actual, expected, label) {
  check(`${label}: expected ${expected}, got ${actual}`, Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9);
}

const plan = {
  mode: 'perNumber', date: '2026-07-16', budget: 40, config: { pay2: 95, pay3: 950 },
  rows: [
    { num: '00', field: 'bottom2', stake: 20 },
    { num: '15', field: 'prize1_last2', stake: 10 },
    { num: '215', field: 'back3', stake: 10 },
  ],
};
const fullDraw = {
  date: '16/07/2026', prize1: '884215', bottom2: '15',
  front3_1: '789', front3_2: '012', back3_1: '215', back3_2: '111',
};

const incompleteDraw = { ...fullDraw, prize1: '', bottom2: '' };
const invalidPlanResult = sandbox.bpResolvePlan(plan, incompleteDraw);
check('invalid draw cells stay unknown rather than resolving padded hits', invalidPlanResult.rows.every(row => row.hit === null));
check('invalid actual data marks the plan unverifiable', invalidPlanResult.status === 'unverifiable' && invalidPlanResult.unverifiable === true);
check('unverifiable plan has no realized net P/L', invalidPlanResult.net === null);
check('invalid actual cells never generate payouts', invalidPlanResult.returned === 0);

const partialPlan = { ...plan, rows: [plan.rows[1], plan.rows[2]] };
const partialDraw = { ...fullDraw, prize1: '884215', bottom2: '' };
const partialResult = sandbox.bpResolvePlan(partialPlan, partialDraw);
check('valid prize1-backed fields can resolve when unrelated bottom2 is absent', partialResult.rows.every(row => row.hit === true));
check('missing unrelated field does not invalidate a resolved plan', partialResult.status === 'resolved' && partialResult.unverifiable === false);
near(partialResult.returned, 10 * 95 + 10 * 950, 'valid-field payouts');

const completeResult = sandbox.bpResolvePlan(plan, fullDraw);
check('complete valid draw preserves the existing bottom2 miss', completeResult.rows[0].hit === false);
check('complete valid draw preserves prize1-tail and back3 hits', completeResult.rows[1].hit === true && completeResult.rows[2].hit === true);
near(completeResult.net, completeResult.returned - 40, 'complete draw net');

const zeroQtyTicket = sandbox.bpResolvePlan({
  mode: 'ticket', budget: 0, config: { ticketPrice: 80 },
  rows: [{ num: '123456', field: 'ticket', qty: 0, stake: 0 }],
}, { ...fullDraw, prize1: '123456', back3_1: '456', bottom2: '56' });
check('zero quantity ticket does not use a hidden one-ticket fallback', zeroQtyTicket.returned === 0);
check('zero quantity confirmed prize is not reported as a purchased winning ticket', zeroQtyTicket.rows[0].hit === false);
check('zero quantity ticket is not a realized P/L position that requires result completeness', zeroQtyTicket.status === 'resolved' && zeroQtyTicket.net === 0);

const invalidQtyTicket = sandbox.bpResolvePlan({
  mode: 'ticket', budget: 0, config: { ticketPrice: 80 },
  rows: [{ num: '123456', field: 'ticket', qty: -2, stake: 0 }],
}, { ...fullDraw, prize1: '123456', back3_1: '456', bottom2: '56' });
check('negative ticket quantity cannot create a negative or positive prize payout', invalidQtyTicket.returned === 0);
check('negative ticket quantity is not reported as a purchased winning ticket', invalidQtyTicket.rows[0].hit === false);

const missingFieldResult = sandbox.bpResolvePlan({ ...plan, rows: [plan.rows[0]] }, { ...fullDraw, bottom2: '' });
check('selected field missing is unknown, not a measured miss', missingFieldResult.rows[0].hit === null && missingFieldResult.status === 'unverifiable');

const ticket = sandbox.bpResolveTicket('012345', { ...fullDraw, prize1: '12345', bottom2: '', near1_1: '', near1_2: '', prize2_1: '' });
check('short prize1 cannot create a padded first-prize hit', !ticket.wins.some(win => win.prize === 'ที่ 1'));
check('malformed ticket actual fields flag unverifiable', ticket.unverifiable === true);

const validColumns = {
  ...fullDraw, prize1: '123456',
  near1_1: '123455', near1_2: '123457',
  prize2_1: '200001', prize2_2: '200002', prize2_3: '200003', prize2_4: '200004', prize2_5: '200005',
  prize3_1: '300001', prize3_2: '300002', prize3_3: '300003', prize3_4: '300004', prize3_5: '300005',
  prize3_6: '300006', prize3_7: '300007', prize3_8: '300008', prize3_9: '300009', prize3_10: '300010',
  prize4: Array.from({ length: 50 }, (_, i) => String(400000 + i).padStart(6, '0')).join(' '),
  prize5: Array.from({ length: 100 }, (_, i) => String(500000 + i).padStart(6, '0')).join(' '),
};
const sparsePrize3 = sandbox.bpResolveTicket('333333', { ...fullDraw, prize1: '123456', prize3_1: '333333' });
check('partial draw still recognizes a valid listed prize3 win', sparsePrize3.wins.some(win => win.prize === 'ที่ 3'));
check('partial prize3-only data remains unverifiable', sparsePrize3.unverifiable === true);
const sparseLastPrize3 = sandbox.bpResolveTicket('333310', { ...fullDraw, prize1: '123456', prize3_10: '333310' });
check('partial draw recognizes a valid prize3 hit in the last column', sparseLastPrize3.wins.some(win => win.prize === 'ที่ 3'));
check('last-column prize3 hit remains unverifiable when other columns are absent', sparseLastPrize3.unverifiable === true);
const sparsePrize5Values = validColumns.prize5.split(' ');
sparsePrize5Values[0] = '555555';
const sparsePrize5 = sandbox.bpResolveTicket('555555', { ...fullDraw, prize1: '123456', prize5: sparsePrize5Values.join(' ') });
check('partial draw still recognizes a valid listed prize5 win', sparsePrize5.wins.some(win => win.prize === 'ที่ 5'));
check('prize5-only data remains unverifiable', sparsePrize5.unverifiable === true);
const duplicatePrize5Values = validColumns.prize5.split(' ');
duplicatePrize5Values[0] = duplicatePrize5Values[1];
const duplicatePrize5 = sandbox.bpResolveTicket(duplicatePrize5Values[1], { ...validColumns, prize5: duplicatePrize5Values.join(' ') });
check('duplicate token in full-count prize5 pool keeps resolution unverifiable', duplicatePrize5.unverifiable === true);
const duplicatePrize4Values = validColumns.prize4.split(' ');
duplicatePrize4Values[0] = duplicatePrize4Values[1];
const duplicatePrize4 = sandbox.bpResolveTicket(duplicatePrize4Values[1], { ...validColumns, prize4: duplicatePrize4Values.join(' ') });
check('duplicate token in full-count prize4 pool keeps resolution unverifiable', duplicatePrize4.unverifiable === true);
const duplicateKnownPrize4Values = validColumns.prize4.split(' ');
duplicateKnownPrize4Values[1] = '400004';
duplicateKnownPrize4Values[4] = '400004';
const duplicateKnownPrize4 = sandbox.bpResolveTicket('400004', { ...validColumns, prize4: duplicateKnownPrize4Values.join(' ') });
check('confirmed prize4 match survives duplicate elsewhere in an incomplete pool', duplicateKnownPrize4.wins.some(win => win.prize === 'ที่ 4' && win.amount === 40000));
check('duplicate prize4 pool stays unverifiable despite its confirmed match', duplicateKnownPrize4.unverifiable === true);
const duplicatePrize4Plan = sandbox.bpResolvePlan({
  mode: 'ticket', budget: 80, config: { ticketPrice: 80 },
  rows: [{ num: '400004', field: 'ticket', qty: 1, stake: 80 }],
}, { ...validColumns, prize4: duplicateKnownPrize4Values.join(' ') });
check('confirmed duplicate-list prize4 hit remains true at plan level', duplicatePrize4Plan.rows[0].hit === true);
check('duplicate-list prize4 hit keeps the overall plan unverifiable with no net', duplicatePrize4Plan.status === 'unverifiable' && duplicatePrize4Plan.net === null);
near(duplicatePrize4Plan.returned, 40000, 'confirmed prize4 payout despite duplicate');

const partialPool = sandbox.bpResolveTicket('222221', {
  ...fullDraw, prize1: '123456', near1_1: '123455', near1_2: '123457',
  prize2_1: '222222', prize2_2: '222223', prize2_3: '222224', prize2_4: '222225',
  prize3_1: '333333', prize3_2: '333334', prize4: '444444', prize5: '555555',
});
const partialPlanResult = sandbox.bpResolvePlan({
  mode: 'ticket', date: '2026-07-16', budget: 80, config: { ticketPrice: 80 },
  rows: [{ num: '222221', field: 'ticket', qty: 1, stake: 80 }],
}, { ...fullDraw, prize1: '123456', near1_1: '123455', near1_2: '123457',
  prize2_1: '222222', prize2_2: '222223', prize2_3: '222224', prize2_4: '222225',
  prize3_1: '333333', prize3_2: '333334', prize4: '444444', prize5: '555555' });
check('partial Sanook prize columns are not represented as a verified miss', partialPlanResult.status === 'unverifiable' && partialPlanResult.net === null);
check('ticket with no match in a partial prize draw is unknown, not a measured miss', partialPlanResult.rows[0].hit === null);
const myhoraOnlyNoHitPlan=sandbox.bpResolvePlan({mode:'ticket',budget:80,config:{ticketPrice:80},rows:[{num:'080808',field:'ticket',qty:1,stake:80}]},{...fullDraw,prize1:'123456'});
check('absent Sanook result columns keep a no-known-win ticket unknown, not a miss',myhoraOnlyNoHitPlan.rows[0].hit===null&&myhoraOnlyNoHitPlan.net===null);
const partialSanookBlankWin= sandbox.bpResolvePlan({mode:'ticket',budget:80,config:{ticketPrice:80},rows:[{num:'123456',field:'ticket',qty:1,stake:80}]},{...fullDraw,prize1:'123456',bottom2:'56',front3_1:'789',front3_2:'012',back3_1:'456',back3_2:'111',near1_1:'',near1_2:'',prize2_1:'',prize3_10:'',prize4:'',prize5:''});
check('verified Myhora win is not downgraded by blank incomplete Sanook fields',partialSanookBlankWin.rows[0].hit===true&&partialSanookBlankWin.net===null);
const partialKnownWinDraw = { ...fullDraw, prize1: '123456', prize3_10: '333310' };
const partialKnownWinPlan = sandbox.bpResolvePlan({
  mode: 'ticket', date: '2026-07-16', budget: 80, config: { ticketPrice: 80 },
  rows: [{ num: '333310', field: 'ticket', qty: 1, stake: 80 }],
}, partialKnownWinDraw);
check('verified prize match remains visible as a hit on an unverifiable plan', partialKnownWinPlan.rows[0].hit === true);
check('known payout does not make the incomplete plan P/L verifiable', partialKnownWinPlan.status === 'unverifiable' && partialKnownWinPlan.net === null);
near(partialKnownWinPlan.returned, 80000, 'known prize3_10 payout on incomplete draw');
const partialKnownWinLedgerDraw = { ...fullDraw, prize1: '123456', prize3_10: '333310' };
sandbox.localStorage = {
  getItem: key => key === 'lottery_buyplan_history' ? JSON.stringify([{ id: 'partial-win', mode: 'ticket', date: '2026-07-16', risk: 'mid', config: { ticketPrice: 80 }, rows: [{ num: '333310', field: 'ticket', qty: 1, stake: 80 }] }]) : null,
  setItem: () => {}, removeItem: () => {},
};
vm.runInContext(`_bpHistRows=${JSON.stringify([partialKnownWinLedgerDraw])}`, sandbox);
const partialKnownWinLedgerHtml = sandbox.bpHistoryLedgerHtml();
check('ledger visibly reports verified prize matches on an unverifiable plan', partialKnownWinLedgerHtml.includes('ตรวจพบ 1 รางวัลที่ยืนยันได้'));
const partialLedger = sandbox.bpLedger([
  { mode: 'ticket', date: '2026-07-16', budget: 80, config: { ticketPrice: 80 }, rows: [{ num: '222221', field: 'ticket', qty: 1, stake: 80 }] },
], [{ date: '16/07/2026', ...fullDraw, prize1: '123456', near1_1: '123455', near1_2: '123457',
  prize2_1: '222222', prize2_2: '222223', prize2_3: '222224', prize2_4: '222225',
  prize3_1: '333333', prize3_2: '333334', prize4: '444444', prize5: '555555' }]);
check('ticket with incomplete prize lists is excluded from ledger realized totals', partialLedger.resolved === 0);
check('unverifiable settled draw is excluded and counted separately, not pending', partialLedger.pending === 0 && partialLedger.unverifiable === 1);

const savedMessages=[];
sandbox.toast=(message,type)=>savedMessages.push({message,type});
vm.runInContext(`_bpWorkingPlan={mode:'perNumber',date:'2026-07-16',budget:20,risk:'mid',config:{pay2:95,pay3:950},rows:[{num:'15',field:'bottom2',stake:20}],ev:{theoretical:{},adjusted:{},warning:false},totalStake:20}`,sandbox);
sandbox.localStorage={getItem:()=> '[]',setItem:()=>{throw new Error('quota exceeded');},removeItem:()=>{}};
let saveError=null;
try { sandbox.bpSaveCurrentPlan(); } catch(error) { saveError=error; }
check('localStorage quota failure is handled by the save flow, not an uncaught exception',saveError===null);
check('failed save shows an error toast and never claims success',savedMessages.length===1&&savedMessages[0].type==='error'&&!savedMessages[0].message.includes('บันทึกชุดซื้อแล้ว'));

let historyBlob='[]';
sandbox.localStorage={
  getItem:key=>key==='lottery_buyplan_history'?historyBlob:null,
  setItem:(key,value)=>{if(key==='lottery_buyplan_history')historyBlob=value;},
  removeItem:()=>{},
};
for(let i=0;i<201;i++)sandbox.bpHistoryAdd({id:`bp${i}`});
const retainedPlans=JSON.parse(historyBlob);
check('all-time Buy Plan ledger retains more than 200 saved plans',retainedPlans.length===201);
check('oldest saved plan remains in history after the 201st save',retainedPlans.some(row=>row.id==='bp0'));

const configValues={'bp-cfg-pay2':95,'bp-cfg-pay3':950,'bp-cfg-min':20,'bp-cfg-round':2.5,'bp-cfg-ticket':80};
sandbox.document.getElementById=id=>configValues[id]!=null?{value:configValues[id]}:null;
let storedConfig=null;
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_config'?storedConfig:null,setItem:(key,value)=>{if(key==='lottery_buyplan_config')storedConfig=value;},removeItem:()=>{}};
const configMessages=[];
sandbox.toast=(message,type)=>configMessages.push({message,type});
sandbox.bpSaveConfig();
check('fractional rounding unit is rejected to match the integer-step config input',storedConfig===null&&configMessages.some(m=>m.type==='error'));

configValues['bp-cfg-round']=10;
sandbox.localStorage={getItem:()=>null,setItem:()=>{throw new Error('storage unavailable');},removeItem:()=>{}};
const configWriteMessages=[];
sandbox.toast=(message,type)=>configWriteMessages.push({message,type});
let configWriteError=null;
try { sandbox.bpSaveConfig(); } catch(error) { configWriteError=error; }
check('config storage failure is handled without an uncaught exception',configWriteError===null);
check('config storage failure is reported and never claims settings were saved',configWriteMessages.some(m=>m.type==='error')&&!configWriteMessages.some(m=>m.type==='success'));

const prefsErrorMessages=[];
sandbox.toast=(message,type)=>prefsErrorMessages.push({message,type});
let prefsWriteError=null;
try { sandbox.bpSetBudget(700); } catch(error) { prefsWriteError=error; }
check('preference storage failure is handled without an uncaught exception',prefsWriteError===null);
check('preference storage failure is reported and does not claim a save',prefsErrorMessages.some(m=>m.type==='error'));

let showPageCount=0;
sandbox.showPage=()=>showPageCount++;
sandbox._bpMixIntentPending=false;
let mixToast=[];
sandbox.toast=(message,type)=>mixToast.push({message,type});
sandbox.bpFromMix();
check('failed Mix-to-Buy-Plan preference write leaves no stale Mix intent and does not navigate',!sandbox._bpMixIntentPending&&showPageCount===0&&mixToast.some(m=>m.type==='error'));

const deleteMessages=[];
sandbox.toast=(message,type)=>deleteMessages.push({message,type});
let deleteError=null;
try { sandbox.bpDeletePlan('saved-plan'); } catch(error) { deleteError=error; }
check('history-delete storage failure is handled without an uncaught exception',deleteError===null);
check('failed history deletion never shows a success message',deleteMessages.some(m=>m.type==='error')&&!deleteMessages.some(m=>m.type==='success'));

console.log(`OK: ${passed} checks passed`);
