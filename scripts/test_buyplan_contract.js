// Regression tests for Buy Plan draw completeness and resolution semantics.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');
const appSrcRaw = require('./frontend_source').readFrontend('app.js');
const appSrc = appSrcRaw.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');
const dom = Object.create(null);
const sandbox = {
  console,
  document: { getElementById: id => dom[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(new Error('network disabled in test sandbox')),
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
require('./frontend_source').prepareContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);
sandbox.document.getElementById = id => dom[id] || null;

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
vm.runInContext(`LotteryServerData.buyplan.history=${JSON.stringify([partialKnownWinLedgerDraw])}`, sandbox);
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
vm.runInContext(`LotteryUiState.buyplan.workingPlan={mode:'perNumber',date:'2026-07-16',budget:20,risk:'mid',config:{pay2:95,pay3:950},rows:[{num:'15',field:'bottom2',stake:20}],ev:{theoretical:{},adjusted:{},warning:false},totalStake:20}`,sandbox);
let quotaHistory='[]';
sandbox.localStorage={getItem:()=>quotaHistory,setItem:()=>{throw new Error('quota exceeded');},removeItem:()=>{}};
let saveError=null;
try { sandbox.bpSaveCurrentPlan(); } catch(error) { saveError=error; }
check('localStorage quota failure is handled by the save flow, not an uncaught exception',saveError===null);
check('failed save shows an error toast and never claims success',savedMessages.length===1&&savedMessages[0].type==='error'&&!savedMessages[0].message.includes('บันทึกชุดซื้อแล้ว'));
check('blocked localStorage writes leave the prior history bytes intact',quotaHistory==='[]');

let dedupeHistory='[]';
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_history'?dedupeHistory:null,setItem:(key,value)=>{if(key==='lottery_buyplan_history')dedupeHistory=value;},removeItem:()=>{}};
const planRoot={className:'',dataset:{},setAttribute(){},innerHTML:''};
dom['bp-plan-root']=planRoot;
const duplicateDraft={mode:'perNumber',date:'2026-07-16',budget:20,risk:'mid',config:{pay2:95,pay3:950,minStake:20,roundUnit:10,tierCap:10,ticketPrice:80},rows:[],ev:{theoretical:{perBaht:0,per100:0},adjusted:{perBaht:0,per100:0,positive:false},warning:false},totalStake:0};
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,hand:false}],totalStake:20};
sandbox.LotteryUiState.buyplan.workingPlanTouched=false;
sandbox.bpEditStake(0,30);
check('manual stake edit marks the current Buy Plan draft as touched',sandbox.LotteryUiState.buyplan.workingPlanTouched&&sandbox.LotteryUiState.buyplan.workingPlan.rows[0].hand===true);
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,hand:false}],totalStake:20};
sandbox.LotteryUiState.buyplan.workingPlanTouched=false;
sandbox.bpDeleteRow(0);
check('manual deletion marks the draft as touched even when no rows remain',sandbox.LotteryUiState.buyplan.workingPlanTouched&&sandbox.LotteryUiState.buyplan.workingPlan.rows.length===0);
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft};
sandbox.bpPaint();
check('empty Buy Plan disables save and tells the user to add a wager first',/disabled[^>]*>เพิ่มเลขก่อนบันทึก/.test(planRoot.innerHTML)&&planRoot.innerHTML.includes('เพิ่มรายการเลขก่อน'));
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,source:'2 ตัวล่าง',hand:false}],totalStake:20};
sandbox.bpPaint();
check('unsaved wager plan keeps its save action enabled',!/<button[^>]*disabled/.test(planRoot.innerHTML)&&planRoot.innerHTML.includes('💾 บันทึกชุดนี้'));
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:30,source:'2 ตัวล่าง',hand:true}],totalStake:30};
sandbox.bpPaint();
check('over-budget actual wager shows exact overrun and keeps save action enabled',planRoot.innerHTML.includes('เกินงบ 10฿')&&!/<button[^>]*disabled/.test(planRoot.innerHTML)&&planRoot.innerHTML.includes('💾 บันทึกชุดนี้'));
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,source:'2 ตัวล่าง',hand:false,topEdgeDraws:74}],totalStake:20};
sandbox.bpPaint();
check('Buy Plan plan context separates the source-history count from the rolling Edge window',planRoot.innerHTML.includes('ข้อมูลย้อนหลัง 1 งวด · Edge Backtest สูงสุด 80 งวด'));
check('per-number Edge row visibly reports the actual formula sample',planRoot.innerHTML.includes('74/80 งวด'));
sandbox.bpSaveCurrentPlan();
check('first save creates one immutable history record',JSON.parse(dedupeHistory).length===1);
check('transient Edge sample count is excluded from the saved Buy Plan row schema',!Object.prototype.hasOwnProperty.call(JSON.parse(dedupeHistory)[0].rows[0],'topEdgeDraws'));
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,budget:40,risk:'bold',rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,source:'2 ตัวล่าง',hand:false,score:999,topEdge:25}],totalStake:20};
sandbox.bpPaint();
check('a reloaded equivalent wager is marked saved despite changed ranking/budget metadata',/disabled[^>]*>✓ ชุดนี้บันทึกแล้ว/.test(planRoot.innerHTML)&&planRoot.innerHTML.includes('ปรับเลขหรือยอดก่อนบันทึกชุดใหม่'));
const duplicateSaveMessages=[];sandbox.toast=(message,type)=>duplicateSaveMessages.push({message,type});
sandbox.bpSaveCurrentPlan();
check('direct duplicate save call is rejected without adding a second record',JSON.parse(dedupeHistory).length===1&&duplicateSaveMessages.some(m=>m.type==='error'));
sandbox.LotteryUiState.buyplan.workingPlan={...sandbox.LotteryUiState.buyplan.workingPlan,rows:[{...sandbox.LotteryUiState.buyplan.workingPlan.rows[0],stake:40}],totalStake:40};
sandbox.bpPaint();
check('editing the actual stake re-enables the distinct-save action',!/<button[^>]*disabled/.test(planRoot.innerHTML)&&!planRoot.innerHTML.includes('ชุดนี้บันทึกแล้ว'));
sandbox.bpSaveCurrentPlan();
check('a changed wager can be saved as a separate record',JSON.parse(dedupeHistory).length===2);

