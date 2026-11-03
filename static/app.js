// ─── Config ───────────────────────────────────────────────────────────────────
const LOTTERY_TYPES = {
  "รางวัลที่ 1":"prize1","3 ตัวบน":"top3","2 ตัวบน":"top2",
  "3 ตัวหน้า 1":"front3_1","3 ตัวหน้า 2":"front3_2",
  "3 ตัวล่าง 1":"back3_1","3 ตัวล่าง 2":"back3_2","2 ตัวล่าง":"bottom2"
};
const ALL_OPTS = Object.entries(LOTTERY_TYPES).map(([l,v])=>`<option value="${v}">${l}</option>`).join('');
const NO_P1_OPTS = Object.entries(LOTTERY_TYPES).filter(([,v])=>v!=='prize1').map(([l,v])=>`<option value="${v}">${l}</option>`).join('');
const TWO_DIGIT_OPTS = Object.entries(LOTTERY_TYPES).filter(([,v])=>v==='top2'||v==='bottom2').map(([l,v])=>`<option value="${v}">${l}</option>`).join('');
// ตัวเลือกพิเศษสำหรับหน้า Frequency (รางวัลที่ 2-3 จาก Sanook)
const SANOOK_FREQ_OPTS = `<optgroup label="── Sanook (รางวัลพิเศษ) ──"><option value="near1">ข้างเคียงรางวัลที่ 1</option><option value="prize2">รางวัลที่ 2</option><option value="prize3">รางวัลที่ 3</option><option value="prize4">รางวัลที่ 4</option><option value="prize5">รางวัลที่ 5</option></optgroup>`;

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type='', options={}){
  const el = Object.assign(document.createElement('div'), {className:'toast'+(type?' '+type:''), textContent:msg});
  if(options?.announce===false)el.setAttribute('aria-hidden','true');
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}
function showUndoToast(message,onUndo){
  const host=document.getElementById('toast-container');
  if(!host||typeof onUndo!=='function'){toast(message);return;}
  if(LotteryUiState.notifications.timer!==null)clearTimeout(LotteryUiState.notifications.timer);
  LotteryUiState.notifications.node?.remove();
  const el=document.createElement('div');
  el.className='toast toast-undo';
  el.setAttribute('role','status');
  el.setAttribute('aria-live','polite');
  const text=document.createElement('span');
  text.textContent=message;
  const button=document.createElement('button');
  button.type='button';
  button.className='toast-undo-btn';
  button.textContent='เลิกทำ';
  button.setAttribute('aria-label',`เลิกทำ: ${message}`);
  button.addEventListener('click',()=>{
    if(LotteryUiState.notifications.timer!==null)clearTimeout(LotteryUiState.notifications.timer);
    LotteryUiState.notifications.timer=null;
    LotteryUiState.notifications.node=null;
    el.remove();
    onUndo();
    toast('กู้คืนข้อมูลแล้ว','success');
  });
  el.append(text,button);
  host.appendChild(el);
  LotteryUiState.notifications.node=el;
  LotteryUiState.notifications.timer=setTimeout(()=>{
    if(LotteryUiState.notifications.node===el)LotteryUiState.notifications.node=null;
    LotteryUiState.notifications.timer=null;
    el.remove();
  },8000);
}
function deleteWithUndo(key,message,mutate,render){
  const previous=localStorage.getItem(key);
  if(mutate()===false)return false;
  if(typeof render==='function')render();
  showUndoToast(message,()=>{
    if(previous===null)localStorage.removeItem(key);
    else localStorage.setItem(key,previous);
    if(typeof render==='function')render();
  });
  return true;
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function setPageStatus(id,message){
  const status=document.getElementById(id);
  if(status)status.textContent=String(message??'');
}
window.setPageStatus=setPageStatus;
document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click',()=>showPage(item.dataset.page));
});
function switchPredTab(tab,options={}){
  if(tab==='astra')return showAstraFormulaView();
  LotteryUiState.navigation.predictionTab=tab;
  syncPrimaryRunAction(tab);
  ['predict','formula','decision','oldver'].forEach(t=>{
    const panel=document.getElementById('pred-main-tab-'+t);
    if(panel){panel.hidden=t!==tab;panel.style.display=t===tab?'':'none';}
    const button=document.getElementById('pred-main-btn-'+t);
    if(button){button.classList.toggle('active',t===tab);button.setAttribute('aria-pressed',t===tab?'true':'false');}
  });
  syncPredTabLocation(tab);
  if(LotteryUiState.navigation.page==='predict')focusPageHeading('predict',tab,false);
  if(tab==='formula'){
    initFormulaPage(); renderPageSnapshots('formula');
  }
  else if(tab==='decision'){ loadDecisionCenter(); }
  else if(tab==='oldver'){ loadDecisionCenterOld(); }
  else { renderPageSnapshots('predict'); }
  syncAstraRunButton();
}
window.switchPredTab=switchPredTab;

