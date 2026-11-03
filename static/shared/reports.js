var LotteryReports = (() => {
const REPORT_SCHEMA_VERSION=2;
const snapshotReadErrors=new Map();
function canonicalReportDate(value){
  if(typeof value!=='string')return null;
  const iso=/^(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00:00)?$/.exec(value);
  const local=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const text=iso?iso.slice(1,4).join('-'):local?[local[3],local[2],local[1]].join('-'):null;
  if(!text)return null;
  const date=new Date(text+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text?text:null;
}
function latestEligibleDate(rows,target){
  const cutoff=canonicalReportDate(target);
  if(!cutoff)return null;
  return (rows||[]).map(row=>canonicalReportDate(row.date)).filter(date=>date&&date<cutoff).sort().at(-1)||null;
}
function reportDisplayTime(value){
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}):'ไม่ระบุ';
}
function buildReportProvenance(method,target,settings={},source={}){
  return {schema_version:REPORT_SCHEMA_VERSION,method,engine_version:'legacy-formulas-v1',
    generated_at:new Date().toISOString(),target_date:target,source:'loaded_or_manual_inputs',
    history_cutoff:null,data_version:null,...source,settings:JSON.parse(JSON.stringify(settings))};
}
function reportProvenanceHtml(provenance){
  if(!provenance)return '<p class="report-lineage">รายงานรุ่นเก่า · ไม่ได้บันทึกเวอร์ชันสูตรหรือแหล่งข้อมูล</p>';
  const sourceLabel={loaded_history:'ประวัติที่โหลดสำหรับคำนวณ',loaded_or_manual_inputs:'ประวัติที่โหลดหรือข้อมูลที่กรอก',existing_local_cache:'แคชเดิมในเครื่อง'}[provenance.source]||provenance.source||'ไม่ระบุ';
  const scopeLabel=provenance.data_version_scope==='eligible_dataframe'?'ข้อมูลก่อนงวดเป้าหมาย':provenance.data_version_scope||'ไม่ระบุขอบเขต';
  const digest=provenance.data_version?`<details class="report-digest"><summary>ลายนิ้วมือข้อมูล · ${escHtml(scopeLabel)}</summary><div class="report-digest-content"><code class="report-digest-value">${escHtml(provenance.data_version)}</code><button type="button" class="btn btn-secondary report-digest-copy" data-fingerprint="${escHtml(provenance.data_version)}" onclick="copyReportFingerprint(this.dataset.fingerprint)">คัดลอก</button></div></details>`:'';
  return `<dl class="report-lineage"><div><dt>วิธี / เวอร์ชัน</dt><dd>${escHtml(provenance.method||'ไม่ระบุ')} · ${escHtml(provenance.engine_version||'ไม่ระบุ')}</dd></div><div><dt>สร้างผลเมื่อ</dt><dd>${escHtml(reportDisplayTime(provenance.generated_at))}</dd></div><div><dt>ข้อมูลที่ใช้ถึง</dt><dd>${escHtml(provenance.history_cutoff||'ไม่ได้บันทึก')+(provenance.history_cutoff&&/^\d{2}\/\d{2}\/\d{4}$/.test(provenance.history_cutoff)?' · ข้อมูลอ้างอิงรูปแบบเดิม ยังไม่ได้ยืนยันวันที่ cutoff':'')}</dd></div><div><dt>แหล่งข้อมูล</dt><dd>${escHtml(sourceLabel)}</dd></div></dl>${digest}`;
}
function copyReportFingerprint(value){
  const text=String(value||'');
  if(!text)return Promise.resolve(false);
  const copied=()=>toast('คัดลอกลายนิ้วมือข้อมูลแล้ว','success');
  const fallback=()=>{
    try{
      const field=document.createElement('textarea');
      field.value=text;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';
      document.body.appendChild(field);field.select();
      const ok=document.execCommand?.('copy')===true;
      field.remove();
      if(!ok)throw new Error('clipboard unavailable');
      copied();return Promise.resolve(true);
    }catch(e){toast('คัดลอกไม่ได้ — เลือกลายนิ้วมือแล้วกด Ctrl+C','error');return Promise.resolve(false);}
  };
  if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText){
    return navigator.clipboard.writeText(text).then(()=>{copied();return true;}).catch(fallback);
  }
  return fallback();
}
function showReportDraft(key,provenance){
  const host=document.getElementById(key+'-report-origin');
  if(host)host.innerHTML='<strong>ผลคำนวณปัจจุบัน · ยังไม่บันทึก</strong>'+reportProvenanceHtml(provenance);
}
function exportLocalReports(){
  const keys=['lottery_predict_snapshots','lottery_formula_snapshots','lottery_dc_snapshots','lottery_dc_snapshots_old','lottery_mix_snapshots','lottery_buyplan_history'];
  const stores={},storeErrors={};
  keys.forEach(key=>{
    let raw;
    try{raw=localStorage.getItem(key);}
    catch(e){stores[key]=null;storeErrors[key]={status:'unavailable'};return;}
    if(raw===null){stores[key]=[];return;}
    let value;
    try{value=JSON.parse(raw);}
    catch(e){stores[key]=null;storeErrors[key]={status:'malformed_json',raw};return;}
    if(!Array.isArray(value)){stores[key]=null;storeErrors[key]={status:'unexpected_shape',raw};return;}
    stores[key]=value;
  });
  try{
    const errors=Object.keys(storeErrors);
    const payload={schema_version:REPORT_SCHEMA_VERSION,exported_at:new Date().toISOString(),stores};
    if(errors.length)payload.store_errors=storeErrors;
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='lottery-reports-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast(errors.length?`ส่งออกแล้ว · มี ${errors.length} รายการที่อ่านไม่ได้ ดูรายละเอียดและข้อมูลดิบในไฟล์`:'ส่งออกบันทึกในเบราว์เซอร์แล้ว','success');
    return true;
  }catch{toast('ส่งออกไม่ได้ กรุณาตรวจพื้นที่จัดเก็บของเบราว์เซอร์','error');return false;}
}