let damagedHistory='{"unfinished":';
let protectedWriteCount=0;
sandbox.localStorage={
  getItem:key=>key==='lottery_buyplan_history'?damagedHistory:null,
  setItem:()=>{protectedWriteCount++;},
  removeItem:()=>{protectedWriteCount++;},
};
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,source:'2 ตัวล่าง'}],totalStake:20};
sandbox.bpPaint();
check('malformed Buy Plan history is an error, not a successful empty ledger',planRoot.innerHTML.includes('อ่านประวัติชุดซื้อไม่ได้')&&!planRoot.innerHTML.includes('ยังไม่มีชุดที่บันทึก'));
check('malformed Buy Plan history disables saving with a preservation explanation',/disabled[^>]*>ปิดบันทึกไว้/.test(planRoot.innerHTML)&&planRoot.innerHTML.includes('ข้อมูลเดิมถูกเขียนทับ'));
const damagedBytesBefore=damagedHistory;
const damagedSaveMessages=[];sandbox.toast=(message,type)=>damagedSaveMessages.push({message,type});
sandbox.bpSaveCurrentPlan();
check('saving with malformed history does not call setItem or replace the original bytes',damagedHistory===damagedBytesBefore&&protectedWriteCount===0);
check('blocked save explains the old history was protected',damagedSaveMessages.some(item=>item.type==='error'&&item.message.includes('ข้อมูลเดิมสูญหาย')));
check('deleting from malformed history is blocked without changing its bytes',sandbox.bpHistoryDelete('existing')===false&&damagedHistory===damagedBytesBefore&&protectedWriteCount===0);

damagedHistory='{}';
sandbox.bpPaint();
check('unexpected non-array Buy Plan history shape is reported as malformed',planRoot.innerHTML.includes('โครงสร้างข้อมูลไม่ถูกต้อง')&&sandbox.LotteryUiState.buyplan.historyReadError==='malformed');

let inaccessibleWrites=0;
sandbox.localStorage={getItem:()=>{throw new Error('storage access denied');},setItem:()=>{inaccessibleWrites++;},removeItem:()=>{inaccessibleWrites++;}};
sandbox.bpPaint();
check('Buy Plan storage read exceptions are distinct from an empty ledger',planRoot.innerHTML.includes('เบราว์เซอร์ไม่อนุญาตให้อ่านข้อมูล')&&!planRoot.innerHTML.includes('ยังไม่มีชุดที่บันทึก'));
const accessFailureSave=[];sandbox.toast=(message,type)=>accessFailureSave.push({message,type});
sandbox.bpSaveCurrentPlan();
const accessFailureDelete=sandbox.bpHistoryDelete('existing');
check('Buy Plan read exceptions block saves and deletes without attempting writes',inaccessibleWrites===0&&accessFailureDelete===false&&inaccessibleWrites===0);