function showPage(p){
  // formula/decision are now tabs inside predict
  if(p==='formula'||p==='decision'){
    const already=LotteryUiState.navigation.page==='predict';
    if(!already) showPage('predict');
    switchPredTab(p);
    focusPageHeading('predict',p);
    return;
  }
  const page=document.getElementById('page-'+p);
  if(!page)return;
  document.querySelectorAll('.nav-item').forEach(n=>{
    const active=n.dataset.page===p;
    n.classList.toggle('active',active);
    if(active)n.setAttribute('aria-current','page');
    else n.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach(pg=>pg.classList.remove('active'));
  page.classList.add('active');
  if(p!==LotteryUiState.navigation.page){LotteryUiState.navigation.page=p;onPageLoad(p);}
  syncPageLocation(p,LotteryUiState.navigation.predictionTab);
  focusPageHeading(p);
}
window.showPage=showPage;

function syncPageLocation(page,tab=LotteryUiState.navigation.predictionTab){
  if(LotteryUiState.navigation.restoringPageLocation)return;
  const hash=page==='predict'&&tab!=='predict'?`#predict/${tab}`:`#${page}`;
  if(window.location.hash===hash)return;
  window.history.pushState({page,tab},'',`${window.location.pathname}${window.location.search}${hash}`);
}
function syncPredTabLocation(tab){
  if(LotteryUiState.navigation.page==='predict')syncPageLocation('predict',tab);
}
function restorePageLocation(){
  LotteryUiState.navigation.restoringPageLocation=true;
  try{
    const [route,tab]=window.location.hash.replace(/^#/,'').split('/');
    const predTabs=['predict','formula','decision','oldver','astra'];
    if(route==='predict'){
      showPage('predict');
      switchPredTab(predTabs.includes(tab)?tab:'predict');
    }else if(predTabs.includes(route)&&route!=='predict'){
      showPage('predict');
      switchPredTab(route);
    }else if(route&&document.getElementById('page-'+route))showPage(route);
    else if(!route)showPage('dashboard');
  }finally{LotteryUiState.navigation.restoringPageLocation=false;}
}
window.addEventListener('popstate',restorePageLocation);

function focusPageHeading(page,tab='',shouldFocus=true){
  const heading=document.querySelector(`#page-${page} .page-title`);
  if(!heading)return;
  const labels={predict:'ทำนาย',formula:'สูตรคำนวณ',decision:'สรุปงวดนี้',oldver:'สรุปงวดนี้ (รุ่นเดิม)'};
  const label=labels[tab]||heading.textContent.trim();
  document.title=`${label} · Thai Lottery Intelligence`;
  if(!shouldFocus)return;
  if(!heading.hasAttribute('tabindex'))heading.setAttribute('tabindex','-1');
  heading.focus();
}

function syncPrimaryRunAction(tab=LotteryUiState.navigation.predictionTab){
  const button=document.getElementById('pred-primary-run');
  if(!button)return;
  const labels={predict:'ทำนายทุกประเภท',formula:'คำนวณสูตร',decision:'คำนวณสรุปงวดนี้',oldver:'คำนวณรุ่นเดิม'};
  button.textContent=labels[tab]||'รันมุมมองนี้';
  // Formula and astra already have local primary actions beside their controls.
  button.hidden=tab==='formula';
}

function updateSidebarScrollControl(){
  const nav=document.getElementById('sidebar-nav');
  const button=document.getElementById('nav-scroll-control');
  if(!nav||!button)return;
  const overflowing=nav.scrollWidth>nav.clientWidth+1;
  button.hidden=window.innerWidth>900||!overflowing;
  if(button.hidden)return;
  const atEnd=nav.scrollLeft+nav.clientWidth>=nav.scrollWidth-1;
  button.textContent=atEnd?'←':'→';
  button.setAttribute('aria-label',atEnd?'เลื่อนเมนูกลับไปทางซ้าย':'เลื่อนเมนูไปทางขวา');
}
function scrollSidebarNav(){
  const nav=document.getElementById('sidebar-nav');
  if(!nav)return;
  const atEnd=nav.scrollLeft+nav.clientWidth>=nav.scrollWidth-1;
  nav.scrollBy({left:(atEnd?-1:1)*Math.max(120,nav.clientWidth*.75),behavior:'smooth'});
}
window.scrollSidebarNav=scrollSidebarNav;
document.getElementById('sidebar-nav')?.addEventListener('scroll',updateSidebarScrollControl,{passive:true});
window.addEventListener('resize',updateSidebarScrollControl);
updateSidebarScrollControl();

function _setSelectValueKeepingOptions(id,value){
  const el=document.getElementById(id);
  if(!el||!value)return;
  const found=[...el.options].some(o=>o.value===value);
  if(!found)el.add(new Option(fmtDate(value),value));
  el.value=value;
}

function syncSharedDrawDate(value,userAction=false){
  if(LotteryUiState.navigation.sharedDateSyncing)return;
  // Invalidate before the userAction/visibility guards, including startup/date resets.
  invalidateAstra(value);
  if(typeof resetReportDrafts==='function')resetReportDrafts();
  if(!value)return;
  LotteryUiState.navigation.sharedDateSyncing=true;
  ['shared-draw-date','pred-date','f-target-date','dc-date','dc-date-old','dash-date'].forEach(id=>_setSelectValueKeepingOptions(id,value));
  if(typeof syncPredictTarget==='function')syncPredictTarget(value);
  else if(typeof syncLuckyNewsTarget==='function')syncLuckyNewsTarget(value);
  if(typeof updateFormulaTargetDisplay==='function')updateFormulaTargetDisplay();
  LotteryUiState.navigation.sharedDateSyncing=false;
  if(!userAction)return;
  if(LotteryUiState.navigation.predictionTab==='formula'&&LotteryUiState.formula.activeTab==='ASTRA'){
    // A changed target may load an existing v1 snapshot, but never infer without Calculate.
    if(LotteryUiState.navigation.page==='predict'&&getSelectedAstraVersion()==='astra-v1')return loadAstra({statusOnly:true});
    return;
  }
  else if(LotteryUiState.navigation.predictionTab==='formula')autoFillFormula(true);
  else if(LotteryUiState.navigation.predictionTab==='decision')loadDecisionCenter();
  else if(LotteryUiState.navigation.predictionTab==='oldver')loadDecisionCenterOld();
}
window.syncSharedDrawDate=syncSharedDrawDate;

function applySharedLotteryFocus(){
  const focus=document.getElementById('shared-lottery-focus')?.value||'';
  const predMap={prize1:'prize1',top3:'top3',front3:'front3',back3:'back3',bottom2:'bottom2'};
  const formulaMap={prize1:'prize1',top3:'3-digit',front3:'front 3',back3:'back 3',bottom2:'bottom'};
  const pg=document.getElementById('predict-group-filter');
  if(pg){pg.value=predMap[focus]??'';filterPredictions();}
  const ft=document.getElementById('formula-target-filter');
  if(ft){ft.value=formulaMap[focus]??'';filterFormulaCards();}
}
window.applySharedLotteryFocus=applySharedLotteryFocus;

function runSharedPrimaryAction(){
  if(LotteryUiState.navigation.predictionTab==='formula'){
    if(LotteryUiState.formula.activeTab==='ASTRA')return runAllFormulas({userInitiated:true});
    autoFillFormula().then(ok=>{if(ok)runAllFormulas();});
  }else if(LotteryUiState.navigation.predictionTab==='decision'){
    loadDecisionCenter();
  }else if(LotteryUiState.navigation.predictionTab==='oldver'){
    loadDecisionCenterOld();
  }else if(LotteryUiState.navigation.predictionTab==='astra'){
    return getSelectedAstraVersion()==='astra-sigma'?loadAstraSigma({recompute:true}):loadAstra({recompute:true});
  }else{
    loadPredict();
  }
}
window.runSharedPrimaryAction=runSharedPrimaryAction;

function onPageLoad(p){
  if(p==='predict'){
    renderPageSnapshots('predict');
  }
  else if(p==='backtest'&&typeof FirstPrizeFeature!=='undefined')FirstPrizeFeature.board('page-astra-prospective-board');
    else if(p==='frequency') loadFreq();
  else if(p==='history') loadHistory();
  else if(p==='mix') loadMixPage();
  else if(p==='buyplan'){ bpConsumeMixIntent(); bpFillConfigInputs(); loadBuyPlan(); }
}
