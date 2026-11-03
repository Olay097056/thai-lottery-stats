// ─── Predict ──────────────────────────────────────────────────────────────────

function predictSaveSnapshot(){
  if(LotteryUiState.predict.sourceStale){toast('ผลนี้ใช้ข้อมูลก่อนรีเฟรช · คำนวณใหม่ก่อนบันทึก Snapshot','error');return false;}
  if(!LotteryUiState.predict.lastPredictSnapshot){toast('ยังไม่มีผลทำนายให้บันทึก','error');return;}
  const target=document.getElementById('pred-date')?.value;
  if(target&&target!==LotteryUiState.predict.lastPredictSnapshot.date){toast('ผลนี้เป็นของงวดก่อน กรุณาคำนวณงวดที่เลือกก่อนบันทึก','error');return false;}
  savePageSnapshot('predict',LotteryUiState.predict.lastPredictSnapshot);
}
function markPredictDataStale(message){
  const state=LotteryUiState.predict;
  if(!state.lastPredictSnapshot&&!state.isLoading&&!LotteryServerData.predict.rows.length)return;
  state.sourceStale=true;
  if(state.isLoading){state.requestId++;state.isLoading=false;setPredictLoading(false);}
  state.lastPredictStatus=`${message} · คำนวณงวดที่เลือกใหม่ก่อนบันทึกหรือใช้งานผล`;
  const origin=document.getElementById('predict-report-origin');
  if(origin){origin.classList.add('is-stale');origin.innerHTML=`<strong>ผลทำนายอาจใช้ข้อมูลเก่า</strong><br>${escHtml(message)} · กดคำนวณใหม่เพื่ออัปเดตผลและเปิดการบันทึกอีกครั้ง <button type="button" class="btn btn-secondary" onclick="loadPredict()">คำนวณ Predict ใหม่</button>`;}
  const snapshotButton=document.getElementById('pred-save-snapshot');
  if(snapshotButton){snapshotButton.disabled=true;snapshotButton.title='ผลนี้ใช้ข้อมูลก่อนรีเฟรช · คำนวณใหม่ก่อนบันทึก';}
  setPageStatus('predict-status',state.lastPredictStatus);
}
window.markPredictDataStale=markPredictDataStale;

function formulaSaveSnapshot(){
  if(LotteryUiState.formula.activeTab==='ASTRA'){toast('Astra ใช้รายงานแยกจาก Snapshot ของสูตรทั่วไป','error');return false;}
  if(LotteryUiState.formula.sourceStale){toast('ผลสูตรใช้ข้อมูลก่อนรีเฟรช · โหลดข้อมูลล่าสุดและคำนวณใหม่ก่อนบันทึก','error');return false;}
  if(LotteryUiState.formula.autoFillPending){toast('กำลังโหลดข้อมูลงวดก่อน กรุณารอให้เสร็จก่อนบันทึก Snapshot','error');return false;}
  if(window._formulaCalculationPending){toast('กำลังคำนวณสูตร กรุณารอให้เสร็จก่อนบันทึก Snapshot','error');return false;}
  if(!LotteryUiState.formula.hasRun){toast('ยังไม่มีผลสูตรให้บันทึก กดคำนวณทุกสูตรก่อน','error');return false;}
  const date=document.getElementById('f-target-date')?.value||nextDrawInfo().iso;
  const isFano=LotteryUiState.formula.activeTab==='FANO';
  const isolatedFormula=isFano;
  const selector=isFano?'#formula-results-FANO .num-badge':'#formula-final .num-badge,#formula-results-ALL .num-badge';
  const visibleNumbers=[...document.querySelectorAll(selector)].map(x=>x.textContent.trim().replace(/\s+/g,''));
  const items=isFano?[...document.querySelectorAll('#formula-results-FANO .formula-card')].flatMap(card=>{
    const title=card.querySelector('.card-title')?.textContent||'';
    const formula=title.includes('v5')?'Fano v5':'Fano v4';
    return [...card.querySelectorAll('.num-badge')].map(chip=>({
      num:chip.textContent.trim().replace(/\s+/g,''),formula,
    }));
  }).filter(item=>/^[0-9]{6}$/.test(item.num)).slice(0,40)
    :[...new Set(visibleNumbers.filter(x=>/^[0-9]{1,6}$/.test(x)))].slice(0,40).map(num=>({num}));
  if(!items.length){toast('ยังไม่มีผลสูตรให้บันทึก กดคำนวณทุกสูตรก่อน','error');return false;}
  const activeTab=LotteryUiState.formula.activeTab||'ALL';
  savePageSnapshot('formula',{
    id:`formula_${date}`,
    provenance:(typeof window!=='undefined'?window._formulaReportProvenance||null:null),
    title:`${isFano?'ระนาบฟาโน v4 + v5 · ทดลอง':'สูตรคำนวณ'} · ${fmtDate(date)}`,
    date,
    kind:activeTab,
    items,
    note:isolatedFormula?`บันทึกชุดทดลอง ${'ระนาบฟาโน v4 + v5 (ระบุรุ่นกำกับเลขแต่ละชุด)'} จำนวน ${items.length} เลข; ไม่ได้ลงทะเบียนในผลทดลองรางวัลที่ 1`: `บันทึกจาก Formula Final/Consensus รวม ${items.length} เลข`
  });
  return true;
}
function predictConfidence(rank,score,maxScore,support=0){
  const rel=maxScore?score/maxScore:0;
  const boosted=rel+(support>=3 ? .18 : support>=2 ? .1 : support>=1 ? .05 : 0)-(rank>10 ? .1 : 0);
  if(boosted>=.82)return {label:'ตัวเลือกเด่น',cls:'high'};
  if(boosted>=.55)return {label:'ตัวเลือกกลาง',cls:'mid'};
  return {label:'ตัวเลือกสำรอง',cls:'low'};
}