let backupBytes='{"unfinished":';
let downloadedBlob=null,downloadClicked=false,downloadRevoked=false;
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_history'?backupBytes:null,setItem:()=>{throw new Error('writes must stay blocked');},removeItem:()=>{throw new Error('writes must stay blocked');}};
sandbox.Blob=class {constructor(parts,options){downloadedBlob={text:parts.join(''),type:options.type};}};
sandbox.URL={createObjectURL:()=> 'blob:buyplan-backup',revokeObjectURL:url=>{downloadRevoked=url==='blob:buyplan-backup';}};
sandbox.document.body={appendChild(){}};
sandbox.document.createElement=()=>({click(){downloadClicked=true;},remove(){},style:{}});
sandbox.setTimeout=callback=>{callback();return 1;};
check('unreadable Buy Plan history offers a raw JSON backup without rewriting storage',sandbox.bpDownloadHistoryBackup()===true&&downloadedBlob.text===backupBytes&&downloadClicked&&downloadRevoked&&backupBytes==='{"unfinished":');
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_history'?dedupeHistory:null,setItem:(key,value)=>{if(key==='lottery_buyplan_history')dedupeHistory=value;},removeItem:()=>{}};

sandbox.LotteryUiState.buyplan.workingPlan={mode:'ticket',date:'2026-07-16',budget:80,risk:'mid',config:{ticketPrice:80},rows:[{num:'123456',field:'ticket',tier:'ticket',qty:2,stake:160,ladder:['123456','456','56'],sources:[],hand:true}],ticketCount:2,totalStake:160,ev:{theoretical:{expectedReturn:48,perTicket:-32},adjusted:{},warning:false}};
sandbox.bpPaint();
check('over-budget ticket plan shows exact overrun and keeps save action enabled',planRoot.innerHTML.includes('เกินงบ 80฿')&&!/<button[^>]*disabled/.test(planRoot.innerHTML)&&planRoot.innerHTML.includes('💾 บันทึกชุดนี้'));
const ticketSingle={mode:'ticket',date:'2026-07-16',config:{ticketPrice:80},rows:[{num:'123456',field:'ticket',qty:2,stake:160}]};
const ticketSplit={...ticketSingle,rows:[{num:'123456',field:'ticket',qty:1,stake:80},{num:'123456',field:'ticket',qty:1,stake:80}]};
check('ticket duplicate identity aggregates equivalent split rows',sandbox.bpSavedPlanSignature(ticketSingle)===sandbox.bpSavedPlanSignature(ticketSplit));
check('a changed ticket quantity produces a distinct plan identity',sandbox.bpSavedPlanSignature(ticketSingle)!==sandbox.bpSavedPlanSignature({...ticketSingle,rows:[{num:'123456',field:'ticket',qty:3,stake:240}]}));
check('a different target draw is a separate plan identity',sandbox.bpSavedPlanSignature(ticketSingle)!==sandbox.bpSavedPlanSignature({...ticketSingle,date:'2026-08-01'}));
const perNumberIdentity={mode:'perNumber',date:'2026-07-16',config:{pay2:95,pay3:950},rows:[{num:'15',field:'bottom2',stake:20}]};
check('a different wager number produces a distinct plan identity',sandbox.bpSavedPlanSignature(perNumberIdentity)!==sandbox.bpSavedPlanSignature({...perNumberIdentity,rows:[{num:'16',field:'bottom2',stake:20}]}));
check('a changed payout rate produces a distinct plan identity',sandbox.bpSavedPlanSignature(perNumberIdentity)!==sandbox.bpSavedPlanSignature({...perNumberIdentity,config:{pay2:96,pay3:950}}));

let historyBlob='[]';
sandbox.localStorage={
  getItem:key=>key==='lottery_buyplan_history'?historyBlob:null,
  setItem:(key,value)=>{if(key==='lottery_buyplan_history')historyBlob=value;},
  removeItem:()=>{},
};
for(let i=0;i<201;i++)sandbox.bpHistoryAdd({id:`bp${i}`,date:'2026-07-16',rows:[]});
const retainedPlans=JSON.parse(historyBlob);
check('all-time Buy Plan ledger retains more than 200 saved plans',retainedPlans.length===201);
check('oldest saved plan remains in history after the 201st save',retainedPlans.some(row=>row.id==='bp0'));