function resetReportDrafts(){
  for(const key of ['predict','formula']){
    const host=document.getElementById(key+'-report-origin');
    if(host)host.textContent='งวดที่เลือกยังไม่มีผลคำนวณใหม่ · กดคำนวณเพื่อดูรายงาน';
  }
}

function reportStoreCanWrite(key){
  try{
    const raw=localStorage.getItem(key);
    if(raw===null)return true;
    const values=JSON.parse(raw);
    return Array.isArray(values)&&values.every(value=>value&&typeof value==='object'&&!Array.isArray(value));
  }catch{return false;}
}
function pageSnapshotReadError(key){return snapshotReadErrors.get(key)||null;}
function pageSnapshotRecordIsValid(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))return false;
  if(snapshot.items!==undefined&&(!Array.isArray(snapshot.items)||snapshot.items.some(item=>!item||typeof item!=='object'||Array.isArray(item))))return false;
  const categories=snapshot.report?.categories;
  if(categories!==undefined&&categories!==null&&(typeof categories!=='object'||Array.isArray(categories)||Object.values(categories).some(category=>!category||typeof category!=='object'||Array.isArray(category))))return false;
  return true;
}
function pageSnapshotErrorHtml(key){
  const label=key==='formula'?'สูตรคำนวณ':'หน้าทำนาย';
  const reason=pageSnapshotReadError(key)==='malformed'?'รูปแบบข้อมูลไม่ถูกต้อง':'เบราว์เซอร์ไม่อนุญาตให้อ่านข้อมูล';
  return `<section class="feature-state feature-state-error report-snapshot-error" role="alert"><div class="feature-state-mark" aria-hidden="true">!</div><div><h2>อ่าน Snapshot ${label} ไม่ได้</h2><p>${reason} ข้อมูลเดิมยังอยู่และจะไม่ถูกเขียนทับ การบันทึก โหลด หรือลบ Snapshot ถูกพักไว้จนกว่าจะอ่านได้</p><div class="report-snapshot-actions"><button type="button" class="btn btn-secondary" onclick="downloadPageSnapshotBackup('${key}')">ดาวน์โหลดข้อมูลดิบ</button><button type="button" class="btn" onclick="renderPageSnapshots('${key}')">ลองอ่านอีกครั้ง</button></div></div></section>`;
}
function savedReportHtml(report){
  if(!report||!report.categories)return '';
  const partial=report.report_status==='partial';
  const summary=partial?'ผลที่บันทึก · บางหมวดไม่สำเร็จ':'ผลที่บันทึกครบทุกหมวด';
  const warning=partial?'<p class="dc-signal-sub" role="note">Snapshot นี้บันทึกขณะมีบางหมวดคำนวณไม่สำเร็จ ตัวเลขที่แสดงมีเฉพาะหมวดที่สำเร็จ</p>':'';
  return `<details class="saved-full-report"><summary>${summary}</summary>${warning}${Object.values(report.categories).map(category=>`<section><strong>${escHtml(category.label||'ไม่ระบุหมวด')}</strong><div>${Array.isArray(category.numbers)?category.numbers.map(row=>`<span class="num-badge">${escHtml(typeof row==='string'?row:predNum(row))}</span>`).join(''):''}</div>${category.error?`<p>${escHtml(category.error)}</p>`:''}</section>`).join('')}</details>`;
}
function pageSnapshots(key){
  const storageKey=`lottery_${key}_snapshots`;
  let raw;
  try{raw=localStorage.getItem(storageKey);}
  catch(e){snapshotReadErrors.set(key,'unavailable');return null;}
  if(raw===null){snapshotReadErrors.delete(key);return [];}
  let list;
  try{list=JSON.parse(raw);}
  catch(e){snapshotReadErrors.set(key,'malformed');return null;}
  if(!Array.isArray(list)||list.some(value=>!pageSnapshotRecordIsValid(value))){snapshotReadErrors.set(key,'malformed');return null;}
  snapshotReadErrors.delete(key);
  return list;
}

