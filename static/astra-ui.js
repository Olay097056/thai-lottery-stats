var AstraFeature = (() => {
// ─── astra: isolated next-draw report (never enters historical scoring) ────────
const ui={requestId:0,started:false,autoTarget:"",targetOverride:null,selectedVersion:"astra-v1",sigmaRequestId:0,sigmaStarted:false};

function astraTargetDate(){
  const shared=document.getElementById('shared-draw-date')?.value||'';
  return ui.targetOverride?.shared===shared?ui.targetOverride.date:shared;
}
function _astraThailandToday(){
  return new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10);
}
function _astraNextFutureDrawDate(today=_astraThailandToday(),preferred=''){
  if(_astraIsDate(preferred)&&preferred>today)return preferred;
  const days=Array.from({length:46},(_,i)=>new Date(Date.parse(today+'T00:00:00Z')+(i+1)*86400000));
  const next=days.find(day=>day.getUTCDate()===1||day.getUTCDate()===16);
  return next?next.toISOString().slice(0,10):'';
}
function _astraEnsureFutureTarget(){
  const shared=document.getElementById('shared-draw-date')?.value||'';
  const target=astraTargetDate(),today=_astraThailandToday();
  if(!_astraIsDate(target))return target;
  if(_astraIsDate(target)&&target>today)return target;
  const next=_astraNextFutureDrawDate(today,ui.autoTarget);
  if(next)ui.targetOverride={date:next,shared,reason:'next-future'};
  return next||target;
}
function _astraTargetSource(date){
  const shared=document.getElementById('shared-draw-date')?.value||'';
  if(ui.targetOverride?.shared===shared&&ui.targetOverride.date===date){
    return ui.targetOverride.reason==='next-future'
      ?`งวดหลักไม่ใช่วันอนาคตสำหรับ Astra · ใช้ ${date} เฉพาะ Astra`
      :'เลือกจากปฏิทินอัตโนมัติเฉพาะ Astra';
  }
  return 'ใช้ตามงวดหลัก';
}
function showAstraAutomaticTarget(){
  if(!_astraIsDate(ui.autoTarget))return;
  ui.targetOverride={date:ui.autoTarget,shared:document.getElementById('shared-draw-date')?.value||'',reason:'automation'};
  return loadAstra({statusOnly:true});
}
function setAstraAutomaticTarget(date=''){
  ui.autoTarget=date;
  const button=document.getElementById('astra-auto-target');
  if(button){
    button.hidden=!date||date===astraTargetDate();
    button.textContent=date?'ดูงวดอัตโนมัติ '+date:'ดูงวดอัตโนมัติ';
  }
}
const ASTRA_CATEGORIES=[
  ['prize1','รางวัลที่ 1',6,5],['front3','เลขหน้า 3 ตัว',3,2],
  ['back3','เลขท้าย 3 ตัวทางการ',3,2],['bottom2','เลขท้าย 2 ตัว',2,1],
  ['prize2','รางวัลที่ 2',6,5],['prize3','รางวัลที่ 3',6,5],['prize4','รางวัลที่ 4',6,5]
];
const ASTRA_SETTINGS={max_draws:null,min_valid_draws:20,half_life_draws:24,weight_floor:0.5,
  positional_prior:1,pair_backoff_strength:10,positional_log_weight:0.5,conditional_log_weight:0.5,stale_days:35};
function _astraHasKeys(value,keys){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
}
function _astraIsDate(value){
  if(typeof value!=='string'||value.length!==10||!/[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(value)||value.startsWith('0000'))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function _astraGenerationDay(value){
  if(typeof value!=='string')return '';
  const parts=/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,6})?(Z|[+-]([0-9]{2}):([0-9]{2}))$/.exec(value);
  if(!parts||parts[0]!==value||!_astraIsDate(parts[1])||Number(parts[2])>23||Number(parts[3])>59||Number(parts[4])>59||Number(parts[6]||0)>23||Number(parts[7]||0)>59)return '';
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp)?new Date(timestamp+7*60*60*1000).toISOString().slice(0,10):'';
}
function validateAstraReport(report,target,allowLegacyWindow=false){
  if(!_astraHasKeys(report,['schema_version','formula','version','trust','target_date','generated_at',
    'training_cutoff_date','source','window_draws','settings','warnings','categories']))return false;
  if(report.schema_version!==1||report.formula!=='astra'||report.version!=='astra-v1'||report.trust!=='ทดลอง'||
    !['existing_local_cache','supplied_history'].includes(report.source)||!_astraIsDate(target)||report.target_date!==target)return false;
  const generationDay=_astraGenerationDay(report.generated_at);
  if(!generationDay||target<=generationDay)return false;
  if(!Number.isSafeInteger(report.window_draws)||report.window_draws<0)return false;
  const cutoff=report.training_cutoff_date;
  if(report.window_draws===0?cutoff!==null:(!_astraIsDate(cutoff)||cutoff>=target||cutoff>generationDay))return false;
  if(!_astraHasKeys(report.settings,Object.keys(ASTRA_SETTINGS)))return false;
  const isCurrentSettings=Object.entries(ASTRA_SETTINGS).every(([key,value])=>report.settings[key]===value);
  const isLegacySettings=allowLegacyWindow&&report.settings.max_draws===200&&
    Object.entries(ASTRA_SETTINGS).every(([key,value])=>key==='max_draws'||report.settings[key]===value);
  if((!isCurrentSettings&&!isLegacySettings)||
    (report.settings.max_draws!==null&&report.window_draws>report.settings.max_draws))return false;
  if(!Array.isArray(report.warnings)||!Array.from(report.warnings).every(w=>typeof w==='string'&&w.trim().length>0))return false;
  if(!_astraHasKeys(report.categories,ASTRA_CATEGORIES.map(([key])=>key)))return false;
  return ASTRA_CATEGORIES.every(([key,label,digits,requested])=>{
    const category=report.categories[key];
    if(!_astraHasKeys(category,['label','digits','requested_count','status','valid_draws','invalid_draws','training_cutoff_date','numbers'])||
      category.label!==label||category.digits!==digits||category.requested_count!==requested)return false;
    if(!Number.isInteger(category.valid_draws)||category.valid_draws<0||!Number.isInteger(category.invalid_draws)||category.invalid_draws<0||
      category.valid_draws+category.invalid_draws!==report.window_draws)return false;
    if(category.valid_draws===0?category.training_cutoff_date!==null:
      (!_astraIsDate(category.training_cutoff_date)||category.training_cutoff_date>cutoff))return false;
    const sufficient=category.valid_draws>=ASTRA_SETTINGS.min_valid_draws;
    if(category.status!==(sufficient?'ok':'insufficient_data')||!Array.isArray(category.numbers)||category.numbers.length!==(sufficient?requested:0))return false;
    const seen=new Set();
    for(let i=0;i<category.numbers.length;i++){
      const row=category.numbers[i],previous=category.numbers[i-1];
      if(!_astraHasKeys(row,['number','rank','log_score'])||typeof row.number!=='string'||row.number.length!==digits||
        !/^[0-9]+$/.test(row.number)||row.rank!==i+1||!Number.isFinite(row.log_score)||seen.has(row.number))return false;
      if(previous&&(row.log_score>previous.log_score||(row.log_score===previous.log_score&&row.number<previous.number)))return false;
      seen.add(row.number);
    }
    return true;
  });
}
const ASTRA_AUTO_PHASES={idle:'รอเริ่มตรวจ',checking:'กำลังตรวจผลใหม่',waiting:'รอรอบตรวจถัดไป',
  saved:'บันทึกรายงานแล้ว',waiting_results:'รอผลรางวัลครบ',waiting_calendar:'รอปฏิทินงวด',
  catching_up:'กำลังรับงวดใหม่ที่ค้าง',error:'ตรวจหรือบันทึกไม่สำเร็จ',disabled:'ปิดระบบอัตโนมัติ',stopped:'ตัวทำงานหยุดแล้ว'};
