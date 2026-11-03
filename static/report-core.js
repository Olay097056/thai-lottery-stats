// Shared data status and report lineage. These functions never calculate predictions.
async function loadDataStatus(){
  const host=document.getElementById('shared-data-details');
  if(!host)return;
  const requestId=++LotteryUiState.health.requestId;
  const summary=document.getElementById('shared-data-summary');
  const button=document.getElementById('shared-data-read');
  if(button)button.disabled=true;
  summary.textContent='กำลังตรวจสถานะข้อมูลเดิมในเครื่อง…';
  host.setAttribute('aria-busy','true');
  try{
    const report=await api('data-status',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(requestId!==LotteryUiState.health.requestId)return;
    if(report?.error||!Array.isArray(report?.categories)){
      LotteryServerData.health.report=null;
      summary.textContent=report?.error||'อ่านสถานะข้อมูลไม่สำเร็จ กดตรวจอีกครั้งได้';
      host.innerHTML='<p>ยังยืนยันงวดล่าสุดและความครบของข้อมูลไม่ได้</p>';
      return;
    }
    LotteryServerData.health.report=report;
    const complete=report.categories.filter(category=>category.latest_draw_complete).length;
    summary.textContent=`ข้อมูลถึง ${report.latest_draw_date||'ยังไม่มีงวดที่ใช้ได้'} · งวดล่าสุดครบ ${complete}/${report.categories.length} หมวด${report.stale?' · ข้อมูลเก่ากว่า 35 วัน':''}`;
    host.innerHTML=`<p>อ่านสถานะเมื่อ ${escHtml(report.checked_at)} · ${escHtml(report.valid_dated_draws)} งวดที่วันที่ใช้ได้ · ข้ามแถววันที่ผิด/ซ้ำ/อนาคต ${escHtml(report.rejected_date_rows)} แถว</p>
      <div class="data-health-grid">${report.categories.map(category=>`<div class="data-health-category"><strong>${escHtml(category.label)}</strong><span class="data-health-state ${category.latest_draw_complete?'complete':'incomplete'}">${category.latest_draw_complete?'งวดล่าสุดครบ':'งวดล่าสุดไม่ครบ'}</span><span>ใช้ได้ ${escHtml(category.valid_draws)} งวด · ขาดหรือผิดรูปแบบ ${escHtml(category.unavailable_draws)} งวด</span><span>ข้อมูลหมวดนี้ถึง ${escHtml(category.latest_valid_date||'ยังไม่มีข้อมูล')}</span></div>`).join('')}</div>`;
    return report;
  }catch(error){
    if(requestId!==LotteryUiState.health.requestId)return null;
    LotteryServerData.health.report=null;
    summary.textContent='อ่านสถานะข้อมูลไม่สำเร็จ กดตรวจอีกครั้งได้';
    host.innerHTML='<p>ยังยืนยันงวดล่าสุดและความครบของข้อมูลไม่ได้</p>';
    return null;
  }finally{
    if(requestId===LotteryUiState.health.requestId){host.setAttribute('aria-busy','false');if(button)button.disabled=false;}
  }
}
function showCacheRefreshNotice(id,targetId,title,message,actionLabel,onAction){
  const target=document.getElementById(targetId);
  if(!target)return null;
  document.getElementById(id)?.remove();
  const section=document.createElement('section');
  section.id=id;
  section.className='feature-state data-refresh-notice';
  section.setAttribute('role','status');
  section.setAttribute('aria-live','polite');
  const mark=document.createElement('div');mark.className='feature-state-mark';mark.setAttribute('aria-hidden','true');mark.textContent='!';
  const content=document.createElement('div');
  const heading=document.createElement('h2');heading.textContent=title;
  const copy=document.createElement('p');copy.textContent=message;
  const button=document.createElement('button');button.type='button';button.className='btn btn-primary';button.textContent=actionLabel;
  button.addEventListener('click',onAction);
  content.append(heading,copy,button);section.append(mark,content);target.before(section);
  return section;
}
function clearCacheRefreshNotice(id){document.getElementById(id)?.remove();}
function markLotteryReportsStale({verified=true}={}){
  LotteryUiState.health.dataEpoch=(Number(LotteryUiState.health.dataEpoch)||0)+1;
  const message=verified
    ?'ข้อมูลย้อนหลังอัปเดตแล้ว ผลที่แสดงอยู่คำนวณจากแคชก่อนหน้า'
    :'ยืนยันเวอร์ชันข้อมูลหลังรีเฟรชไม่ได้ ผลที่แสดงอยู่อาจอ้างอิงแคชก่อนหน้า';
  if(typeof markPredictDataStale==='function')markPredictDataStale(message);
  if(typeof markFormulaDataStale==='function')markFormulaDataStale(message);
  if(typeof markMixDataStale==='function')markMixDataStale(message);
  if(typeof markBuyPlanDataStale==='function')markBuyPlanDataStale(message);
  if(typeof AstraFeature!=='undefined'&&typeof AstraFeature.markDataStale==='function')AstraFeature.markDataStale(message);
}
const lotteryRefreshChannel=(()=>{
  if(typeof BroadcastChannel!=='function')return null;
  try{return new BroadcastChannel('lottery-history-cache-v1');}catch{return null;}
})();
function receiveLotteryRefreshSignal(event){
  const message=event?.data;
  if(message?.type!=='cache-refreshed'||typeof message.verified!=='boolean')return;
  markLotteryReportsStale({verified:message.verified});
}
function broadcastLotteryReportsStale({verified=true}={}){
  const message={type:'cache-refreshed',verified:verified===true};
  try{
    if(lotteryRefreshChannel){lotteryRefreshChannel.postMessage(message);return true;}
  }catch{}
  try{
    const signal={...message,id:`${Date.now()}-${Math.random()}`};
    const key='lottery-history-cache-refresh';
    window.localStorage.setItem(key,JSON.stringify(signal));
    try{window.localStorage.removeItem(key);}catch{}
    return true;
  }catch{return false;}
}
if(lotteryRefreshChannel)lotteryRefreshChannel.addEventListener('message',receiveLotteryRefreshSignal);
else if(typeof window.addEventListener==='function')window.addEventListener('storage',event=>{
  if(event.key!=='lottery-history-cache-refresh'||!event.newValue)return;
  try{receiveLotteryRefreshSignal({data:JSON.parse(event.newValue)});}catch{}
});
window.showCacheRefreshNotice=showCacheRefreshNotice;
window.clearCacheRefreshNotice=clearCacheRefreshNotice;
window.markLotteryReportsStale=markLotteryReportsStale;
window.broadcastLotteryReportsStale=broadcastLotteryReportsStale;
function choosePredictionMethod(method){
  const guide=document.querySelector('.prediction-method-guide');
  if(guide)guide.open=false;
  if(method==='mix'){
    const targetDate=document.getElementById('shared-draw-date')?.value||'';
    if(typeof syncMixTargetDate==='function')syncMixTargetDate(targetDate);
    showPage('mix');return;
  }
  if(method==='astra-v1'||method==='astra-sigma'){
    switchFormulaTab('ASTRA');selectAstraVersion(method);switchPredTab('formula');return;
  }
  switchPredTab(method);
}
