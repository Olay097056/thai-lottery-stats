// ─── ไม่รู้ซื้ออะไรดี (Mix page) ──────────────────────────────────────────────────
// หน้า standalone ของสูตร "ไม่รู้ซื้อเหี้ยไรดี" (Mix — ดู CONTEXT.md) — จงใจไม่แตะ
// Picks/เลขแนะนำ: อ่านผลสูตรผ่าน dcComputeFormulaResults แล้วผสมเองด้วย _mixCompute
// Track record แยก localStorage ('lottery_mix_snapshots') ไม่ปนกับ Decision Center

function mixSnapshotPayloadIsValid(value){
  return Array.isArray(value)&&value.every(snapshot=>snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)
    &&typeof snapshot.date==='string'&&snapshot.date.trim()!==''
    &&(snapshot.picks===undefined||(Array.isArray(snapshot.picks)&&snapshot.picks.every(pick=>typeof pick==='string'&&/^\d{6}$/.test(pick)))));
}
function mixSnapshots(){
  LotteryUiState.mix.snapshotReadError=null;
  let raw;
  try{raw=localStorage.getItem('lottery_mix_snapshots');}
  catch(e){LotteryUiState.mix.snapshotReadError='unavailable';return null;}
  if(raw===null)return [];
  let value;
  try{value=JSON.parse(raw);}
  catch(e){LotteryUiState.mix.snapshotReadError='malformed';return null;}
  if(!mixSnapshotPayloadIsValid(value)){LotteryUiState.mix.snapshotReadError='malformed';return null;}
  return value;
}
function mixAutoSaveSnapshot(snap,snapshots){
  try{
    if(arguments.length<2)snapshots=mixSnapshots();
    if(!Array.isArray(snapshots))return false;
    const list=snapshots;
    if(list.some(x=>x.date===snap.date))return true;
    if(typeof reportStoreCanWrite==='function'&&!reportStoreCanWrite('lottery_mix_snapshots'))return false;
    list.unshift({...snap,schema_version:2,savedAt:new Date().toISOString()});
    localStorage.setItem('lottery_mix_snapshots',JSON.stringify(list));
    return true;
  }catch(e){return false;}
}
// pool ที่ใช้ตัดสิน hit ของ Mix = pool6 (prize1 + near1 + prize2-5) ของงวดผลจริง
function mixPoolForRow(row){
  const pool=new Set();
  const scalarFields=[
    'near1_1','near1_2',
    'prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
    'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10',
  ];
  scalarFields.forEach(key=>{
    const value=String(row?.[key]??'').trim();
    if(/^[0-9]{6}$/.test(value))pool.add(value);
  });
  ['prize4','prize5'].forEach(key=>{
    String(row?.[key]??'').trim().split(/\s+/).forEach(value=>{
      if(/^[0-9]{6}$/.test(value))pool.add(value);
    });
  });
  const p1=String(row?.prize1??'');
  if(/^[0-9]{6}$/.test(p1))pool.add(p1);
  return pool;
}
function mixPoolIsComplete(row){
  if(!/^\d{6}$/.test(String(row?.prize1??'')))return false;
  const scalarFields=[
    'near1_1','near1_2',
    'prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
    'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10',
  ];
  const scalarComplete=scalarFields.every(key=>{
    const raw=String(row?.[key]??'').trim();
    return /^\d{6}$/.test(raw);
  });
  const listComplete=(value,count)=>{
    const tokens=String(value??'').trim().split(/\s+/).filter(Boolean);
    return tokens.length===count&&tokens.every(token=>/^\d{6}$/.test(token))&&new Set(tokens).size===count;
  };
  return scalarComplete&&listComplete(row?.prize4,50)&&listComplete(row?.prize5,100);
}
function mixSnapshotResult(s,rows){
  const picksValue=s?.picks;
  if(picksValue!==undefined&&(!Array.isArray(picksValue)||!picksValue.every(pick=>typeof pick==='string'&&/^\d{6}$/.test(pick))))
    return {status:'unverifiable',hits:0,poolSize:0};
  const picks=Array.isArray(picksValue)?picksValue:[];
  if(!picks.length)return {status:'no-picks',hits:0,poolSize:0};
  const actual=dcActualForDate(rows,s?.date);
  if(!actual)return {status:'pending',hits:0,poolSize:0};
  const pool=mixPoolForRow(actual);
  const hits=picks.filter(n=>pool.has(String(n))).length;
  const status=hits>0?'hit':mixPoolIsComplete(actual)?'miss':'unverifiable';
  return {status,hits,poolSize:pool.size};
}
function mixHitRateTrend(snapshots,rows,window=5,take=20){
  const resolved=(snapshots||[])
    .map(s=>({date:s.date,...mixSnapshotResult(s,rows)}))
    .filter(r=>r.status==='hit'||r.status==='miss')
    .sort((a,b)=>a.date.localeCompare(b.date));
  return dcRollingRate(resolved,window,take);
}
function mixTrackStatusBadge(status){
  if(status==='unverifiable')return '<span class="dc-status warn">ตรวจไม่ได้</span>';
  if(status==='no-picks')return '<span class="dc-status warn">ไม่มีชุดให้ตรวจ</span>';
  return dcTrackStatusBadge(status);
}
function mixSnapshotHistoryErrorHtml(){
  const reason=LotteryUiState.mix.snapshotReadError==='malformed'?'รูปแบบข้อมูลไม่ถูกต้อง':'เบราว์เซอร์ไม่อนุญาตให้อ่านข้อมูล';
  return `<section class="feature-state feature-state-error mix-history-error" role="alert"><div class="feature-state-mark" aria-hidden="true">!</div><div><h2>อ่านประวัติ Mix ไม่ได้</h2><p>${reason} ข้อมูลเดิมยังอยู่และจะไม่ถูกเขียนทับ การบันทึกหรือลบประวัติถูกพักไว้จนกว่าจะอ่านได้</p><div class="mix-history-actions"><button type="button" class="btn btn-secondary" onclick="mixDownloadSnapshotBackup()">ดาวน์โหลดข้อมูลเดิม</button><button type="button" class="btn" onclick="loadMixPage()">ลองอ่านอีกครั้ง</button></div></div></section>`;
}
function mixShowSnapshotHistoryError(){
  const el=document.getElementById('mix-track-list');
  if(el)el.innerHTML=mixSnapshotHistoryErrorHtml();
}
function mixTrackHtml(rows,list){
  if(arguments.length<2)list=mixSnapshots();
  if(!Array.isArray(list))return mixSnapshotHistoryErrorHtml();
  if(!list.length)return '<div id="mix-history-empty" class="dash-empty" tabindex="-1">ยังไม่มีประวัติ — ระบบจะบันทึกผลครั้งแรกของแต่ละงวดอัตโนมัติ</div>';
  return `<div class="dc-snapshot-list">${list.map((s,i)=>{
    const r=mixSnapshotResult(s,rows);
    return `<details class="dc-snapshot-item" ${i===0?'open':''}>
      <summary><span>${fmtDate(s.date)}</span><span style="display:flex;gap:6px;align-items:center"><span class="dc-status">${(s.picks||[]).length} ชุด</span>${mixTrackStatusBadge(r.status)}</span></summary>
      <div class="dc-snapshot-detail">
        <div class="dc-row">${(s.picks||[]).map(n=>`<span class="num-badge">${escHtml(n)}</span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
        <div class="dc-signal-sub" style="margin-top:7px">${r.status==='pending'?'รอผลงวดนี้':r.status==='unverifiable'?'ข้อมูลรางวัลที่ 1–5 ไม่ครบ — ไม่นับเป็นถูก/พลาด':r.status==='no-picks'?'ไม่มีชุดตัวเลขใน Snapshot — ไม่นับเป็นถูก/พลาด':`ถูกใน pool รางวัลที่ 1-5: ${r.hits}/${(s.picks||[]).length} ชุด · pool ${r.poolSize} ใบ`} · บันทึก ${s.savedAt?new Date(s.savedAt).toLocaleString('th-TH'):'-'}</div>
        <div class="dc-snapshot-actions"><button type="button" class="dc-mini-btn" id="mix-history-delete-${i}" data-mix-date="${escHtml(s.date)}" onclick="mixDeleteSnapshot(this.dataset.mixDate)">ลบ</button></div>
      </div>
    </details>`;
  }).join('')}${list.length>1?'<button class="dc-mini-btn" onclick="mixClearSnapshots()">ลบประวัติทั้งหมด</button>':''}</div>`;
}
function mixDeleteSnapshot(date){
  const snapshots=mixSnapshots();
  if(!Array.isArray(snapshots)){mixShowSnapshotHistoryError();return false;}
  const index=snapshots.findIndex(snapshot=>snapshot.date===date);
  try{
    const deleted=deleteWithUndo('lottery_mix_snapshots','ลบประวัติแล้ว',()=>{
      try{localStorage.setItem('lottery_mix_snapshots',JSON.stringify(snapshots.filter(x=>x.date!==date)));return true;}
      catch(e){if(typeof toast==='function')toast('ลบประวัติไม่ได้ — ข้อมูลเดิมยังอยู่','error');return false;}
    },()=>{
      const el=document.getElementById('mix-track-list');
      if(el)el.innerHTML=mixTrackHtml(LotteryServerData.mix.history);
    });
    if(!deleted)return false;
    const remaining=mixSnapshots();
    if(Array.isArray(remaining)){
      const focusId=remaining.length
        ?`mix-history-delete-${Math.min(Math.max(index,0),remaining.length-1)}`
        :'mix-history-empty';
      const focusTarget=document.getElementById(focusId);
      if(focusTarget)focusTarget.focus();
    }
    return true;
  }catch(e){if(typeof toast==='function')toast('อ่านประวัติเดิมไม่ได้ — ข้อมูลยังไม่ถูกลบ','error');return false;}
}
function mixClearSnapshots(){
  const snapshots=mixSnapshots();
  if(!Array.isArray(snapshots)){mixShowSnapshotHistoryError();return false;}
  if(!confirm('ลบประวัติ Mix ทั้งหมดหรือไม่?'))return false;
  try{
    const deleted=deleteWithUndo('lottery_mix_snapshots','ลบประวัติทั้งหมดแล้ว',()=>{
      try{localStorage.removeItem('lottery_mix_snapshots');return true;}
      catch(e){if(typeof toast==='function')toast('ลบประวัติไม่ได้ — ข้อมูลเดิมยังอยู่','error');return false;}
    },()=>{
      const el=document.getElementById('mix-track-list');
      if(el)el.innerHTML=mixTrackHtml(LotteryServerData.mix.history);
    });
    if(!deleted)return false;
    const emptyState=document.getElementById('mix-history-empty');
    if(emptyState)emptyState.focus();
    return true;
  }catch(e){if(typeof toast==='function')toast('อ่านประวัติเดิมไม่ได้ — ข้อมูลยังไม่ถูกลบ','error');return false;}
}
function mixDownloadSnapshotBackup(){
  let raw;
  try{raw=localStorage.getItem('lottery_mix_snapshots');}
  catch(e){if(typeof toast==='function')toast('อ่านข้อมูลสำรองไม่ได้ — ข้อมูลเดิมไม่ได้ถูกแก้','error');return false;}
  if(raw===null){if(typeof toast==='function')toast('ไม่พบประวัติ Mix ที่ดาวน์โหลดได้','error');return false;}
  try{
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='lottery_mix_snapshots_backup.json';
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),0);
    return true;
  }catch(e){if(typeof toast==='function')toast('ดาวน์โหลดข้อมูลสำรองไม่สำเร็จ — ข้อมูลเดิมยังอยู่','error');return false;}
}
// ปุ่มสุ่มหยิบ 1 ใบ — ถ่วงน้ำหนักตามอันดับ (ชุดที่ i จาก N ชุด มีน้ำหนัก N-i)
function mixRandomPick(){
  if(LotteryUiState.mix.sourceStale){if(typeof toast==='function')toast('ผล Mix ใช้ข้อมูลก่อนรีเฟรช · คำนวณใหม่ก่อนสุ่มหยิบเลข','error');return false;}
  if(!LotteryServerData.mix.predictions.length)return;
  const weights=LotteryServerData.mix.predictions.map((_,i)=>LotteryServerData.mix.predictions.length-i);
  const total=weights.reduce((a,b)=>a+b,0);
  let r=Math.random()*total,idx=0;
  for(let i=0;i<weights.length;i++){r-=weights[i];if(r<=0){idx=i;break;}}
  const el=document.getElementById('mix-random-result');
  if(el)el.innerHTML=`<span class="mix-random-num">${escHtml(LotteryServerData.mix.predictions[idx])}</span><span class="dc-signal-sub" style="margin-left:8px">อันดับ ${idx+1} · น้ำหนัก ${weights[idx]}/${total}</span>`;
}