function predictionFormulaSupport(num){
  const root=document.getElementById('formula-results-ALL');
  if(!root)return [];
  const n=String(num||'').trim();
  if(!n)return [];
  const hits=[];
  root.querySelectorAll('.formula-card').forEach(card=>{
    const title=(card.querySelector('.card-title')?.textContent||'').trim();
    const has=[...card.querySelectorAll('.formula-result-row span')].some(s=>(s.textContent||'').trim()===n);
    if(has&&title)hits.push(title);
  });
  return hits.slice(0,5);
}

function predDetailHtml({num,col,row,rank,score,maxScore,support=0,extra=[]}){
  const conf=predictConfidence(rank,score,maxScore,support);
  const formulaHits=predictionFormulaSupport(num);
  const reasons=[
    `${conf.label}`,
    rank<=3?'Top 3':rank<=10?'Top 10':'สำรอง',
    support>0?`หนุน ${support}`:'',
    ...extra,
  ].filter(Boolean);
  const formulaHtml=formulaHits.length?`<span class="pred-pill formula">สูตรหนุน ${formulaHits.length}</span>`:'';
  const reasonHtml=reasons.map((x,i)=>`<span class="pred-pill ${i===0?conf.cls:''}">${escHtml(x)}</span>`).join('')+formulaHtml;
  const scoreText=Number.isFinite(score)?score.toFixed(score>=10?1:3):'-';
  return `<details class="pred-detail">
    <summary>${copyPredButton(num,'',null,'','pred-num')}<span class="pred-pill ${conf.cls}">${conf.label}</span></summary>
    <div class="pred-detail-panel">
      <div class="predict-summary-sub">อันดับ ${rank} · score ${scoreText}${support?` · support ${support}`:''}</div>
      <div class="pred-reasons">${reasonHtml}</div>
      ${formulaHits.length?`<div class="predict-summary-sub">สูตรที่หนุน: ${formulaHits.map(escHtml).join(' · ')}</div>`:''}
      <div class="pred-actions">
        ${copyPredActionButton(num,'copy','pred-action-btn')}
      </div>
    </div>
  </details>`;
}

function _renderSimpleRows(rows, tbodyId, badgeId, error=''){
  const scoreKey=predScoreKey(rows);
  const maxScore=Math.max(1,...rows.map(r=>predScore(r,scoreKey)));
  const col=({f31:'front3_1',f32:'front3_2',b31:'back3_1',b32:'back3_2',bt2:'bottom2'})[String(tbodyId).split('-')[0]]||'bottom2';
  const hasError=Boolean(error);
  const errorHtml='<div class="predict-empty">คำนวณไม่สำเร็จ — ลองใหม่อีกครั้ง</div>';
  const emptyHtml=hasError?errorHtml:'<div class="predict-empty">ไม่มีข้อมูล</div>';
  document.getElementById(tbodyId).innerHTML=rows.length?rows.map((r,i)=>{
    const sv=predScore(r,scoreKey);
    const bw=((sv/maxScore)*100).toFixed(0);
    const num=predNum(r);
    return `<tr>
      <td><span class="rank-badge ${i<3?'rank-'+(i+1):''}">${i+1}</span></td>
      <td>${predDetailHtml({num,col,row:r,rank:i+1,score:sv,maxScore})}</td>
      <td><div style="display:flex;align-items:center;gap:4px"><div class="progress-bar" style="width:50px"><div class="progress-fill" style="width:${bw}%"></div></div><span style="font-size:.7rem;color:var(--text3)">${sv.toFixed(3)}</span></div></td>
    </tr>`;
  }).join(''):`<tr><td colspan="3">${emptyHtml}</td></tr>`;
  document.getElementById(badgeId).innerHTML=rows.slice(0,5).map(r=>numChip(predNum(r))).join('')||(hasError?errorHtml:'<span class="dash-empty">—</span>');
}

function predNum(row){
  return row?.['เลข']??row?.number??row?.num??row?.value??row?.['à¹€à¸¥à¸‚']??'';
}

function validatePredictCategories(categories){
  if(!categories||typeof categories!=='object'||Array.isArray(categories))return false;
  const expected={prize1:6,front3_1:3,front3_2:3,back3_1:3,back3_2:3,bottom2:2};
  return Object.entries(expected).every(([key,width])=>{
    const category=categories[key];
    if(!category||typeof category!=='object'||Array.isArray(category)||!Array.isArray(category.numbers))return false;
    if(category.error!==undefined&&(typeof category.error!=='string'||!category.error.trim()))return false;
    return category.numbers.every(candidate=>{
      if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return false;
      const number=predNum(candidate);
      return typeof number==='string'&&new RegExp(`^[0-9]{${width}}$`).test(number);
    });
  });
}

function predScoreKey(rows){
  return rows[0]?Object.keys(rows[0]).find(k=>k.includes('คะแนน')||k.includes('Score')||k.toLowerCase().includes('score'))||'':'';
}

function predScore(row,key){
  const v=key?row?.[key]:undefined;
  if(typeof v==='number')return v;
  const nums=Object.values(row||{}).filter(x=>typeof x==='number'&&Number.isFinite(x));
  return nums.length?nums[0]:0;
}

function escHtml(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function p1Front(row){
  const n=String(predNum(row)||'');
  return row?.['หน้า 3']??row?.front3??(n.length>=3?n.slice(0,3):'');
}

function p1Back(row){
  const n=String(predNum(row)||'');
  return row?.['หลัง 3']??row?.back3??(n.length>=6?n.slice(3,6):'');
}

function copyPredNumber(num){
  const text=String(num||'').trim();
  if(!text)return;
  const done=()=>toast(`คัดลอก ${text} แล้ว`,'success');
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));
  }else{
    fallbackCopy(text,done);
  }
}

function fallbackCopy(text,done){
  const ta=document.createElement('textarea');
  ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');done?.();}catch(e){toast('คัดลอกไม่สำเร็จ','error');}
  ta.remove();
}