const ASTRA_AUTO_ERRORS={cache_missing:'ไม่พบแคชผลรางวัล',cache_invalid:'แคชผลรางวัลไม่ถูกต้อง',
  cache_changed:'แคชเปลี่ยนระหว่างตรวจ',storage_unavailable:'พื้นที่บันทึกใช้งานไม่ได้',storage_invalid:'ข้อมูลบันทึกไม่ถูกต้อง',
  source_unavailable:'ติดต่อแหล่งผลไม่ได้',source_invalid:'ข้อมูลจากแหล่งผลไม่ถูกต้อง',results_pending:'รอผลรางวัลครบ',
  calendar_invalid:'ปฏิทินงวดไม่ถูกต้อง',calendar_unavailable:'ยังอ่านปฏิทินงวดไม่ได้',inference_failed:'คำนวณไม่สำเร็จ',internal_error:'ระบบอัตโนมัติขัดข้อง'};
function validateAstraSnapshot(snapshot,target){
  if(!_astraHasKeys(snapshot,['formula_version','source_draw_date','target_date','captured_at',
    'cache_sha256','engine_sha256','source','calendar_source','report']))return false;
  if(snapshot.formula_version!=='astra-v1'||snapshot.target_date!==target||!_astraIsDate(snapshot.source_draw_date)||
    snapshot.source!=='sanook'||snapshot.calendar_source!=='glo')return false;
  if(!['cache_sha256','engine_sha256'].every(key=>typeof snapshot[key]==='string'&&snapshot[key].length===64&&/^[0-9a-f]+$/.test(snapshot[key])))return false;
  const report=snapshot.report;
  return validateAstraReport(report,target,true)&&report.source==='existing_local_cache'&&report.version===snapshot.formula_version&&
    report.generated_at===snapshot.captured_at&&report.training_cutoff_date===snapshot.source_draw_date;
}
function validateAstraAutomation(state,target){
  if(!_astraHasKeys(state,['enabled','running','phase','poll_interval_seconds','last_check_at','next_check_at',
    'last_success_at','latest_source_date','target_date','snapshot_count','error','snapshot']))return false;
  if(typeof state.enabled!=='boolean'||typeof state.running!=='boolean'||typeof state.phase!=='string'||
    !Object.prototype.hasOwnProperty.call(ASTRA_AUTO_PHASES,state.phase)||state.poll_interval_seconds!==900||
    !Number.isSafeInteger(state.snapshot_count)||state.snapshot_count<0)return false;
  if(state.error!==null&&(typeof state.error!=='string'||!Object.prototype.hasOwnProperty.call(ASTRA_AUTO_ERRORS,state.error)))return false;
  if(!['last_check_at','next_check_at','last_success_at'].every(key=>state[key]===null||_astraIsDate(_astraGenerationDay(state[key]))))return false;
  if(!['latest_source_date','target_date'].every(key=>state[key]===null||_astraIsDate(state[key])))return false;
  // Status dates describe the worker, while the saved report must match the selected target.
  return state.snapshot===null||(state.snapshot_count>0&&validateAstraSnapshot(state.snapshot,target));
}
const ASTRA_API_ERROR_COPY=Object.freeze({
  'date must use canonical YYYY-MM-DD':'วันที่งวดของระบบ Astra ไม่อยู่ในรูปแบบ YYYY-MM-DD',
  'astra requires a canonical future Thailand date and valid dated history':'เลือกงวดอนาคตที่ถูกต้อง และตรวจว่าประวัติผลรางวัลมีวันที่ครบถ้วน',
  'astra local cache is missing or unreadable; no refresh was attempted':'อ่านแคชผลรางวัลของ Astra ไม่ได้ · ตรวจแคชแล้วลองคำนวณอีกครั้ง',
  'Astra-Σ requires a canonical future Thailand date and valid dated history':'เลือกงวดอนาคตที่ถูกต้อง และตรวจว่าประวัติผลรางวัลมีวันที่ครบถ้วน',
  'Astra-Σ local cache is missing or unreadable; no refresh was attempted':'อ่านแคชผลรางวัลของ Astra-Σ ไม่ได้ · ตรวจแคชแล้วลองคำนวณอีกครั้ง',
});
function astraApiFailureMessage(response,fallback='คำนวณ Astra ไม่สำเร็จ'){
  const detail=typeof response?.detail==='string'?response.detail:'';
  let message=Object.prototype.hasOwnProperty.call(ASTRA_API_ERROR_COPY,detail)
    ?ASTRA_API_ERROR_COPY[detail]
    :response?.error_code==='network_or_response_failed'
      ?'เชื่อมต่อ server หรืออ่านคำตอบไม่ได้'
      :response?.http_status>=500
        ?'server คำนวณไม่สำเร็จ'
        :fallback;
  if(response?.retryable===true)message+=' · สามารถลองใหม่ได้';
  return message;
}
function isAstraApiFailure(response){
  return !!response&&typeof response==='object'&&(response.ok===false||Number.isInteger(response.http_status)||typeof response.error_code==='string');
}
function setAstraAutomationState(state,message){
  setAstraAutomaticTarget();
  const status=document.getElementById('astra-auto-status');
  if(status){status.dataset.state=state;status.textContent=message;}
  const meta=document.getElementById('astra-auto-meta');
  if(meta)meta.innerHTML='';
}
function renderAstraAutomation(state){
  setAstraAutomaticTarget(state.target_date||'');
  const status=document.getElementById('astra-auto-status');
  if(status){
    status.dataset.state=state.error?'error':state.phase;
    status.textContent=`${state.enabled?'ตั้งค่าเปิดใช้งาน':'ปิดใช้งาน'} · ${state.running?'ตัวทำงานกำลังทำงาน':'ตัวทำงานหยุด'} · ${ASTRA_AUTO_PHASES[state.phase]}`+
      (state.error?` · ${ASTRA_AUTO_ERRORS[state.error]} (${state.error})`:'');
  }
  const meta=document.getElementById('astra-auto-meta');
  if(meta)meta.innerHTML='<dl>'+[
    ['ตรวจล่าสุด',state.last_check_at??'ยังไม่เคยตรวจ'],['ตรวจครั้งถัดไป',state.next_check_at??'ยังไม่กำหนด'],
    ['สำเร็จล่าสุด',state.last_success_at??'ยังไม่เคยสำเร็จ'],['ช่วงตรวจ (วินาที)',state.poll_interval_seconds],
    ['งวดต้นทางล่าสุดของระบบ',state.latest_source_date??'ยังไม่มีข้อมูล'],['งวดเป้าหมายของระบบ',state.target_date??'ยังไม่กำหนด'],
    ['จำนวนรายงานบันทึกทั้งหมด',state.snapshot_count]
  ].map(([label,value])=>`<div><dt>${escHtml(label)}</dt><dd>${escHtml(value)}</dd></div>`).join('')+'</dl>';
}
function setAstraState(state,date,message){
  const targetLabel=document.getElementById('astra-target-label');
  const isOverride=ui.targetOverride?.shared===(document.getElementById('shared-draw-date')?.value||'')&&ui.targetOverride?.date===date;
  if(targetLabel)targetLabel.textContent=`งวด astra: ${date||'ยังไม่เลือก'} · ${_astraTargetSource(date)}`+
    (isOverride?'; เปลี่ยนงวดหลักเพื่อกลับไปใช้ร่วมกัน':'');
  const results=document.getElementById('astra-results');
  if(results){results.dataset.state=state;results.setAttribute('aria-busy',String(state==='loading'));}
  syncAstraRunButton();
  const status=document.getElementById('astra-status');
  if(status){status.dataset.state=state;status.textContent=message;}
  const meta=document.getElementById('astra-meta');
  if(meta)meta.innerHTML=`สูตร astra-v1 · ทดลอง · งวดเป้าหมาย ${escHtml(date||'ยังไม่เลือก')} · วันสร้างรายงาน / ข้อมูลล่าสุด: ยังไม่มีรายงาน`;
  const warnings=document.getElementById('astra-warnings');
  if(warnings){warnings.hidden=true;warnings.innerHTML='';}
  ASTRA_CATEGORIES.forEach(([key,,digits,requested])=>{
    const body=document.getElementById('astra-body-'+key);
    if(body)body.innerHTML=`<p>${digits} หลัก · ขอ ${requested} เลข · ${escHtml(message)}</p><p>งวดใช้ได้ — · ใช้ไม่ได้ —</p><p>ข้อมูลล่าสุดหมวดนี้: ยังไม่มีรายงาน</p>`;
  });
}
function renderAstraReport(report,snapshot=null){
  const meta=document.getElementById('astra-meta');
  if(meta)meta.innerHTML='<dl>'+[
    ['สูตร / เวอร์ชัน / สถานะ',`${report.formula} / ${report.version} / ${report.trust}`],
    ['งวดเป้าหมาย',report.target_date],['สร้างรายงานเมื่อ',report.generated_at],
    ['ขอบเขตข้อมูล',report.settings.max_draws===200?'รายงานเดิม · ไม่เกิน 200 งวดก่อนงวดเป้าหมาย':
      report.source==='existing_local_cache'?'ทุกงวดในแคชก่อนงวดเป้าหมาย':'ทุกงวดที่ได้รับก่อนงวดเป้าหมาย'],
    ['ข้อมูลล่าสุดรวม',report.training_cutoff_date??'ไม่มีข้อมูล'],['งวดที่ใช้',report.window_draws],
    ['แหล่งข้อมูล',report.source==='existing_local_cache'?'แคชในเครื่อง (อ่านอย่างเดียว) / existing_local_cache':'ข้อมูลทดสอบ / supplied_history'],
    ...(snapshot?[
      ['ที่มาของรายงาน','บันทึกถาวรอัตโนมัติ · ไม่เขียนทับ'],['บันทึกเมื่อ',snapshot.captured_at],
      ['งวดต้นทาง',snapshot.source_draw_date],['แหล่งผล / ปฏิทิน',`${snapshot.source} / ${snapshot.calendar_source}`],
      ['SHA-256 แคช',snapshot.cache_sha256],['SHA-256 สูตร',snapshot.engine_sha256]
    ]:[['ที่มาของรายงาน','คำนวณอ่านอย่างเดียว · ยังไม่บันทึก · ไม่แทนรายงานถาวร']])
  ].map(([label,value])=>`<div><dt>${escHtml(label)}</dt><dd>${escHtml(value)}</dd></div>`).join('')+'</dl>';
  const messages=[...new Set(report.warnings)];
  const generationDay=_astraGenerationDay(report.generated_at);
  if(!messages.some(message=>message.includes('35 วัน'))&&report.training_cutoff_date&&Date.parse(generationDay)-Date.parse(report.training_cutoff_date)>ASTRA_SETTINGS.stale_days*86400000){
    messages.push('ข้อมูลล่าสุดเก่ากว่าวันสร้างรายงานเกิน 35 วัน โปรดตรวจวันข้อมูลล่าสุดของแต่ละหมวด');
  }
  const warnings=document.getElementById('astra-warnings');
  if(warnings){
    warnings.hidden=!messages.length;
    warnings.innerHTML=messages.length?`<strong>ข้อจำกัดข้อมูล</strong><ul>${messages.map(w=>`<li>${escHtml(w)}</li>`).join('')}</ul>`:'';
  }
  let count=0,available=0;
  ASTRA_CATEGORIES.forEach(([key,,digits,requested])=>{
    const category=report.categories[key];
    count+=category.numbers.length;
    if(category.status==='ok')available++;
    const body=document.getElementById('astra-body-'+key);
    if(!body)return;
    body.innerHTML=`<p>${digits} หลัก · ขอ ${requested} เลข · ${category.status==='ok'?'ข้อมูลเพียงพอ':'ข้อมูลไม่เพียงพอ (ต้องมีอย่างน้อย 20 งวด)'}</p>
      <p>งวดใช้ได้ ${escHtml(category.valid_draws)} · ใช้ไม่ได้ ${escHtml(category.invalid_draws)}</p>
      <p>ข้อมูลล่าสุดหมวดนี้: ${escHtml(category.training_cutoff_date??'ไม่มีข้อมูล')}</p>`+
      (category.numbers.length?`<ol class="astra-numbers">${category.numbers.map(row=>`<li><span class="astra-rank">อันดับ ${escHtml(row.rank)}</span><span class="astra-number">${escHtml(row.number)}</span><span class="astra-score">คะแนนจัดอันดับ ${escHtml(row.log_score.toFixed(4))}</span></li>`).join('')}</ol>`:'<p>ไม่แสดงเลขทดแทนเมื่อข้อมูลไม่พอ</p>');
  });
  const results=document.getElementById('astra-results');
  if(results){results.dataset.state=count?'ready':'empty';results.setAttribute('aria-busy','false');}
  syncAstraRunButton();
  const status=document.getElementById('astra-status');
  if(status)status.dataset.state=count?'ready':'empty';
  setPageStatus('astra-status',(count?`astra แสดง ${count} เลข · ข้อมูลเพียงพอ ${available}/7 หมวด · ทดลอง`:'astra ไม่มีหมวดที่มีข้อมูลเพียงพอ · ไม่แสดงเลขทดแทน')+(snapshot?' · รายงานบันทึกถาวร':' · คำนวณอ่านอย่างเดียว ยังไม่บันทึก')+(messages.length?' · มีคำเตือนข้อมูล':''));
}
function invalidateAstra(date=document.getElementById('shared-draw-date')?.value||''){
  ++ui.requestId;
  ++ui.sigmaRequestId;
  ui.targetOverride=null;
  setAstraAutomaticTarget();
  // Startup synchronizes shared controls, but must not initialize or fetch astra.
  if(ui.started){
    setAstraState('idle',date,'งวดถูกปรับแล้ว เลือกแท็บเพื่ออ่านรายงาน หรือคำนวณใหม่แบบไม่บันทึก');
    setAstraAutomationState('idle','งวดถูกปรับแล้ว ยังไม่ยืนยันสถานะอัตโนมัติสำหรับงวดที่เลือก');
  }
  if(ui.sigmaStarted)setAstraSigmaState('idle',date,'งวดถูกปรับแล้ว เลือกแท็บเพื่อคำนวณ Astra-Σ ใหม่แบบอ่านอย่างเดียว');
}
function markDataStale(message){
  const v1Results=document.getElementById('astra-results');
  if(ui.started){
    ui.requestId++;
    if(v1Results){v1Results.dataset.state='stale';v1Results.setAttribute('aria-busy','false');}
    const status=document.getElementById('astra-status');
    if(status){status.dataset.state='stale';status.textContent=`${message} · รายงาน Astra v1 ที่แสดงยังเป็นผลเดิม กด “คำนวณ Astra v1” เพื่ออัปเดต`;}
  }
  if(ui.sigmaStarted){
    ui.sigmaRequestId++;
    const results=document.getElementById('astra-sigma-results');
    if(results){results.dataset.state='stale';results.setAttribute('aria-busy','false');}
    const status=document.getElementById('astra-sigma-status');
    if(status){status.dataset.state='stale';status.textContent=`${message} · รายงาน Astra-Σ ที่แสดงยังเป็นผลเดิม กด “คำนวณ Astra-Σ” เพื่ออัปเดต`;}
  }
  syncAstraRunButton();
  if(typeof syncFormulaSnapshotButton==='function')syncFormulaSnapshotButton();
}
async function loadAstra({recompute=false,statusOnly=false}={}){
  const requestId=++ui.requestId;
  ui.started=true;
  let date=recompute?_astraEnsureFutureTarget():astraTargetDate();
  const sharedDate=document.getElementById('shared-draw-date')?.value||'';
  const isCurrent=()=>requestId===ui.requestId&&date===astraTargetDate()&&sharedDate===(document.getElementById('shared-draw-date')?.value||'');
  let checkingAutomation=!recompute;
  setAstraState('loading',date,(checkingAutomation?'กำลังอ่านรายงาน astra สำหรับงวด ':'กำลังคำนวณ astra สำหรับงวด ')+date);
  if(checkingAutomation){
    setAstraAutomationState('loading','กำลังอ่านสถานะและรายงานที่บันทึกสำหรับงวด '+date);
    // A slow status read must not lock out the independent, read-only manual route.
    const run=document.getElementById('f-run-formulas');
    if(run)run.disabled=false;
  }else if(document.getElementById('astra-auto-status')?.dataset.state==='loading'){
    setAstraAutomationState('idle','ยังไม่ยืนยันสถานะอัตโนมัติ · กำลังคำนวณเองแบบไม่บันทึก');
  }
  try{
    if(!_astraIsDate(date))throw new Error('Invalid astra target');
    if(!recompute){
      const state=await api('astra/automation?date='+encodeURIComponent(date),{
        suppressNetworkToast:true,suppressSpinnerAnnouncement:true,requireOk:true
      });
      if(!isCurrent())return;
      if(isAstraApiFailure(state)){
        const message=astraApiFailureMessage(state,'อ่านสถานะอัตโนมัติของ Astra ไม่สำเร็จ');
        setAstraAutomationState('error',message);
        setAstraState('error',date,message);
        return;
      }
      if(!validateAstraAutomation(state,date)){
        setAstraAutomationState('error','server ส่งสถานะอัตโนมัติไม่ครบหรือไม่ตรงรูปแบบ');
        setAstraState('error',date,'อ่านสถานะอัตโนมัติของ Astra ไม่สำเร็จ · server ส่งข้อมูลไม่ครบ');
        return;
      }
      renderAstraAutomation(state);
      checkingAutomation=false;
      if(state?.snapshot){
        renderAstraReport(state.snapshot.report,state.snapshot);
        return;
      }
      if(statusOnly){
        setAstraState('idle',date,'ไม่มีรายงานบันทึกสำหรับงวดนี้ เลือกคำนวณใหม่แบบอ่านอย่างเดียวได้ (ไม่บันทึก)');
        return;
      }
      date=_astraEnsureFutureTarget();
      setAstraState('loading',date,'ไม่มีรายงานบันทึก · กำลังคำนวณ astra แบบไม่บันทึกสำหรับงวด '+date);
    }
    const report=await api('predict/astra?date='+encodeURIComponent(date),{
      suppressNetworkToast:true,suppressSpinnerAnnouncement:true,requireOk:true
    });
    if(!isCurrent())return;
    if(isAstraApiFailure(report)){
      setAstraState('error',date,astraApiFailureMessage(report,'คำนวณ Astra ไม่สำเร็จ'));
      return;
    }
    if(!validateAstraReport(report,date)){
      setAstraState('error',date,'ตรวจรายงาน Astra ไม่สำเร็จ · server ส่งข้อมูลไม่ครบหรือไม่ตรงรูปแบบ จึงไม่แสดงตัวเลข');
      return;
    }
    renderAstraReport(report);
  }catch{
    if(!isCurrent())return;
    if(checkingAutomation)setAstraAutomationState('error','อ่านสถานะอัตโนมัติไม่สำเร็จ จึงไม่ยืนยันสถานะของระบบ');
    setAstraState('error',date,'เกิดข้อผิดพลาดระหว่างอ่านหรือแสดงรายงาน Astra · ไม่มีการแสดงตัวเลขจากคำขอนี้');
  }
}

