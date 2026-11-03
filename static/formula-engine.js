// ─── Formula Calculators ──────────────────────────────────────────────────────

const FORMULA_BT_WINDOWS=[50,100,200];

const FORMULA_REQUIRED_COLUMNS=[
  ['prize1',6],['top3',3],['top2',2],['bottom2',2],
  ['front3_1',3],['front3_2',3],['back3_1',3],['back3_2',3],
];

const FORMULA_BT_FIELD_META={
  bottom2:{typeLabel:'เต็ม 2หลัก',board:'2-digit exact',widths:[2],base:(k)=>({baseP:k,baseLabel:`${k}/100`})},
  prize1_last2:{typeLabel:'เต็ม 2หลัก',board:'2-digit exact',widths:[2],base:(k)=>({baseP:k,baseLabel:`${k}/100`})},
  bottom2_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  front3_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  back3_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  prize1_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  // Legacy mixed-width target; split it before scoring because one scalar baseline is invalid.
  back3:{typeLabel:'3หลัก/ท้าย2 (legacy)',board:'Legacy mixed target',widths:[2,3],base:()=>({baseP:null,baseLabel:'แยกเป้าก่อนคำนวณ Edge'})},
  top3:{typeLabel:'3ตัวบนตรง',board:'3-digit exact',widths:[3],base:(k)=>({baseP:k/1000*100,baseLabel:`${k}/1000`})},
  prize1_exact:{typeLabel:'รางวัลที่ 1 ตรง 6 หลัก',board:'รางวัลที่ 1 · ตรง 6 หลัก',widths:[6],base:(k)=>({baseP:k/1e6*100,baseLabel:`${k}/1,000,000`})},
  front3:{typeLabel:'เต็ม 3หลัก',board:'3-digit exact',widths:[3],base:(k)=>({baseP:(1-Math.pow(1-Math.min(k,1000)/1000,2))*100,baseLabel:`1-(1-${Math.min(k,1000)}/1000)²`})},
  back3exact:{typeLabel:'เต็ม 3หลัก',board:'3-digit exact',widths:[3],base:(k)=>({baseP:(1-Math.pow(1-Math.min(k,1000)/1000,2))*100,baseLabel:`1-(1-${Math.min(k,1000)}/1000)²`})},
  back3_suffix2:{typeLabel:'2หลักท้าย 3 ตัวทางการ',board:'Official back3 suffix · 2-digit',widths:[2],base:(k)=>({baseP:(1-Math.pow(1-Math.min(k,100)/100,2))*100,baseLabel:`1-(1-${Math.min(k,100)}/100)²`})},
  prize1_last4_digits:{typeLabel:'4หลักรางวัล',board:'Prize1 tail',widths:[1],base:()=>({baseP:(1-Math.pow(0.9,4))*100,baseLabel:'1-(0.9)^4≈34.4%'})},
  pool6:{typeLabel:'Pool 6หลัก',board:'Pool 1-5',widths:[6],base:(k)=>({baseP:(1-Math.pow(1-168/1e6,k))*100,baseLabel:`${k} vs pool168/10⁶`})},
  pool_tail3:{typeLabel:'Pool ท้าย3',board:'Pool 1-5',widths:[3],base:(k)=>{const p1=1000*(1-Math.pow(0.999,168))/1000;return {baseP:(1-Math.pow(1-p1,k))*100,baseLabel:`${k} vs ~155/1000`};}},
  pool6_14:{typeLabel:'Pool 1-4',board:'Pool 1-4',widths:[6],base:(k)=>({baseP:(1-Math.pow(1-66/1e6,k))*100,baseLabel:`${k} vs pool66/10⁶`})},
};

function _formulaBtFieldMeta(field){
  const f=String(field||'');
  if(f.startsWith('run_'))return {typeLabel:'วิ่ง',board:'Run / digit',widths:[1],base:(k,slots=2)=>({baseP:(1-Math.pow((10-k)/10,slots))*100,baseLabel:`วิ่ง${k}/${slots}slot`})};
  return FORMULA_BT_FIELD_META[f]||null;
}

function _formulaBaselineForField(field,predsN,slots=2){
  const meta=_formulaBtFieldMeta(field);
  if(!meta)return {baseP:0,baseLabel:'-',typeLabel:field||'-',board:'Other'};
  return {...meta.base(Math.max(1,Number(predsN)||1),slots),typeLabel:meta.typeLabel,board:meta.board};
}

function _formulaActualDigits(actual,key,width,strict=false){
  if(!actual||actual[key]==null)return null;
  const raw=String(actual[key]);
  const value=strict?raw:raw.trim();
  return new RegExp(`^[0-9]{${width}}$`).test(value)?value:null;
}

function _formulaDrawValues(actual,keys){
  const values=keys.map(key=>_formulaActualDigits(actual,key,6));
  return values.every(Boolean)?values:null;
}

function _formulaPrizeValues(actual,key,count){
  const raw=String(actual?.[key]??'').trim();
  if(!raw)return null;
  const values=raw.split(/\s+/);
  return values.length===count&&values.every(value=>/^[0-9]{6}$/.test(value))?values:null;
}

function _formulaHitForField(fr,actual,pools={}){
  const preds=(fr?.preds||[]).map(String);
  if(!preds.length)return null;
  const p1=_formulaActualDigits(actual,'prize1',6,true);
  const bottom2=_formulaActualDigits(actual,'bottom2',2);
  const front1=_formulaActualDigits(actual,'front3_1',3);
  const front2=_formulaActualDigits(actual,'front3_2',3);
  const back1=_formulaActualDigits(actual,'back3_1',3);
  const back2=_formulaActualDigits(actual,'back3_2',3);
  const field=fr.field;
  if(field==='bottom2'||field==='bottom2_unit'||field==='run_bottom2'){
    if(!bottom2)return null;
    if(field==='bottom2')return preds.includes(bottom2);
    if(field==='bottom2_unit')return preds.includes(bottom2.slice(-1));
    return preds.some(d=>bottom2.includes(d));
  }
  if(field==='back3'||field==='back3exact'||field==='back3_suffix2'||field==='back3_unit'||field==='run_back3'){
    if(!back1||!back2)return null;
    if(field==='back3')return preds.some(n=>n===back1||n===back2||n===back1.slice(-2)||n===back2.slice(-2));
    if(field==='back3exact')return preds.includes(back1)||preds.includes(back2);
    if(field==='back3_suffix2')return preds.some(n=>/^\d{2}$/.test(n)&&(n===back1.slice(-2)||n===back2.slice(-2)));
    if(field==='back3_unit')return preds.includes(back1.slice(-1))||preds.includes(back2.slice(-1));
    return preds.some(d=>(back1+back2).includes(d));
  }
  if(field==='front3'||field==='front3_unit'||field==='run_front3'){
    if(!front1||!front2)return null;
    if(field==='front3')return preds.includes(front1)||preds.includes(front2);
    if(field==='front3_unit')return preds.includes(front1.slice(-1))||preds.includes(front2.slice(-1));
    return preds.some(d=>(front1+front2).includes(d));
  }
  if(field==='prize1_last4_digits'||field==='prize1_last2'||field==='prize1_unit'||field==='run_prize1back3'){
    if(!p1)return null;
    if(field==='prize1_last4_digits'){
      const tail=p1.slice(2);
      return preds.some((d,i)=>d===tail[i]);
    }
    if(field==='prize1_last2')return preds.includes(p1.slice(-2));
    if(field==='prize1_unit')return preds.includes(p1.slice(-1));
    return preds.some(d=>p1.slice(-3).includes(d));
  }
  if(field==='top3'){
    const top3=_formulaActualDigits(actual,'top3',3);
    return top3?preds.includes(top3):null;
  }
  if(field==='prize1_exact')return p1?preds.includes(p1):null;
  if(field==='pool6'||field==='pool_tail3'||field==='pool6_14'){
    const pool=field==='pool6'?pools.pool6Set:field==='pool_tail3'?pools.poolTail3Set:pools.pool14Set;
    if(!pool||typeof pool.has!=='function'||!pool.size)return null;
    return preds.some(n=>pool.has(n));
  }
  return null;
}

