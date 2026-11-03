// Buy Plan accessibility contract: concise live announcements and keyboard focus after deletion.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {prepareContext}=require('./frontend_source');

const ROOT=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'static/index.html'),'utf8');
const buyplan=fs.readFileSync(path.join(ROOT,'static/buyplan-ui.js'),'utf8');
const statusTag=html.match(/<div id="bp-status"[^>]*>/)?.[0]||'';
const planTag=html.match(/<div id="bp-plan-root"[^>]*>/)?.[0]||'';
const unsavedHtml=sandboxUnsavedDraftHtml();
assert.match(statusTag,/role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
assert.doesNotMatch(planTag,/aria-live=/);
assert.match(unsavedHtml,/class="bp-unsaved-draft"/);
assert.doesNotMatch(unsavedHtml,/role="status"|aria-live=/,'draft guidance with a button is not a live region');
assert.match(unsavedHtml,/onclick="bpRebuildCurrentPlan\(\)"/,'the explicit rebuild action remains available');
assert.match(buyplan,/id="bp-row-delete-\$\{i\}"/);
assert.match(buyplan,/id="bp-history-delete-\$\{idx\}"/);

function sandboxUnsavedDraftHtml(){
  const start=buyplan.indexOf('function bpUnsavedDraftHtml(');
  const end=buyplan.indexOf('\nfunction bpRebuildCurrentPlan(',start);
  assert.ok(start>=0&&end>start,'unsaved draft renderer is available');
  const probe={LotteryUiState:{buyplan:{workingPlan:{rows:[]}}},bpHistory:()=>[],bpHasUnsavedDraft:()=>true,escHtml:value=>String(value??'')};
  vm.runInNewContext(buyplan.slice(start,end),probe);
  return probe.bpUnsavedDraftHtml({rows:[]},[],true);
}

const dom=Object.create(null),focused=[];
const toggleControl=dataset=>{const classes=new Set();return {dataset,attrs:{},classes,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},setAttribute(name,value){this.attrs[name]=String(value);}};};
const modeControls=[toggleControl({mode:'perNumber'}),toggleControl({mode:'ticket'})];
const riskControls=[toggleControl({risk:'safe'}),toggleControl({risk:'mid'}),toggleControl({risk:'bold'})];
const budgetControls=[toggleControl({amt:'200'}),toggleControl({amt:'500'}),toggleControl({amt:'1000'})];
const document={
  getElementById(id){
    if(dom[id])return dom[id];
    if(id.startsWith('bp-row-delete-')||id==='bp-add-num'||id==='bp-add-ticket-num'){
      dom[id]={id,focus(){focused.push(id);}};
      return dom[id];
    }
    if(id.startsWith('bp-history-delete-')||id==='bp-history-heading'){
      dom[id]={id,focus(){focused.push(id);}};
      return dom[id];
    }
    return null;
  },
  querySelector:()=>null,
  querySelectorAll(selector){return ({'.bp-mode-btn':modeControls,'.bp-risk-btn':riskControls,'.bp-budget-quick':budgetControls})[selector]||[];},
  createElement:()=>({}),
  addEventListener:()=>{},
};
const sandbox={console,document,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}};
sandbox.window=sandbox;
sandbox.escHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
sandbox.fmtDate=value=>String(value);
prepareContext(sandbox);
vm.runInContext(buyplan,sandbox);
sandbox.bpRecomputeWorking=()=>{};
sandbox.bpPaint=()=>{};
sandbox.dcTrustBadge=()=>'';
sandbox.bpRowExplainHtml=()=>'';
sandbox.bpEdgeSignalNoteHtml=()=>'';
sandbox.bpStrengthWord=()=>({word:'',cls:''});
sandbox.deleteWithUndo=(_key,_message,mutate,render)=>{
  if(mutate()===false)return false;
  if(typeof render==='function')render();
  return true;
};

const renderedTicket=sandbox.bpEditableTicketHtml({mode:'ticket',rows:[{num:'012345',ladder:['012345','345','45'],sources:[],qty:1,stake:80}],config:{ticketPrice:80},ticketCount:1,totalStake:80,budget:80,risk:'mid'});
assert.match(renderedTicket,/aria-label="ลบลอตเตอรี่เลข 012345"/,'ticket removal identifies its six-digit number');
const renderedNumbers=sandbox.bpEditablePlanHtml({mode:'perNumber',rows:[{num:'15',tier:'2d',field:'bottom2',stake:20,sources:[]}],config:{roundUnit:10,minStake:20},totalStake:20,budget:20,risk:'mid'});
assert.match(renderedNumbers,/aria-label="ลบเลข 15 หมวด 2 ตัวล่าง"/,'number removal identifies its number and bet category');