function savePageSnapshot(key,snap){
  const list=pageSnapshots(key);
  if(!Array.isArray(list)){renderPageSnapshots(key);toast('อ่าน Snapshot เดิมไม่ได้ — ดาวน์โหลดข้อมูลดิบก่อนแก้ไข','error');return false;}
  if(typeof reportStoreCanWrite==='function'&&!reportStoreCanWrite('lottery_'+key+'_snapshots')){renderPageSnapshots(key);toast('บันทึกเดิมอ่านไม่ได้ กรุณาสำรองข้อมูลก่อนแก้ไข','error');return false;}
  const savedAt=new Date().toISOString();
  const id=String(snap.id||key)+'_'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now()+'_'+Math.random().toString(36).slice(2));
  const saved=JSON.parse(JSON.stringify({...snap,id,schema_version:2,savedAt}));
  list.unshift(saved);
  try{localStorage.setItem(`lottery_${key}_snapshots`,JSON.stringify(list));}
  catch{toast('บันทึกไม่ได้ พื้นที่จัดเก็บอาจเต็ม ส่งออกบันทึกแล้วลองใหม่','error');return false;}
  renderPageSnapshots(key);
  const panel=document.getElementById(key+'-snapshot-panel');
  if(panel)panel.open=true;
  const origin=document.getElementById(key+'-report-origin');
  if(origin)origin.innerHTML='<strong>บันทึกรายงานนี้แล้ว · ผลเดิมถูกเก็บแยกจากการคำนวณครั้งต่อไป</strong>'+(typeof reportProvenanceHtml==='function'?reportProvenanceHtml(saved.provenance):'');
  toast('บันทึกรายงานใหม่แล้ว ผลเดิมยังอยู่','success');
}