function _formulaSecondaryHit(fr,secondary6,secTail2,secTail3){
  const preds=(fr?.preds||[]).map(String);
  if(!preds.length||!secondary6?.length)return false;
  const lens=[...new Set(preds.map(p=>p.length))];
  return lens.some(len=>{
    if(len===3)return preds.some(p=>secTail3.has(p));
    if(len===2)return preds.some(p=>secTail2.has(p));
    if(len===6)return preds.some(p=>secondary6.includes(p));
    return false;
  });
}

function _formulaFieldMappingCheck(rows=[]){
  const errors=[],warnings=[];
  const sample=(rows||[]).find(r=>r&&r.prize1)||{};
  for(const [col,width] of FORMULA_REQUIRED_COLUMNS){
    if(!(col in sample)){errors.push(`CSV ไม่มีคอลัมน์ ${col}`);continue;}
    const v=String(sample[col]||'');
    if(v&&v.length!==width)warnings.push(`${col} ควรเป็น ${width} หลัก แต่ตัวอย่างเป็น ${v.length} หลัก`);
  }
  const curr=rows?.[0]||{};
  const prev=rows?.find((r,i)=>i>0&&r?.prize1)||rows?.[1]||{};
  let iso='';
  if(curr.date){const[d,m,y]=String(curr.date).split('/').map(Number);if(d&&m&&y)iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
  let formulas=[];
  try{formulas=_computeFormulasBatch(prev,iso,rows.slice(2,202))||[];}catch(e){errors.push(`คำนวณ batch ไม่สำเร็จ: ${String(e)}`);}
  const groups=new Set();
  for(const fr of formulas){
    const code=String(fr.name||'').match(/^([A-Z]+\d+)/)?.[1]||'';
    const group=code[0]||String(fr.name||'').trim()[0]||'?';
    groups.add(group);
    const meta=_formulaBtFieldMeta(fr.field);
    if(!meta){errors.push(`${fr.name}: field "${fr.field}" ยังไม่มี mapping`);continue;}
    const allowed=new Set(meta.widths||[]);
    for(const pred of fr.preds||[]){
      if(typeof pred!=='string')errors.push(`${fr.name}: prediction ต้องเป็น string เพื่อรักษาเลข 0 นำหน้า`);
      const s=String(pred);
      if(!allowed.has(s.length))warnings.push(`${fr.name}: "${s}" ยาว ${s.length} หลัก ไม่ตรง field ${fr.field}`);
    }
  }
  ['A','B','C','D','E','G','H'].forEach(g=>{if(!groups.has(g))warnings.push(`ไม่พบสูตรกลุ่ม ${g} ใน batch check`);});
  if(!groups.has('X'))warnings.push('ไม่พบสูตรกลุ่ม F/Rolling (X*) ใน batch check');
  return {ok:errors.length===0,errors,warnings,checked:formulas.length,groups:[...groups].sort()};
}

function _formulaMappingBannerHtml(check){
  if(!check)return '';
  const details=[...(check.errors||[]),...(check.warnings||[]).slice(0,8)];
  const message=check.ok?'การตรวจโครงสร้างสูตรผ่าน':'พบปัญหาโครงสร้างสูตร '+check.errors.length+' จุด';
  return `<details class="bt-check ${check.ok?'good':'bad'}"${check.ok?'':' open'}>
    <summary>${_formulaEsc(message)}${check.warnings?.length?' · มีคำเตือน '+check.warnings.length+' จุด':''}</summary>
    <p>ตรวจ ${check.checked} สูตร · กลุ่ม ${_formulaEsc(check.groups.join(', '))}</p>
    ${details.map(x=>`<p>${_formulaEsc(x)}</p>`).join('')}
  </details>`;
}
window.formulaFieldMappingCheck=_formulaFieldMappingCheck;

function _freqMap(arr){const m={};for(const v of arr)m[v]=(m[v]||0)+1;return m;}
function _topN(freq,n){return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k])=>k);}

const FORMULA_FIELD_RULES=[
  ['f-prize1',6,'รางวัลที่ 1'],
  ['f-top3',3,'3 ตัวบน'],
  ['f-bottom2',2,'ท้าย 2 ตัว'],
  ['f-front3-1',3,'หน้า 3 ตัว #1'],
  ['f-front3-2',3,'หน้า 3 ตัว #2'],
  ['f-back3-1',3,'ท้าย 3 ตัว #1'],
  ['f-back3-2',3,'ท้าย 3 ตัว #2'],
];

function _bindFormulaInputSanitizers(){
  for(const [id,len] of FORMULA_FIELD_RULES){
    const el=document.getElementById(id);
    if(!el||el.dataset.formulaSanitized)continue;
    el.dataset.formulaSanitized='1';
    el.addEventListener('input',()=>{
      const clean=(el.value||'').replace(/\D/g,'').slice(0,len);
      if(el.value!==clean)el.value=clean;
      if(el.classList.contains('formula-input-error'))_clearFormulaErrors();
    });
  }
}

function _clearFormulaErrors(){
  document.querySelectorAll('.formula-field-error').forEach(el=>el.remove());
  document.querySelectorAll('.formula-input-error').forEach(el=>{
    el.classList.remove('formula-input-error');
    el.removeAttribute('aria-invalid');
    const errorId=el.dataset.formulaErrorId;
    if(errorId){
      const described=(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==errorId);
      if(described.length)el.setAttribute('aria-describedby',described.join(' '));
      else el.removeAttribute('aria-describedby');
      delete el.dataset.formulaErrorId;
    }
  });
  const status=document.getElementById('formula-input-status');
  if(status)status.textContent='';
}