dom['bp-budget-input']={value:'500'};
sandbox.bpSyncControls({mode:'ticket',risk:'bold',budget:1000},true);
assert.deepEqual(modeControls.map(button=>button.attrs['aria-pressed']),['false','true'],'purchase mode exposes the current selection');
assert.deepEqual(riskControls.map(button=>button.attrs['aria-pressed']),['false','false','true'],'risk preset exposes the current selection');
assert.deepEqual(budgetControls.map(button=>button.attrs['aria-pressed']),['false','false','true'],'quick budget exposes the current selection');
assert.equal(dom['bp-budget-input'].value,'','a quick budget clears the custom budget field');

dom['bp-status']={textContent:''};
sandbox.LotteryUiState.buyplan.workingPlan={mode:'perNumber',rows:[{},{}],totalStake:150,budget:200};
sandbox.bpAnnouncePlanSummary();
assert.match(dom['bp-status'].textContent,/2 รายการ/);
assert.match(dom['bp-status'].textContent,/150/);
assert.match(dom['bp-status'].textContent,/200/);
sandbox.LotteryUiState.buyplan.workingPlan={mode:'ticket',rows:[{qty:2},{qty:1}],totalStake:240,budget:400};
sandbox.bpAnnouncePlanSummary();
assert.match(dom['bp-status'].textContent,/2 เลข 3 ใบ/);
assert.match(dom['bp-status'].textContent,/240/);

const state=sandbox.LotteryUiState.buyplan;
state.workingPlan={mode:'perNumber',rows:[{},{},{}]};
sandbox.bpDeleteRow(1);
assert.equal(state.workingPlan.rows.length,2);
assert.equal(focused.at(-1),'bp-row-delete-1');
sandbox.bpDeleteRow(1);
assert.equal(state.workingPlan.rows.length,1);
assert.equal(focused.at(-1),'bp-row-delete-0');
sandbox.bpDeleteRow(0);
assert.equal(state.workingPlan.rows.length,0);
assert.equal(focused.at(-1),'bp-add-num');

state.workingPlan={mode:'ticket',rows:[{}]};
sandbox.bpDeleteRow(0);
assert.equal(focused.at(-1),'bp-add-ticket-num');

let savedPlans=[{id:'one'},{id:'two'},{id:'three'}];
sandbox.bpHistory=()=>savedPlans;
sandbox.bpHistoryDelete=id=>{
  savedPlans=savedPlans.filter(plan=>plan.id!==id);
  return true;
};
sandbox.bpDeletePlan('two');
assert.deepEqual(savedPlans.map(plan=>plan.id),['one','three']);
assert.equal(focused.at(-1),'bp-history-delete-1');
sandbox.bpDeletePlan('three');
assert.deepEqual(savedPlans.map(plan=>plan.id),['one']);
assert.equal(focused.at(-1),'bp-history-delete-0');
sandbox.bpDeletePlan('one');
assert.equal(savedPlans.length,0);
assert.equal(focused.at(-1),'bp-history-heading');

const hostileId=`id' onclick='alert(1)`;
const renderedHistory=sandbox.bpHistoryLedgerHtml([{id:hostileId,date:'2026-10-16',rows:[{num:'012345',field:'ticket',qty:1,stake:80}],mode:'ticket',budget:80,risk:'mid',config:{ticketPrice:80}}]);
assert.ok(renderedHistory.includes(`data-bp-plan-id="${sandbox.escHtml(hostileId)}"`));
assert.ok(renderedHistory.includes('onclick="bpDeletePlan(this.dataset.bpPlanId)"'));
assert.ok(!renderedHistory.includes(`onclick="bpDeletePlan('${hostileId}`));
assert.ok(renderedHistory.includes('aria-label="ลบชุดซื้อวันที่ 2026-10-16 จำนวน 1 เลข"'),'saved-plan removal identifies its draw and number count');

console.log('PASS: Buy Plan announcement and deletion-focus contract');