// Astra-Σ is a separate, read-only experimental view; it never enters astra-v1 automation.

const ASTRA_SIGMA_VERSION='astra-sigma-v0.1';
const ASTRA_SIGMA_WEIGHTS={A:0.50,H:0.10,D:0.10,N:0.12,L:0.08,B:0.10};
const ASTRA_SIGMA_SETTINGS={
  max_draws:null,min_valid_draws:20,signal_window_valid_draws:24,overdue_cap_valid_draws:24,
  hot_definition:'position_digit_fraction; equal weight per draw then slot',
  overdue_definition:'valid category draws since same-position appearance; capped at 24',
  numerology:'digit-sum modulo 9; circular distance on residues 0..8',
  lucky_digits:'fraction of digits equal to 8 or 9',
  balance:'mean of odd-even, low-high (0-4/5-9), and distinct-digit balance',
  tie_break:'descending unrounded score, then ascending digit string',
  weights:ASTRA_SIGMA_WEIGHTS
};
const ASTRA_SIGMA_COMPONENTS=Object.keys(ASTRA_SIGMA_WEIGHTS);
function selectAstraVersion(version){
  if(version!=='astra-v1'&&version!=='astra-sigma')return;
  ui.selectedVersion=version;
  const sigma=version==='astra-sigma';
  const v1=document.getElementById('astra-v1-content');
  const sigmaPanel=document.getElementById('astra-sigma-content');
  const versionSelect=document.getElementById('astra-version-select');
  if(v1){v1.hidden=sigma;v1.style.display=sigma?'none':'';}
  if(sigmaPanel){sigmaPanel.hidden=!sigma;sigmaPanel.style.display=sigma?'':'none';}
  if(versionSelect)versionSelect.value=version;
  syncAstraRunButton();
}
function syncAstraRunButton(){
  const run=document.getElementById('f-run-formulas');
  if(!run)return;
  const isAstra=LotteryUiState.navigation.predictionTab==='formula'&&LotteryUiState.formula.activeTab==='ASTRA';
  run.textContent=isAstra?`⚡ คำนวณ ${ui.selectedVersion==='astra-sigma'?'Astra-Σ':'Astra v1'}`:'⚡ คำนวณทุกสูตร';
  if(!isAstra){run.disabled=!!LotteryUiState.formula.autoFillPending;return;}
  const state=document.getElementById(ui.selectedVersion==='astra-sigma'?'astra-sigma-results':'astra-results')?.dataset.state;
  // Astra reads its own API and does not depend on the legacy formula-history autofill.
  run.disabled=state==='loading';
}
function loadSelectedAstraFormula(options={}){
  return ui.selectedVersion==='astra-sigma'?loadAstraSigma(options):loadAstra(options);
}
function showAstraFormulaView(){
  if(LotteryUiState.navigation.predictionTab!=='formula')switchPredTab('formula',{deferAstraLoad:true});
  switchFormulaTab('ASTRA');
  focusPageHeading('predict','formula',false);
}
function validateAstraSigmaReport(report,target){
  if(!_astraHasKeys(report,['schema_version','formula','version','trust','target_date','generated_at',
    'training_cutoff_date','source','window_draws','settings','warnings','categories']))return false;
  if(report.schema_version!==1||report.formula!=='astra'||report.version!==ASTRA_SIGMA_VERSION||report.trust!=='ทดลอง'||
    !['existing_local_cache','supplied_history'].includes(report.source)||!_astraIsDate(target)||report.target_date!==target)return false;
  const generationDay=_astraGenerationDay(report.generated_at);
  if(!generationDay||target<=generationDay)return false;
  if(!Number.isSafeInteger(report.window_draws)||report.window_draws<0)return false;
  const cutoff=report.training_cutoff_date;
  if(report.window_draws===0?cutoff!==null:(!_astraIsDate(cutoff)||cutoff>=target||cutoff>generationDay))return false;
  if(!_astraHasKeys(report.settings,Object.keys(ASTRA_SIGMA_SETTINGS))||
    !Object.entries(ASTRA_SIGMA_SETTINGS).every(([key,value])=>{
      if(key==='weights')return _astraHasKeys(report.settings[key],ASTRA_SIGMA_COMPONENTS)&&
        ASTRA_SIGMA_COMPONENTS.every(component=>report.settings[key][component]===value[component]);
      return report.settings[key]===value;
    }))return false;
  if(!_astraHasKeys(report.settings.weights,ASTRA_SIGMA_COMPONENTS)||
    !ASTRA_SIGMA_COMPONENTS.every(key=>report.settings.weights[key]===ASTRA_SIGMA_WEIGHTS[key]))return false;
  if(!Array.isArray(report.warnings)||!report.warnings.every(w=>typeof w==='string'&&w.trim().length>0))return false;
  if(!_astraHasKeys(report.categories,ASTRA_CATEGORIES.map(([key])=>key)))return false;
  return ASTRA_CATEGORIES.every(([key,label,digits,requested])=>{
    const category=report.categories[key];
    if(!_astraHasKeys(category,['label','digits','requested_count','status','valid_draws','invalid_draws','training_cutoff_date','numbers'])||
      category.label!==label||category.digits!==digits||category.requested_count!==requested)return false;
    if(!Number.isInteger(category.valid_draws)||category.valid_draws<0||!Number.isInteger(category.invalid_draws)||category.invalid_draws<0||
      category.valid_draws+category.invalid_draws!==report.window_draws)return false;
    if(category.valid_draws===0?category.training_cutoff_date!==null:
      (!_astraIsDate(category.training_cutoff_date)||category.training_cutoff_date>cutoff))return false;
    const sufficient=category.valid_draws>=ASTRA_SIGMA_SETTINGS.min_valid_draws;
    if(category.status!==(sufficient?'ok':'insufficient_data')||!Array.isArray(category.numbers)||
      category.numbers.length!==(sufficient?requested:0))return false;
    const seen=new Set();
    for(let i=0;i<category.numbers.length;i++){
      const row=category.numbers[i],previous=category.numbers[i-1];
      if(!_astraHasKeys(row,['number','rank','score','base_score','components'])||typeof row.number!=='string'||
        row.number.length!==digits||!/^[0-9]+$/.test(row.number)||row.rank!==i+1||
        !Number.isFinite(row.score)||row.score<0||row.score>1||!Number.isFinite(row.base_score)||seen.has(row.number)||
        !_astraHasKeys(row.components,ASTRA_SIGMA_COMPONENTS)||
        !ASTRA_SIGMA_COMPONENTS.every(component=>Number.isFinite(row.components[component])&&row.components[component]>=0&&row.components[component]<=1))return false;
      let expectedScore=0;
      for(const component of ASTRA_SIGMA_COMPONENTS)expectedScore+=ASTRA_SIGMA_WEIGHTS[component]*row.components[component];
      if(Math.abs(expectedScore-row.score)>1e-12)return false;
      if(previous&&(row.score>previous.score||(row.score===previous.score&&row.number<previous.number)))return false;
      seen.add(row.number);
    }
    return true;
  });
}
function setAstraSigmaState(state,date,message){
  ui.sigmaStarted=true;
  const target=document.getElementById('astra-sigma-target-label');
  const isOverride=ui.targetOverride?.shared===(document.getElementById('shared-draw-date')?.value||'')&&ui.targetOverride?.date===date;
  if(target)target.textContent=`${date||'ยังไม่เลือก'} · ${_astraTargetSource(date)}`+
    (isOverride?'; เปลี่ยนงวดหลักเพื่อกลับไปใช้ร่วมกัน':'');
  const results=document.getElementById('astra-sigma-results');
  if(results){results.dataset.state=state;results.setAttribute('aria-busy',String(state==='loading'));}
  syncAstraRunButton();
  const status=document.getElementById('astra-sigma-status');
  if(status){status.dataset.state=state;status.textContent=message;}
  const meta=document.getElementById('astra-sigma-meta');
  if(meta)meta.innerHTML=`สูตร astra / ${escHtml(ASTRA_SIGMA_VERSION)} / ทดลอง · งวดเป้าหมาย ${escHtml(date||'ยังไม่เลือก')} · ยังไม่มีรายงาน`;
  const warnings=document.getElementById('astra-sigma-warnings');
  if(warnings){warnings.hidden=true;warnings.innerHTML='';}
  ASTRA_CATEGORIES.forEach(([key,,digits,requested])=>{
    const body=document.getElementById('astra-sigma-body-'+key);
    if(body)body.innerHTML=`<p>${digits} หลัก · ขอ ${requested} เลข · ${escHtml(message)}</p><p>งวดใช้ได้ — · ใช้ไม่ได้ —</p><p>ข้อมูลล่าสุดหมวดนี้: ยังไม่มีรายงาน</p>`;
  });
}
function renderAstraSigmaReport(report){
  const meta=document.getElementById('astra-sigma-meta');
  if(meta)meta.innerHTML='<dl>'+[
    ['สูตร / เวอร์ชัน / สถานะ',`${report.formula} / ${report.version} / ${report.trust}`],
    ['งวดเป้าหมาย',report.target_date],['สร้างรายงานเมื่อ',report.generated_at],
    ['ขอบเขตข้อมูล',report.source==='existing_local_cache'?'ทุกงวดในแคชก่อนงวดเป้าหมาย':'ทุกงวดที่ได้รับก่อนงวดเป้าหมาย'],
    ['ข้อมูลล่าสุดรวม',report.training_cutoff_date??'ไม่มีข้อมูล'],['งวดที่ใช้',report.window_draws],
    ['แหล่งข้อมูล',report.source==='existing_local_cache'?'แคชในเครื่อง (อ่านอย่างเดียว)':'ข้อมูลทดสอบ / supplied_history'],
    ['คะแนน', 'คะแนนจัดอันดับ · ไม่ใช่ความน่าจะเป็น']
  ].map(([label,value])=>`<div><dt>${escHtml(label)}</dt><dd>${escHtml(value)}</dd></div>`).join('')+'</dl>';
  const messages=[...new Set(report.warnings)];
  const generationDay=_astraGenerationDay(report.generated_at);
  if(!messages.some(message=>message.includes('35 วัน'))&&report.training_cutoff_date&&Date.parse(generationDay)-Date.parse(report.training_cutoff_date)>35*86400000)
    messages.push('ข้อมูลล่าสุดเก่ากว่าวันสร้างรายงานเกิน 35 วัน โปรดตรวจวันข้อมูลล่าสุดของแต่ละหมวด');
  const warnings=document.getElementById('astra-sigma-warnings');
  if(warnings){warnings.hidden=!messages.length;warnings.innerHTML=messages.length?
    `<strong>ข้อจำกัดข้อมูล</strong><ul>${messages.map(w=>`<li>${escHtml(w)}</li>`).join('')}</ul>`:'';}
  let shown=0,available=0;
  ASTRA_CATEGORIES.forEach(([key,,digits,requested])=>{
    const category=report.categories[key],body=document.getElementById('astra-sigma-body-'+key);
    if(category.status==='ok')available++;
    if(!body)return;
    shown+=category.numbers.length;
    body.innerHTML=`<p>${digits} หลัก · ขอ ${requested} เลข · งวดใช้ได้ ${category.valid_draws} · ใช้ไม่ได้ ${category.invalid_draws}</p>`+
      `<p>ข้อมูลล่าสุดหมวดนี้: ${escHtml(category.training_cutoff_date??'ไม่มีข้อมูล')}</p>`+
      (category.numbers.length?`<ol class="astra-numbers">${category.numbers.map(row=>`<li><span class="astra-rank">อันดับ ${escHtml(row.rank)}</span><span class="astra-number">${escHtml(row.number)}</span><span class="astra-score">คะแนนจัดอันดับ ${row.score.toFixed(6)}</span><details class="astra-component-details"><summary>ดูองค์ประกอบคะแนน</summary><span class="astra-components">A (ฐานสถิติ) ${row.components.A.toFixed(3)} · H (ความถี่ล่าสุด) ${row.components.H.toFixed(3)} · D (ช่วงไม่ออก) ${row.components.D.toFixed(3)} · N (เลขศาสตร์) ${row.components.N.toFixed(3)} · L (เลขนำโชค) ${row.components.L.toFixed(3)} · B (สมดุลเลข) ${row.components.B.toFixed(3)}</span></details></li>`).join('')}</ol>`:'<p>ข้อมูลไม่ถึงขั้นต่ำ 20 งวดที่ใช้ได้ · ไม่แสดงเลขทดแทน</p>');
  });
  const results=document.getElementById('astra-sigma-results');
  if(results){results.dataset.state=shown?'ready':'empty';results.setAttribute('aria-busy','false');}
  syncAstraRunButton();
  const status=document.getElementById('astra-sigma-status');
  if(status)status.dataset.state=shown?'ready':'empty';
  setPageStatus('astra-sigma-status',(shown?`Astra-Σ แสดง ${shown} เลข · ข้อมูลเพียงพอ ${available}/7 หมวด · ทดลอง`:
    'Astra-Σ ไม่มีหมวดที่มีข้อมูลเพียงพอ · ไม่แสดงเลขทดแทน')+' · คำนวณอ่านอย่างเดียว ไม่บันทึก'+(messages.length?' · มีคำเตือนข้อมูล':''));
}
async function loadAstraSigma(){
  const requestId=++ui.sigmaRequestId;
  ui.sigmaStarted=true;
  const sharedDate=document.getElementById('shared-draw-date')?.value||'';
  const date=_astraEnsureFutureTarget();
  const isCurrent=()=>requestId===ui.sigmaRequestId&&date===astraTargetDate()&&sharedDate===(document.getElementById('shared-draw-date')?.value||'');
  setAstraSigmaState('loading',date,`กำลังคำนวณ Astra-Σ สำหรับงวด ${date} จากแคชเดิมแบบอ่านอย่างเดียว`);
  try{
    if(!_astraIsDate(date))throw new Error('Invalid Astra-Σ target');
    const report=await api('predict/astra-sigma?date='+encodeURIComponent(date),{
      suppressNetworkToast:true,suppressSpinnerAnnouncement:true,requireOk:true
    });
    if(!isCurrent())return;
    if(isAstraApiFailure(report)){
      setAstraSigmaState('error',date,astraApiFailureMessage(report,'คำนวณ Astra-Σ ไม่สำเร็จ'));
      return;
    }
    if(!validateAstraSigmaReport(report,date)){
      setAstraSigmaState('error',date,'ตรวจรายงาน Astra-Σ ไม่สำเร็จ · server ส่งข้อมูลไม่ครบหรือไม่ตรงรูปแบบ จึงไม่แสดงตัวเลข');
      return;
    }
    renderAstraSigmaReport(report);
  }catch{
    if(!isCurrent())return;
    setAstraSigmaState('error',date,'เกิดข้อผิดพลาดระหว่างอ่านหรือแสดงรายงาน Astra-Σ · ไม่มีการแสดงตัวเลขจากคำขอนี้');
  }
}


function getSelectedAstraVersion(){return ui.selectedVersion;}

function getAstraUiState(){return Object.freeze({selectedVersion:ui.selectedVersion,requestId:ui.requestId,started:ui.started,sigmaRequestId:ui.sigmaRequestId,sigmaStarted:ui.sigmaStarted});}
return Object.freeze({getAstraUiState,astraTargetDate,showAstraAutomaticTarget,setAstraAutomaticTarget,validateAstraReport,validateAstraSnapshot,validateAstraAutomation,setAstraAutomationState,renderAstraAutomation,setAstraState,renderAstraReport,invalidateAstra,markDataStale,loadAstra,selectAstraVersion,syncAstraRunButton,loadSelectedAstraFormula,showAstraFormulaView,validateAstraSigmaReport,setAstraSigmaState,renderAstraSigmaReport,loadAstraSigma,getSelectedAstraVersion});
})();
Object.assign(window,AstraFeature);