function copyPredButton(num,cls='',count=null,title='',baseClass='num-badge'){
  const value=String(num??'');
  const safe=escHtml(value);
  const classes=[baseClass,'predict-copy',cls].filter(Boolean).join(' ');
  const countValue=count===null||count===undefined?null:Number(count);
  const hasCount=countValue!==null&&Number.isFinite(countValue);
  const countLabel=hasCount?`, ${countValue} ครั้ง`:'';
  const detail=title?` · ${title}`:'';
  const countHtml=hasCount?`<span aria-hidden="true" style="font-size:.62rem;margin-left:4px;color:var(--text3)">x${countValue}</span>`:'';
  return `<button type="button" class="${escHtml(classes)}" data-copy-number="${safe}" aria-label="คัดลอกเลข ${safe}${escHtml(countLabel+detail)}" title="${escHtml(title||`คัดลอก ${value}`)}">${safe}${countHtml}</button>`;
}
function copyPredActionButton(num,label,cls=''){
  const value=String(num??'');
  return `<button type="button" class="${escHtml(cls)}" data-copy-number="${escHtml(value)}" aria-label="คัดลอกเลข ${escHtml(value)}">${escHtml(label)}</button>`;
}
function numChip(num,cls=''){return copyPredButton(num,cls);}
document.addEventListener?.('click',event=>{
  const button=event.target?.closest?.('button[data-copy-number]');
  if(!button)return;
  event.preventDefault();
  event.stopPropagation();
  copyPredNumber(button.dataset.copyNumber);
});

function setPredictLoading(isLoading,msg='กำลังคำนวณ...'){
  const grid=document.getElementById('all-pred-grid');
  if(grid)grid.style.display='block';
  ['p1-badges','f31-badges','f32-badges','b31-badges','b32-badges','bt2-badges'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&isLoading)el.innerHTML=`<span style="color:var(--text3);font-size:.82rem">${msg}</span>`;
  });
  if(isLoading){
    const tableBodies=[['p1-tbody',5],['f31-tbody',3],['f32-tbody',3],['b31-tbody',3],['b32-tbody',3],['bt2-tbody',3],['ref-tbody',7]];
    tableBodies.forEach(([id,columns])=>{
      const el=document.getElementById(id);
      if(el)el.innerHTML=`<tr><td colspan="${columns}"><div class="predict-empty">${escHtml(msg)}</div></td></tr>`;
    });
    ['predict-summary','predict-consensus','predict-decision-board','predict-final'].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.remove('active');el.innerHTML='';}});
    const extra=document.getElementById('predict-analysis-more');
    if(extra)extra.hidden=true;
    document.getElementById('predict-tools')?.classList.remove('active');
  }
}

function renderPredictSummary({date,topn,beam,kback,preset,cats,totalRows}){
  const el=document.getElementById('predict-summary');
  if(!el)return;
  const activeCats=Object.values(cats||{}).filter(c=>(c?.numbers||[]).length).length;
  const p1rows=cats?.prize1?.numbers||[];
  const frontCount=new Set(p1rows.map(p1Front).filter(Boolean)).size;
  const backCount=new Set(p1rows.map(p1Back).filter(Boolean)).size;
  const presetLabel=({optimized:'เน้นแม่น',balanced:'สมดุล',coverage:'เน้นครอบคลุม'})[preset]||preset||'—';
  el.innerHTML=[
    ['งวดเป้าหมาย',date||'—','งวดอ้างอิงของรายงานนี้'],
    ['ความหลากหลาย',`${frontCount}/${backCount}`,`หน้า/ท้ายไม่ซ้ำใน Top ${p1rows.length||0}`],
    ['รูปแบบคัดรางวัลที่ 1',presetLabel,`ผู้สมัคร Beam ${beam} · ท้าย 3 จำนวน ${kback}`],
    ['รายการพร้อมใช้',totalRows,`${activeCats} จาก 6 หมวดมีผลคำนวณ`],
  ].map(([label,value,sub])=>`<div class="predict-summary-item"><div class="predict-summary-label">${label}</div><div class="predict-summary-value">${value}</div><div class="predict-summary-sub">${sub}</div></div>`).join('');
  el.classList.add('active');
}

function topRows(rows,n=6){
  const scoreKey=predScoreKey(rows||[]);
  return [...(rows||[])].sort((a,b)=>predScore(b,scoreKey)-predScore(a,scoreKey)).slice(0,n);
}

function uniqueP1Rows(rows,n=6){
  const picked=[],usedF=new Set(),usedB=new Set();
  for(const r of rows||[]){
    const f=p1Front(r),b=p1Back(r);
    if(!usedF.has(f)&&!usedB.has(b)){
      picked.push(r);usedF.add(f);usedB.add(b);
    }
    if(picked.length>=n)break;
  }
  if(picked.length<n){
    for(const r of rows||[]){
      if(!picked.includes(r))picked.push(r);
      if(picked.length>=n)break;
    }
  }
  return picked.slice(0,n);
}

function predictionSupportMap(cats){
  const map=new Map();
  const add=(num,label)=>{
    const n=String(num||'').trim();
    if(!n)return;
    const cur=map.get(n)||{num:n,count:0,labels:new Set()};
    cur.count+=1;cur.labels.add(label);map.set(n,cur);
  };
  (cats.prize1?.numbers||[]).slice(0,30).forEach(r=>{
    const n=String(predNum(r)||'');
    add(p1Front(r),'P1 หน้า');add(p1Back(r),'P1 ท้าย');
    if(n.length>=2)add(n.slice(-2),'P1 ท้าย2');
  });
  [['front3_1','หน้า3-1'],['front3_2','หน้า3-2'],['back3_1','ท้าย3-1'],['back3_2','ท้าย3-2'],['bottom2','ท้าย2']].forEach(([k,label])=>{
    (cats[k]?.numbers||[]).slice(0,20).forEach(r=>add(predNum(r),label));
  });
  return map;
}