function renderPageSnapshots(key){
  const el=document.getElementById(`${key}-snapshot-list`);
  if(!el)return;
  const list=pageSnapshots(key);
  const count=document.getElementById(`${key}-snapshot-count`);
  if(!Array.isArray(list)){
    if(count)count.textContent='อ่านไม่ได้';
    el.innerHTML=pageSnapshotErrorHtml(key);
    return;
  }
  if(count)count.textContent=`${list.length} รายการ`;
  if(!list.length){el.innerHTML=`<div id="${key}-snapshot-empty" class="dash-empty" tabindex="-1">ยังไม่มี Snapshot</div>`;return;}
  el.innerHTML=`<div class="dc-snapshot-list">${list.map((s,i)=>`<details class="dc-snapshot-item" ${i===0?'open':''}>
    <summary><span>${escHtml(s.title||fmtDate(s.date))}</span><span style="display:flex;gap:6px;align-items:center">${s.report?.report_status==='partial'?'<span class="dc-status warn" aria-label="รายงานนี้คำนวณไม่ครบทุกหมวด" title="มีบางหมวดคำนวณไม่สำเร็จ">ไม่ครบทุกหมวด</span>':''}<span class="dc-status">${escHtml(s.mode||s.kind||'saved')}</span></span></summary>
    <div class="dc-snapshot-detail">
      <div class="dc-row">${(s.items||[]).map(p=>`<span class="num-badge">${p.formula?`<span style="font-size:.58rem;margin-right:4px;color:var(--text3)">${escHtml(p.formula)}</span>`:''}${escHtml(p.num)}${p.score!=null?`<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">${escHtml(p.score)}</span>`:''}</span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
      ${typeof reportProvenanceHtml==='function'?reportProvenanceHtml(s.provenance):''}
      ${typeof savedReportHtml==='function'?savedReportHtml(s.report):''}
      ${s.note?`<div class="dc-signal-sub" style="margin-top:7px">${escHtml(s.note)}</div>`:''}
      <div class="dc-signal-sub" style="margin-top:7px">บันทึก ${s.savedAt?new Date(s.savedAt).toLocaleString('th-TH'):'-'}</div>
      <div class="dc-snapshot-actions">
        ${s.date?`<button type="button" class="dc-mini-btn" data-snapshot-id="${escHtml(s.id)}" onclick="loadPageSnapshot('${key}',this.dataset.snapshotId)">คำนวณใหม่งวดนี้</button>`:''}
        <button type="button" id="${key}-snapshot-delete-${i}" class="dc-mini-btn" data-snapshot-id="${escHtml(s.id)}" onclick="deletePageSnapshot('${key}',this.dataset.snapshotId)">ลบ</button>
      </div>
    </div>
  </details>`).join('')}${list.length>1?`<button class="dc-mini-btn" onclick="clearPageSnapshots('${key}')">ลบ Snapshot ทั้งหมด</button>`:''}</div>`;
}

function loadPageSnapshot(key,id){
  const list=pageSnapshots(key);
  if(!Array.isArray(list)){renderPageSnapshots(key);return false;}
  const snap=list.find(x=>x.id===id);
  if(!snap)return;
  if(key==='predict'&&snap.date){
    syncSharedDrawDate(snap.date);
    if(snap.topn)document.getElementById('pred-topn').value=snap.topn;
    if(snap.preset)document.getElementById('p1-preset').value=snap.preset;
    loadPredict();
  }else if(key==='formula'&&snap.date){
    syncSharedDrawDate(snap.date);
    autoFillFormula(true);
  }
}

function deletePageSnapshot(key,id){
  const storageKey=`lottery_${key}_snapshots`;
  const list=pageSnapshots(key);
  if(!Array.isArray(list)){renderPageSnapshots(key);toast('อ่าน Snapshot เดิมไม่ได้ — ข้อมูลยังไม่ถูกลบ','error');return false;}
  const index=list.findIndex(snapshot=>snapshot.id===id);
  try{
    const deleted=deleteWithUndo(storageKey,'ลบ Snapshot แล้ว',()=>{
    try{localStorage.setItem(storageKey,JSON.stringify(list.filter(x=>x.id!==id)));return true;}
    catch(e){toast('ลบ Snapshot ไม่ได้ — ข้อมูลเดิมยังอยู่','error');return false;}
    },()=>renderPageSnapshots(key));
    if(!deleted)return false;
    const remaining=pageSnapshots(key);
    const target=Array.isArray(remaining)&&remaining.length
      ?document.getElementById(`${key}-snapshot-delete-${Math.min(Math.max(index,0),remaining.length-1)}`)
      :document.getElementById(`${key}-snapshot-empty`);
    target?.focus();
    return true;
  }
  catch(e){toast('อ่าน Snapshot เดิมไม่ได้ — ข้อมูลยังไม่ถูกลบ','error');return false;}
}

function clearPageSnapshots(key){
  const list=pageSnapshots(key);
  if(!Array.isArray(list)){renderPageSnapshots(key);toast('อ่าน Snapshot เดิมไม่ได้ — ข้อมูลยังไม่ถูกลบ','error');return false;}
  if(!confirm('ลบ Snapshot ทั้งหมดของหน้านี้หรือไม่?'))return false;
  const storageKey=`lottery_${key}_snapshots`;
  try{
    const deleted=deleteWithUndo(storageKey,'ลบ Snapshot ทั้งหมดแล้ว',()=>{
      try{localStorage.removeItem(storageKey);return true;}
      catch(e){toast('ลบ Snapshot ไม่ได้ — ข้อมูลเดิมยังอยู่','error');return false;}
    },()=>renderPageSnapshots(key));
    if(!deleted)return false;
    document.getElementById(`${key}-snapshot-empty`)?.focus();
    return true;
  }
  catch(e){toast('อ่าน Snapshot เดิมไม่ได้ — ข้อมูลยังไม่ถูกลบ','error');return false;}
}

function downloadPageSnapshotBackup(key){
  const storageKeys={predict:'lottery_predict_snapshots',formula:'lottery_formula_snapshots'};
  const storageKey=storageKeys[key];
  if(!storageKey){toast('ไม่พบ Snapshot ที่ดาวน์โหลดได้','error');return false;}
  let raw;
  try{raw=localStorage.getItem(storageKey);}
  catch(e){toast('อ่านข้อมูลสำรองไม่ได้ — ข้อมูลเดิมไม่ได้ถูกแก้','error');return false;}
  if(raw===null){toast('ไม่พบข้อมูล Snapshot ที่ดาวน์โหลดได้','error');return false;}
  try{
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download=`lottery_${key}_snapshots_backup.json`;
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),0);
    return true;
  }catch(e){toast('ดาวน์โหลดข้อมูลสำรองไม่สำเร็จ — ข้อมูลเดิมยังอยู่','error');return false;}
}


return Object.freeze({canonicalReportDate,latestEligibleDate,reportDisplayTime,buildReportProvenance,reportProvenanceHtml,copyReportFingerprint,showReportDraft,exportLocalReports,resetReportDrafts,reportStoreCanWrite,pageSnapshotReadError,savedReportHtml,pageSnapshots,savePageSnapshot,renderPageSnapshots,loadPageSnapshot,deletePageSnapshot,clearPageSnapshots,downloadPageSnapshotBackup});
})();
Object.assign(window,LotteryReports);