const configValues={'bp-cfg-pay2':95,'bp-cfg-pay3':950,'bp-cfg-min':20,'bp-cfg-round':2.5,'bp-cfg-ticket':80};
sandbox.document.getElementById=id=>configValues[id]!=null?{value:configValues[id]}:(dom[id]||null);
let configReadRaw=null,configReadWrites=0;
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_config'?configReadRaw:null,setItem:()=>{configReadWrites++;},removeItem:()=>{}};
const missingConfig=sandbox.bpReadConfig();
check('missing Buy Plan config is a normal default state',missingConfig.pay2===95&&missingConfig.roundUnit===10&&sandbox.LotteryUiState.buyplan.configReadError===null);
configReadRaw='{"pay2":90}';
const legacyPartialConfig=sandbox.bpReadConfig();
check('valid partial legacy config keeps its stored values and fills missing defaults',legacyPartialConfig.pay2===90&&legacyPartialConfig.pay3===950&&legacyPartialConfig.ticketPrice===80&&sandbox.LotteryUiState.buyplan.configReadError===null);
const invalidConfigRaw='{"pay2":"oops","roundUnit":0}';
configReadRaw=invalidConfigRaw;
const invalidConfig=sandbox.bpReadConfig();
check('invalid stored payout and rounding values fall back to valid defaults',invalidConfig.pay2===95&&invalidConfig.roundUnit===10&&sandbox.LotteryUiState.buyplan.configReadError==='malformed');
check('invalid config is clearly marked beside the plan and in settings with recovery controls',sandbox.bpConfigWarningHtml().includes('ใช้ค่าเรตเริ่มต้นชั่วคราว')&&sandbox.bpConfigStatusHtml().includes('bpDownloadConfigBackup()')&&sandbox.bpConfigStatusHtml().includes('bpRetryConfigRead()'));
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:20,source:'2 ตัวล่าง'}],totalStake:20};
sandbox.bpPaint();
check('invalid payout config warning is rendered inside the active Buy Plan beside its estimated return',planRoot.innerHTML.includes('แผนนี้ใช้ค่าเรตเริ่มต้นชั่วคราว')&&planRoot.innerHTML.includes('ตรวจและแก้เรต'));
check('reading invalid config never overwrites the original stored bytes',configReadRaw===invalidConfigRaw&&configReadWrites===0);
configReadRaw='{broken config';
check('malformed JSON config remains intact and is labeled malformed',sandbox.bpReadConfig().pay2===95&&sandbox.LotteryUiState.buyplan.configReadError==='malformed'&&configReadRaw==='{broken config');
sandbox.localStorage={getItem:()=>{throw new Error('storage denied');},setItem:()=>{configReadWrites++;},removeItem:()=>{}};
check('unreadable config is distinct from malformed JSON while using safe defaults',sandbox.bpReadConfig().pay3===950&&sandbox.LotteryUiState.buyplan.configReadError==='unavailable');
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_config'?invalidConfigRaw:null,setItem:()=>{configReadWrites++;},removeItem:()=>{}};
let configBackup='';
sandbox.Blob=class{constructor(parts){this.parts=parts;}};
sandbox.URL={createObjectURL:blob=>{configBackup=blob.parts[0];return 'blob:buyplan-config';},revokeObjectURL(){}};
sandbox.window.setTimeout=fn=>fn();
sandbox.document.body={appendChild(){}};
sandbox.document.createElement=()=>({click(){},remove(){}});
check('Buy Plan can download the original malformed config bytes without changing them',sandbox.bpDownloadConfigBackup()===true&&configBackup===invalidConfigRaw&&configReadWrites===0);
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
const planBeforeConfigWriteFailure={...duplicateDraft,rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:40,hand:true}],totalStake:40};
sandbox.LotteryUiState.buyplan.workingPlan=planBeforeConfigWriteFailure;
sandbox.LotteryUiState.buyplan.workingPlanTouched=true;
const configWritePlanBytes=JSON.stringify(planBeforeConfigWriteFailure);
let configWriteError=null;
try { sandbox.bpSaveConfig(); } catch(error) { configWriteError=error; }
check('config storage failure is handled without an uncaught exception',configWriteError===null);
check('config storage failure is reported and never claims settings were saved',configWriteMessages.some(m=>m.type==='error')&&!configWriteMessages.some(m=>m.type==='success'));
check('failed payout-config write leaves the edited Buy Plan draft untouched',JSON.stringify(sandbox.LotteryUiState.buyplan.workingPlan)===configWritePlanBytes);