function renderPredictFinalPanel(cats,config={}){
  const el=document.getElementById('predict-final');
  if(!el)return;
  const p1rows=cats?.prize1?.numbers||[];
  if(!p1rows.length){el.classList.remove('active');el.innerHTML='';return;}
  const support=predictionSupportMap(cats);
  const scoreKey=predScoreKey(p1rows);
  const maxScore=Math.max(1,...p1rows.map(r=>predScore(r,scoreKey)));
  const topP1=topRows(p1rows,5);
  const top3=[
    ...(cats.front3_1?.numbers||[]).slice(0,3).map(predNum),
    ...(cats.front3_2?.numbers||[]).slice(0,3).map(predNum),
    ...topP1.map(p1Back),
  ].filter(Boolean);
  const bottom=(cats.bottom2?.numbers||[]).slice(0,6).map(predNum).filter(Boolean);
  const supported=[...support.values()].filter(x=>x.count>1).sort((a,b)=>b.count-a.count||a.num.localeCompare(b.num)).slice(0,8);
  const topCopy=[...topP1.map(predNum),...bottom.slice(0,3)].filter(Boolean).join(' ');
  const p1Html=topP1.map((r,i)=>{
    const n=predNum(r),s=(support.get(p1Front(r))?.count||0)+(support.get(p1Back(r))?.count||0);
    return predDetailHtml({num:n,col:'prize1',row:r,rank:i+1,score:predScore(r,scoreKey),maxScore,support:s,extra:[`หน้า ${p1Front(r)}`,`ท้าย ${p1Back(r)}`]});
  }).join('');
  el.innerHTML=`<div class="predict-final-card">
    <div class="predict-final-head">
    <div class="predict-final-title">ชุดเลขเด่นจากผลคำนวณ</div>
      ${copyPredActionButton(topCopy,'copy ชุดหลัก','dash-link')}
    </div>
    <div class="predict-final-grid">
      <div class="predict-final-block"><div class="predict-final-label">รางวัลที่ 1 · 6 หลัก</div><div class="predict-final-row">${p1Html}</div></div>
      <div class="predict-final-block"><div class="predict-final-label">3 ตัวบน / หน้า</div><div class="predict-final-row">${[...new Set(top3)].slice(0,8).map(n=>numChip(n)).join('')||'<span class="dash-empty">—</span>'}</div></div>
      <div class="predict-final-block"><div class="predict-final-label">2 ตัวล่าง</div><div class="predict-final-row">${bottom.slice(0,6).map(n=>numChip(n)).join('')||'<span class="dash-empty">—</span>'}</div></div>
    </div>
    <div id="predict-mode-compare" class="predict-mode-compare"><div class="predict-summary-sub">กำลังเทียบ Optimized / Balanced / Coverage...</div></div>
  </div>`;
  el.classList.add('active');
  loadPredictModeCompare(config.date,config.topn||10,config.beam||500,config.kback||100);
}

async function loadPredictModeCompare(date,topn,beam,kback){
  const el=document.getElementById('predict-mode-compare');
  if(!el)return;
  const requestId=LotteryUiState.predict.requestId;
  const isCurrent=()=>requestId===LotteryUiState.predict.requestId
    &&document.getElementById('pred-date')?.value===date
    &&document.getElementById('predict-mode-compare')===el;
  const modes=[['optimized','เน้นแม่น'],['balanced','สมดุล'],['coverage','เน้นครอบคลุม']];
  try{
    const rows=await Promise.all(modes.map(async ([preset,label])=>{
      const r=await api(`predict/prize1?top_n=5&date=${date}&beam_width=${beam}&k_back=${kback}&preset=${preset}`);
      const validTarget=typeof r?.date==='string'&&r.date===date;
      const validPredictions=Array.isArray(r?.predictions);
      const error=Boolean(r?.error||r?.detail)||!validTarget||!validPredictions;
      return {preset:label,error,nums:error?[]:r.predictions.slice(0,5).map(predNum).filter(Boolean)};
    }));
    if(!isCurrent())return;
    const counts=new Map();
    rows.forEach(row=>row.nums.forEach(n=>counts.set(n,(counts.get(n)||0)+1)));
    el.innerHTML=rows.map(row=>`<div class="predict-mode-card">
      <div class="predict-mode-title">${row.preset}</div>
      <div>${row.error?'<div class="predict-empty">เทียบโหมดไม่สำเร็จ — ลองใหม่อีกครั้ง</div>':row.nums.map(n=>numChip(n,counts.get(n)>1?'agree':'')).join('')||'<span class="dash-empty">-</span>'}</div>
    </div>`).join('');
  }catch(e){
    if(!isCurrent())return;
    el.innerHTML='<div class="predict-summary-sub">เทียบโหมดไม่สำเร็จ ลองรันใหม่อีกครั้ง</div>';
  }
}

