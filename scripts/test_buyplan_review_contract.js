// Buy Plan contract verification — run offline with synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT=path.join(__dirname,'..');
const raw=fs.readFileSync(path.join(ROOT,'static','app.js'),'utf8');
const src=raw.replace(/^startCountdown\(\);\s*$/m,'').replace(/^init\(\);\s*$/m,'');
const engine=fs.readFileSync(path.join(ROOT,'static','formula-engine.js'),'utf8');
const sandbox={console,document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({}),addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}};
sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(engine,sandbox);vm.runInContext(src,sandbox);
let passed=0;function check(name,ok){if(!ok)throw Error('FAIL '+name);passed++;}
const full={date:'16/07/2026',prize1:'123456',front3_1:'789',front3_2:'012',back3_1:'456',back3_2:'111',bottom2:'56',near1_1:'123455',near1_2:'123457',prize2_1:'222222',prize2_2:'222223',prize2_3:'222224',prize2_4:'222225',prize2_5:'222226',prize3_1:'333333',prize3_2:'333334',prize3_3:'333335',prize3_4:'333336',prize3_5:'333337',prize3_6:'333338',prize3_7:'333339',prize3_8:'333340',prize3_9:'333341',prize3_10:'333310',prize4:Array.from({length:50},(_,i)=>String(400000+i)).join(' '),prize5:Array.from({length:100},(_,i)=>String(500000+i)).join(' ')};
const plan=(rows,mode='ticket')=>({mode,date:'2026-07-16',budget:100,config:{ticketPrice:80,pay2:95,pay3:950},rows});
const missing=sandbox.bpResolvePlan(plan([{num:'00',field:'bottom2',stake:20}], 'perNumber'),{...full,bottom2:''});check('blank actual is unknown not padded hit',missing.rows[0].hit===null&&missing.status==='unverifiable'&&missing.net===null);
const shortPrize1=sandbox.bpResolvePlan(plan([{num:'012345',field:'ticket',qty:1,stake:80}]),{...full,prize1:'12345'});check('short prize1 never creates a first-prize hit',!shortPrize1.rows[0].wins.some(win=>win.prize==='ที่ 1'));
check('short prize1 leaves the ticket result unverifiable',shortPrize1.status==='unverifiable'&&shortPrize1.net===null);
check('independently exact front3 can still be recognized under short prize1',shortPrize1.rows[0].wins.some(win=>win.prize==='เลขหน้า 3 ตัว'));
const confirmed=sandbox.bpResolvePlan(plan([{num:'333310',field:'ticket',qty:1,stake:80}]),{...full,prize2_1:'',prize3_10:'333310'});check('sparse Sanook known win remains confirmed',confirmed.rows[0].hit===true&&confirmed.status==='unverifiable');
const unknown=sandbox.bpResolvePlan(plan([{num:'999999',field:'ticket',qty:1,stake:80}]),{...full,prize2_1:'',prize3_10:''});check('incomplete prize table leaves unmatched ticket unknown',unknown.rows[0].hit===null&&unknown.status==='unverifiable');
const sparse=sandbox.bpResolvePlan(plan([{num:'999999',field:'ticket',qty:1,stake:80}]),{...full,near1_1:'',prize2_1:'',prize4:''});check('sparse table without confirmed match is unverifiable',sparse.status==='unverifiable'&&sparse.net===null);
const duplicatePool=[...full.prize4.split(' ').slice(0,49),'400000'].join(' ');const dup=sandbox.bpResolvePlan(plan([{num:'400000',field:'ticket',qty:1,stake:80}]),{...full,prize4:duplicatePool});check('duplicate pool may report confirmed win but not settled net',dup.rows[0].hit===true&&dup.status==='unverifiable'&&dup.net===null);
const zero=sandbox.bpResolvePlan(plan([{num:'333310',field:'ticket',qty:0,stake:0}]),full);check('zero quantity creates no purchased hit',zero.rows[0].hit===false&&zero.rows[0].returned===0);
const malformedQtyValues=[null,undefined,'',' ','bad',1.5];
for(const qty of malformedQtyValues){
 const malformedQtyPlan=plan([{num:'123456',field:'ticket',qty,stake:0}]);
 const malformedQtyResult=sandbox.bpResolvePlan(malformedQtyPlan,full);
 check('malformed ticket quantity is unverifiable, not a verified no-purchase',malformedQtyResult.status==='unverifiable'&&malformedQtyResult.net===null&&malformedQtyResult.rows[0].hit===null);
}
const numericStringQty=sandbox.bpResolvePlan(plan([{num:'123456',field:'ticket',qty:'1',stake:80}]),full);
const numericQty=sandbox.bpResolvePlan(plan([{num:'123456',field:'ticket',qty:1,stake:80}]),full);
check('integer numeric-string quantity resolves identically to integer quantity',numericStringQty.status===numericQty.status&&numericStringQty.rows[0].hit===numericQty.rows[0].hit&&numericStringQty.rows[0].returned===numericQty.rows[0].returned&&numericStringQty.spent===numericQty.spent&&numericStringQty.net===numericQty.net);
const negativeQtyNoPurchase=sandbox.bpResolvePlan(plan([{num:'123456',field:'ticket',qty:-1,stake:0}]),full);
check('explicit negative quantity still normalizes to zero no-purchase',negativeQtyNoPurchase.status==='resolved'&&negativeQtyNoPurchase.rows[0].hit===false&&negativeQtyNoPurchase.net===0);
let blob='[]';sandbox.localStorage={getItem:()=>blob,setItem:(k,v)=>{blob=v;}};for(let i=0;i<201;i++)sandbox.bpHistoryAdd({id:`p${i}`});const hist=JSON.parse(blob);check('history retains 201st entry and oldest',hist.length===201&&hist.some(x=>x.id==='p0'));
const messages=[];sandbox.toast=(m,t)=>messages.push({m,t});sandbox.localStorage={getItem:()=>null,setItem:()=>{throw Error('quota');}};vm.runInContext('_bpMixIntent=true;_bpMixIntentPending=true;',sandbox);let thrown=false;try{sandbox.bpSetBudget(500);sandbox.bpFromMix();}catch{thrown=true;}check('preference storage errors do not escape',!thrown);check('failed Mix preference write clears pending intent',!sandbox._bpMixIntentPending);check('failed Mix preference write clears active intent',!sandbox._bpMixIntent);check('preference failure reported',messages.some(x=>x.t==='error'));
let saveMsgs=[];sandbox.toast=(m,t)=>saveMsgs.push({m,t});vm.runInContext(`_bpWorkingPlan={mode:'perNumber',date:'2026-07-16',budget:20,risk:'mid',config:{pay2:95,pay3:950},rows:[{num:'15',field:'bottom2',stake:20}],ev:{theoretical:{},adjusted:{},warning:false},totalStake:20}`,sandbox);try{sandbox.bpSaveCurrentPlan();}catch{thrown=true;}check('failed save shows only error, no success',saveMsgs.some(x=>x.t==='error')&&!saveMsgs.some(x=>x.t==='success'));
const missingStakePlans=[null,'',' '].map(stake=>plan([{num:'123456',field:'ticket',qty:0,stake}]));
for(const missingStakePlan of missingStakePlans){
 const missingStakeResult=sandbox.bpResolvePlan(missingStakePlan,full);
 check('zero quantity with absent or blank saved stake is unverifiable',missingStakeResult.status==='unverifiable'&&missingStakeResult.net===null&&missingStakeResult.rows[0].hit===null);
}
const negativeQtyPlan={mode:'ticket',date:'2026-07-16',budget:0,config:{ticketPrice:80},rows:[{num:'123456',field:'ticket',qty:-1,stake:80}]};
check('negative legacy ticket quantity is normalized in ticket EV count',sandbox.bpComputeTicketEv(negativeQtyPlan.rows,negativeQtyPlan.config).tickets===0);
const negativeQtyResolved=sandbox.bpResolvePlan(negativeQtyPlan,full);
check('quantity/stake mismatch cannot claim resolved P/L',negativeQtyResolved.status==='unverifiable'&&negativeQtyResolved.net===null&&negativeQtyResolved.rows[0].hit===null);
const negativeQtyLedger=sandbox.bpLedger([negativeQtyPlan],[full]);
check('quantity/stake mismatch is excluded from realized and theoretical totals',negativeQtyLedger.unverifiable===1&&negativeQtyLedger.resolved===0&&negativeQtyLedger.randomExpectedNet===0&&negativeQtyLedger.spent===0&&negativeQtyLedger.returned===0);
const positiveQtyMismatch={mode:'ticket',date:'2026-07-16',budget:0,config:{ticketPrice:80},rows:[{num:'123456',field:'ticket',qty:1,stake:0}]};
const positiveQtyMismatchResult=sandbox.bpResolvePlan(positiveQtyMismatch,full);
check('positive quantity with mismatched saved stake is unverifiable',positiveQtyMismatchResult.status==='unverifiable'&&positiveQtyMismatchResult.net===null&&positiveQtyMismatchResult.rows[0].hit===null);
const positiveQtyMismatchLedger=sandbox.bpLedger([positiveQtyMismatch],[full]);
check('positive qty/stake mismatch is excluded from ledger totals',positiveQtyMismatchLedger.unverifiable===1&&positiveQtyMismatchLedger.resolved===0&&positiveQtyMismatchLedger.spent===0&&positiveQtyMismatchLedger.returned===0&&positiveQtyMismatchLedger.randomExpectedNet===0);

const negativeStakePlan={mode:'ticket',date:'2026-07-16',budget:0,config:{ticketPrice:80},rows:[{num:'123456',field:'ticket',qty:0,stake:-80}]};
const negativeStakeResolved=sandbox.bpResolvePlan(negativeStakePlan,full);
check('negative ticket stake cannot be reported as a clean no-purchase outcome',negativeStakeResolved.status==='unverifiable'&&negativeStakeResolved.net===null&&negativeStakeResolved.rows[0].hit===null);
console.log(`PASS: ${passed} checks`);