configValues['bp-cfg-pay2']=96;
let repairedConfig='{"pay2":"oops"}';
sandbox.localStorage={getItem:key=>key==='lottery_buyplan_config'?repairedConfig:null,setItem:(key,value)=>{if(key==='lottery_buyplan_config')repairedConfig=value;},removeItem:()=>{}};
sandbox.toast=(message,type)=>configMessages.push({message,type});
sandbox.bpSaveConfig();
check('saving corrected rates replaces corrupt settings only after explicit save and clears the warning',JSON.parse(repairedConfig).pay2===96&&sandbox.LotteryUiState.buyplan.configReadError===null&&configMessages.some(m=>m.type==='success'));

const buyPrefs={mode:'perNumber',budget:500,risk:'mid'};
sandbox.localStorage={
  getItem:key=>key==='lottery_buyplan_config'?repairedConfig:key==='lottery_buyplan_prefs'?JSON.stringify(buyPrefs):key==='lottery_buyplan_history'?'[]':null,
  setItem:(key,value)=>{if(key==='lottery_buyplan_config')repairedConfig=value;},removeItem:()=>{},
};
sandbox.LotteryServerData.buyplan.sources={scoreRows:[{num:'16',score:10}],recoNums:[],ticketSources:[]};
configValues['bp-cfg-pay2']=97;
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,date:'2026-11-01',budget:500,risk:'bold',rows:[{num:'15',field:'bottom2',tier:'2d',len:2,stake:30,source:'manual source detail',hand:true}],totalStake:30};
sandbox.LotteryUiState.buyplan.workingPlanTouched=true;
sandbox.bpSaveConfig();
const savedEditedNumberPlan=sandbox.LotteryUiState.buyplan.workingPlan;
check('saving payout settings preserves a manually edited per-number draft and its row explanation',savedEditedNumberPlan.date==='2026-11-01'&&savedEditedNumberPlan.budget===500&&savedEditedNumberPlan.risk==='bold'&&savedEditedNumberPlan.rows[0].num==='15'&&savedEditedNumberPlan.rows[0].source==='manual source detail'&&savedEditedNumberPlan.rows[0].hand===true);
check('preserved per-number draft adopts the new payout config and recomputes EV',savedEditedNumberPlan.config.pay2===97&&savedEditedNumberPlan.totalStake===30&&Math.abs(savedEditedNumberPlan.ev.theoretical.perBaht+0.03)<1e-9);

buyPrefs.mode='ticket';
configValues['bp-cfg-ticket']=100;
sandbox.LotteryUiState.buyplan.workingPlan={mode:'ticket',date:'2026-12-16',budget:160,risk:'safe',config:{...duplicateDraft.config,ticketPrice:80},ticketPrice:80,ticketCount:2,totalStake:160,rows:[{num:'012345',field:'ticket',qty:2,stake:160,sources:['Mix'],ladder:['012345','345','45'],hand:true}],ev:{}};
sandbox.LotteryUiState.buyplan.workingPlanTouched=true;
sandbox.bpSaveConfig();
const savedEditedTicketPlan=sandbox.LotteryUiState.buyplan.workingPlan;
check('saving ticket price preserves the manually chosen number and quantity while recalculating spend',savedEditedTicketPlan.rows.length===1&&savedEditedTicketPlan.rows[0].num==='012345'&&savedEditedTicketPlan.rows[0].qty===2&&savedEditedTicketPlan.rows[0].stake===200&&savedEditedTicketPlan.totalStake===200&&savedEditedTicketPlan.ticketPrice===100);

buyPrefs.mode='perNumber';
configValues['bp-cfg-pay2']=98;
sandbox.LotteryServerData.buyplan.sources={scoreRows:[{num:'16',score:10}],recoNums:[],ticketSources:[]};
sandbox.LotteryUiState.buyplan.workingPlan={...duplicateDraft,rows:[{num:'99',field:'bottom2',tier:'2d',len:2,stake:20,source:'generated',hand:false}],totalStake:20};
sandbox.LotteryUiState.buyplan.workingPlanTouched=false;
sandbox.bpSaveConfig();
check('saving payout settings regenerates an untouched plan from the current source candidates',sandbox.LotteryUiState.buyplan.workingPlan.config.pay2===98&&sandbox.LotteryUiState.buyplan.workingPlan.rows.some(row=>row.num==='16')&&!sandbox.LotteryUiState.buyplan.workingPlan.rows.some(row=>row.num==='99'));