function renderPredictDecisionBoard(cats,config={}){
  const el=document.getElementById('predict-decision-board');
  if(!el)return;
  const p1rows=cats?.prize1?.numbers||[];
  if(!p1rows.length){el.classList.remove('active');el.innerHTML='';return;}
  const scoreKey=predScoreKey(p1rows);
  const top=p1rows[0];
  const topNum=predNum(top);
  const topScore=predScore(top,scoreKey);
  const frontCount=new Set(p1rows.map(p1Front).filter(Boolean)).size;
  const backCount=new Set(p1rows.map(p1Back).filter(Boolean)).size;
  const support=predictionSupportMap(cats);
  const supportScore=r=>{
    const n=String(predNum(r)||'');
    return (support.get(p1Front(r))?.count||0)+(support.get(p1Back(r))?.count||0)+(support.get(n.slice(-2))?.count||0);
  };
  const strongest=topRows(p1rows,6);
  const spread=uniqueP1Rows(p1rows,6);
  const supported=[...p1rows].sort((a,b)=>supportScore(b)-supportScore(a)||predScore(b,scoreKey)-predScore(a,scoreKey)).slice(0,6);
  const supportChips=[...support.values()]
    .filter(x=>x.count>1)
    .sort((a,b)=>b.count-a.count||b.labels.size-a.labels.size||a.num.localeCompare(b.num))
    .slice(0,14);
  const coverageTone=frontCount>=p1rows.length*.8&&backCount>=p1rows.length*.8?'กระจายสูง':frontCount>=p1rows.length*.5&&backCount>=p1rows.length*.5?'กระจายปานกลาง':'กระจุกตัว';
  const presetLabel=({optimized:'เน้นแม่น',balanced:'สมดุล',coverage:'เน้นครอบคลุม'})[config.preset]||config.preset||'—';
  const ticket=(title,rows)=>`<div class="predict-ticket"><div class="predict-ticket-title">${title}</div><div class="predict-ticket-row">${rows.map(r=>numChip(predNum(r))).join('')||'<span class="dash-empty">—</span>'}</div></div>`;
  el.innerHTML=`
    <div class="card predict-spotlight">
      <div class="predict-spotlight-head">
        <div>
          <div class="predict-spotlight-label">อันดับ 1 · รางวัลที่ 1</div>
          ${copyPredButton(topNum,'',null,'','predict-spotlight-num')}
          <div class="predict-spotlight-sub">หน้า ${escHtml(p1Front(top))} · ท้าย ${escHtml(p1Back(top))} · คะแนนจัดอันดับ ${topScore.toFixed(2)}</div>
        </div>
        ${copyPredActionButton(topNum,'คัดลอก','btn btn-primary')}
      </div>
      <div class="predict-signal-grid">
        <div class="predict-signal"><div class="predict-signal-label">ความหลากหลาย</div><div class="predict-signal-value">${frontCount}/${backCount}</div><div class="predict-summary-sub">เลขหน้า/ท้ายไม่ซ้ำ · ${coverageTone}</div></div>
        <div class="predict-signal"><div class="predict-signal-label">รูปแบบคัด</div><div class="predict-signal-value">${escHtml(presetLabel)}</div><div class="predict-summary-sub">แสดง Top ${escHtml(config.topn||p1rows.length)}</div></div>
        <div class="predict-signal"><div class="predict-signal-label">เลขที่ซ้ำข้ามหมวด</div><div class="predict-signal-value">${supportChips.length}</div><div class="predict-summary-sub">เป็นสัญญาณซ้ำ ไม่ใช่โอกาสถูกรางวัล</div></div>
      </div>
    </div>
    <div class="card predict-panel">
      <div class="predict-panel-title"><span>เปรียบเทียบชุดเลข</span><button class="dash-link" onclick="exportPredCSV()">ส่งออก CSV</button></div>
      <div class="predict-portfolio">
        ${ticket('คะแนนสูงสุด',strongest)}
        ${ticket('กระจายหน้า/ท้าย',spread)}
        ${ticket('มีหมวดย่อยสนับสนุน',supported)}
      </div>
    </div>`;
  el.classList.add('active');
}

function renderPredictionConsensus(cats){
  const el=document.getElementById('predict-consensus');
  if(!el)return;
  const counts=new Map();
  const add=(rows,len)=>rows.forEach(r=>{
    const n=String(predNum(r)||'');
    if(n.length===len)counts.set(n,(counts.get(n)||0)+1);
  });
  add(cats.front3_1?.numbers||[],3); add(cats.front3_2?.numbers||[],3);
  add(cats.back3_1?.numbers||[],3); add(cats.back3_2?.numbers||[],3);
  add(cats.bottom2?.numbers||[],2);
  const top=[...counts.entries()].filter(([,c])=>c>1).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,12);
  const body=top.length?top.map(([n,c])=>copyPredButton(n,'agree',c)).join(''):'<span class="dash-empty">ยังไม่มีเลขซ้ำข้ามหมวดเด่น</span>';
  el.innerHTML=`<div class="card"><div class="dash-card-head"><h2 class="card-title">เลขที่ซ้ำในหลายหมวด</h2><button class="dash-link" onclick="resetPredictionFilters()">แสดงทุกหมวด</button></div><p class="predict-consensus-note">ตัวเลขนี้สะท้อนการซ้ำของผลคำนวณ ไม่ได้เพิ่มโอกาสถูกรางวัล</p><div class="predict-consensus-row">${body}</div></div>`;
  el.classList.add('active');
}

function resetPredictionFilters(){
  const q=document.getElementById('predict-search');
  const g=document.getElementById('predict-group-filter');
  if(q)q.value='';
  if(g)g.value='';
  filterPredictions();
}

function filterPredictions(){
  const tools=document.getElementById('predict-tools');
  const count=document.getElementById('predict-filter-count');
  const cards=[...document.querySelectorAll('#all-pred-grid .predict-card')];
  if(!cards.length){if(tools)tools.classList.remove('active');return;}
  if(tools)tools.classList.add('active');
  const q=(document.getElementById('predict-search')?.value||'').toLowerCase();
  const g=(document.getElementById('predict-group-filter')?.value||'').toLowerCase();
  let visible=0;
  cards.forEach(card=>{
    const ok=(!q||(card.textContent||'').toLowerCase().includes(q))&&(!g||(card.dataset.predGroup||'').includes(g));
    card.style.display=ok?'':'none';
    if(ok)visible++;
  });
  const noMatchingTop3=g==='top3'&&!visible;
  if(count)count.textContent=noMatchingTop3
    ?'ไม่มีหมวดทำนาย 3 ตัวบนแยก — 3 ตัวบนอ่านจาก 3 หลักท้ายของรางวัลที่ 1'
    :`แสดง ${visible}/${cards.length} หมวด`;
    ['predict-summary','predict-final','predict-decision-board','predict-consensus'].forEach(id=>{
    const panel=document.getElementById(id);
    if(panel)panel.style.display=noMatchingTop3?'none':'';
  });
}