function _formulaError(id,msg){
  const el=document.getElementById(id);
  if(!el)return null;
  el.classList.add('formula-input-error');
  const errorId=`formula-error-${id}`;
  el.dataset.formulaErrorId=errorId;
  el.setAttribute('aria-invalid','true');
  const described=new Set((el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
  described.add(errorId);
  el.setAttribute('aria-describedby',[...described].join(' '));
  const div=document.createElement('div');
  div.className='formula-field-error';
  div.id=errorId;
  div.textContent=msg;
  el.insertAdjacentElement('afterend',div);
  return el;
}

function _validateFormulaInputs(){
  _clearFormulaErrors();
  let ok=true;
  for(const [id,len,label] of FORMULA_FIELD_RULES){
    const v=_fv(id);
    if(!new RegExp(`^\\d{${len}}$`).test(v)){
      _formulaError(id,`${label} ต้องเป็นเลข ${len} หลัก`);
      ok=false;
    }
  }
  const drawday=parseInt(_fv('f-drawday'),10);
  if(![1,16].includes(drawday)){
    _formulaError('f-drawday','เลือกได้เฉพาะวันที่ 1 หรือ 16');
    ok=false;
  }
  const bd=_fv('f-bday'),bm=_fv('f-bmon'),by=_fv('f-byear');
  const anyBirth=bd||bm||by;
  if(anyBirth){
    const bdi=parseInt(bd,10),bmi=parseInt(bm,10),byi=parseInt(by,10);
    if(!(bdi>=1&&bdi<=31)){_formulaError('f-bday','วัน 1-31');ok=false;}
    if(!(bmi>=1&&bmi<=12)){_formulaError('f-bmon','เดือน 1-12');ok=false;}
    if(!(byi>=2480&&byi<=2580)){_formulaError('f-byear','ใช้ปี พ.ศ. 2480-2580');ok=false;}
  }
  const status=document.getElementById('formula-input-status');
  if(!ok){
    const invalid=document.querySelector('.formula-input-error');
    if(status)status.textContent=`พบข้อมูลไม่ถูกต้อง ${document.querySelectorAll('.formula-input-error').length} ช่อง กรุณาตรวจข้อความใต้ช่องที่มีกรอบแดง`;
    invalid?.focus();
    toast('ตรวจข้อมูลในช่องที่เป็นสีแดง','error');
  }
  return ok;
}

function syncFormulaSnapshotButton(){
  const button=document.getElementById('f-save-snapshot');
  if(!button)return false;
  const state=LotteryUiState.formula;
  const tab=state.activeTab||'A';
  const calculationPending=typeof window!=='undefined'&&!!window._formulaCalculationPending;
  const selector=tab==='FANO'?'#formula-results-FANO .num-badge':'#formula-final .num-badge,#formula-results-ALL .num-badge';
  const nodes=typeof document.querySelectorAll==='function'?[...document.querySelectorAll(selector)]:[];
  const candidatePattern=tab==='FANO'?/^[0-9]{6}$/:/^[0-9]{1,6}$/;
  const candidateValues=nodes.map(node=>String(node.textContent||'').trim().replace(/\s+/g,''));
  const hasCandidates=candidateValues.some(value=>candidatePattern.test(value));
  let reason='';
  if(tab==='ASTRA')reason='Astra มี Snapshot รายงานแยก';
  else if(state.sourceStale)reason='ข้อมูลย้อนหลังอัปเดตแล้ว · โหลดข้อมูลล่าสุดและคำนวณใหม่ก่อนบันทึก';
  else if(state.autoFillPending)reason='กำลังโหลดข้อมูลงวดก่อน';
  else if(calculationPending)reason='กำลังคำนวณสูตร';
  else if(!state.hasRun)reason='คำนวณสูตรก่อนจึงจะบันทึก Snapshot ได้';
  else if(!hasCandidates)reason='ยังไม่มีเลขผลลัพธ์ที่บันทึกได้ในมุมมองนี้';
  button.disabled=Boolean(reason);
  button.title=reason||'บันทึกผลสูตรที่คำนวณแล้ว';
  const hint=document.getElementById('formula-snapshot-help');
  if(hint)hint.textContent=reason||'บันทึกผลสูตรที่คำนวณแล้วลงในประวัติ Snapshot';
  const run=document.getElementById('f-run-formulas');
  if(run&&tab!=='ASTRA'){
    run.disabled=Boolean(state.sourceStale||state.autoFillPending||calculationPending);
    run.title=state.sourceStale?'ข้อมูลย้อนหลังเปลี่ยนแล้ว · ใช้ปุ่มโหลดข้อมูลล่าสุดในข้อความเตือนด้านบน':'คำนวณผลจากข้อมูลในช่องและประวัติที่โหลดไว้';
  }
  return !reason;
}

function markFormulaDataStale(message){
  const state=LotteryUiState.formula;
  const hasCachedHistory=Array.isArray(LotteryServerData.formula.history)&&LotteryServerData.formula.history.length>0;
  if(!state.hasRun&&!state.autoFillPending&&!window._formulaCalculationPending&&!hasCachedHistory)return;
  state.sourceStale=true;
  state.autoFillRequestId++;
  state.autoFillPending=false;
  window._formulaCalculationRequestId=(Number(window._formulaCalculationRequestId)||0)+1;
  window._formulaCalculationPending=false;
  _setFormulaAutoFillPending(false);
  const origin=document.getElementById('formula-report-origin');
  if(origin){
    origin.classList.add('is-stale');
    origin.innerHTML=`<strong>ผลสูตรอาจใช้ข้อมูลเก่า</strong><br>${escHtml(message)} · การคำนวณใหม่จะเติมช่องเลขจากงวดก่อนล่าสุดแทนค่าปัจจุบัน <button type="button" class="btn btn-secondary" onclick="recomputeFormulaAfterCacheRefresh()">โหลดข้อมูลล่าสุดและคำนวณสูตร</button>`;
  }
  setPageStatus('formula-status',`${message} · โหลดข้อมูลล่าสุดและคำนวณสูตรใหม่ก่อนใช้งาน`);
  syncFormulaSnapshotButton();
}
window.markFormulaDataStale=markFormulaDataStale;
async function recomputeFormulaAfterCacheRefresh(){
  const state=LotteryUiState.formula;
  if(state.activeTab==='ASTRA')return loadSelectedAstraFormula({recompute:true});
  if(typeof window.confirm==='function'&&!window.confirm('โหลดข้อมูลล่าสุดและแทนเลขในช่องด้วยผลรางวัลของงวดก่อนล่าสุด แล้วคำนวณสูตรใหม่หรือไม่?'))return false;
  const epoch=Number(LotteryUiState.health.dataEpoch)||0;
  state.hasRun=false;
  if(!await autoFillFormula(true))return false;
  if(epoch!==(Number(LotteryUiState.health.dataEpoch)||0)){
    markFormulaDataStale('แคชเปลี่ยนระหว่างโหลดข้อมูลสูตร');
    return false;
  }
  state.sourceStale=false;
  const origin=document.getElementById('formula-report-origin');
  if(origin)origin.classList.remove('is-stale');
  _setFormulaAutoFillPending(false);
  return runAllFormulas();
}
window.recomputeFormulaAfterCacheRefresh=recomputeFormulaAfterCacheRefresh;

function _clearFormulaResults(msg=''){
  if(typeof window!=='undefined'){
    window._formulaCalculationRequestId=(Number(window._formulaCalculationRequestId)||0)+1;
    window._formulaCalculationPending=false;
  }
  ['A','B','C','D','F','G','H','E','ALL','FANO','RLL'].forEach(k=>{
    const el=document.getElementById('formula-results-'+k);
    if(el)el.innerHTML='';
  });
  const empty=document.getElementById('formula-empty');
  if(empty){empty.style.display='block';if(msg)empty.textContent=msg;}
  const sum=document.getElementById('formula-summary');
  if(sum){sum.classList.remove('active');sum.innerHTML='';}
  const insights=document.getElementById('formula-insights');
  if(insights){insights.classList.remove('active');insights.innerHTML='';}
  const final=document.getElementById('formula-final');
  if(final){final.classList.remove('active');final.innerHTML='';}
  const tools=document.getElementById('formula-tools');
  if(tools)tools.classList.remove('active');
  const count=document.getElementById('formula-filter-count');
  if(count)count.textContent='';
  LotteryUiState.formula.hasRun=false;
  if(typeof window!=='undefined'&&typeof window.setPageStatus==='function')window.setPageStatus('formula-status',msg||'ไม่มีผลสูตรให้แสดง');
  syncFormulaSnapshotButton();
}

function setFormulaLoading(msg='กำลังโหลดข้อมูลสูตร...'){
  const empty=document.getElementById('formula-empty');
  if(empty){empty.style.display='block';empty.textContent=msg;}
  ['formula-summary','formula-insights','formula-final'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.classList.remove('active');el.innerHTML='';}
  });
  if(typeof window!=='undefined'&&typeof window.setPageStatus==='function')window.setPageStatus('formula-status',msg);
  syncFormulaSnapshotButton();
}