configValues['bp-cfg-round']=2.5;
const planBeforeInvalidConfig=JSON.stringify(sandbox.LotteryUiState.buyplan.workingPlan);
sandbox.bpSaveConfig();
check('invalid payout settings leave the current Buy Plan draft unchanged',JSON.stringify(sandbox.LotteryUiState.buyplan.workingPlan)===planBeforeInvalidConfig);
sandbox.LotteryServerData.buyplan.sources=null;
sandbox.LotteryUiState.buyplan.workingPlan=null;
sandbox.LotteryUiState.buyplan.workingPlanTouched=false;

const prefsErrorMessages=[];
sandbox.toast=(message,type)=>prefsErrorMessages.push({message,type});
sandbox.localStorage={getItem:()=>null,setItem:()=>{throw new Error('storage unavailable');},removeItem:()=>{}};
let prefsWriteError=null;
try { sandbox.bpSetBudget(700); } catch(error) { prefsWriteError=error; }
check('preference storage failure is handled without an uncaught exception',prefsWriteError===null);
check('preference storage failure is reported and does not claim a save',prefsErrorMessages.some(m=>m.type==='error'));

let shownPages=[];
sandbox.showPage=page=>shownPages.push(page);
sandbox.clientDraws=()=>[
  {date:'2026-10-16',label:'16 ต.ค. 2569'},
  {date:'2026-11-01',label:'1 พ.ย. 2569'},
];
let selectedBuyDate='2026-10-16';
const bpDate={options:[],get value(){return selectedBuyDate;},set value(value){if(this.options.some(option=>option.value===value))selectedBuyDate=value;},set innerHTML(html){this.options=[...html.matchAll(/value="([^"]+)"/g)].map(match=>({value:match[1]}));},appendChild(option){this.options.push(option);}};
dom['mix-date']={value:'2026-11-01'};
dom['bp-date']=bpDate;
sandbox.document.getElementById=id=>dom[id]||null;
const handoffStorage=Object.create(null);
sandbox.localStorage={getItem:key=>handoffStorage[key]??null,setItem:(key,value)=>{handoffStorage[key]=value;},removeItem:key=>{delete handoffStorage[key];}};
sandbox.LotteryUiState.buyplan.mixIntentPending=false;
let mixToast=[];
sandbox.toast=(message,type)=>mixToast.push({message,type});
sandbox.bpFromMix();
check('Mix handoff populates a first-visit Buy Plan date selector from available draws',bpDate.options.length===2);
check('Mix handoff carries its selected target into Buy Plan before navigation',selectedBuyDate==='2026-11-01'&&shownPages.at(-1)==='buyplan');
check('Mix handoff still selects ticket mode and carries one-shot source intent',sandbox.bpReadPrefs().mode==='ticket'&&sandbox.LotteryUiState.buyplan.mixIntentPending);

// A restored target can sit outside the default client draw list; preserve it without building HTML.
dom['mix-date']={value:'2027-01-16'};
selectedBuyDate='2026-10-16';
sandbox.document.createElement=()=>({});
sandbox.fmtDate=value=>`วันที่ ${value}`;
sandbox.bpFromMix();
check('Mix handoff safely adds a restored custom target to Buy Plan options',bpDate.options.some(option=>option.value==='2027-01-16'&&option.textContent==='วันที่ 2027-01-16'));
check('Mix handoff selects the restored target rather than keeping the old Buy Plan draw',selectedBuyDate==='2027-01-16'&&shownPages.at(-1)==='buyplan');
check('custom target handoff does not save a plan implicitly',!handoffStorage.lottery_buyplan_history);

sandbox.localStorage={getItem:()=>null,setItem:()=>{throw new Error('storage unavailable');},removeItem:()=>{}};
sandbox.LotteryUiState.buyplan.mixIntentPending=false;
shownPages=[];
sandbox.bpFromMix();
check('failed Mix-to-Buy-Plan preference write leaves no stale intent and does not navigate',!sandbox.LotteryUiState.buyplan.mixIntentPending&&shownPages.length===0&&mixToast.some(m=>m.type==='error'));

const deleteMessages=[];
sandbox.toast=(message,type)=>deleteMessages.push({message,type});
let deleteError=null;
try { sandbox.bpDeletePlan('saved-plan'); } catch(error) { deleteError=error; }
check('history-delete storage failure is handled without an uncaught exception',deleteError===null);
check('failed history deletion never shows a success message',deleteMessages.some(m=>m.type==='error')&&!deleteMessages.some(m=>m.type==='success'));

// Protect edited drafts across preference changes, no-op selections, and Mix hand-off.
const protectedPlan={...duplicateDraft,budget:500,rows:[{num:'07',field:'bottom2',tier:'2d',len:2,stake:20,source:'saved source'}],totalStake:20};
const protectedLedger=[{...protectedPlan,id:'saved-draft'}];
const protectionStorage={lottery_buyplan_prefs:JSON.stringify({mode:'perNumber',budget:500,risk:'mid'}),lottery_buyplan_history:JSON.stringify(protectedLedger)};
sandbox.localStorage={getItem:key=>protectionStorage[key]??null,setItem:(key,value)=>{protectionStorage[key]=value;},removeItem:key=>{delete protectionStorage[key];}};
dom['bp-plan-root']={className:'',dataset:{},setAttribute(){},innerHTML:''};
dom['bp-budget-input']={value:500};
const quickBudgetButtons=[200,500,1000].map(amount=>({dataset:{amt:String(amount)},classList:{toggle(name,on){this[name]=on;}},setAttribute(name,value){this[name]=value;}}));
sandbox.document.querySelectorAll=selector=>selector==='.bp-budget-quick'?quickBudgetButtons:[];
sandbox.LotteryUiState.buyplan.workingPlan={...protectedPlan,rows:protectedPlan.rows.map(row=>({...row}))};
sandbox.LotteryUiState.buyplan.workingPlanTouched=true;
 sandbox.bpSyncControls(sandbox.bpReadPrefs(),true);
check('a selected quick preset is represented by the active button and an empty custom field',dom['bp-budget-input'].value===''&&quickBudgetButtons[1].classList.active===true&&quickBudgetButtons[1]['aria-pressed']==='true');
sandbox.bpSyncControls({mode:'perNumber',budget:700,risk:'mid'},true);
check('a custom budget appears in the input with no quick preset active',dom['bp-budget-input'].value===700&&quickBudgetButtons.every(button=>button.classList.active===false));
sandbox.bpWritePrefs({mode:'perNumber',budget:700,risk:'mid'});
dom['bp-budget-input'].value='';
check('leaving a blank custom field restores the current custom budget instead of zero',sandbox.bpSetBudgetFromInput(dom['bp-budget-input'])===true&&sandbox.bpReadPrefs().budget===700&&dom['bp-budget-input'].value===700);
const budgetRenderBeforeCommit=sandbox.bpRender;sandbox.bpRender=()=>{};
dom['bp-budget-input'].value='900';
const acceptedCustomBudget=sandbox.bpSetBudgetFromInput(dom['bp-budget-input']);
check('committing a custom budget keeps the amount visible with no quick preset active',acceptedCustomBudget===true&&sandbox.bpReadPrefs().budget===900&&dom['bp-budget-input'].value===900&&quickBudgetButtons.every(button=>button.classList.active===false));
const selectedPreset=sandbox.bpSetBudget(500);
sandbox.bpRender=budgetRenderBeforeCommit;
check('selecting a quick preset clears the custom field and marks that preset active',selectedPreset===true&&dom['bp-budget-input'].value===''&&quickBudgetButtons[1].classList.active===true);
sandbox.bpWritePrefs({mode:'perNumber',budget:500,risk:'mid'});
sandbox.bpSyncControls(sandbox.bpReadPrefs(),true);
check('a manually touched draft already present in the saved ledger is not treated as unsaved',!sandbox.bpHasUnsavedDraft());
check('saved identity keeps the unsaved-draft notice hidden',!sandbox.bpUnsavedDraftHtml().includes('แก้ไขที่ยังไม่บันทึก'));
sandbox.LotteryUiState.buyplan.workingPlan.rows[0].stake=30;
sandbox.LotteryUiState.buyplan.workingPlan.totalStake=30;
check('manual edits after saving become an unsaved draft again',sandbox.bpHasUnsavedDraft()&&sandbox.bpUnsavedDraftHtml().includes('แก้ไขที่ยังไม่บันทึก'));
sandbox.bpPaint();
check('edited draft state is visible in the current Buy Plan panel',dom['bp-plan-root'].innerHTML.includes('bp-unsaved-draft')&&dom['bp-plan-root'].innerHTML.includes('คำนวณชุดใหม่จากข้อมูลล่าสุด'));

let draftConfirmations=0,draftConfirmResult=false;
sandbox.confirm=()=>{draftConfirmations++;return draftConfirmResult;};
const preservedPlan=sandbox.LotteryUiState.buyplan.workingPlan;
check('selecting the current budget is a no-op and does not prompt or regenerate',sandbox.bpSetBudget(500)===true&&draftConfirmations===0&&sandbox.LotteryUiState.buyplan.workingPlan===preservedPlan&&sandbox.LotteryUiState.buyplan.workingPlanTouched);
check('committing an empty custom field keeps the selected preset budget',sandbox.bpSetBudgetFromInput(dom['bp-budget-input'])===true&&sandbox.bpReadPrefs().budget===500&&dom['bp-budget-input'].value===''&&sandbox.LotteryUiState.buyplan.workingPlan===preservedPlan);
dom['bp-budget-input'].value=700;
check('canceling a budget change restores the active preset representation and preserves the draft',sandbox.bpSetBudget(700)===false&&dom['bp-budget-input'].value===''&&quickBudgetButtons[1].classList.active===true&&sandbox.bpReadPrefs().budget===500&&sandbox.LotteryUiState.buyplan.workingPlan===preservedPlan&&sandbox.LotteryUiState.buyplan.workingPlanTouched);
check('canceling a mode change preserves the preference and draft',sandbox.bpSetMode('ticket')===false&&sandbox.bpReadPrefs().mode==='perNumber'&&sandbox.LotteryUiState.buyplan.workingPlan===preservedPlan&&sandbox.LotteryUiState.buyplan.workingPlanTouched);
check('canceling a risk change preserves the preference and draft',sandbox.bpSetRisk('bold')===false&&sandbox.bpReadPrefs().risk==='mid'&&sandbox.LotteryUiState.buyplan.workingPlan===preservedPlan&&sandbox.LotteryUiState.buyplan.workingPlanTouched);

let canceledMixPages=[];
sandbox.showPage=page=>canceledMixPages.push(page);
dom['bp-date']={options:[{value:protectedPlan.date}],value:protectedPlan.date};
dom['mix-date']={value:'2026-08-01'};
sandbox.LotteryUiState.buyplan.mixIntentPending=false;
check('canceling Mix hand-off leaves mode, target, intent, page, and draft untouched',sandbox.bpFromMix()===false&&sandbox.bpReadPrefs().mode==='perNumber'&&dom['bp-date'].value===protectedPlan.date&&!sandbox.LotteryUiState.buyplan.mixIntentPending&&canceledMixPages.length===0&&sandbox.LotteryUiState.buyplan.workingPlan===preservedPlan&&sandbox.LotteryUiState.buyplan.workingPlanTouched);

draftConfirmResult=true;
sandbox.LotteryServerData.buyplan.sources={scoreRows:[],recoNums:[],ticketSources:[]};
sandbox.LotteryServerData.buyplan.history=[];
check('confirming a risk change rebuilds the plan and clears its dirty marker',sandbox.bpSetRisk('bold')===true&&sandbox.bpReadPrefs().risk==='bold'&&sandbox.LotteryUiState.buyplan.workingPlan!==preservedPlan&&!sandbox.LotteryUiState.buyplan.workingPlanTouched);

sandbox.LotteryUiState.buyplan.workingPlan={...protectedPlan,rows:protectedPlan.rows.map(row=>({...row,stake:30})),totalStake:30};
sandbox.LotteryUiState.buyplan.workingPlanTouched=true;
dom['mix-date']={value:protectedPlan.date};
draftConfirmResult=true;
check('confirming Mix hand-off selects ticket mode and target, carries intent, and consumes the dirty draft',sandbox.bpFromMix()===true&&sandbox.bpReadPrefs().mode==='ticket'&&dom['bp-date'].value===protectedPlan.date&&sandbox.LotteryUiState.buyplan.mixIntentPending&&!sandbox.LotteryUiState.buyplan.workingPlanTouched&&canceledMixPages.at(-1)==='buyplan');

const prefsBeforeExplicitZero=sandbox.bpReadPrefs();
const touchedBeforeExplicitZero=sandbox.LotteryUiState.buyplan.workingPlanTouched;
const originalBudgetRender=sandbox.bpRender;
sandbox.LotteryUiState.buyplan.workingPlanTouched=false;
sandbox.bpRender=()=>{};
dom['bp-budget-input'].value='0';
const explicitZeroResult=sandbox.bpSetBudgetFromInput(dom['bp-budget-input']);
sandbox.bpRender=originalBudgetRender;
check('an explicitly entered zero remains a valid budget',explicitZeroResult===true&&sandbox.bpReadPrefs().budget===0&&dom['bp-budget-input'].value===0);
sandbox.bpWritePrefs(prefsBeforeExplicitZero);
sandbox.LotteryUiState.buyplan.workingPlanTouched=touchedBeforeExplicitZero;
sandbox.bpSyncControls(sandbox.bpReadPrefs(),true);

console.log(`OK: ${passed} checks passed`);