async function loadPredict(){
  const state=LotteryUiState.predict;
  const requestId=++state.requestId;
  const date = document.getElementById('pred-date').value;
  syncLuckyNewsTarget(date);
  state.isLoading=true;
  state.sourceStale=false;
  state.lastPredictStatus='';
  const topn = document.getElementById('pred-topn').value;
  const preset = document.getElementById('p1-preset')?.value||'optimized';
  const beam = document.getElementById('p1-beam').value;
  const kback = document.getElementById('p1-kback')?.value||100;
  setPredictLoading(true);
  setPageStatus('predict-status','กำลังโหลดผลทำนาย...');
  LotteryServerData.predict.rows=[];
  LotteryUiState.predict.lastPredCol='';
  LotteryUiState.predict.lastPredDate=date;
  LotteryUiState.predict.lastPredictSnapshot=null;
  const snapshotButton=document.getElementById('pred-save-snapshot');
  if(snapshotButton){snapshotButton.disabled=true;snapshotButton.title='กำลังคำนวณผลทำนาย';}
  const reportOrigin=document.getElementById('predict-report-origin');
  if(reportOrigin){reportOrigin.classList.remove('is-stale');reportOrigin.textContent='กำลังคำนวณ · ผลใหม่นี้ยังไม่ได้บันทึก';}

  const r = await api(`predict/all?top_n=${topn}&date=${date}&beam_width=${beam}&k_back=${kback}&preset=${preset}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
  if(requestId!==state.requestId)return;
  const categoriesValid=validatePredictCategories(r?.categories);
  const targetMatches=typeof r?.date==='string'&&r.date===date;
  const requestError=r?.error?'โหลดผลทำนายไม่สำเร็จ — ลองใหม่อีกครั้ง':r?.detail?'คำขอทำนายไม่ถูกต้อง — ตรวจช่วงค่า Top N, Beam และ Back3 แล้วลองใหม่':!targetMatches?'ผลทำนายไม่ตรงกับงวดที่เลือก — ลองโหลดใหม่อีกครั้ง':categoriesValid?'':'ข้อมูลหมวดทำนายไม่ครบหรือรูปแบบไม่ถูกต้อง — ลองใหม่อีกครั้ง';
  if(requestError){
    state.isLoading=false;
    state.lastPredDate='';
    setPredictLoading(false);
    setPageStatus('predict-status',requestError);
    if(reportOrigin)reportOrigin.textContent='ไม่มีผลทำนายที่บันทึกได้ · โปรดคำนวณงวดนี้อีกครั้ง';
    if(snapshotButton)snapshotButton.title='ไม่มีผลทำนายสำหรับบันทึก';
    const errorHtml=`<div class="predict-empty">${requestError}</div>`;
    document.getElementById('p1-badges').innerHTML=errorHtml;
    document.getElementById('p1-tbody').innerHTML=`<tr><td colspan="5">${errorHtml}</td></tr>`;
    _renderSimpleRows([], 'f31-tbody', 'f31-badges', requestError);
    _renderSimpleRows([], 'f32-tbody', 'f32-badges', requestError);
    _renderSimpleRows([], 'b31-tbody', 'b31-badges', requestError);
    _renderSimpleRows([], 'b32-tbody', 'b32-badges', requestError);
    _renderSimpleRows([], 'bt2-tbody', 'bt2-badges', requestError);
    document.getElementById('ref-tbody').innerHTML='<tr><td colspan="7"><div class="predict-empty">ยังไม่โหลดข้อมูลอ้างอิง เพราะไม่มีผลทำนายที่ตรวจสอบได้</div></td></tr>';
    toast(requestError,'error',{announce:false});
    return;
  }
  const cats = r.categories||{};
  const reportStatus=r.report_status==='partial'||Object.values(cats).some(category=>Boolean(category?.error))?'partial':'ready';

  // prize1
  const p1 = cats.prize1||{};
  const p1rows = p1.numbers||[];
  const scoreKey1 = predScoreKey(p1rows);
  const max1 = Math.max(1,...p1rows.map(r=>predScore(r,scoreKey1)));
  const p1Error=p1.error?'คำนวณรางวัลที่ 1 ไม่สำเร็จ — ลองใหม่อีกครั้ง':'';
  document.getElementById('p1-badges').innerHTML=p1Error?`<div class="predict-empty">${p1Error}</div>`:p1rows.slice(0,5).map(r=>numChip(predNum(r))).join('')||'<span class="dash-empty">—</span>';
  document.getElementById('p1-tbody').innerHTML=p1rows.length?p1rows.map((r,i)=>{
    const sv=predScore(r,scoreKey1);
    const bw=((sv/max1)*100).toFixed(0);
    const num=predNum(r);
    const support=predictionSupportMap(cats);
    const sup=(support.get(p1Front(r))?.count||0)+(support.get(p1Back(r))?.count||0)+(support.get(String(num).slice(-2))?.count||0);
    return `<tr>
      <td><span class="rank-badge ${i<3?'rank-'+(i+1):''}">${i+1}</span></td>
      <td>${predDetailHtml({num,col:'prize1',row:r,rank:i+1,score:sv,maxScore:max1,support:sup,extra:[`หน้า ${p1Front(r)}`,`ท้าย ${p1Back(r)}`]})}</td>
      <td style="color:var(--accent);font-weight:600">${escHtml(p1Front(r))}</td>
      <td style="color:#4d9de0;font-weight:600">${escHtml(p1Back(r))}</td>
      <td><div style="display:flex;align-items:center;gap:4px"><div class="progress-bar" style="width:60px"><div class="progress-fill" style="width:${bw}%"></div></div><span style="font-size:.72rem;color:var(--text3)">${sv.toFixed(2)}</span></div></td>
    </tr>`;
  }).join(''):`<tr><td colspan="5"><div class="predict-empty">${p1Error||'ไม่มีข้อมูลรางวัลที่ 1'}</div></td></tr>`;

  // front3
  _renderSimpleRows(cats.front3_1?.numbers||[], 'f31-tbody', 'f31-badges', cats.front3_1?.error);
  _renderSimpleRows(cats.front3_2?.numbers||[], 'f32-tbody', 'f32-badges', cats.front3_2?.error);
  // back3
  _renderSimpleRows(cats.back3_1?.numbers||[], 'b31-tbody', 'b31-badges', cats.back3_1?.error);
  _renderSimpleRows(cats.back3_2?.numbers||[], 'b32-tbody', 'b32-badges', cats.back3_2?.error);
  // bottom2
  _renderSimpleRows(cats.bottom2?.numbers||[], 'bt2-tbody', 'bt2-badges', cats.bottom2?.error);

  document.getElementById('all-pred-grid').style.display='block';
  const allRows=[
    ...p1rows.map(r=>({group:'prize1',number:predNum(r),score:predScore(r,scoreKey1)})),
    ...['front3_1','front3_2','back3_1','back3_2','bottom2'].flatMap(k=>(cats[k]?.numbers||[]).map(r=>({group:k,number:predNum(r),score:predScore(r,predScoreKey(cats[k]?.numbers||[]))}))),
  ];
  LotteryServerData.predict.rows=allRows;
  LotteryUiState.predict.lastPredCol='all';
  LotteryUiState.predict.lastPredDate=date;
  const snapshotItems=[
      ...p1rows.slice(0,5).map(r=>({num:predNum(r),score:'P1'})),
      ...(cats.bottom2?.numbers||[]).slice(0,6).map(r=>({num:predNum(r),score:'2ตัว'})),
      ...(cats.front3_1?.numbers||[]).slice(0,3).map(r=>({num:predNum(r),score:'หน้า3'})),
      ...(cats.back3_1?.numbers||[]).slice(0,3).map(r=>({num:predNum(r),score:'ท้าย3'})),
    ];
  LotteryUiState.predict.lastPredictSnapshot=snapshotItems.length?{
    id:`predict_${date}_${preset}_${topn}`,
    title:`ทำนาย · ${fmtDate(date)}`,
    date,topn,preset,
    report:{target_date:r.date||date,categories:cats,report_status:reportStatus},
    provenance:r.report_provenance?{...r.report_provenance,settings:{topn,preset,beam,kback}}:null,
    mode:preset,
    items:snapshotItems,
    note:`Top ${topn} · ${allRows.length} แถว · Beam ${beam} · Back3 ${kback}`
  }:null;
  if(snapshotButton){
    snapshotButton.disabled=!LotteryUiState.predict.lastPredictSnapshot;
    snapshotButton.title=LotteryUiState.predict.lastPredictSnapshot?'บันทึกผลทำนายของงวดนี้':'ไม่มีผลทำนายสำหรับบันทึก';
  }
  if(typeof showReportDraft==='function')showReportDraft('predict',LotteryUiState.predict.lastPredictSnapshot?.provenance);
  renderPredictSummary({date,topn,beam,kback,preset:r.prize1_config?.preset_label||preset,cats,totalRows:allRows.length});
  renderPredictFinalPanel(cats,{date,topn,beam,kback,preset:r.prize1_config?.preset_label||preset});
  const extra=document.getElementById('predict-analysis-more');
  if(extra)extra.hidden=!p1rows.length;
  renderPredictDecisionBoard(cats,{date,topn,beam,kback,preset:r.prize1_config?.preset_label||preset});
  renderPredictionConsensus(cats);
  filterPredictions();

  // Ref draws (same day+month)
  if(date){
    const [,m,dd]=date.split('-');
    const h=await api('history?n=500',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(requestId!==LotteryUiState.predict.requestId)return;
    if(h?.error||h?.detail||!Array.isArray(h?.data)){
      document.getElementById('ref-tbody').innerHTML='<tr><td colspan="7"><div class="predict-empty">โหลดข้อมูลอ้างอิงไม่สำเร็จ</div></td></tr>';
      state.lastPredictStatus='ผลทำนายพร้อมแล้ว แต่โหลดข้อมูลอ้างอิงไม่สำเร็จ';
      state.isLoading=false;
      setPageStatus('predict-status',state.lastPredictStatus);
      return;
    }
    const refs=h.data.filter(row=>{
      if(!row.date) return false;
      const p=row.date.split('/');
      return p[0]===dd&&p[1]===m;
    }).slice(0,15);
    document.getElementById('ref-tbody').innerHTML=refs.map(row=>`<tr>
      <td>${escHtml(row.date)}</td><td>${escHtml(row.prize1||'')}</td><td>${escHtml(row.top3||'')}</td>
      <td>${escHtml(row.top2||'')}</td><td>${escHtml(row.back3_1||'')}</td><td>${escHtml(row.back3_2||'')}</td><td>${escHtml(row.bottom2||'')}</td>
    </tr>`).join('')||'<tr><td colspan="7"><div class="predict-empty">ไม่พบงวดวันเดียวกันในอดีต</div></td></tr>';
  }
  state.lastPredictStatus=`${reportStatus==='partial'?'ผลทำนายพร้อมบางหมวด · ตรวจข้อผิดพลาดของหมวดที่ขาด':'ผลทำนายพร้อมแล้ว'} ${allRows.length} รายการ`;
  state.isLoading=false;
  setPageStatus('predict-status',state.lastPredictStatus);
}

function syncPredictTarget(date){
  const state=LotteryUiState.predict;
  const target=String(date||'');
  syncLuckyNewsTarget(target);

  // A target change during the first request has no report worth preserving.
  if(state.isLoading&&state.lastPredCol!=='all'&&state.lastPredDate&&state.lastPredDate!==target){
    state.requestId++;
    state.isLoading=false;
    state.lastPredCol='';
    state.lastPredDate='';
    state.lastPredictSnapshot=null;
    state.lastPredictStatus='';
    LotteryServerData.predict.rows=[];
    const message=`เปลี่ยนงวดแล้ว · กด “ทำนาย” เพื่อคำนวณงวด ${fmtDate(target)}`;
    setPredictLoading(true,message);
    const origin=document.getElementById('predict-report-origin');
    if(origin){origin.textContent=message;origin.classList.add('is-stale');}
    const snapshotButton=document.getElementById('pred-save-snapshot');
    if(snapshotButton){snapshotButton.disabled=true;snapshotButton.title='คำนวณงวดที่เลือกก่อนจึงบันทึกได้';}
    setPageStatus('predict-status',message);
    return;
  }

  const reportDate=state.lastPredCol==='all'?state.lastPredDate:'';
  if(!reportDate)return;
  const origin=document.getElementById('predict-report-origin');
  const snapshotButton=document.getElementById('pred-save-snapshot');
  if(state.sourceStale){
    const message=`${state.lastPredictStatus||'ผลทำนายใช้ข้อมูลก่อนรีเฟรช'} · คำนวณงวดที่เลือกใหม่ก่อนบันทึก`;
    if(origin){origin.classList.add('is-stale');origin.textContent=message;}
    if(snapshotButton){snapshotButton.disabled=true;snapshotButton.title='ผลนี้ใช้ข้อมูลก่อนรีเฟรช · คำนวณใหม่ก่อนบันทึก';}
    setPageStatus('predict-status',message);
    return;
  }
  if(target===reportDate){
    if(origin)origin.classList.remove('is-stale');
    if(typeof showReportDraft==='function')showReportDraft('predict',state.lastPredictSnapshot?.provenance);
    if(snapshotButton){snapshotButton.disabled=!state.lastPredictSnapshot;snapshotButton.title=state.lastPredictSnapshot?'บันทึกผลทำนายของงวดนี้':'ไม่มีผลทำนายสำหรับบันทึก';}
    const rows=LotteryServerData.predict.rows.length;
    const fallback=`${state.lastPredictSnapshot?.report?.report_status==='partial'?'ผลทำนายพร้อมบางหมวด · ตรวจข้อผิดพลาดของหมวดที่ขาด':'ผลทำนายพร้อมแล้ว'} ${rows} รายการ`;
    setPageStatus('predict-status',state.lastPredictStatus||fallback);
    return;
  }

  // Once the prediction is rendered, keep it visible as context but reject saves
  // and stop any reference-history response from being attached to another draw.
  if(state.isLoading){
    state.requestId++;
    state.isLoading=false;
    const referenceBody=document.getElementById('ref-tbody');
    if(referenceBody&&referenceBody.innerHTML.includes('กำลังคำนวณ')){
      referenceBody.innerHTML='<tr><td colspan="7"><div class="predict-empty">เปลี่ยนงวดก่อนโหลดข้อมูลอ้างอิงเสร็จ · กด “ทำนาย” เพื่อโหลดข้อมูลของงวดนี้</div></td></tr>';
    }
  }
  const message=`ผลทำนายนี้เป็นของงวด ${fmtDate(reportDate)} · ตอนนี้เลือกงวด ${fmtDate(target)} · กด “ทำนาย” เพื่ออัปเดต`;
  if(origin){origin.textContent=message;origin.classList.add('is-stale');}
  if(snapshotButton){snapshotButton.disabled=true;snapshotButton.title='คำนวณงวดที่เลือกก่อนจึงบันทึกได้';}
  setPageStatus('predict-status',message);
}

function syncLuckyNewsTarget(date){
  const state=LotteryUiState.predict;
  if(!state.luckyNewsDate||state.luckyNewsDate===date)return;
  state.luckyNewsRequestId++;
  state.luckyNewsDate='';
  const sec=document.getElementById('lucky-news-section');
  if(sec){sec.style.display='none';sec.setAttribute('aria-busy','false');}
  ['lucky-source','lucky-3d','lucky-2d','lucky-note'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){if(id==='lucky-source'||id==='lucky-note')el.textContent='';else el.innerHTML='';}
  });
}

async function loadLuckyNews(){
  const date = document.getElementById('pred-date').value;
  const state=LotteryUiState.predict;
  const requestId=++state.luckyNewsRequestId;
  state.luckyNewsDate=date;
  const sec = document.getElementById('lucky-news-section');
  sec.style.display='block';
  sec.setAttribute('aria-busy','true');
  document.getElementById('lucky-source').textContent='กำลังค้นข่าวเลขเด็ด...';
  document.getElementById('lucky-3d').innerHTML='<span style="color:var(--text3);font-size:.8rem">กำลังโหลด...</span>';
  document.getElementById('lucky-2d').innerHTML='<span style="color:var(--text3);font-size:.8rem">กำลังโหลด...</span>';
  document.getElementById('lucky-note').textContent='';
  const r = await api(`lucky-news${date?'?date='+date:''}`);
  if(requestId!==state.luckyNewsRequestId||document.getElementById('pred-date')?.value!==date)return;
  sec.setAttribute('aria-busy','false');
  const targetMatches=typeof r?.date==='string'&&r.date===date;
  if(r?.error||!targetMatches){
    const message=r?.error||'ข่าวเลขเด็ดไม่ตรงกับงวดที่เลือก — ลองโหลดใหม่อีกครั้ง';
    document.getElementById('lucky-source').textContent=message;
    document.getElementById('lucky-3d').innerHTML='<span style="color:var(--red);font-size:.8rem">โหลดข่าวไม่สำเร็จ</span>';
    document.getElementById('lucky-2d').innerHTML='';
    document.getElementById('lucky-note').textContent='';
    toast(message,'error');
    return;
  }
  document.getElementById('lucky-source').textContent=`งวดเป้าหมาย ${fmtDate(date)} | แหล่งที่มา: ${(r.sources||[]).join(', ')||'ไม่พบ'} | คำค้น: ${r.query||''}`;
  document.getElementById('lucky-3d').innerHTML=(r.numbers_3||[]).map(n=>`<span class="num-badge" style="font-family:'IBM Plex Mono',monospace">${n}</span>`).join('')||'<span style="color:var(--text3);font-size:.8rem">ไม่พบเลข 3 ตัว</span>';
  document.getElementById('lucky-2d').innerHTML=(r.numbers_2||[]).map(n=>`<span class="num-badge" style="font-family:'IBM Plex Mono',monospace">${n}</span>`).join('')||'<span style="color:var(--text3);font-size:.8rem">ไม่พบเลข 2 ตัว</span>';
  document.getElementById('lucky-note').textContent=r.note||'';
  sec.scrollIntoView({behavior:'smooth',block:'nearest'});
}