async function initFormulaPage(){
  updateFormulaTargetDisplay();
  if(LotteryUiState.formula.activeTab==='ASTRA'){switchFormulaTab('ASTRA');return;}
  _bindFormulaInputSanitizers();
  // populate f-target-date from history
  const sel=document.getElementById('f-target-date');
  if(!sel)return;
  let prefetchedHistoryRows=null;
  let initialHistoryFailed=false;
  if(!sel.options.length){
    setFormulaLoading('กำลังเตรียมรายการงวดสำหรับสูตร...');
    const predSel=document.getElementById('pred-date');
    let opts=[];
    if(predSel && predSel.options.length){
      for(const o of predSel.options){
        const opt=document.createElement('option');
        opt.value=o.value; opt.textContent=o.textContent;
        opts.push(opt);
      }
    }
    try{
      const h=await api('prize-history?n=500',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
      if(h?.error||h?.detail)throw new Error('formula history unavailable');
      prefetchedHistoryRows=Array.isArray(h.data)?h.data:[];
      // also add recent past draws as reference targets (past 6)
      const recent=prefetchedHistoryRows.slice(0,6);
      for(const r of recent){
        if(!r.date) continue;
        const [d,m,y]=r.date.split('/').map(Number);
        const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const opt=document.createElement('option');
        opt.value=iso; opt.textContent=r.date;
        opts.push(opt);
      }
    }catch(e){
      initialHistoryFailed=true;
      _clearFormulaResults('โหลดข้อมูลงวดไม่สำเร็จ ลองใหม่อีกครั้ง');
      showFormulaManualInput();
    }
    if(opts.length)opts.forEach(o=>sel.appendChild(o));
    else if(!initialHistoryFailed)_clearFormulaResults('ยังโหลดรายการงวดไม่ได้ ลองกดรีเฟรชข้อมูลหรือกรอกเลขเอง');
  }
  if(!LotteryUiState.formula.filled && sel.value && !initialHistoryFailed){
    await autoFillFormula(false,prefetchedHistoryRows);
  }
  updateFormulaTargetDisplay();
  switchFormulaTab(LotteryUiState.formula.activeTab);
}

function updateFormulaTargetDisplay(){
  const target=document.getElementById('f-target-date')?.value||document.getElementById('shared-draw-date')?.value||'';
  const label=document.getElementById('formula-target-display');
  if(label)label.textContent=target?fmtDate(target):'ตามงวดหลัก';
}
window.updateFormulaTargetDisplay=updateFormulaTargetDisplay;

function showFormulaManualInput(){
  const details=document.getElementById('formula-manual-input');
  if(details)details.open=true;
}

function switchFormulaTab(tab){
  const mainPanel=document.getElementById('pred-main-tab-formula');
  if(mainPanel)mainPanel.classList.toggle('astra-selected',tab==='ASTRA');
  LotteryUiState.formula.activeTab=tab;
  document.querySelectorAll('.ftab-btn').forEach(btn=>{
    const on=btn.dataset.ftab===tab;
    btn.classList.toggle('active',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
  // sync the native group selector with the currently exposed result group.
  const groupSel=document.getElementById('ftab-group-select');
  const astraVersionControl=document.getElementById('astra-version-control');
  if(astraVersionControl)astraVersionControl.hidden=tab!=='ASTRA';
  if(groupSel){
    const isGroup=['A','B','C','D','F','G','H','E','I','J','HM','ASTRA','FANO','RLL'].includes(tab);
    groupSel.value=isGroup?tab:'';
    groupSel.classList.toggle('ftab-select-active',isGroup);
    if(isGroup)groupSel.setAttribute('aria-controls','formula-results-'+tab);
    else groupSel.removeAttribute('aria-controls');
  }
  document.querySelectorAll('.ftab-info').forEach(el=>el.classList.add('hidden'));
  const desc=document.getElementById('ftab-desc-'+tab);
  if(desc)desc.classList.remove('hidden');
  document.querySelectorAll('.formula-results-panel').forEach(el=>el.classList.remove('active'));
  const panel=document.getElementById('formula-results-'+tab);
  if(panel){
    if(tab!=='BT'&&!panel.innerHTML.trim()){
      panel.innerHTML=LotteryUiState.formula.hasRun
        ?`<div class="formula-tab-empty" style="display:block;grid-column:1/-1">ไม่มีผลสูตรในหมวดนี้</div>`
        :'';
    }
    panel.classList.add('active');
  }
  const tools=document.getElementById('formula-tools');
  if(tools)tools.classList.toggle('active',LotteryUiState.formula.hasRun&&tab!=='BT'&&tab!=='ASTRA');
  if(tab==='BT'&&typeof FirstPrizeFeature!=='undefined')FirstPrizeFeature.board('formula-astra-prospective-board');
  if(tab!=='BT'&&tab!=='ASTRA')filterFormulaCards();
  if(typeof window!=='undefined'&&typeof window.syncAstraRunButton==='function')window.syncAstraRunButton();
  syncFormulaSnapshotButton();
}


// แปลง dd/mm/yyyy → Date object
function _parseThai(dateStr){
  const [d,m,y]=dateStr.split('/').map(Number);
  return new Date(y,m-1,d);
}

function _setFormulaAutoFillPending(pending){
  LotteryUiState.formula.autoFillPending=!!pending;
  if(pending&&typeof window!=='undefined'){
    window._formulaCalculationRequestId=(Number(window._formulaCalculationRequestId)||0)+1;
    window._formulaCalculationPending=false;
  }
  const astraSelected=LotteryUiState.navigation.predictionTab==='formula'&&LotteryUiState.formula.activeTab==='ASTRA';
  ['f-run-formulas','f-save-snapshot','f-load-formula','f-prize1','f-top3','f-bottom2','f-front3-1','f-front3-2','f-back3-1','f-back3-2','f-drawday'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&!(id==='f-run-formulas'&&astraSelected))el.disabled=LotteryUiState.formula.autoFillPending||
      (LotteryUiState.formula.sourceStale&&id!=='f-load-formula');
  });
  if(typeof window!=='undefined'&&typeof window.syncAstraRunButton==='function')window.syncAstraRunButton();
  syncFormulaSnapshotButton();
}

async function autoFillFormula(clearStaleInputs=false,prefetchedHistoryRows=null){
  const requestId=++LotteryUiState.formula.autoFillRequestId;
  LotteryUiState.formula.filled=false;
  const targetDateStr=document.getElementById('f-target-date')?.value||''; // YYYY-MM-DD
  updateFormulaTargetDisplay();
  _setFormulaAutoFillPending(true);
  if(clearStaleInputs){
    ['f-prize1','f-top3','f-bottom2','f-front3-1','f-front3-2','f-back3-1','f-back3-2'].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.value='';
    });
    const targetDay=Number(targetDateStr.split('-')[2]);
    const drawDay=document.getElementById('f-drawday');
    if(drawDay)drawDay.value=targetDay===16?'16':'1';
  }
  let rows=[];
  setFormulaLoading('กำลังโหลดข้อมูลงวดก่อน...');
  if(Array.isArray(prefetchedHistoryRows)){
    rows=prefetchedHistoryRows;
  }else{
    try{
      // prize-history (ไม่ใช่ history) เพราะมีคอลัมน์เดียวกันครบ + near1/prize2-5
      // เพิ่มเติม (จำเป็นสำหรับจักรพรรดิ กลุ่ม I ที่ใช้ pool รางวัล 1-5)
      const h=await api('prize-history?n=500',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
      if(requestId!==LotteryUiState.formula.autoFillRequestId)return false;
      if(h?.error||h?.detail){
        _setFormulaAutoFillPending(false);
        _clearFormulaResults('โหลดข้อมูลงวดไม่สำเร็จ ลองใหม่อีกครั้ง');
        showFormulaManualInput();
        return false;
      }
      rows=Array.isArray(h.data)?h.data:[];
    }catch(e){
      if(requestId!==LotteryUiState.formula.autoFillRequestId)return false;
      _setFormulaAutoFillPending(false);
      _clearFormulaResults('โหลดข้อมูลงวดไม่สำเร็จ ลองใหม่อีกครั้ง');
      showFormulaManualInput();
      return false;
    }
  }
  if(!rows.length){
    _setFormulaAutoFillPending(false);
    _clearFormulaResults('ยังไม่มีประวัติงวดให้เติมอัตโนมัติ สามารถกรอกเลขเองแล้วคำนวณได้');
    showFormulaManualInput();
    return false;
  }
  LotteryServerData.formula.history=rows; // cache for Claude/Codex/จักรพรรดิ formulas

  let prev=null;
  if(targetDateStr){
    const target=new Date(targetDateStr);
    for(const r of rows){
      if(!r.date) continue;
      const rd=_parseThai(r.date);
      if(rd<target){prev=r;break;}
    }
  }
  if(!prev) prev=rows[0];
  if(!prev){
    _setFormulaAutoFillPending(false);
    _clearFormulaResults('ไม่พบงวดก่อนหน้าสำหรับวันที่เป้าหมาย สามารถกรอกเลขเองแล้วคำนวณได้');
    showFormulaManualInput();
    return false;
  }

  const setVal=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
  setVal('f-prize1',prev.prize1);
  setVal('f-top3',prev.top3);
  setVal('f-bottom2',prev.bottom2);
  setVal('f-front3-1',prev.front3_1);
  setVal('f-front3-2',prev.front3_2);
  setVal('f-back3-1',prev.back3_1);
  setVal('f-back3-2',prev.back3_2);
  let drawDay=1;
  if(targetDateStr){
    const parts=targetDateStr.split('-').map(Number);
    drawDay=parts[2]||1;
  }else{
    drawDay=parseInt((prev.date||'1').split('/')[0]||'1');
  }
  setVal('f-drawday',(drawDay===16)?16:1);

  const info=document.getElementById('f-prev-info');
  if(info) info.textContent=`งวด: ${prev.date||''} | รางวัลที่1: ${prev.prize1||''}`;
  updateFormulaTargetDisplay();
  LotteryUiState.formula.filled=true;
  _setFormulaAutoFillPending(false);
  if(LotteryUiState.formula.hasRun){
    if(document.getElementById('f-auto-run')?.checked)runAllFormulas();
    else _clearFormulaResults('เปลี่ยนงวดเป้าหมายแล้ว กดคำนวณอีกครั้งเพื่ออัปเดตผล');
  }else{
    const empty=document.getElementById('formula-empty');
    if(empty){empty.style.display='block';empty.textContent='ตรวจข้อมูลงวดก่อนแล้ว กด ⚡ คำนวณทุกสูตร';}
  }
  return true;
}

function _fv(id){return (document.getElementById(id)?.value||'').trim();}
function _pad(n,len){return String(n).padStart(len,'0');}
function _digits(s){return s.split('').map(Number);}
function _sumDigits(s){return _digits(s).reduce((a,b)=>a+b,0);}
function _modAdd(a,b){return (parseInt(a)+parseInt(b))%10;}

// บวกไม่ทด = digit-wise add mod 10
function _addNoCarry(a,b){
  const la=String(a).split('').map(Number);
  const lb=String(b).split('').map(Number);
  while(la.length<lb.length) la.unshift(0);
  while(lb.length<la.length) lb.unshift(0);
  return la.map((d,i)=>(d+lb[i])%10).join('');
}
// ลบไม่ยืม = digit-wise subtract absolute mod 10
function _subNoCarry(a,b){
  const la=String(a).split('').map(Number);
  const lb=String(b).split('').map(Number);
  while(la.length<lb.length) la.unshift(0);
  while(lb.length<la.length) lb.unshift(0);
  return la.map((d,i)=>Math.abs(d-lb[i])%10).join('');
}

function _mktDigit(v){
  const n=parseInt(v,10);
  return Number.isFinite(n)?((n%10)+10)%10:0;
}

function _mktGarland(...vals){
  return vals.flatMap(v=>String(Math.abs(parseInt(v,10)||0)).split('').map(Number))
    .reduce((a,b)=>a+b,0)%10;
}

function _mktSeq(start,count,step=1){
  return Array.from({length:count},(_,i)=>String((_mktDigit(start)+i*step)%10));
}

function _mktNearest(pool,target){
  const t=_mktDigit(target);
  const nums=(pool||[]).map(_mktDigit);
  if(nums.includes(t))return String(t);
  nums.sort((a,b)=>Math.min((a-t+10)%10,(t-a+10)%10)-Math.min((b-t+10)%10,(t-b+10)%10));
  return String(nums[0]??t);
}

function _mktJoin3(hundreds,tens,units){
  const out=[];
  for(const h of hundreds)for(const t of tens)for(const u of units)out.push(`${h}${t}${u}`);
  return [...new Set(out)];
}

function _maenKhanThep(ctx){
  const p=String(ctx.p6||'').padStart(6,'0').split('').map(Number);
  const b2=String(ctx.b2||'').padStart(2,'0').split('').map(Number);
  const f1=String(ctx.f31||'').padStart(3,'0').split('').map(Number);
  const f2=String(ctx.f32||'').padStart(3,'0').split('').map(Number);
  const bk1=String(ctx.bk1||'').padStart(3,'0').split('').map(Number);
  const bk2=String(ctx.bk2||'').padStart(3,'0').split('').map(Number);

  const g1H=_mktGarland(p[0]+p[5], b2[1]+f2[2], 5);
  const g1T0=_mktGarland(bk1[2]+bk2[1], 9);
  const g1T=_mktSeq(g1T0,3,3);
  const g1U=_mktGarland(f2[1]+f2[2],5);
  const g1=_mktJoin3([String(g1H)],g1T,[String(g1U)]);

  const g2H=(_mktGarland(p[1]+p[5], f1[0], bk1[2])+4)%10;
  const g2T0=(_mktGarland(p[2], b2[1], bk1[0])+6)%10;
  const g2T=_mktSeq(g2T0,3,1);
  const g2U=_mktGarland(p[1]+p[2]+bk2[1],5);
  const g2=_mktJoin3([String(g2H)],g2T,[String(g2U)]);

  const g3H0=(f1[2]+bk2[0]+bk2[1]+bk2[2]+3)%10;
  const g3H=_mktSeq(g3H0,3,2);
  const g3TPool=_mktSeq(_mktGarland(p[3],f1[1],bk1[1]),5,1);
  const g3UPool=_mktSeq(_mktGarland(p[4],f2[2],bk2[2]),5,1);
  const g3TCut=(_mktGarland(p[0],f1[1],bk2[1])+5)%10;
  const g3UCut=(_mktGarland(p[5],f2[2],bk2[2])+5)%10;
  const g3T=_mktNearest(g3TPool,g3TCut);
  const g3U=_mktNearest(g3UPool,g3UCut);
  const g3=_mktJoin3(g3H,[g3T],[g3U]);

  const g4TStart=(p[0]+p[2]+p[4]+1)%10;
  const g4T=_mktSeq(g4TStart,3,1);
  const g4UPool=_mktSeq(_mktGarland(p[1],f1[0],f2[1]),5,1);
  const g4UCut=(_mktGarland(bk2[0],bk2[2],7)+5)%10;
  const g4U=_mktNearest(g4UPool,g4UCut);
  const g4=g4T.map(t=>`${t}${g4U}`);

  return {
    top3Type1:g1, top3Type2:g2, top3Type3:g3, bottom2:g4,
    meta:{g1H,g1T0,g1T,g1U,g2H,g2T0,g2T,g2U,g3H,g3TPool,g3UPool,g3TCut,g3UCut,g3T,g3U,g4T,g4UPool,g4UCut,g4U}
  };
}

function _maenKhanThepCards(ctx){
  const M=_maenKhanThep(ctx);
  const m=M.meta;
  return [
    _mkFormulaCard('แม่นขั้นเทพ 1 · 3 ตัวบน ร้อยมาลัย 5-9-5','G. แม่นขั้นเทพ',
      [`หลักร้อย: (แสนรางวัลที่1+หน่วยรางวัลที่1) และ (หน่วยล่าง+หน่วยเลขหน้า#2) บวกมาลัยกับ 5 = ${m.g1H}`,
       `หลักสิบ: (หน่วยท้าย#1+สิบท้าย#2) บวกมาลัยกับ 9 = ${m.g1T0}, เพิ่มทีละ 3 ได้ ${m.g1T.join(', ')}`,
       `หลักหน่วย: (สิบ+หน่วยเลขหน้า#2) บวกมาลัยกับ 5 = ${m.g1U}`],
      M.top3Type1),
    _mkFormulaCard('แม่นขั้นเทพ 2 · 3 ตัวบน ขนาบหน้า-หลัง 4/6','G. แม่นขั้นเทพ',
      [`หลักร้อย: หมื่นรางวัลที่1 + หน่วยรางวัลที่1 ขนาบฐานหน้า#1 และหน่วยท้าย#1 แล้วบวก 4 = ${m.g2H}`,
       `หลักสิบ: พันรางวัลที่1 + หน่วยล่าง + ร้อยท้าย#1 แล้วบวก 6 = ${m.g2T0}, นับต่อ 3 ตัว = ${m.g2T.join(', ')}`,
       `หลักหน่วย: หมื่น+พันรางวัลที่1 + สิบท้าย#2 รวมฐาน 5 = ${m.g2U}`],
      M.top3Type2),
    _mkFormulaCard('แม่นขั้นเทพ 3 · 3 ตัวบน โครง 25 คู่แล้วตัด','G. แม่นขั้นเทพ',
      [`หลักร้อย: หน่วยเลขหน้า#1 + ท้าย#2 ทั้ง 3 หลัก + 3 = ${m.g3H[0]}, เพิ่มทีละ 2 ได้ ${m.g3H.join(', ')}`,
       `โครงหลักสิบ 5 ตัว: ${m.g3TPool.join(', ')} | ตัวตัด +5 = ${m.g3TCut} → เลือก ${m.g3T}`,
       `โครงหลักหน่วย 5 ตัว: ${m.g3UPool.join(', ')} | ตัวตัด +5 = ${m.g3UCut} → เลือก ${m.g3U}`],
      M.top3Type3),
    _mkFormulaCard('แม่นขั้นเทพ 4 · เลขท้าย 2 ตัวล่าง เด่น 3 ชุดตรง','G. แม่นขั้นเทพ',
      [`หลักสิบ: แสน+พัน+สิบรางวัลที่1 ได้เลขท้าย แล้วเริ่มตัวถัดไป = ${m.g4T[0]}, นับครบ 3 ตัว ${m.g4T.join(', ')}`,
       `หลักหน่วยตั้งต้น 5 ตัวจาก หมื่นรางวัลที่1 + ร้อยหน้า#1 + สิบหน้า#2 = ${m.g4UPool.join(', ')}`,
       `ตัวตัด: ร้อยท้าย#2 + หน่วยท้าย#2 + 7 แล้วบวกเพิ่ม 5 = ${m.g4UCut} → เลือก ${m.g4U}`],
      M.bottom2),
  ];
}

function _misterC(ctx){
  const p=String(ctx.p6||'').padStart(6,'0').split('').map(Number);
  const t3=String(ctx.t3||'').padStart(3,'0').split('').map(Number);
  const b2=String(ctx.b2||'').padStart(2,'0').split('').map(Number);
  const f1=String(ctx.f31||'').padStart(3,'0').split('').map(Number);
  const bk1=String(ctx.bk1||'').padStart(3,'0').split('').map(Number);
  const bk2=String(ctx.bk2||'').padStart(3,'0').split('').map(Number);

  const f1H=_mktDigit(p[0]*3 + p[1]*2 + bk1[0]*3 - 2);
  const f1T=_mktDigit(p[0] + b2[0] + f1[0] + bk1[0]*3 + 4);
  const f1U=_mktDigit(p[0] + p[3]*2 + p[4] + bk2[0]*2 - 1);
  const formula1=`${f1H}${f1T}${f1U}`;

  const f2H=_mktDigit(p[0] + p[3]*2 + p[5] + b2[0]*4 + 8);
  const f2T=_mktDigit(p[0]*2 + p[1]*3 + b2[0]*3 + 8);
  const f2U=_mktDigit(p[0]*3 + p[1] + p[4]*2 + b2[0] + 1);
  const formula2=`${f2H}${f2T}${f2U}`;

  const combo=_mktJoin3(
    [...new Set([String(f1H),String(f2H)])],
    [...new Set([String(f1T),String(f2T)])],
    [...new Set([String(f1U),String(f2U)])]
  );

  return {
    formula1:[formula1],
    formula2:[formula2],
    combo,
    meta:{f1H,f1T,f1U,f2H,f2T,f2U}
  };
}

function _misterCCards(ctx){
  const M=_misterC(ctx);
  const m=M.meta;
  return [
    _mkFormulaCard('มิสเตอร์ซี 1 · 3 ตัวบนตรงชุดเดียว','H. มิสเตอร์ซี',
      [`หลักร้อย: แสนรางวัลที่ 1×3 + หมื่นรางวัลที่ 1×2 + ร้อยท้าย#1×3 - 2 = ${m.f1H}`,
       `หลักสิบ: แสนรางวัลที่ 1 + สิบล่าง + ร้อยหน้า#1 + ร้อยท้าย#1×3 + 4 = ${m.f1T}`,
       `หลักหน่วย: แสนรางวัลที่ 1 + ร้อยรางวัลที่ 1×2 + สิบรางวัลที่ 1 + ร้อยท้าย#2×2 - 1 = ${m.f1U}`],
      M.formula1,'แกะจากคลิป pZI5wD5WzzE: ใช้รางวัลที่ 1, 3 ตัวบน, 2 ตัวล่าง, หน้า 3 และท้าย 3')
    ,
    _mkFormulaCard('มิสเตอร์ซี 2 · สูตรเสริมรางวัลที่ 1 + ล่าง','H. มิสเตอร์ซี',
      [`หลักร้อย: แสน + ร้อย×2 + หน่วย + สิบล่าง×4 + 8 = ${m.f2H}`,
       `หลักสิบ: แสน×2 + หมื่น×3 + สิบล่าง×3 + 8 = ${m.f2T}`,
       `หลักหน่วย: แสน×3 + หมื่น + สิบ×2 + สิบล่าง + 1 = ${m.f2U}`],
      M.formula2,'สูตรเสริมในคลิป ใช้เฉพาะรางวัลที่ 1 และเลขท้าย 2 ตัวล่าง')
    ,
    _mkFormulaCard('มิสเตอร์ซี 3 · จับคู่สองสูตรสูงสุด 8 ชุด','H. มิสเตอร์ซี',
      [`หลักร้อยจากสองสูตร: ${m.f1H}, ${m.f2H}`,
       `หลักสิบจากสองสูตร: ${m.f1T}, ${m.f2T}`,
       `หลักหน่วยจากสองสูตร: ${m.f1U}, ${m.f2U}`,
       `จับทุกความเป็นไปได้แบบไม่ซ้ำ ได้ ${M.combo.length} ชุด`],
      M.combo,'ใช้เมื่ออยากขยายจากชุดเดียวเป็นกรอบ 3 ตัวบนตรง สูงสุด 8 ชุดเมื่อแต่ละหลักไม่ซ้ำกัน')
  ];
}

function _mkFormulaCard(title, source, steps, highlights, note='', trust=null){
  const group=_formulaGroupKey(source,title);
  const badges=highlights.map(h=>`<span class="num-badge">${h}</span>`).join('');
  const resultHtml=badges||note||'<span style="font-size:.78rem;color:var(--text3)">ผลลัพธ์อยู่ในรายละเอียดสูตร</span>';
  const stepHtml=steps.map(s=>`<div class="formula-step">${s}</div>`).join('');
  const target=_formulaTargetLabel(title,source,highlights);
  const count=highlights.length?`${highlights.length} ชุด`:'ชุดคำนวณเฉพาะ';
  const quality=_formulaQualityBadges(title,source,highlights);
  const stepsLabel=String(source||"").startsWith("HM")?"วิธีคำนวณและข้อจำกัด":"ดูวิธีคำนวณ";
  const noteHtml=(badges&&note)?`<div style="font-size:.72rem;color:var(--text3);font-style:italic;margin-top:6px">${note}</div>`:'';
  const trustHtml=trust?`<span class="trust-badge">${trust}</span>`:'';
  return `<div class="card formula-card" data-group="${group}">
    <h2 class="card-title">${title}${trustHtml}</h2>
    <div style="font-size:.7rem;color:var(--text3);margin-top:3px">${source}</div>
    <div class="formula-meta"><span class="formula-chip target">${target}</span><span class="formula-chip">${count}</span>${quality}</div>
    <div class="formula-result-row">${resultHtml}</div>
    ${noteHtml}
    <details class="formula-steps">
      <summary>${stepsLabel}</summary>
      <div style="margin-top:7px">${stepHtml||'<div class="formula-step">ไม่มีขั้นตอนเพิ่มเติม</div>'}</div>
    </details>
  </div>`;
}

function _formulaQualityBadges(title,source,highlights=[]){
  const n=highlights.length;
  const out=[];
  if(n===1)out.push(['single','สูตรชุดเดียว']);
  else if(n>12)out.push(['wide','ชุดใหญ่']);
  else if(n>0&&n<=5)out.push(['good','โฟกัส']);
  const bt=_formulaBacktestProfileForTitle(title,source);
  if(bt?.degraded)out.push(['bad','ต่ำกว่าสุ่ม']);
  else if(bt?.edge200!=null)out.push(['bt',`200งวด ${bt.edge200>=0?'+':''}${bt.edge200.toFixed(1)}%`]);
  else if(source.startsWith('G.')||source.startsWith('H.')||title.startsWith('X'))out.push(['bt','Backtest']);
  return out.map(([cls,label])=>`<span class="formula-quality ${cls}">${label}</span>`).join('');
}

function _formulaGroupKey(source,title=''){
  const s=String(source||title||'').trim();
  if(s.startsWith('FANO.'))return 'FANO';
  if(s.startsWith('RLL'))return 'RLL';
  if(s.startsWith('A.'))return 'A';
  if(s.startsWith('B.'))return 'B';
  if(s.startsWith('C.'))return 'C';
  if(s.startsWith('D.'))return 'D';
  if(s.startsWith('E.'))return 'E';
  if(s.startsWith('F.'))return 'F';
  if(s.startsWith('G.'))return 'G';
  if(s.startsWith('H.'))return 'H';
  if(s.startsWith('HM'))return 'HM';
  if(title.startsWith('X'))return 'F';
  return 'A';
}

function _formulaTargetLabel(title,source,highlights=[]){
  if(title.startsWith('RLL'))return 'Target: รางวัลที่ 1 ตรง 6 หลัก';
  if(title.startsWith('D2')||title.startsWith('X2'))return 'Target: front 3';
  if(title.startsWith('D3')||title.startsWith('X3')||title.startsWith('C3'))return 'Target: back 3';
  if(title.startsWith('D4')||title.startsWith('X4')||title.includes('2530'))return 'Target: prize1 tail';
  if(/ท้าย3.*ทางการ/.test(title))return 'Target: เลขท้าย 3 ตัวทางการ (2 รางวัล · 4,000฿)';
  if(/ท้าย3/.test(title))return 'Target: ท้าย 3 ตัว pool 1-4 (ใต้ดิน · ~64/1000)';
  if(/Pool 1-4/.test(title))return 'Target: เลขเต็ม 6 หลัก (pool 1-4 · 66 เลข)';
  if(/เลขเต็ม6หลัก/.test(title))return 'Target: เลขเต็ม 6 หลัก (pool 1-5 · 168 เลข)';
  if(highlights.some(h=>String(h).length===1))return 'Target: digit/run';
  if(highlights.some(h=>String(h).length===3))return 'Target: 3-digit';
  if(highlights.some(h=>String(h).length>=4))return 'Target: prize1';
  return 'Target: bottom 2 / mixed';
}

function _groupFormulaCards(cards){
  const groups={A:[],B:[],C:[],D:[],G:[],H:[]};
  for(const html of cards){
    if(html.includes('data-group="A"'))groups.A.push(html);
    else if(html.includes('data-group="B"'))groups.B.push(html);
    else if(html.includes('data-group="C"'))groups.C.push(html);
    else if(html.includes('data-group="D"'))groups.D.push(html);
    else if(html.includes('data-group="G"'))groups.G.push(html);
    else if(html.includes('data-group="H"'))groups.H.push(html);
  }
  return groups;
}

function _renderFormulaSummary({grouped,codexCards,patternCards=[],eCards,imperialCards,tycoonCards,hermesCards,fanoCards=0,rllCards=0,targetDate}){
  const el=document.getElementById('formula-summary');
  if(!el)return;
  const counts={
    A:grouped.A.length,
    B:grouped.B.length,
    C:grouped.C.length,
    D:grouped.D.length,
    G:grouped.G.length,
    H:grouped.H.length,
    F:codexCards.length+patternCards.length,
    E:eCards.length,
    I:(imperialCards||[]).length,
    J:(tycoonCards||[]).length,
    HM:(hermesCards||[]).length,
    FANO:fanoCards,
    RLL:rllCards,
  };
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const targetLabel=targetDate?(()=>{
    const [y,m,d]=targetDate.split('-').map(Number);
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y+543}`;
  })():'-';
  el.innerHTML=[
    ['งวดเป้าหมาย',targetLabel,'อ้างอิงจากงวดก่อนหน้า'],
    ['สูตรทั้งหมด',total,'รวมทุกหมวดที่คำนวณแล้ว'],
    ['สูตร 2 ตัว',counts.A+counts.B+counts.E,'พื้นบ้าน · Lottery+ · สายมู'],
    ['สูตร 3 ตัว/รางวัล',counts.C+counts.D+counts.F+counts.G+counts.H,'พิชิตโชค · Arithmetic · Rolling Stats · Pattern Link · แม่นขั้นเทพ · มิสเตอร์ซี'],
    ['สูตร 6 ตัว (pool 1-5)',counts.I,'จักรพรรดิ'],
    ['สูตร Hermes (pool 1-4)',counts.HM,'Hermes · ทดลอง'],
    ['รางวัลที่ 1 · สมมติฐาน',counts.FANO,'ระนาบฟาโน v4 + v5 · แยกจาก Picks · เลือก 2 เลขจากโมเดลย้อนหลัง'],
    ['RLL · LLM สด',counts.RLL,'เรียนจากจำนวนหลักที่ตรง ไม่ใช่เงินรางวัล · ยังไม่มีหลักฐาน'],
  ].map(([label,value,sub])=>`<div class="formula-summary-item"><div class="formula-summary-label">${label}</div><div class="formula-summary-value">${value}</div><div class="formula-summary-sub">${sub}</div></div>`).join('');
  el.classList.add('active');
}

function _formulaPanelHtml(html,tabName){
  return html&&html.trim()?html:`<div class="formula-tab-empty" style="display:block;grid-column:1/-1">ยังไม่มีผลในหมวด ${tabName}</div>`;
}
