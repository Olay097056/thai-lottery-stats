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

// ─── Chart registry ───────────────────────────────────────────────────────────
const _charts = {};
function mkChart(id, cfg){
  if(_charts[id]){ _charts[id].destroy(); }
  const el = document.getElementById(id);
  if(!el) return;
  _charts[id] = new Chart(el.getContext('2d'), cfg);
  return _charts[id];
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type=''){
  const el = Object.assign(document.createElement('div'), {className:'toast'+(type?' '+type:''), textContent:msg});
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
let currentPage = 'dashboard';
let currentPredTab = 'predict';
document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click',()=>{
    const p = item.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.page').forEach(pg=>pg.classList.remove('active'));
    document.getElementById('page-'+p).classList.add('active');
    if(p!==currentPage){ currentPage=p; onPageLoad(p); }
  });
});

function switchPredTab(tab){
  currentPredTab=tab;
  const workflow=document.getElementById('shared-workflow');
  if(workflow&&workflow.value!==tab)workflow.value=tab;
  ['predict','formula','decision','oldver'].forEach(t=>{
    document.getElementById('pred-main-tab-'+t).style.display=t===tab?'':'none';
    document.getElementById('pred-main-btn-'+t).classList.toggle('active',t===tab);
  });
  if(tab==='formula'){ initFormulaPage(); renderPageSnapshots('formula'); }
  else if(tab==='decision'){ loadDecisionCenter(); }
  else if(tab==='oldver'){ loadDecisionCenterOld(); }
  else { renderPageSnapshots('predict'); }
}
window.switchPredTab=switchPredTab;

function showPage(p){
  // formula/decision are now tabs inside predict
  if(p==='formula'||p==='decision'){
    const already=currentPage==='predict';
    if(!already) showPage('predict');
    switchPredTab(p);
    return;
  }
  const item=document.querySelector(`.nav-item[data-page="${p}"]`);
  if(item){item.click();return;}
  const page=document.getElementById('page-'+p);
  if(!page)return;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  document.querySelectorAll('.page').forEach(pg=>pg.classList.remove('active'));
  page.classList.add('active');
  if(p!==currentPage){currentPage=p;onPageLoad(p);}
}
window.showPage=showPage;

let _sharedDateSyncing=false;
function _setSelectValueKeepingOptions(id,value){
  const el=document.getElementById(id);
  if(!el||!value)return;
  const found=[...el.options].some(o=>o.value===value);
  if(!found)el.add(new Option(fmtDate(value),value));
  el.value=value;
}

function syncSharedDrawDate(value,userAction=false){
  if(_sharedDateSyncing||!value)return;
  _sharedDateSyncing=true;
  ['shared-draw-date','pred-date','f-target-date','dc-date','dc-date-old','dash-date'].forEach(id=>_setSelectValueKeepingOptions(id,value));
  _sharedDateSyncing=false;
  if(!userAction)return;
  if(currentPredTab==='formula')autoFillFormula();
  else if(currentPredTab==='decision')loadDecisionCenter();
  else if(currentPredTab==='oldver')loadDecisionCenterOld();
}
window.syncSharedDrawDate=syncSharedDrawDate;

function applySharedLotteryFocus(){
  const focus=document.getElementById('shared-lottery-focus')?.value||'';
  const predMap={prize1:'prize1',top3:'',front3:'front3',back3:'back3',bottom2:'bottom2'};
  const formulaMap={prize1:'prize1',top3:'3-digit',front3:'front 3',back3:'back 3',bottom2:'bottom'};
  const pg=document.getElementById('predict-group-filter');
  if(pg){pg.value=predMap[focus]??'';filterPredictions();}
  const ft=document.getElementById('formula-target-filter');
  if(ft){ft.value=formulaMap[focus]??'';filterFormulaCards();}
}
window.applySharedLotteryFocus=applySharedLotteryFocus;

function runSharedPrimaryAction(){
  if(currentPredTab==='formula'){
    autoFillFormula().then(()=>runAllFormulas());
  }else if(currentPredTab==='decision'){
    loadDecisionCenter();
  }else if(currentPredTab==='oldver'){
    loadDecisionCenterOld();
  }else{
    loadPredict();
  }
}
window.runSharedPrimaryAction=runSharedPrimaryAction;

function onPageLoad(p){
  if(p==='predict'){ renderPageSnapshots('predict'); }
  else if(p==='frequency') loadFreq();
  else if(p==='history') loadHistory();
}

// ─── API ──────────────────────────────────────────────────────────────────────
let _apiInFlight=0;
async function api(path){
  _apiInFlight++;
  if(_apiInFlight===1) document.getElementById('api-spinner').classList.add('active');
  try{
    const r=await fetch('/api/'+path);
    return await r.json();
  }catch(e){
    // แจ้งผู้ใช้เมื่อโหลดล้มเหลว (throttle 5 วิ กันสแปมตอน server ล่มแล้วยิงหลาย call พร้อมกัน)
    const now=Date.now();
    if(typeof toast==='function'&&now-(window._lastApiErrToast||0)>5000){
      window._lastApiErrToast=now;
      toast('เชื่อมต่อ server ไม่ได้ — ลองรีเฟรชหรือเช็กว่า server ยังรันอยู่','error');
    }
    return {error:String(e)};
  }finally{
    _apiInFlight=Math.max(0,_apiInFlight-1);
    if(_apiInFlight===0) document.getElementById('api-spinner').classList.remove('active');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init(){
  // Populate selects
  [['pred-col','ALL'],
  ].forEach(([id,type])=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = type==='ALL' ? ALL_OPTS : NO_P1_OPTS;
  });
  // freq-col ใช้ opts ปกติ + Sanook extra
  const freqEl = document.getElementById('freq-col');
  if(freqEl){ freqEl.innerHTML = ALL_OPTS + SANOOK_FREQ_OPTS; freqEl.value='top3'; }

  // Latest draw date in sidebar
  api('summary').then(s=>{
    const d=s.latest?.date||s.date_max||'';
    if(d){
      document.getElementById('sidebar-draw-date-val').textContent=d;
      document.getElementById('sidebar-draw-date').style.display='block';
    }
  });

  // Next draws — generated client-side (Bangkok time, cutoff 16:00)
  const drawOpts = clientDraws().map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
  ['shared-draw-date','pred-date','dc-date','dc-date-old','dash-date','f-target-date'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.innerHTML = drawOpts;
  });
  syncSharedDrawDate(document.getElementById('shared-draw-date')?.value||'');

  // pred-col change wires prize1 section
  const _toggleP1 = () => {
    const predCol = document.getElementById('pred-col');
    const prize1Section = document.getElementById('prize1-section');
    if(!predCol || !prize1Section) return;
    prize1Section.style.display = predCol.value==='prize1'?'block':'none';
  };
  document.getElementById('pred-col')?.addEventListener('change', _toggleP1);
  _toggleP1(); // trigger on init so prize1 section shows on first load

  await loadDashboard();
  renderPageSnapshots('predict');
  renderPageSnapshots('formula');
}

function dcAddSource(map,num,kind,label,detail=''){
  const n=String(num||'').trim();
  if(!n)return;
  const cur=map.get(n)||{num:n,predict:[],formula:[]};
  const item={label:String(label||kind),detail:String(detail||'')};
  const bucket=kind==='formula'?cur.formula:cur.predict;
  if(!bucket.some(x=>x.label===item.label&&x.detail===item.detail))bucket.push(item);
  map.set(n,cur);
}

function dcBuildPredictFormulaMatches(cats,formulaResults){
  const map=new Map();
  (cats.prize1?.numbers||[]).slice(0,20).forEach((r,i)=>{
    const n=String(predNum(r)||'');
    dcAddSource(map,n,'predict','Predict รางวัลที่ 1',`อันดับ ${i+1}`);
    dcAddSource(map,p1Front(r),'predict','Predict หน้า 3 จากรางวัลที่ 1',n);
    dcAddSource(map,p1Back(r),'predict','Predict ท้าย 3 จากรางวัลที่ 1',n);
    if(n.length>=2)dcAddSource(map,n.slice(-2),'predict','Predict ท้าย 2 จากรางวัลที่ 1',n);
  });
  [
    ['front3_1','Predict เลขหน้า 3 ชุดที่ 1'],
    ['front3_2','Predict เลขหน้า 3 ชุดที่ 2'],
    ['back3_1','Predict เลขท้าย 3 ชุดที่ 1'],
    ['back3_2','Predict เลขท้าย 3 ชุดที่ 2'],
    ['bottom2','Predict เลขท้าย 2 ตัวล่าง']
  ].forEach(([key,label])=>{
    (cats[key]?.numbers||[]).slice(0,20).forEach((r,i)=>dcAddSource(map,predNum(r),'predict',label,`อันดับ ${i+1}`));
  });

  (formulaResults||[]).forEach(fr=>{
    const name=fr?.name||'สูตรคำนวณ';
    const field=fr?.field||fr?.compareField||'formula';
    (fr?.preds||fr?.predictions||[]).forEach(n=>dcAddSource(map,n,'formula',name,field));
  });

  return [...map.values()]
    .filter(x=>x.predict.length&&x.formula.length)
    .sort((a,b)=>(b.predict.length+b.formula.length)-(a.predict.length+a.formula.length)||b.formula.length-a.formula.length||a.num.localeCompare(b.num));
}

function dcSourceChips(items,kind){
  return (items||[]).slice(0,8).map(x=>{
    const text=x.detail?`${x.label} · ${x.detail}`:x.label;
    return `<span class="dc-source-chip ${kind==='formula'?'formula':''}" title="${escHtml(text)}">${escHtml(text)}</span>`;
  }).join('')||'<span class="dash-empty">-</span>';
}

function dcFormulaMatchHtml(matches){
  if(!matches?.length){
    return `<div class="dash-empty">ยังไม่พบเลขที่ระบบ Predict และสูตรคำนวณออกมาตรงกันในงวดนี้</div>`;
  }
  const renderItems=(items,startIndex=0)=>`<div class="dc-match-list">${items.map((m,i)=>`
    <details class="dc-match" ${i===0?'open':''}>
      <summary>
        <span>
          <span class="dc-match-num" title="คลิกเพื่อดูแหล่งที่มา">${escHtml(m.num)}</span>
          <span class="dc-match-sub">ตรงกัน ${m.predict.length+m.formula.length} แหล่ง</span>
        </span>
        <span class="dc-status good">P${m.predict.length} / F${m.formula.length}</span>
      </summary>
      <div class="dc-match-detail">
        <div class="dc-source-grid">
          <div class="dc-source-col">
            <div class="dc-source-title">Predict</div>
            ${dcSourceChips(m.predict,'predict')}
          </div>
          <div class="dc-source-col">
            <div class="dc-source-title">สูตรคำนวณ</div>
            ${dcSourceChips(m.formula,'formula')}
          </div>
        </div>
      </div>
    </details>`).join('')}</div>`;
  const groups=[
    ['3 หลัก',matches.filter(x=>String(x.num).length===3).slice(0,12)],
    ['2 หลัก',matches.filter(x=>String(x.num).length===2).slice(0,12)],
    ['6 หลัก',matches.filter(x=>String(x.num).length===6).slice(0,6)],
    ['อื่น ๆ',matches.filter(x=>![2,3,6].includes(String(x.num).length)).slice(0,8)]
  ].filter(([,items])=>items.length);
  return groups.map(([label,items],gi)=>`
    <div class="dc-match-section">
      <div class="dc-match-section-head">${label} <span class="dc-status">${items.length}</span></div>
      ${renderItems(items,gi*100)}
    </div>`).join('');
}

function dcComputeFormulaResults(historyRows,next){
  const rows=(historyRows||[]).filter(Boolean);
  if(!rows.length||typeof _computeFormulasBatch!=='function')return [];
  try{
    return _computeFormulasBatch(rows[0],next,rows.slice(1,201))||[];
  }catch(e){
    console.warn('Decision Center formula match failed',e);
    return [];
  }
}

function dcFormulaHit(fr,actual){
  const preds=(fr?.preds||[]).map(String);
  if(!actual||!preds.length)return false;
  const p=(v,w)=>String(v||'').padStart(w,'0');
  switch(fr.field){
    case 'bottom2': return preds.includes(p(actual.bottom2,2));
    case 'bottom2_unit': return preds.includes(String(actual.bottom2||'').slice(-1));
    case 'front3': return preds.includes(p(actual.front3_1,3))||preds.includes(p(actual.front3_2,3));
    case 'back3exact': return preds.includes(p(actual.back3_1,3))||preds.includes(p(actual.back3_2,3));
    case 'back3': return preds.includes(p(actual.back3_1,3))||preds.includes(p(actual.back3_2,3))||preds.includes(String(actual.back3_1||'').slice(-2))||preds.includes(String(actual.back3_2||'').slice(-2));
    case 'top3': return preds.includes(p(actual.top3,3));
    case 'prize1_last2': return preds.includes(p(actual.prize1,6).slice(-2));
    case 'prize1_last4_digits': {
      const tail=p(actual.prize1,6).slice(2);
      return preds.some((d,i)=>d===tail[i]);
    }
    default:
      if((fr.field||'').includes('unit'))return preds.includes(String(actual.bottom2||'').slice(-1));
      if((fr.field||'').startsWith('run_')){
        const target=[actual.bottom2,actual.front3_1,actual.front3_2,actual.back3_1,actual.back3_2,p(actual.prize1,6).slice(-3)].join('');
        return preds.some(d=>target.includes(d));
      }
      return false;
  }
}

function dcFormulaBaseP(field,n){
  const k=Math.max(1,Number(n)||1);
  if(field==='bottom2'||field==='prize1_last2')return k;
  if(['bottom2_unit','front3_unit','back3_unit','prize1_unit'].includes(field))return k*10;
  if(field==='top3'||field==='back3')return k/1000*100;
  if(field==='front3'||field==='back3exact')return k/1000*2*100;
  if(field==='prize1_last4_digits')return (1-Math.pow(.9,4))*100;
  if((field||'').startsWith('run_'))return (1-Math.pow((10-k)/10,2))*100;
  return 0;
}

function dcFormulaBacktestRows(rows,n=80){
  if(!rows?.length||typeof _computeFormulasBatch!=='function')return [];
  const stats={};
  let tested=0;
  for(let i=0;i<rows.length-1&&tested<n;i++){
    const curr=rows[i],prev=rows[i+1];
    if(!prev?.prize1||!curr?.prize1)continue;
    tested++;
    let iso='';
    if(curr.date){
      const [d,m,y]=String(curr.date).split('/').map(Number);
      if(d&&m&&y)iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    const frs=_computeFormulasBatch(prev,iso,rows.slice(i+2,i+202))||[];
    frs.forEach(fr=>{
      const key=fr.name||'formula';
      const s=stats[key]||(stats[key]={name:key,field:fr.field,baseline:fr.baseline||fr.preds?.length||1,hits:0,total:0});
      s.total++;
      if(dcFormulaHit(fr,curr))s.hits++;
    });
  }
  return Object.values(stats).map(s=>{
    const pct=s.total?s.hits/s.total*100:0;
    const baseP=dcFormulaBaseP(s.field,s.baseline);
    return {...s,pct,baseP,edge:pct-baseP,weight:Math.max(.25,Math.min(1.8,1+(pct-baseP)/35))};
  }).sort((a,b)=>b.edge-a.edge);
}

// ─── Decision Center track record (สรุปงวดนี้ auto-snapshot + hit-rate trend) ──────
function dcActualForDate(rows,iso){
  for(const row of rows||[]){
    if(!row?.date)continue;
    const [d,m,y]=String(row.date).split('/').map(Number);
    if(!d||!m||!y)continue;
    const rowIso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(rowIso===iso)return row;
  }
  return null;
}

function dcCheckHit(num,actual){
  if(!actual)return 'pending';
  const n=String(num||'').trim();
  const p=(v,w)=>String(v||'').padStart(w,'0');
  if(n.length===6)return n===p(actual.prize1,6)?'hit':'miss';
  if(n.length===3)return dcBtActual3(actual).has(n)?'hit':'miss';
  if(n.length===2)return n===p(actual.bottom2,2)?'hit':'miss';
  return 'miss';
}

function dcSnapshotResult(snapshot,rows){
  const actual=dcActualForDate(rows,snapshot?.date);
  const picks=snapshot?.picks||[];
  if(!actual)return {status:'pending',hits:0,total:picks.length};
  const results=picks.map(p=>dcCheckHit(p.num,actual));
  const hits=results.filter(r=>r==='hit').length;
  return {status:hits>0?'hit':'miss',hits,total:picks.length};
}

function dcHitRateTrend(snapshots,rows,window=5,take=20){
  const resolved=(snapshots||[])
    .map(s=>({date:s.date,...dcSnapshotResult(s,rows)}))
    .filter(r=>r.status!=='pending')
    .sort((a,b)=>a.date.localeCompare(b.date));
  const recent=resolved.slice(-take);
  return recent.map((r,i)=>{
    const start=Math.max(0,i-window+1);
    const win=recent.slice(start,i+1);
    const hitCount=win.filter(w=>w.status==='hit').length;
    return {date:r.date,value:+(hitCount/win.length*100).toFixed(1)};
  });
}

function dcSecondaryPrizeSignals(rows,limit=10){
  const cols=[
    'prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
    'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10'
  ];
  const recent=(rows||[]).slice(0,limit);
  const t2=new Map(),t3=new Map();
  recent.forEach((row,drawIndex)=>{
    cols.forEach(col=>{
      const v=String(row?.[col]||'').trim();
      if(!/^\d{6}$/.test(v))return;
      const add=(map,num)=>{
        const cur=map.get(num)||{num,count:0,draws:new Set(),sources:new Set()};
        cur.count++;cur.draws.add(row.date||String(drawIndex+1));cur.sources.add(col.replace('_',' #'));
        map.set(num,cur);
      };
      add(t3,v.slice(-3));
      add(t2,v.slice(-2));
    });
  });
  const sortRows=map=>[...map.values()]
    .filter(x=>x.count>1)
    .map(x=>({...x,drawCount:x.draws.size,sources:[...x.sources].slice(0,4)}))
    .sort((a,b)=>b.count-a.count||b.drawCount-a.drawCount||a.num.localeCompare(b.num));
  return {draws:recent.length,tail3:sortRows(t3).slice(0,10),tail2:sortRows(t2).slice(0,10)};
}

function dcSecondarySignalsHtml(signals){
  const row=(label,items)=>`<div class="dc-match-section">
    <div class="dc-match-section-head">${label} <span class="dc-status">${items.length}</span></div>
    <div class="dc-row">${items.length?items.map(x=>`<span class="num-badge predict-copy" onclick="copyPredNumber('${escHtml(x.num)}')" title="${escHtml(x.sources.join(', '))}">${escHtml(x.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">x${x.count}</span></span>`).join(''):'<span class="dash-empty">ยังไม่พบเลขซ้ำเด่น</span>'}</div>
  </div>`;
  return `<div>
    <div class="dc-signal-sub" style="margin-bottom:8px">นับจากรางวัลที่ 2/3 ล่าสุด ${signals.draws||0} งวด · เป็นแรงหนุนเชิงบริบท ไม่ใช่ผล backtest ของสูตร</div>
    ${row('ท้าย 3 จากรางวัลรอง',signals.tail3||[])}
    ${row('ท้าย 2 จากรางวัลรอง',signals.tail2||[])}
  </div>`;
}

function dcBuildScoreRows({cats,formulaResults,formulaMatches,btRows,mode,secondarySignals}){
  const map=new Map();
  const btMap=new Map((btRows||[]).map(r=>[r.name,r]));
  const cfg={strict:{min:58,limit:4},balanced:{min:42,limit:6},coverage:{min:26,limit:10}}[mode]||{min:42,limit:6};
  const add=(num,type,source,points,reason,meta={})=>{
    const n=String(num||'').trim(); if(!n)return;
    const r=map.get(n)||{num:n,type,sources:[],score:0,reasons:[],warnings:[],formulaWeight:0,predictCount:0,formulaCount:0,topEdge:null};
    r.type=r.type||type;
    r.score+=points;
    r.sources.push(source);
    if(reason)r.reasons.push(reason);
    if(meta.predict)r.predictCount++;
    if(meta.formula){
      r.formulaCount++;r.formulaWeight+=meta.weight||1;
      if(typeof meta.edge==='number')r.topEdge=r.topEdge==null?meta.edge:Math.max(r.topEdge,meta.edge);
    }
    map.set(n,r);
  };
  (cats.prize1?.numbers||[]).slice(0,12).forEach((r,i)=>{
    const base=Math.max(7,24-i*1.5);
    const n=String(predNum(r)||'');
    add(n,'6 หลัก','Predict รางวัลที่ 1',base,'ติดอันดับรางวัลที่ 1 จากระบบ Predict',{predict:true});
    add(p1Front(r),'3 หลัก','Predict หน้า 3',base*.62,'หน้า 3 ของชุดรางวัลที่ 1 ถูกระบบดันขึ้นมา',{predict:true});
    add(p1Back(r),'3 หลัก','Predict ท้าย 3',base*.62,'ท้าย 3 ของชุดรางวัลที่ 1 ถูกระบบดันขึ้นมา',{predict:true});
    if(n.length>=2)add(n.slice(-2),'2 หลัก','Predict ท้าย 2 รางวัลที่ 1',base*.42,'ท้าย 2 ของชุดรางวัลที่ 1 มีแรงหนุน',{predict:true});
  });
  [['front3_1','3 หลัก','Predict หน้า 3'],['front3_2','3 หลัก','Predict หน้า 3'],['back3_1','3 หลัก','Predict ท้าย 3'],['back3_2','3 หลัก','Predict ท้าย 3'],['bottom2','2 หลัก','Predict 2 ตัวล่าง']].forEach(([k,type,label])=>{
    (cats[k]?.numbers||[]).slice(0,12).forEach((r,i)=>add(predNum(r),type,label,Math.max(6,20-i*1.4),`${label} อันดับ ${i+1}`,{predict:true}));
  });
  (secondarySignals?.tail3||[]).slice(0,8).forEach((x,i)=>add(x.num,'3 หลัก','รางวัลรอง 10 งวด',Math.max(2,8-i*.7),`ท้าย 3 รางวัลที่ 2/3 ซ้ำ ${x.count} ครั้งใน ${secondarySignals.draws} งวด`));
  (secondarySignals?.tail2||[]).slice(0,8).forEach((x,i)=>add(x.num,'2 หลัก','รางวัลรอง 10 งวด',Math.max(2,7-i*.6),`ท้าย 2 รางวัลที่ 2/3 ซ้ำ ${x.count} ครั้งใน ${secondarySignals.draws} งวด`));
  (formulaResults||[]).forEach(fr=>{
    const bt=btMap.get(fr.name);
    const edge=bt?.edge??0;
    const isPattern=String(fr.name||'').includes('Pattern Link');
    const compact=(fr.preds||[]).length<=10;
    if(!isPattern&&!(compact&&edge>0))return;
    const w=bt?.weight||1;
    (fr.preds||[]).forEach(n=>{
      const len=String(n||'').length;
      if(![2,3,6].includes(len))return;
      add(n,`${len} หลัก`,fr.name,5*w,`สูตร ${fr.name} ให้เลขนี้โดยตรง${bt?` (edge ${edge>=0?'+':''}${edge.toFixed(1)}%)`:''}`,{formula:true,weight:w,edge:bt?bt.edge:undefined});
    });
  });
  (formulaMatches||[]).forEach(m=>{
    m.formula.forEach(f=>{
      const bt=btMap.get(f.label);
      const w=bt?.weight||1;
      const edge=bt?`backtest edge ${bt.edge>=0?'+':''}${bt.edge.toFixed(1)}%`:'ยังไม่มี backtest weight';
      add(m.num,String(m.num).length+' หลัก',f.label,10*w,`สูตร ${f.label} สนับสนุน (${edge})`,{formula:true,weight:w,edge:bt?.edge});
    });
  });
  for(const r of map.values()){
    if(r.predictCount&&r.formulaCount)r.score+=16;
    if(r.formulaWeight>2)r.score+=6;
    if(r.predictCount<1)r.warnings.push('ไม่มีแรงหนุนจาก Predict');
    if(r.formulaCount<1)r.warnings.push('ยังไม่มีสูตรคำนวณตรงกัน');
    if(r.score<cfg.min)r.warnings.push('คะแนนรวมต่ำกว่าโหมดคัดเลข');
    r.score=Math.round(Math.min(100,r.score));
  }
  const all=[...map.values()].sort((a,b)=>b.score-a.score||b.formulaCount-a.formulaCount||a.num.localeCompare(b.num));
  return {all,picks:all.filter(r=>r.score>=cfg.min).slice(0,cfg.limit),risks:all.filter(r=>r.warnings.length).slice(0,6)};
}

function dcEdgeBadge(topEdge){
  if(topEdge==null)return '';
  const cls=topEdge>0?'good':topEdge<0?'bad':'warn';
  return `<span class="dc-status ${cls}">edge ${topEdge>=0?'+':''}${topEdge.toFixed(1)}%</span>`;
}

function dcScoreHtml(rows){
  if(!rows?.length)return '<div class="dash-empty">ยังไม่มีเลขที่ผ่านโหมดคัดเลขนี้</div>';
  return `<div class="dc-decision-list">${rows.map((r,i)=>`
    <details class="dc-pick ${i===0?'top':''}" ${i===0?'open':''}>
      <summary class="dc-pick-head">
        <span class="dc-pick-num">${escHtml(r.num)}</span>
        <span style="display:flex;align-items:center;gap:6px"><span class="dc-score">${r.score}/100</span>${dcEdgeBadge(r.topEdge)}</span>
      </summary>
      <div class="dc-meter"><div class="dc-meter-fill" style="width:${r.score}%"></div></div>
      <div class="dc-explain">${escHtml(dcExplainPick(r))}</div>
      <div style="margin-top:7px">${r.sources.slice(0,5).map(s=>`<span class="dc-source-chip">${escHtml(s)}</span>`).join('')}</div>
    </details>`).join('')}</div>`;
}

function dcExplainPick(r){
  const parts=[];
  if(r.predictCount)parts.push(`มี Predict หนุน ${r.predictCount} จุด`);
  if(r.formulaCount)parts.push(`สูตรตรงกัน ${r.formulaCount} แหล่ง`);
  if(r.formulaWeight>0)parts.push(`น้ำหนักสูตร ${r.formulaWeight.toFixed(1)}`);
  if(r.reasons[0])parts.push(r.reasons[0]);
  if(r.warnings.length)parts.push(`ระวัง: ${r.warnings[0]}`);
  return parts.join(' · ');
}

function dcRiskHtml(rows){
  if(!rows?.length)return '<div class="dash-empty">ไม่มีรายการเสี่ยงเด่นในโหมดนี้</div>';
  return `<div class="dc-risk-list">${rows.map(r=>`<div class="dc-risk-item"><div><b class="dc-pick-num" style="font-size:.95rem">${escHtml(r.num)}</b><div class="dc-signal-sub">${escHtml(r.warnings.join(' · '))}</div></div><span class="dc-status warn">${r.score}/100</span></div>`).join('')}</div>`;
}

let _dcLastSnapshot=null;
let _dcHistRows=[];
function dcSnapshots(){
  try{return JSON.parse(localStorage.getItem('lottery_dc_snapshots')||'[]');}catch(e){return [];}
}
function dcAutoSaveSnapshot(snapshot){
  const list=dcSnapshots().filter(x=>x.date!==snapshot.date);
  list.unshift({...snapshot,savedAt:new Date().toISOString()});
  localStorage.setItem('lottery_dc_snapshots',JSON.stringify(list.slice(0,60)));
}
function dcTrackStatusBadge(status){
  if(status==='hit')return '<span class="dc-status good">ถูก</span>';
  if(status==='miss')return '<span class="dc-status bad">ไม่ถูก</span>';
  return '<span class="dc-status warn">รอผล</span>';
}
function dcSnapshotTrackHtml(rows){
  const list=dcSnapshots();
  if(!list.length)return '<div class="dash-empty">ยังไม่มี Snapshot</div>';
  const modeLabel=m=>m==='strict'?'ปลอดภัย':m==='coverage'?'ลุ้นสูง':'สมดุล';
  return `<div class="dc-snapshot-list">${list.map((s,i)=>{
    const result=dcSnapshotResult(s,rows);
    return `<details class="dc-snapshot-item" ${i===0?'open':''}>
    <summary><span>${fmtDate(s.date)} · ${modeLabel(s.mode)}</span><span style="display:flex;gap:6px;align-items:center"><span class="dc-status">${(s.picks||[]).length} เลข</span>${dcTrackStatusBadge(result.status)}</span></summary>
    <div class="dc-snapshot-detail">
      <div class="dc-row">${(s.picks||[]).map(p=>`<span class="num-badge">${escHtml(p.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">${p.score}/100</span></span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
      ${dcRecoSnapshotBadgesHtml(s,rows)}
      ${(s.pattern||[]).length?`<div class="dc-signal-sub" style="margin-top:7px">Pattern Link: ${(s.pattern||[]).map(p=>`${escHtml(p.num)}(${p.score})`).join(' ')}</div>`:''}
      <div class="dc-signal-sub" style="margin-top:7px">Predict × สูตรตรงกัน ${s.matches??'-'} รายการ${result.status!=='pending'?` · ถูก ${result.hits}/${result.total}`:''} · บันทึก ${s.savedAt?new Date(s.savedAt).toLocaleString('th-TH'):'-'}</div>
      <div class="dc-snapshot-actions">
        <button class="dc-mini-btn" onclick="dcLoadSnapshot('${escHtml(s.date)}')">โหลดงวดนี้</button>
        <button class="dc-mini-btn" onclick="dcDeleteSnapshot('${escHtml(s.date)}')">ลบ</button>
      </div>
    </div>
  </details>`;
  }).join('')}
  ${list.length>1?'<button class="dc-mini-btn" onclick="dcClearSnapshots()">ลบ Snapshot ทั้งหมด</button>':''}</div>`;
}

function dcLoadSnapshot(date){
  const el=document.getElementById('dc-date');
  if(el&&date){
    const opt=[...el.options].find(o=>o.value===date);
    if(opt)el.value=date;
    else el.add(new Option(fmtDate(date),date,true,true));
  }
  loadDecisionCenter();
}

function dcDeleteSnapshot(date){
  const list=dcSnapshots().filter(x=>x.date!==date);
  localStorage.setItem('lottery_dc_snapshots',JSON.stringify(list));
  const el=document.getElementById('dc-snapshot-list');
  if(el)el.innerHTML=dcSnapshotTrackHtml(_dcHistRows);
  toast('ลบ Snapshot แล้ว','success');
}

function dcClearSnapshots(){
  localStorage.removeItem('lottery_dc_snapshots');
  const el=document.getElementById('dc-snapshot-list');
  if(el)el.innerHTML=dcSnapshotTrackHtml(_dcHistRows);
  toast('ลบ Snapshot ทั้งหมดแล้ว','success');
}

function pageSnapshots(key){
  try{return JSON.parse(localStorage.getItem(`lottery_${key}_snapshots`)||'[]');}catch(e){return [];}
}

function savePageSnapshot(key,snap){
  const list=pageSnapshots(key).filter(x=>x.id!==snap.id);
  list.unshift({...snap,savedAt:new Date().toISOString()});
  localStorage.setItem(`lottery_${key}_snapshots`,JSON.stringify(list.slice(0,30)));
  renderPageSnapshots(key);
  toast('บันทึก Snapshot แล้ว','success');
}

function renderPageSnapshots(key){
  const el=document.getElementById(`${key}-snapshot-list`);
  if(!el)return;
  const list=pageSnapshots(key);
  if(!list.length){el.innerHTML='<div class="dash-empty">ยังไม่มี Snapshot</div>';return;}
  el.innerHTML=`<div class="dc-snapshot-list">${list.map((s,i)=>`<details class="dc-snapshot-item" ${i===0?'open':''}>
    <summary><span>${escHtml(s.title||fmtDate(s.date))}</span><span class="dc-status">${escHtml(s.mode||s.kind||'saved')}</span></summary>
    <div class="dc-snapshot-detail">
      <div class="dc-row">${(s.items||[]).map(p=>`<span class="num-badge">${escHtml(p.num)}${p.score!=null?`<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">${escHtml(p.score)}</span>`:''}</span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
      ${s.note?`<div class="dc-signal-sub" style="margin-top:7px">${escHtml(s.note)}</div>`:''}
      <div class="dc-signal-sub" style="margin-top:7px">บันทึก ${s.savedAt?new Date(s.savedAt).toLocaleString('th-TH'):'-'}</div>
      <div class="dc-snapshot-actions">
        ${s.date?`<button class="dc-mini-btn" onclick="loadPageSnapshot('${key}','${escHtml(s.id)}')">โหลดงวดนี้</button>`:''}
        <button class="dc-mini-btn" onclick="deletePageSnapshot('${key}','${escHtml(s.id)}')">ลบ</button>
      </div>
    </div>
  </details>`).join('')}${list.length>1?`<button class="dc-mini-btn" onclick="clearPageSnapshots('${key}')">ลบ Snapshot ทั้งหมด</button>`:''}</div>`;
}

function loadPageSnapshot(key,id){
  const snap=pageSnapshots(key).find(x=>x.id===id);
  if(!snap)return;
  if(key==='predict'&&snap.date){
    const el=document.getElementById('pred-date');
    if(el)el.value=snap.date;
    if(snap.topn)document.getElementById('pred-topn').value=snap.topn;
    if(snap.preset)document.getElementById('p1-preset').value=snap.preset;
    loadPredict();
  }else if(key==='formula'&&snap.date){
    const el=document.getElementById('f-target-date');
    if(el)el.value=snap.date;
    autoFillFormula();
  }
}

function deletePageSnapshot(key,id){
  localStorage.setItem(`lottery_${key}_snapshots`,JSON.stringify(pageSnapshots(key).filter(x=>x.id!==id)));
  renderPageSnapshots(key);
  toast('ลบ Snapshot แล้ว','success');
}

function clearPageSnapshots(key){
  localStorage.removeItem(`lottery_${key}_snapshots`);
  renderPageSnapshots(key);
  toast('ลบ Snapshot ทั้งหมดแล้ว','success');
}

function dcLottoSummaryBoard({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support}){
  const pickByLen=(len,n)=>scored.all.filter(x=>String(x.num).length===len).slice(0,n);
  const best=scored.picks[0]||scored.all[0]||{};
  const three=pickByLen(3,6).map(x=>x.num);
  const two=pickByLen(2,6).map(x=>x.num);
  const back=[...(cats.back3_1?.numbers||[]).slice(0,3),...(cats.back3_2?.numbers||[]).slice(0,3)].map(predNum).filter(Boolean);
  const p1ScoreKey=predScoreKey(p1||[]);
  const p1MaxScore=Math.max(1,...(p1||[]).map(x=>predScore(x,p1ScoreKey)));
  const p1DetailHtml=(p1||[]).slice(0,3).map((r,i)=>predDetailHtml({
    num:predNum(r),col:'prize1',row:r,rank:i+1,
    score:predScore(r,p1ScoreKey),maxScore:p1MaxScore,
    support:(support?.get(p1Front(r))?.count||0)+(support?.get(p1Back(r))?.count||0),
    extra:[`หน้า ${p1Front(r)}`,`ท้าย ${p1Back(r)}`]
  })).join('')||'<span class="dash-empty">-</span>';
  const supportTop=[...(support?.values()||[])].filter(x=>x.count>1).sort((a,b)=>b.count-a.count||a.num.localeCompare(b.num)).slice(0,10);
  const supportHtml=supportTop.map(x=>`<span class="num-badge agree predict-copy" onclick="copyPredNumber('${escHtml(x.num)}')">${escHtml(x.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">x${x.count}</span></span>`).join('')||'<span class="dash-empty">-</span>';
  const bestFormula=(btRows||[]).slice(0,3);
  const formulaLead=(formulaMatches||[]).slice(0,3);
  const patternLead=(scored.all||[]).filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,2);
  const formulaItems=[
    ...patternLead.map(x=>({title:`Pattern Link · ${x.num}`,sub:`Final score ${x.score}/100 · ${String(x.sources.find(s=>String(s).includes('Pattern Link'))||'สูตรเชื่อมโยงแพทเทิร์น')}`})),
    ...formulaLead.map(m=>({title:`เลข ${m.num}`,sub:`สูตรตรง ${m.formula.length} แหล่ง · Predict ${m.predict.length}`})),
    ...bestFormula.map(f=>({title:f.name,sub:`Backtest edge ${f.edge>=0?'+':''}${f.edge.toFixed(1)}%`}))
  ].slice(0,3);
  const patternStrip=patternLead.length?`<div class="dc-pattern-strip">
    <div class="dc-pattern-title">Pattern Link</div>
    <div>
      <div class="dc-pattern-row">${patternLead.map(x=>`<span class="dc-pattern-chip">เลข <b>${escHtml(x.num)}</b> <span>${x.score}/100</span></span>`).join('')}</div>
      <div class="dc-pattern-note">สูตรเชื่อมโยงแพทเทิร์นจากงวดก่อน → งวดเป้าหมาย ใช้เป็นแรงหนุนร่วมกับ Predict และ Backtest</div>
    </div>
  </div>`:'';
  const modeLabel=mode==='strict'?'ปลอดภัย':mode==='coverage'?'ลุ้นสูง':'สมดุล';
  return `<div class="dc-lotto-board">
    <div class="dc-lotto-head">
      <div class="dc-lotto-kicker">Decision Center · Prediction × สูตรคำนวณ × Backtest</div>
      <div class="dc-lotto-title">สรุปเลขเด่นงวด ${fmtDate(next)}</div>
      <div class="dc-lotto-sub">โหมด${modeLabel} · เลขเด่นถูกคัดจากระบบทำนาย สูตรคำนวณ น้ำหนัก backtest และผลล่าสุด</div>
    </div>
    <div class="dc-lotto-main">
      <div class="dc-lotto-prize">
        <div class="dc-lotto-label">เลขแนะนำอันดับ 1</div>
        <div class="dc-lotto-number">${escHtml(best.num||'-')}</div>
        <div class="dc-lotto-note">${best.score!=null?`Final Confidence ${best.score}/100 · ${escHtml(dcExplainPick(best))}`:'ยังไม่มีเลขผ่านเกณฑ์'}</div>
      </div>
      <div class="dc-lotto-side">
        <div class="dc-lotto-mini">
          <div class="dc-lotto-label">3 หลักเด่นจากสูตร + Predict</div>
          <div class="dc-lotto-row">${three.map(n=>numChip(n,'agree')).join('')||'<span class="dash-empty">-</span>'}</div>
        </div>
        <div class="dc-lotto-mini">
          <div class="dc-lotto-label">2 ตัวเด่นจากสูตร + Predict</div>
          <div class="dc-lotto-row">${two.map(n=>numChip(n,'agree')).join('')||'<span class="dash-empty">-</span>'}</div>
        </div>
      </div>
    </div>
    <div class="dc-lotto-block">
      <div class="dc-lotto-label">รางวัลที่ 1 จาก Predict</div>
      <div class="dc-row" style="justify-content:center">${p1DetailHtml}</div>
    </div>
    <div class="dc-lotto-sections">
      <div class="dc-lotto-section"><div class="dc-lotto-label">เลขหน้า 3 ตัว</div><div class="dc-lotto-row">${[...new Set(front)].slice(0,6).map(n=>numChip(n)).join('')||'<span class="dash-empty">-</span>'}</div></div>
      <div class="dc-lotto-section"><div class="dc-lotto-label">เลขท้าย 3 / 2 ตัว</div><div class="dc-lotto-row">${[...new Set([...back.slice(0,4),...(bottom||[]).slice(0,4).map(predNum)])].map(n=>numChip(n)).join('')||'<span class="dash-empty">-</span>'}</div></div>
      <div class="dc-lotto-section"><div class="dc-lotto-label">เลขหนุนข้ามหมวด</div><div class="dc-lotto-row">${supportHtml}</div></div>
    </div>
    <div class="dc-lotto-block">
      <div class="dc-lotto-label">Final Confidence Score · ${modeLabel}</div>
      ${dcScoreHtml(scored.picks)}
    </div>
    ${patternStrip}
    <div class="dc-lotto-formula">
      ${formulaItems.map(x=>`<div class="dc-lotto-formula-item"><div class="dc-lotto-formula-title">${escHtml(x.title)}</div><div class="dc-lotto-formula-sub">${escHtml(x.sub)}</div></div>`).join('')||'<div class="dash-empty">ยังไม่มีสูตรคำนวณที่ตรงกับ Predict</div>'}
    </div>
    <div class="dc-lotto-actions">
      <button class="btn btn-primary" onclick="dcRunDecisionBacktest()">Backtest เลขเด่นชุดนี้</button>
      <button class="btn btn-secondary" onclick="showPage('backtest')">Backtest รางวัลที่ 1</button>
      <button class="btn btn-secondary" onclick="showPage('predict')">เปิดหน้าทำนาย</button>
      <button class="btn btn-secondary" onclick="showPage('formula')">เปิดสูตรคำนวณ</button>
      <button class="btn btn-secondary" onclick="copyPredNumber('${escHtml([...(p1||[]).map(predNum),...(bottom||[]).slice(0,4).map(predNum)].filter(Boolean).join(' '))}')">copy ชุดหลัก</button>
    </div>
  </div>`;
}

function dcIsoFromThaiDate(s){
  const [d,m,y]=String(s||'').split('/').map(Number);
  if(!d||!m||!y)return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function dcConsensusCandidates(formulaResults,btMap,len,limit){
  const map=new Map();
  (formulaResults||[]).forEach(fr=>{
    const bt=btMap.get(fr.name);
    const weight=Math.max(.4,Math.min(2,bt?.weight||1));
    const exact3=['top3','front3','back3','back3exact'].includes(fr.field);
    const exact2=['bottom2','prize1_last2'].includes(fr.field);
    if((len===3&&!exact3)||(len===2&&!exact2))return;
    (fr.preds||[]).forEach(n=>{
      const num=String(n||'').padStart(len,'0');
      if(num.length!==len)return;
      const cur=map.get(num)||{num,score:0,sources:0};
      cur.score+=weight;
      cur.sources++;
      map.set(num,cur);
    });
  });
  return [...map.values()].sort((a,b)=>b.score-a.score||b.sources-a.sources||a.num.localeCompare(b.num)).slice(0,limit);
}

// เลขแนะนำ (Recommended Number) convergence engine — ISSUE-9.
// Independent of dcConsensusCandidates above (which merges same-length field types for
// a different, already-shipped "หลักเด่น" purpose and must stay untouched). Requires an
// EXACT field-type match, not just equal digit length, and requires 2+ DISTINCT
// top-level formula groups (A-I, keyed by name[0] — Codex's X-prefixed sub-formulas all
// count as one group 'X'), never two sub-formulas of the same group. Field types with
// only one historical producing group (pool6, back3, prize1_last4_digits, bottom2_unit)
// therefore never produce a result — a structural consequence of the group-count check
// below, not special-cased. See docs/adr/0001-convergence-definition-for-recommended-number.md.
function dcRecommendedNumbers(formulaResults,btMap){
  const byField=new Map();
  (formulaResults||[]).forEach(fr=>{
    const field=fr?.field;
    if(!field)return;
    const groupKey=String(fr?.name||'')[0]||'?';
    const bt=btMap&&typeof btMap.get==='function'?btMap.get(fr.name):undefined;
    const edge=typeof bt?.edge==='number'?bt.edge:0;
    (fr.preds||[]).forEach(n=>{
      const num=String(n||'').trim();
      if(!num)return;
      if(!byField.has(field))byField.set(field,new Map());
      const numMap=byField.get(field);
      if(!numMap.has(num))numMap.set(num,new Map());
      const groupMap=numMap.get(num);
      const prevEdge=groupMap.get(groupKey);
      if(prevEdge===undefined||edge>prevEdge)groupMap.set(groupKey,edge);
    });
  });
  const result={};
  for(const [field,numMap] of byField){
    const list=[];
    for(const [num,groupMap] of numMap){
      if(groupMap.size<2)continue;
      const groups=[...groupMap.keys()].sort();
      const combinedEdge=[...groupMap.values()].reduce((a,b)=>a+b,0);
      list.push({num,groups,combinedEdge});
    }
    list.sort((a,b)=>b.groups.length-a.groups.length||b.combinedEdge-a.combinedEdge||a.num.localeCompare(b.num));
    result[field]=list;
  }
  return result;
}

// The 5 field types with 2+ historical producing groups — the only ones structurally
// eligible for เลขแนะนำ (see docs/adr/0001-...). pool6/back3/prize1_last4_digits/
// bottom2_unit are deliberately excluded from this list, not just absent from results.
// MAINTENANCE TRIPWIRE: dcRecommendedNumbers computes convergence for ANY field type;
// this list only controls which fields get a card + the coverage-badge denominator.
// If a NEW formula group is ever added to formula-engine.js targeting a field not
// listed here (e.g. a 2nd producer for pool6/back3/prize1_last4_digits/bottom2_unit),
// that field becomes structurally eligible per ADR-0001 and MUST be added here too, or
// its เลขแนะนำ will be computed but silently never rendered. There is no runtime error
// for this — it is a quiet display gap, so update this list when adding such a group.
const DC_RECO_FIELDS=[['bottom2','2 ตัวล่าง'],['top3','3 ตัวบน'],['front3','3 ตัวหน้า'],['back3exact','3 ตัวหลัง'],['prize1_last2','ท้าย 2 รางวัลที่ 1']];
// Known count of DISTINCT top-level producing groups per field type (see ADR-0001 and the
// tripwire above). Drives the group-count-aware เลขแนะนำ baseline in dcRecoBaseline. Keep in
// sync with formula-engine.js:
//   bottom2 ← A,B,C,D,E,G,F/X (7) — note E (สายมู belief) emits bottom2 via a dynamic
//             loop (name f.name+'…'), so a literal grep of `field:'bottom2'` UNDERCOUNTS it;
//   top3 ← G,H,F/X (3) · front3 ← D,F/X (2) · back3exact ← D,F/X (2) · prize1_last2 ← D,F/X (2).
// These values are cross-checked against the real engine output by
// scripts/test_reco_producer_groups.js (which runs _computeFormulasBatch and counts distinct
// name[0] per field), so drift here fails a test rather than silently skewing the baseline.
const DC_RECO_PRODUCER_GROUPS={bottom2:7,top3:3,front3:2,back3exact:2,prize1_last2:2};
const DC_RECO_GROUP_DISPLAY={X:'F'};
function dcRecoGroupLabel(key){ return DC_RECO_GROUP_DISPLAY[key]||key; }

// เลขแนะนำ's own honest baseline (ADR-0002: no backtest exemption). This is the expected
// per-round rate at which a coincidental 2-group convergence would ALSO hit, under a null
// where each producing group emits ~1 random candidate: C(G,2) group-pairs × pRandom², where
// pRandom is the random single-guess hit probability under dcCheckHit's own definition
// (2-digit fields → exact 2 ตัวล่าง = 1/100; 3-digit fields → any of the ~5 three-digit
// result slots = 5/1000 ≈ 1/200). The group count G enters via C(G,2): the more groups that
// can produce a field type, the cheaper coincidental convergence is, so the higher the bar
// เลขแนะนำ must clear there. This is a deliberately conservative order-of-magnitude estimate
// (real per-group candidate sets are larger than 1, so true coincidence rates are somewhat
// higher) — documented as such rather than presented as an exact probability.
function dcRecoBaseline(field,groupCount){
  const g=Math.max(2,Number(groupCount)||2);
  const pRandom=['bottom2','prize1_last2'].includes(field)?0.01:0.005;
  const pairs=g*(g-1)/2;
  return pairs*pRandom*pRandom*100;
}

// Per-field-type เลขแนะนำ Track Record + Edge over RESOLVED auto-snapshots. Unconditional:
// the denominator is every resolved round (a round where a field's เลขแนะนำ didn't converge
// simply didn't hit that round), so the Edge is comparable to the group-count-aware baseline
// above. Reuses dcActualForDate + dcCheckHit — no new hit logic. Snapshot shape (per round):
// s.reco = [{field, num, groups}] for each field that had a top เลขแนะนำ.
function dcRecoEdgeRows(snapshots,rows){
  const resolved=(snapshots||[])
    .map(s=>({s,actual:dcActualForDate(rows,s?.date)}))
    .filter(x=>x.actual);
  const totalResolved=resolved.length;
  return DC_RECO_FIELDS.map(([field,label])=>{
    const groupCount=DC_RECO_PRODUCER_GROUPS[field]||2;
    let shown=0,hits=0;
    resolved.forEach(({s,actual})=>{
      const entry=(s.reco||[]).find(r=>r&&r.field===field);
      if(!entry)return;
      shown++;
      if(dcCheckHit(entry.num,actual)==='hit')hits++;
    });
    const hitRate=totalResolved?hits/totalResolved*100:0;
    const baseline=dcRecoBaseline(field,groupCount);
    return {field,label,groupCount,totalResolved,shown,hits,hitRate,baseline,edge:hitRate-baseline};
  });
}

function dcRecoExplainHtml(candidate){
  if(!candidate)return '';
  // Map to display labels (X->F) BEFORE sorting, so the shown order is alphabetical by
  // DISPLAYED group (e.g. F + G + H), not by raw key (which would show G + H + F).
  const shown=candidate.groups.map(dcRecoGroupLabel).sort();
  return `${shown.join(' + ')} เห็นตรงกัน`;
}

function dcRecoCardHtml(field,label,candidates){
  const list=candidates||[];
  if(!list.length){
    return `<div class="dc-reco-card">
      <div class="dc-reco-field-label">${escHtml(label)}</div>
      <div class="dc-reco-empty">ยังไม่มีสูตรเห็นตรงกันในงวดนี้</div>
    </div>`;
  }
  const top=list[0];
  const rest=list.slice(1);
  const moreHtml=rest.length?`<details class="dc-reco-more">
      <summary>ดูอีก ${rest.length} เลขที่เข้าเกณฑ์</summary>
      <div class="dc-reco-more-row">${rest.map(c=>`<span class="dc-reco-more-chip" title="${escHtml(dcRecoExplainHtml(c))}">${escHtml(c.num)}</span>`).join('')}</div>
    </details>`:'';
  return `<div class="dc-reco-card has-num">
    <div class="dc-reco-field-label">${escHtml(label)}</div>
    <div class="dc-reco-num">${escHtml(top.num)}</div>
    <div class="dc-reco-explain">${escHtml(dcRecoExplainHtml(top))}</div>
    ${moreHtml}
  </div>`;
}

function dcRecoCoverageBadgeHtml(reco){
  const total=DC_RECO_FIELDS.length;
  const count=DC_RECO_FIELDS.filter(([field])=>(reco?.[field]||[]).length>0).length;
  const cls=count>0?'good':'warn';
  return `<span class="dc-status ${cls}">${count}/${total} มีเลขแนะนำ</span>`;
}

function dcRecoSectionHtml(reco){
  const cards=DC_RECO_FIELDS.map(([field,label])=>dcRecoCardHtml(field,label,reco?.[field])).join('');
  return `<div class="dc-reco-board">
    <div class="dc-reco-head">
      <div class="dc-reco-title-group">
        <div class="dc-reco-kicker">Decision Center · Cross-Formula Convergence</div>
        <div class="dc-reco-title">เลขแนะนำ</div>
      </div>
      ${dcRecoCoverageBadgeHtml(reco)}
    </div>
    <div class="dc-reco-grid">${cards}</div>
  </div>`;
}

// เลขแนะนำ Edge card — its own labelled metric, never merged into a formula Edge or the
// Final Confidence Score. Shows, per field type: producing-group count, how many resolved
// rounds it was shown in, its unconditional hit rate, its own group-count-aware baseline,
// and Edge = hitRate − baseline.
function dcRecoEdgeCardHtml(edgeRows){
  const anyResolved=(edgeRows||[]).some(r=>r.totalResolved>0);
  if(!anyResolved){
    return `<div class="dc-card dc-card-wide">
      <div class="dc-label">เลขแนะนำ · Edge (จาก Track Record)</div>
      <div class="dc-signal-sub" style="margin-bottom:8px">Edge = อัตราถูกจริง − baseline (บังเอิญตรงกันแล้วถูก) · baseline สูงขึ้นตามจำนวนกลุ่มที่ผลิต field นั้น</div>
      <div class="dash-empty">ยังไม่มีงวดที่มีผลจริง — auto-save จะสะสมเลขแนะนำทุกงวดเพื่อวัด Edge อย่างซื่อสัตย์</div>
    </div>`;
  }
  const total=edgeRows[0]?.totalResolved||0;
  const rows=edgeRows.map(r=>{
    const edgeCls=r.edge>0?'good':r.edge<0?'bad':'warn';
    const shownNote=r.shown?`${r.shown}/${total} งวด · ถูก ${r.hits}`:'ยังไม่เคยเห็นตรงกันในงวดที่มีผล';
    return `<div class="dc-reco-edge-row">
      <div class="dc-reco-edge-field">${escHtml(r.label)} <span class="dc-reco-edge-groups">${r.groupCount} กลุ่มผลิต</span></div>
      <div class="dc-reco-edge-stat">${shownNote}</div>
      <div class="dc-reco-edge-nums">
        <span class="dc-reco-edge-rate">${r.hitRate.toFixed(1)}%</span>
        <span class="dc-reco-edge-base">base ${r.baseline.toFixed(2)}%</span>
        <span class="dc-status ${edgeCls}">edge ${r.edge>=0?'+':''}${r.edge.toFixed(2)}%</span>
      </div>
    </div>`;
  }).join('');
  return `<div class="dc-card dc-card-wide">
    <div class="dc-label">เลขแนะนำ · Edge (จาก Track Record · ${total} งวดที่มีผล)</div>
    <div class="dc-signal-sub" style="margin-bottom:8px">Edge = อัตราถูกจริง − baseline (บังเอิญตรงกันแล้วถูก) · baseline สูงขึ้นตามจำนวนกลุ่มที่ผลิต field นั้น (bottom2 มี 6 กลุ่ม convergence เกิดง่าย จึงต้องผ่านบาร์สูงกว่า)</div>
    <div class="dc-reco-edge-list">${rows}</div>
  </div>`;
}

// Per-round เลขแนะนำ hit/miss/pending badges for the snapshot Track Record list. Reuses
// dcCheckHit — same coarse digit-length hit definition used for Picks.
function dcRecoSnapshotBadgesHtml(snapshot,rows){
  const reco=snapshot?.reco||[];
  if(!reco.length)return '';
  const actual=dcActualForDate(rows,snapshot?.date);
  const chips=reco.map(r=>{
    const status=dcCheckHit(r.num,actual);
    const cls=status==='hit'?'good':status==='miss'?'bad':'warn';
    const txt=status==='hit'?'ถูก':status==='miss'?'ไม่ถูก':'รอผล';
    return `<span class="dc-status ${cls}" title="${escHtml(r.field)}">แนะนำ ${escHtml(r.num)} · ${txt}</span>`;
  }).join('');
  return `<div class="dc-reco-snap-badges" style="margin-top:7px">${chips}</div>`;
}

function dcBtActual3(row){
  return new Set([row.top3,row.front3_1,row.front3_2,row.back3_1,row.back3_2].map(x=>String(x||'').padStart(3,'0')).filter(x=>x.length===3));
}

async function dcRunDecisionBacktest(){
  const panel=document.getElementById('dc-backtest-panel');
  if(!panel)return;
  panel.innerHTML='<div class="dc-bt-panel"><div class="dc-bt-title">กำลัง Backtest เลขเด่นย้อนหลัง...</div><div class="dc-bt-sub">ทดสอบสูตรคำนวณแบบ rolling โดยใช้ข้อมูลงวดก่อนหน้าเท่านั้น</div></div>';
  try{
    const hist=await api('history?n=160');
    const rows=hist.data||[];
    if(rows.length<25||typeof _computeFormulasBatch!=='function')throw new Error('not enough data');
    const btRows=dcFormulaBacktestRows(rows,80);
    const btMap=new Map(btRows.map(r=>[r.name,r]));
    const samples=[];
    let tested=0,hit2=0,hit3=0,total2=0,total3=0;
    for(let i=0;i<rows.length-1&&tested<60;i++){
      const curr=rows[i],prev=rows[i+1];
      if(!curr?.prize1||!prev?.prize1)continue;
      tested++;
      const iso=dcIsoFromThaiDate(curr.date);
      const frs=_computeFormulasBatch(prev,iso,rows.slice(i+2,i+202))||[];
      const c2=dcConsensusCandidates(frs,btMap,2,6);
      const c3=dcConsensusCandidates(frs,btMap,3,8);
      const actual2=String(curr.bottom2||'').padStart(2,'0');
      const actual3=dcBtActual3(curr);
      const ok2=c2.some(x=>x.num===actual2);
      const ok3=c3.some(x=>actual3.has(x.num));
      if(c2.length){total2++; if(ok2)hit2++;}
      if(c3.length){total3++; if(ok3)hit3++;}
      if(samples.length<6)samples.push({date:curr.date,actual2,actual3:[...actual3].slice(0,5),c2:c2.map(x=>x.num),c3:c3.map(x=>x.num),ok2,ok3});
    }
    const pct=(a,b)=>b?`${(a/b*100).toFixed(1)}%`:'-';
    panel.innerHTML=`<div class="dc-bt-panel">
      <div class="dc-bt-head">
        <div><div class="dc-bt-title">Backtest เลขเด่น Decision Center</div><div class="dc-bt-sub">Rolling ${tested} งวดล่าสุด · วัดชั้นสูตรคำนวณ + น้ำหนัก backtest ก่อนนำไปผสมกับ Predict</div></div>
        <span class="dc-status good">tested</span>
      </div>
      <div class="dc-bt-grid">
        <div class="dc-bt-card"><div class="dc-bt-val">${tested}</div><div class="dc-bt-label">งวดที่ทดสอบ</div></div>
        <div class="dc-bt-card"><div class="dc-bt-val">${pct(hit2,total2)}</div><div class="dc-bt-label">Hit 2 ตัว (${hit2}/${total2})</div></div>
        <div class="dc-bt-card"><div class="dc-bt-val">${pct(hit3,total3)}</div><div class="dc-bt-label">Hit 3 หลัก (${hit3}/${total3})</div></div>
        <div class="dc-bt-card"><div class="dc-bt-val">${btRows[0]?.edge>=0?'+':''}${(btRows[0]?.edge||0).toFixed(1)}%</div><div class="dc-bt-label">สูตร edge สูงสุด</div></div>
      </div>
      <div class="dc-bt-list">${samples.map(s=>`<div class="dc-bt-row">
        <div><b>${escHtml(s.date)}</b> · 2ตัว ${escHtml(s.actual2)} <span class="${s.ok2?'dc-bt-hit':'dc-bt-miss'}">${s.ok2?'เข้า':'ไม่เข้า'}</span> · 3หลัก <span class="${s.ok3?'dc-bt-hit':'dc-bt-miss'}">${s.ok3?'เข้า':'ไม่เข้า'}</span></div>
        <div class="dc-bt-label">คัด 2ตัว: ${s.c2.slice(0,5).join(' ')||'-'}</div>
        <div class="dc-bt-label">คัด 3หลัก: ${s.c3.slice(0,5).join(' ')||'-'}</div>
      </div>`).join('')}</div>
      <div class="dc-bt-sub" style="margin-top:9px">หมายเหตุ: Backtest นี้วัดความแม่นของชั้นสูตรคำนวณ/consensus แบบ rolling ส่วนโมเดล Predict รางวัลที่ 1 ดูต่อได้ที่ปุ่ม Backtest รางวัลที่ 1</div>
    </div>`;
  }catch(e){
    panel.innerHTML='<div class="dc-bt-panel"><div class="dc-bt-title">Backtest ไม่สำเร็จ</div><div class="dc-bt-sub">ข้อมูลย้อนหลังไม่พอหรือสูตรคำนวณยังโหลดไม่ครบ ลองรีเฟรชหน้าอีกครั้ง</div></div>';
  }
}

async function loadDecisionCenter(){
  const root=document.getElementById('dc-root');
  if(!root)return;
  root.className='dc-loading';
  root.textContent='กำลังรวมสัญญาณงวดนี้...';
  const dateEl=document.getElementById('dc-date');
  if(dateEl&&!dateEl.options.length){
    try{
      const nd=await api('next-draws');
      dateEl.innerHTML=(nd.draws||[]).map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
    }catch(e){}
  }
  const next=dateEl?.value||nextDrawInfo().iso;
  const mode=document.getElementById('dc-mode')?.value||'balanced';
  try{
    const [summary,pred,hist]=await Promise.all([
      api('summary'),
      api(`predict/all?top_n=10&date=${next}&beam_width=500&k_back=100&preset=optimized`),
      api('prize-history?n=260')
    ]);
    const cats=pred.categories||{};
    const p1=(cats.prize1?.numbers||[]).slice(0,5);
    const bottom=(cats.bottom2?.numbers||[]).slice(0,8);
    const front=[...(cats.front3_1?.numbers||[]).slice(0,4),...(cats.front3_2?.numbers||[]).slice(0,4)].map(predNum).filter(Boolean);
    const support=predictionSupportMap(cats);
    const latest=summary.latest||{};
    const healthStatus=latest.prize1?'good':'bad';
    const healthText=latest.prize1?'พร้อมใช้':'ข้อมูลยังไม่พร้อม';
    const formulaResults=dcComputeFormulaResults(hist.data,next);
    const formulaMatches=dcBuildPredictFormulaMatches(cats,formulaResults);
    const btRows=dcFormulaBacktestRows(hist.data,80);
    const secondarySignals=dcSecondaryPrizeSignals(hist.data,10);
    const scored=dcBuildScoreRows({cats,formulaResults,formulaMatches,btRows,mode,secondarySignals});
    const formulaMatchHtml=dcFormulaMatchHtml(formulaMatches);
    const btMapForReco=new Map((btRows||[]).map(r=>[r.name,r]));
    const recoObj=dcRecommendedNumbers(formulaResults,btMapForReco);
    const recoHtml=dcRecoSectionHtml(recoObj);
    // Top เลขแนะนำ per field type — snapshotted so its honest Track Record + Edge can be
    // measured once the target draw resolves (ISSUE-10, ADR-0002: no backtest exemption).
    const recoTops=DC_RECO_FIELDS.map(([field])=>{
      const list=recoObj[field]||[];
      return list.length?{field,num:list[0].num,groups:list[0].groups}:null;
    }).filter(Boolean);
    const lottoBoardHtml=dcLottoSummaryBoard({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support});
    _dcHistRows=hist.data||[];
    _dcLastSnapshot={
      date:next,
      mode,
      picks:scored.picks.map(x=>({num:x.num,score:x.score,type:x.type,explain:dcExplainPick(x)})),
      pattern:scored.all.filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,5).map(x=>({num:x.num,score:x.score})),
      reco:recoTops,
      matches:formulaMatches.length
    };
    dcAutoSaveSnapshot(_dcLastSnapshot);
    const recoEdgeHtml=dcRecoEdgeCardHtml(dcRecoEdgeRows(dcSnapshots(),_dcHistRows));
    const trend=dcHitRateTrend(dcSnapshots(),_dcHistRows,5,20);
    const trendHtml=trend.length
      ?`<div style="height:180px"><canvas id="dc-trend-chart" role="img" aria-label="กราฟแนวโน้มอัตราถูกของ Decision Center"></canvas></div>`
      :'<div class="dash-empty">ยังไม่มีงวดที่มีผลจริงพอจะคำนวณแนวโน้ม — auto-save จะสะสมทุกครั้งที่เปิดหน้านี้</div>';
    root.className='';
    root.innerHTML=`${recoHtml}
    <div class="dc-grid">${recoEdgeHtml}</div>
    ${lottoBoardHtml}
    <div class="dc-grid">
      <div class="dc-card dc-card-wide"><div class="dc-label">Snapshot + Track Record</div><div class="dc-signal-sub" style="margin-bottom:8px">บันทึกอัตโนมัติทุกครั้งที่เปิดหน้านี้ · &quot;ถูก&quot; = มีเลขอย่างน้อย 1 ตัวในชุดที่ตรงผลจริง</div><div id="dc-snapshot-list" class="dc-row">${dcSnapshotTrackHtml(_dcHistRows)}</div></div>
      <div class="dc-card dc-card-wide"><div class="dc-label">แนวโน้มอัตราถูก (20 งวดล่าสุดที่มีผล · rolling 5 งวด)</div>${trendHtml}</div>
    </div>
    <div id="dc-backtest-panel"></div>
    <div class="dc-panel">
      <div class="dc-label">Data Health</div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">ผลงวดล่าสุด</div><div class="dc-signal-sub">${latest.date||'-'} · ${latest.prize1||'-'}</div></div><span class="dc-status ${healthStatus}">${healthText}</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">จำนวนงวดในระบบ</div><div class="dc-signal-sub">${summary.total_draws||summary.total||'-'} งวด</div></div><span class="dc-status good">DATA</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">สูตรคำนวณ</div><div class="dc-signal-sub">กดเปิดสูตรเพื่อ refresh Formula Final Picks</div></div><span class="dc-status warn">optional</span></div>
    </div>
    <div class="dc-grid">
      <div class="dc-card dc-card-wide"><div class="dc-label">Predict × สูตรคำนวณ ตรงกัน</div><div class="dc-row">${formulaMatchHtml}</div></div>
      <div class="dc-card dc-card-wide"><div class="dc-label">สัญญาณจากรางวัลรอง 10 งวดล่าสุด</div>${dcSecondarySignalsHtml(secondarySignals)}</div>
      <div class="dc-card"><div class="dc-label">ตัดเลขเสี่ยง</div><div class="dc-row">${dcRiskHtml(scored.risks)}</div></div>
    </div>`;
    if(trend.length){
      const opts=chartOpts('% ถูก');
      opts.scales.y.min=0;opts.scales.y.max=100;
      mkChart('dc-trend-chart',{type:'line',data:{
        labels:trend.map(t=>fmtDate(t.date)),
        datasets:[{label:'% ถูก (rolling 5 งวด)',data:trend.map(t=>t.value),borderColor:'#3dd68c',backgroundColor:'rgba(61,214,140,.15)',tension:.3,fill:true,pointRadius:2}]
      },options:opts});
    }
  }catch(e){
    root.className='dc-loading';
    root.textContent='โหลด Decision Center ไม่สำเร็จ ลองใหม่อีกครั้ง';
  }
}

// ─── Decision Center (OLD VER) ─────────────────────────────────────────────────
// Byte-for-byte behavioral duplicate of the Decision Center above (ISSUE-8), kept
// under its own tab so the rebrand in ISSUE-9 can freely modify the block above
// without touching what ships here. Shares generic utilities (api, escHtml,
// predNum, mkChart, etc.) with the block above on purpose, but its Track Record
// storage ('lottery_dc_snapshots_old') is seeded once from the live tab's data
// and then fully isolated — OLD VER's own delete/clear actions must never
// mutate the live สรุปงวดนี้ tab's history.
function dcAddSourceOld(map,num,kind,label,detail=''){
  const n=String(num||'').trim();
  if(!n)return;
  const cur=map.get(n)||{num:n,predict:[],formula:[]};
  const item={label:String(label||kind),detail:String(detail||'')};
  const bucket=kind==='formula'?cur.formula:cur.predict;
  if(!bucket.some(x=>x.label===item.label&&x.detail===item.detail))bucket.push(item);
  map.set(n,cur);
}

function dcBuildPredictFormulaMatchesOld(cats,formulaResults){
  const map=new Map();
  (cats.prize1?.numbers||[]).slice(0,20).forEach((r,i)=>{
    const n=String(predNum(r)||'');
    dcAddSourceOld(map,n,'predict','Predict รางวัลที่ 1',`อันดับ ${i+1}`);
    dcAddSourceOld(map,p1Front(r),'predict','Predict หน้า 3 จากรางวัลที่ 1',n);
    dcAddSourceOld(map,p1Back(r),'predict','Predict ท้าย 3 จากรางวัลที่ 1',n);
    if(n.length>=2)dcAddSourceOld(map,n.slice(-2),'predict','Predict ท้าย 2 จากรางวัลที่ 1',n);
  });
  [
    ['front3_1','Predict เลขหน้า 3 ชุดที่ 1'],
    ['front3_2','Predict เลขหน้า 3 ชุดที่ 2'],
    ['back3_1','Predict เลขท้าย 3 ชุดที่ 1'],
    ['back3_2','Predict เลขท้าย 3 ชุดที่ 2'],
    ['bottom2','Predict เลขท้าย 2 ตัวล่าง']
  ].forEach(([key,label])=>{
    (cats[key]?.numbers||[]).slice(0,20).forEach((r,i)=>dcAddSourceOld(map,predNum(r),'predict',label,`อันดับ ${i+1}`));
  });

  (formulaResults||[]).forEach(fr=>{
    const name=fr?.name||'สูตรคำนวณ';
    const field=fr?.field||fr?.compareField||'formula';
    (fr?.preds||fr?.predictions||[]).forEach(n=>dcAddSourceOld(map,n,'formula',name,field));
  });

  return [...map.values()]
    .filter(x=>x.predict.length&&x.formula.length)
    .sort((a,b)=>(b.predict.length+b.formula.length)-(a.predict.length+a.formula.length)||b.formula.length-a.formula.length||a.num.localeCompare(b.num));
}

function dcSourceChipsOld(items,kind){
  return (items||[]).slice(0,8).map(x=>{
    const text=x.detail?`${x.label} · ${x.detail}`:x.label;
    return `<span class="dc-source-chip ${kind==='formula'?'formula':''}" title="${escHtml(text)}">${escHtml(text)}</span>`;
  }).join('')||'<span class="dash-empty">-</span>';
}

function dcFormulaMatchHtmlOld(matches){
  if(!matches?.length){
    return `<div class="dash-empty">ยังไม่พบเลขที่ระบบ Predict และสูตรคำนวณออกมาตรงกันในงวดนี้</div>`;
  }
  const renderItems=(items,startIndex=0)=>`<div class="dc-match-list">${items.map((m,i)=>`
    <details class="dc-match" ${i===0?'open':''}>
      <summary>
        <span>
          <span class="dc-match-num" title="คลิกเพื่อดูแหล่งที่มา">${escHtml(m.num)}</span>
          <span class="dc-match-sub">ตรงกัน ${m.predict.length+m.formula.length} แหล่ง</span>
        </span>
        <span class="dc-status good">P${m.predict.length} / F${m.formula.length}</span>
      </summary>
      <div class="dc-match-detail">
        <div class="dc-source-grid">
          <div class="dc-source-col">
            <div class="dc-source-title">Predict</div>
            ${dcSourceChipsOld(m.predict,'predict')}
          </div>
          <div class="dc-source-col">
            <div class="dc-source-title">สูตรคำนวณ</div>
            ${dcSourceChipsOld(m.formula,'formula')}
          </div>
        </div>
      </div>
    </details>`).join('')}</div>`;
  const groups=[
    ['3 หลัก',matches.filter(x=>String(x.num).length===3).slice(0,12)],
    ['2 หลัก',matches.filter(x=>String(x.num).length===2).slice(0,12)],
    ['6 หลัก',matches.filter(x=>String(x.num).length===6).slice(0,6)],
    ['อื่น ๆ',matches.filter(x=>![2,3,6].includes(String(x.num).length)).slice(0,8)]
  ].filter(([,items])=>items.length);
  return groups.map(([label,items],gi)=>`
    <div class="dc-match-section">
      <div class="dc-match-section-head">${label} <span class="dc-status">${items.length}</span></div>
      ${renderItems(items,gi*100)}
    </div>`).join('');
}

function dcComputeFormulaResultsOld(historyRows,next){
  const rows=(historyRows||[]).filter(Boolean);
  if(!rows.length||typeof _computeFormulasBatch!=='function')return [];
  try{
    return _computeFormulasBatch(rows[0],next,rows.slice(1,201))||[];
  }catch(e){
    console.warn('Decision Center formula match failed',e);
    return [];
  }
}

function dcFormulaHitOld(fr,actual){
  const preds=(fr?.preds||[]).map(String);
  if(!actual||!preds.length)return false;
  const p=(v,w)=>String(v||'').padStart(w,'0');
  switch(fr.field){
    case 'bottom2': return preds.includes(p(actual.bottom2,2));
    case 'bottom2_unit': return preds.includes(String(actual.bottom2||'').slice(-1));
    case 'front3': return preds.includes(p(actual.front3_1,3))||preds.includes(p(actual.front3_2,3));
    case 'back3exact': return preds.includes(p(actual.back3_1,3))||preds.includes(p(actual.back3_2,3));
    case 'back3': return preds.includes(p(actual.back3_1,3))||preds.includes(p(actual.back3_2,3))||preds.includes(String(actual.back3_1||'').slice(-2))||preds.includes(String(actual.back3_2||'').slice(-2));
    case 'top3': return preds.includes(p(actual.top3,3));
    case 'prize1_last2': return preds.includes(p(actual.prize1,6).slice(-2));
    case 'prize1_last4_digits': {
      const tail=p(actual.prize1,6).slice(2);
      return preds.some((d,i)=>d===tail[i]);
    }
    default:
      if((fr.field||'').includes('unit'))return preds.includes(String(actual.bottom2||'').slice(-1));
      if((fr.field||'').startsWith('run_')){
        const target=[actual.bottom2,actual.front3_1,actual.front3_2,actual.back3_1,actual.back3_2,p(actual.prize1,6).slice(-3)].join('');
        return preds.some(d=>target.includes(d));
      }
      return false;
  }
}

function dcFormulaBasePOld(field,n){
  const k=Math.max(1,Number(n)||1);
  if(field==='bottom2'||field==='prize1_last2')return k;
  if(['bottom2_unit','front3_unit','back3_unit','prize1_unit'].includes(field))return k*10;
  if(field==='top3'||field==='back3')return k/1000*100;
  if(field==='front3'||field==='back3exact')return k/1000*2*100;
  if(field==='prize1_last4_digits')return (1-Math.pow(.9,4))*100;
  if((field||'').startsWith('run_'))return (1-Math.pow((10-k)/10,2))*100;
  return 0;
}

function dcFormulaBacktestRowsOld(rows,n=80){
  if(!rows?.length||typeof _computeFormulasBatch!=='function')return [];
  const stats={};
  let tested=0;
  for(let i=0;i<rows.length-1&&tested<n;i++){
    const curr=rows[i],prev=rows[i+1];
    if(!prev?.prize1||!curr?.prize1)continue;
    tested++;
    let iso='';
    if(curr.date){
      const [d,m,y]=String(curr.date).split('/').map(Number);
      if(d&&m&&y)iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    const frs=_computeFormulasBatch(prev,iso,rows.slice(i+2,i+202))||[];
    frs.forEach(fr=>{
      const key=fr.name||'formula';
      const s=stats[key]||(stats[key]={name:key,field:fr.field,baseline:fr.baseline||fr.preds?.length||1,hits:0,total:0});
      s.total++;
      if(dcFormulaHitOld(fr,curr))s.hits++;
    });
  }
  return Object.values(stats).map(s=>{
    const pct=s.total?s.hits/s.total*100:0;
    const baseP=dcFormulaBasePOld(s.field,s.baseline);
    return {...s,pct,baseP,edge:pct-baseP,weight:Math.max(.25,Math.min(1.8,1+(pct-baseP)/35))};
  }).sort((a,b)=>b.edge-a.edge);
}

// ─── Decision Center track record (สรุปงวดนี้ auto-snapshot + hit-rate trend) ──────
function dcActualForDateOld(rows,iso){
  for(const row of rows||[]){
    if(!row?.date)continue;
    const [d,m,y]=String(row.date).split('/').map(Number);
    if(!d||!m||!y)continue;
    const rowIso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(rowIso===iso)return row;
  }
  return null;
}

function dcCheckHitOld(num,actual){
  if(!actual)return 'pending';
  const n=String(num||'').trim();
  const p=(v,w)=>String(v||'').padStart(w,'0');
  if(n.length===6)return n===p(actual.prize1,6)?'hit':'miss';
  if(n.length===3)return dcBtActual3Old(actual).has(n)?'hit':'miss';
  if(n.length===2)return n===p(actual.bottom2,2)?'hit':'miss';
  return 'miss';
}

function dcSnapshotResultOld(snapshot,rows){
  const actual=dcActualForDateOld(rows,snapshot?.date);
  const picks=snapshot?.picks||[];
  if(!actual)return {status:'pending',hits:0,total:picks.length};
  const results=picks.map(p=>dcCheckHitOld(p.num,actual));
  const hits=results.filter(r=>r==='hit').length;
  return {status:hits>0?'hit':'miss',hits,total:picks.length};
}

function dcHitRateTrendOld(snapshots,rows,window=5,take=20){
  const resolved=(snapshots||[])
    .map(s=>({date:s.date,...dcSnapshotResultOld(s,rows)}))
    .filter(r=>r.status!=='pending')
    .sort((a,b)=>a.date.localeCompare(b.date));
  const recent=resolved.slice(-take);
  return recent.map((r,i)=>{
    const start=Math.max(0,i-window+1);
    const win=recent.slice(start,i+1);
    const hitCount=win.filter(w=>w.status==='hit').length;
    return {date:r.date,value:+(hitCount/win.length*100).toFixed(1)};
  });
}

function dcSecondaryPrizeSignalsOld(rows,limit=10){
  const cols=[
    'prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
    'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10'
  ];
  const recent=(rows||[]).slice(0,limit);
  const t2=new Map(),t3=new Map();
  recent.forEach((row,drawIndex)=>{
    cols.forEach(col=>{
      const v=String(row?.[col]||'').trim();
      if(!/^\d{6}$/.test(v))return;
      const add=(map,num)=>{
        const cur=map.get(num)||{num,count:0,draws:new Set(),sources:new Set()};
        cur.count++;cur.draws.add(row.date||String(drawIndex+1));cur.sources.add(col.replace('_',' #'));
        map.set(num,cur);
      };
      add(t3,v.slice(-3));
      add(t2,v.slice(-2));
    });
  });
  const sortRows=map=>[...map.values()]
    .filter(x=>x.count>1)
    .map(x=>({...x,drawCount:x.draws.size,sources:[...x.sources].slice(0,4)}))
    .sort((a,b)=>b.count-a.count||b.drawCount-a.drawCount||a.num.localeCompare(b.num));
  return {draws:recent.length,tail3:sortRows(t3).slice(0,10),tail2:sortRows(t2).slice(0,10)};
}

function dcSecondarySignalsHtmlOld(signals){
  const row=(label,items)=>`<div class="dc-match-section">
    <div class="dc-match-section-head">${label} <span class="dc-status">${items.length}</span></div>
    <div class="dc-row">${items.length?items.map(x=>`<span class="num-badge predict-copy" onclick="copyPredNumber('${escHtml(x.num)}')" title="${escHtml(x.sources.join(', '))}">${escHtml(x.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">x${x.count}</span></span>`).join(''):'<span class="dash-empty">ยังไม่พบเลขซ้ำเด่น</span>'}</div>
  </div>`;
  return `<div>
    <div class="dc-signal-sub" style="margin-bottom:8px">นับจากรางวัลที่ 2/3 ล่าสุด ${signals.draws||0} งวด · เป็นแรงหนุนเชิงบริบท ไม่ใช่ผล backtest ของสูตร</div>
    ${row('ท้าย 3 จากรางวัลรอง',signals.tail3||[])}
    ${row('ท้าย 2 จากรางวัลรอง',signals.tail2||[])}
  </div>`;
}

function dcBuildScoreRowsOld({cats,formulaResults,formulaMatches,btRows,mode,secondarySignals}){
  const map=new Map();
  const btMap=new Map((btRows||[]).map(r=>[r.name,r]));
  const cfg={strict:{min:58,limit:4},balanced:{min:42,limit:6},coverage:{min:26,limit:10}}[mode]||{min:42,limit:6};
  const add=(num,type,source,points,reason,meta={})=>{
    const n=String(num||'').trim(); if(!n)return;
    const r=map.get(n)||{num:n,type,sources:[],score:0,reasons:[],warnings:[],formulaWeight:0,predictCount:0,formulaCount:0,topEdge:null};
    r.type=r.type||type;
    r.score+=points;
    r.sources.push(source);
    if(reason)r.reasons.push(reason);
    if(meta.predict)r.predictCount++;
    if(meta.formula){
      r.formulaCount++;r.formulaWeight+=meta.weight||1;
      if(typeof meta.edge==='number')r.topEdge=r.topEdge==null?meta.edge:Math.max(r.topEdge,meta.edge);
    }
    map.set(n,r);
  };
  (cats.prize1?.numbers||[]).slice(0,12).forEach((r,i)=>{
    const base=Math.max(7,24-i*1.5);
    const n=String(predNum(r)||'');
    add(n,'6 หลัก','Predict รางวัลที่ 1',base,'ติดอันดับรางวัลที่ 1 จากระบบ Predict',{predict:true});
    add(p1Front(r),'3 หลัก','Predict หน้า 3',base*.62,'หน้า 3 ของชุดรางวัลที่ 1 ถูกระบบดันขึ้นมา',{predict:true});
    add(p1Back(r),'3 หลัก','Predict ท้าย 3',base*.62,'ท้าย 3 ของชุดรางวัลที่ 1 ถูกระบบดันขึ้นมา',{predict:true});
    if(n.length>=2)add(n.slice(-2),'2 หลัก','Predict ท้าย 2 รางวัลที่ 1',base*.42,'ท้าย 2 ของชุดรางวัลที่ 1 มีแรงหนุน',{predict:true});
  });
  [['front3_1','3 หลัก','Predict หน้า 3'],['front3_2','3 หลัก','Predict หน้า 3'],['back3_1','3 หลัก','Predict ท้าย 3'],['back3_2','3 หลัก','Predict ท้าย 3'],['bottom2','2 หลัก','Predict 2 ตัวล่าง']].forEach(([k,type,label])=>{
    (cats[k]?.numbers||[]).slice(0,12).forEach((r,i)=>add(predNum(r),type,label,Math.max(6,20-i*1.4),`${label} อันดับ ${i+1}`,{predict:true}));
  });
  (secondarySignals?.tail3||[]).slice(0,8).forEach((x,i)=>add(x.num,'3 หลัก','รางวัลรอง 10 งวด',Math.max(2,8-i*.7),`ท้าย 3 รางวัลที่ 2/3 ซ้ำ ${x.count} ครั้งใน ${secondarySignals.draws} งวด`));
  (secondarySignals?.tail2||[]).slice(0,8).forEach((x,i)=>add(x.num,'2 หลัก','รางวัลรอง 10 งวด',Math.max(2,7-i*.6),`ท้าย 2 รางวัลที่ 2/3 ซ้ำ ${x.count} ครั้งใน ${secondarySignals.draws} งวด`));
  (formulaResults||[]).forEach(fr=>{
    const bt=btMap.get(fr.name);
    const edge=bt?.edge??0;
    const isPattern=String(fr.name||'').includes('Pattern Link');
    const compact=(fr.preds||[]).length<=10;
    if(!isPattern&&!(compact&&edge>0))return;
    const w=bt?.weight||1;
    (fr.preds||[]).forEach(n=>{
      const len=String(n||'').length;
      if(![2,3,6].includes(len))return;
      add(n,`${len} หลัก`,fr.name,5*w,`สูตร ${fr.name} ให้เลขนี้โดยตรง${bt?` (edge ${edge>=0?'+':''}${edge.toFixed(1)}%)`:''}`,{formula:true,weight:w,edge:bt?bt.edge:undefined});
    });
  });
  (formulaMatches||[]).forEach(m=>{
    m.formula.forEach(f=>{
      const bt=btMap.get(f.label);
      const w=bt?.weight||1;
      const edge=bt?`backtest edge ${bt.edge>=0?'+':''}${bt.edge.toFixed(1)}%`:'ยังไม่มี backtest weight';
      add(m.num,String(m.num).length+' หลัก',f.label,10*w,`สูตร ${f.label} สนับสนุน (${edge})`,{formula:true,weight:w,edge:bt?.edge});
    });
  });
  for(const r of map.values()){
    if(r.predictCount&&r.formulaCount)r.score+=16;
    if(r.formulaWeight>2)r.score+=6;
    if(r.predictCount<1)r.warnings.push('ไม่มีแรงหนุนจาก Predict');
    if(r.formulaCount<1)r.warnings.push('ยังไม่มีสูตรคำนวณตรงกัน');
    if(r.score<cfg.min)r.warnings.push('คะแนนรวมต่ำกว่าโหมดคัดเลข');
    r.score=Math.round(Math.min(100,r.score));
  }
  const all=[...map.values()].sort((a,b)=>b.score-a.score||b.formulaCount-a.formulaCount||a.num.localeCompare(b.num));
  return {all,picks:all.filter(r=>r.score>=cfg.min).slice(0,cfg.limit),risks:all.filter(r=>r.warnings.length).slice(0,6)};
}

function dcEdgeBadgeOld(topEdge){
  if(topEdge==null)return '';
  const cls=topEdge>0?'good':topEdge<0?'bad':'warn';
  return `<span class="dc-status ${cls}">edge ${topEdge>=0?'+':''}${topEdge.toFixed(1)}%</span>`;
}

function dcScoreHtmlOld(rows){
  if(!rows?.length)return '<div class="dash-empty">ยังไม่มีเลขที่ผ่านโหมดคัดเลขนี้</div>';
  return `<div class="dc-decision-list">${rows.map((r,i)=>`
    <details class="dc-pick ${i===0?'top':''}" ${i===0?'open':''}>
      <summary class="dc-pick-head">
        <span class="dc-pick-num">${escHtml(r.num)}</span>
        <span style="display:flex;align-items:center;gap:6px"><span class="dc-score">${r.score}/100</span>${dcEdgeBadgeOld(r.topEdge)}</span>
      </summary>
      <div class="dc-meter"><div class="dc-meter-fill" style="width:${r.score}%"></div></div>
      <div class="dc-explain">${escHtml(dcExplainPickOld(r))}</div>
      <div style="margin-top:7px">${r.sources.slice(0,5).map(s=>`<span class="dc-source-chip">${escHtml(s)}</span>`).join('')}</div>
    </details>`).join('')}</div>`;
}

function dcExplainPickOld(r){
  const parts=[];
  if(r.predictCount)parts.push(`มี Predict หนุน ${r.predictCount} จุด`);
  if(r.formulaCount)parts.push(`สูตรตรงกัน ${r.formulaCount} แหล่ง`);
  if(r.formulaWeight>0)parts.push(`น้ำหนักสูตร ${r.formulaWeight.toFixed(1)}`);
  if(r.reasons[0])parts.push(r.reasons[0]);
  if(r.warnings.length)parts.push(`ระวัง: ${r.warnings[0]}`);
  return parts.join(' · ');
}

function dcRiskHtmlOld(rows){
  if(!rows?.length)return '<div class="dash-empty">ไม่มีรายการเสี่ยงเด่นในโหมดนี้</div>';
  return `<div class="dc-risk-list">${rows.map(r=>`<div class="dc-risk-item"><div><b class="dc-pick-num" style="font-size:.95rem">${escHtml(r.num)}</b><div class="dc-signal-sub">${escHtml(r.warnings.join(' · '))}</div></div><span class="dc-status warn">${r.score}/100</span></div>`).join('')}</div>`;
}

let _dcLastSnapshotOld=null;
let _dcHistRowsOld=[];
function dcSnapshotsOld(){
  try{
    if(!localStorage.getItem('lottery_dc_snapshots_old_seeded')){
      // One-time-ever seed from the live tab's history so OLD VER shows today's
      // existing Track Record on first visit. The seeded flag is separate from
      // the data key itself so that clearing OLD VER's snapshots to empty later
      // (dcClearSnapshotsOld) is respected and never silently reseeded.
      const seed=localStorage.getItem('lottery_dc_snapshots')||'[]';
      localStorage.setItem('lottery_dc_snapshots_old',seed);
      localStorage.setItem('lottery_dc_snapshots_old_seeded','1');
    }
    return JSON.parse(localStorage.getItem('lottery_dc_snapshots_old')||'[]');
  }catch(e){return [];}
}
function dcAutoSaveSnapshotOld(snapshot){
  const list=dcSnapshotsOld().filter(x=>x.date!==snapshot.date);
  list.unshift({...snapshot,savedAt:new Date().toISOString()});
  localStorage.setItem('lottery_dc_snapshots_old',JSON.stringify(list.slice(0,60)));
}
function dcTrackStatusBadgeOld(status){
  if(status==='hit')return '<span class="dc-status good">ถูก</span>';
  if(status==='miss')return '<span class="dc-status bad">ไม่ถูก</span>';
  return '<span class="dc-status warn">รอผล</span>';
}
function dcSnapshotTrackHtmlOld(rows){
  const list=dcSnapshotsOld();
  if(!list.length)return '<div class="dash-empty">ยังไม่มี Snapshot</div>';
  const modeLabel=m=>m==='strict'?'ปลอดภัย':m==='coverage'?'ลุ้นสูง':'สมดุล';
  return `<div class="dc-snapshot-list">${list.map((s,i)=>{
    const result=dcSnapshotResultOld(s,rows);
    return `<details class="dc-snapshot-item" ${i===0?'open':''}>
    <summary><span>${fmtDate(s.date)} · ${modeLabel(s.mode)}</span><span style="display:flex;gap:6px;align-items:center"><span class="dc-status">${(s.picks||[]).length} เลข</span>${dcTrackStatusBadgeOld(result.status)}</span></summary>
    <div class="dc-snapshot-detail">
      <div class="dc-row">${(s.picks||[]).map(p=>`<span class="num-badge">${escHtml(p.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">${p.score}/100</span></span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
      ${(s.pattern||[]).length?`<div class="dc-signal-sub" style="margin-top:7px">Pattern Link: ${(s.pattern||[]).map(p=>`${escHtml(p.num)}(${p.score})`).join(' ')}</div>`:''}
      <div class="dc-signal-sub" style="margin-top:7px">Predict × สูตรตรงกัน ${s.matches??'-'} รายการ${result.status!=='pending'?` · ถูก ${result.hits}/${result.total}`:''} · บันทึก ${s.savedAt?new Date(s.savedAt).toLocaleString('th-TH'):'-'}</div>
      <div class="dc-snapshot-actions">
        <button class="dc-mini-btn" onclick="dcLoadSnapshotOld('${escHtml(s.date)}')">โหลดงวดนี้</button>
        <button class="dc-mini-btn" onclick="dcDeleteSnapshotOld('${escHtml(s.date)}')">ลบ</button>
      </div>
    </div>
  </details>`;
  }).join('')}
  ${list.length>1?'<button class="dc-mini-btn" onclick="dcClearSnapshotsOld()">ลบ Snapshot ทั้งหมด</button>':''}</div>`;
}

function dcLoadSnapshotOld(date){
  const el=document.getElementById('dc-date-old');
  if(el&&date){
    const opt=[...el.options].find(o=>o.value===date);
    if(opt)el.value=date;
    else el.add(new Option(fmtDate(date),date,true,true));
  }
  loadDecisionCenterOld();
}

function dcDeleteSnapshotOld(date){
  const list=dcSnapshotsOld().filter(x=>x.date!==date);
  localStorage.setItem('lottery_dc_snapshots_old',JSON.stringify(list));
  const el=document.getElementById('dc-snapshot-list-old');
  if(el)el.innerHTML=dcSnapshotTrackHtmlOld(_dcHistRowsOld);
  toast('ลบ Snapshot แล้ว','success');
}

function dcClearSnapshotsOld(){
  localStorage.removeItem('lottery_dc_snapshots_old');
  const el=document.getElementById('dc-snapshot-list-old');
  if(el)el.innerHTML=dcSnapshotTrackHtmlOld(_dcHistRowsOld);
  toast('ลบ Snapshot ทั้งหมดแล้ว','success');
}
function dcLottoSummaryBoardOld({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support}){
  const pickByLen=(len,n)=>scored.all.filter(x=>String(x.num).length===len).slice(0,n);
  const best=scored.picks[0]||scored.all[0]||{};
  const three=pickByLen(3,6).map(x=>x.num);
  const two=pickByLen(2,6).map(x=>x.num);
  const back=[...(cats.back3_1?.numbers||[]).slice(0,3),...(cats.back3_2?.numbers||[]).slice(0,3)].map(predNum).filter(Boolean);
  const p1ScoreKey=predScoreKey(p1||[]);
  const p1MaxScore=Math.max(1,...(p1||[]).map(x=>predScore(x,p1ScoreKey)));
  const p1DetailHtml=(p1||[]).slice(0,3).map((r,i)=>predDetailHtml({
    num:predNum(r),col:'prize1',row:r,rank:i+1,
    score:predScore(r,p1ScoreKey),maxScore:p1MaxScore,
    support:(support?.get(p1Front(r))?.count||0)+(support?.get(p1Back(r))?.count||0),
    extra:[`หน้า ${p1Front(r)}`,`ท้าย ${p1Back(r)}`]
  })).join('')||'<span class="dash-empty">-</span>';
  const supportTop=[...(support?.values()||[])].filter(x=>x.count>1).sort((a,b)=>b.count-a.count||a.num.localeCompare(b.num)).slice(0,10);
  const supportHtml=supportTop.map(x=>`<span class="num-badge agree predict-copy" onclick="copyPredNumber('${escHtml(x.num)}')">${escHtml(x.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">x${x.count}</span></span>`).join('')||'<span class="dash-empty">-</span>';
  const bestFormula=(btRows||[]).slice(0,3);
  const formulaLead=(formulaMatches||[]).slice(0,3);
  const patternLead=(scored.all||[]).filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,2);
  const formulaItems=[
    ...patternLead.map(x=>({title:`Pattern Link · ${x.num}`,sub:`Final score ${x.score}/100 · ${String(x.sources.find(s=>String(s).includes('Pattern Link'))||'สูตรเชื่อมโยงแพทเทิร์น')}`})),
    ...formulaLead.map(m=>({title:`เลข ${m.num}`,sub:`สูตรตรง ${m.formula.length} แหล่ง · Predict ${m.predict.length}`})),
    ...bestFormula.map(f=>({title:f.name,sub:`Backtest edge ${f.edge>=0?'+':''}${f.edge.toFixed(1)}%`}))
  ].slice(0,3);
  const patternStrip=patternLead.length?`<div class="dc-pattern-strip">
    <div class="dc-pattern-title">Pattern Link</div>
    <div>
      <div class="dc-pattern-row">${patternLead.map(x=>`<span class="dc-pattern-chip">เลข <b>${escHtml(x.num)}</b> <span>${x.score}/100</span></span>`).join('')}</div>
      <div class="dc-pattern-note">สูตรเชื่อมโยงแพทเทิร์นจากงวดก่อน → งวดเป้าหมาย ใช้เป็นแรงหนุนร่วมกับ Predict และ Backtest</div>
    </div>
  </div>`:'';
  const modeLabel=mode==='strict'?'ปลอดภัย':mode==='coverage'?'ลุ้นสูง':'สมดุล';
  return `<div class="dc-lotto-board">
    <div class="dc-lotto-head">
      <div class="dc-lotto-kicker">Decision Center · Prediction × สูตรคำนวณ × Backtest</div>
      <div class="dc-lotto-title">สรุปเลขเด่นงวด ${fmtDate(next)}</div>
      <div class="dc-lotto-sub">โหมด${modeLabel} · เลขเด่นถูกคัดจากระบบทำนาย สูตรคำนวณ น้ำหนัก backtest และผลล่าสุด</div>
    </div>
    <div class="dc-lotto-main">
      <div class="dc-lotto-prize">
        <div class="dc-lotto-label">เลขแนะนำอันดับ 1</div>
        <div class="dc-lotto-number">${escHtml(best.num||'-')}</div>
        <div class="dc-lotto-note">${best.score!=null?`Final Confidence ${best.score}/100 · ${escHtml(dcExplainPickOld(best))}`:'ยังไม่มีเลขผ่านเกณฑ์'}</div>
      </div>
      <div class="dc-lotto-side">
        <div class="dc-lotto-mini">
          <div class="dc-lotto-label">3 หลักเด่นจากสูตร + Predict</div>
          <div class="dc-lotto-row">${three.map(n=>numChip(n,'agree')).join('')||'<span class="dash-empty">-</span>'}</div>
        </div>
        <div class="dc-lotto-mini">
          <div class="dc-lotto-label">2 ตัวเด่นจากสูตร + Predict</div>
          <div class="dc-lotto-row">${two.map(n=>numChip(n,'agree')).join('')||'<span class="dash-empty">-</span>'}</div>
        </div>
      </div>
    </div>
    <div class="dc-lotto-block">
      <div class="dc-lotto-label">รางวัลที่ 1 จาก Predict</div>
      <div class="dc-row" style="justify-content:center">${p1DetailHtml}</div>
    </div>
    <div class="dc-lotto-sections">
      <div class="dc-lotto-section"><div class="dc-lotto-label">เลขหน้า 3 ตัว</div><div class="dc-lotto-row">${[...new Set(front)].slice(0,6).map(n=>numChip(n)).join('')||'<span class="dash-empty">-</span>'}</div></div>
      <div class="dc-lotto-section"><div class="dc-lotto-label">เลขท้าย 3 / 2 ตัว</div><div class="dc-lotto-row">${[...new Set([...back.slice(0,4),...(bottom||[]).slice(0,4).map(predNum)])].map(n=>numChip(n)).join('')||'<span class="dash-empty">-</span>'}</div></div>
      <div class="dc-lotto-section"><div class="dc-lotto-label">เลขหนุนข้ามหมวด</div><div class="dc-lotto-row">${supportHtml}</div></div>
    </div>
    <div class="dc-lotto-block">
      <div class="dc-lotto-label">Final Confidence Score · ${modeLabel}</div>
      ${dcScoreHtmlOld(scored.picks)}
    </div>
    ${patternStrip}
    <div class="dc-lotto-formula">
      ${formulaItems.map(x=>`<div class="dc-lotto-formula-item"><div class="dc-lotto-formula-title">${escHtml(x.title)}</div><div class="dc-lotto-formula-sub">${escHtml(x.sub)}</div></div>`).join('')||'<div class="dash-empty">ยังไม่มีสูตรคำนวณที่ตรงกับ Predict</div>'}
    </div>
    <div class="dc-lotto-actions">
      <button class="btn btn-primary" onclick="dcRunDecisionBacktestOld()">Backtest เลขเด่นชุดนี้</button>
      <button class="btn btn-secondary" onclick="showPage('backtest')">Backtest รางวัลที่ 1</button>
      <button class="btn btn-secondary" onclick="showPage('predict')">เปิดหน้าทำนาย</button>
      <button class="btn btn-secondary" onclick="showPage('formula')">เปิดสูตรคำนวณ</button>
      <button class="btn btn-secondary" onclick="copyPredNumber('${escHtml([...(p1||[]).map(predNum),...(bottom||[]).slice(0,4).map(predNum)].filter(Boolean).join(' '))}')">copy ชุดหลัก</button>
    </div>
  </div>`;
}

function dcIsoFromThaiDateOld(s){
  const [d,m,y]=String(s||'').split('/').map(Number);
  if(!d||!m||!y)return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function dcConsensusCandidatesOld(formulaResults,btMap,len,limit){
  const map=new Map();
  (formulaResults||[]).forEach(fr=>{
    const bt=btMap.get(fr.name);
    const weight=Math.max(.4,Math.min(2,bt?.weight||1));
    const exact3=['top3','front3','back3','back3exact'].includes(fr.field);
    const exact2=['bottom2','prize1_last2'].includes(fr.field);
    if((len===3&&!exact3)||(len===2&&!exact2))return;
    (fr.preds||[]).forEach(n=>{
      const num=String(n||'').padStart(len,'0');
      if(num.length!==len)return;
      const cur=map.get(num)||{num,score:0,sources:0};
      cur.score+=weight;
      cur.sources++;
      map.set(num,cur);
    });
  });
  return [...map.values()].sort((a,b)=>b.score-a.score||b.sources-a.sources||a.num.localeCompare(b.num)).slice(0,limit);
}

function dcBtActual3Old(row){
  return new Set([row.top3,row.front3_1,row.front3_2,row.back3_1,row.back3_2].map(x=>String(x||'').padStart(3,'0')).filter(x=>x.length===3));
}

async function dcRunDecisionBacktestOld(){
  const panel=document.getElementById('dc-backtest-panel-old');
  if(!panel)return;
  panel.innerHTML='<div class="dc-bt-panel"><div class="dc-bt-title">กำลัง Backtest เลขเด่นย้อนหลัง...</div><div class="dc-bt-sub">ทดสอบสูตรคำนวณแบบ rolling โดยใช้ข้อมูลงวดก่อนหน้าเท่านั้น</div></div>';
  try{
    const hist=await api('history?n=160');
    const rows=hist.data||[];
    if(rows.length<25||typeof _computeFormulasBatch!=='function')throw new Error('not enough data');
    const btRows=dcFormulaBacktestRowsOld(rows,80);
    const btMap=new Map(btRows.map(r=>[r.name,r]));
    const samples=[];
    let tested=0,hit2=0,hit3=0,total2=0,total3=0;
    for(let i=0;i<rows.length-1&&tested<60;i++){
      const curr=rows[i],prev=rows[i+1];
      if(!curr?.prize1||!prev?.prize1)continue;
      tested++;
      const iso=dcIsoFromThaiDateOld(curr.date);
      const frs=_computeFormulasBatch(prev,iso,rows.slice(i+2,i+202))||[];
      const c2=dcConsensusCandidatesOld(frs,btMap,2,6);
      const c3=dcConsensusCandidatesOld(frs,btMap,3,8);
      const actual2=String(curr.bottom2||'').padStart(2,'0');
      const actual3=dcBtActual3Old(curr);
      const ok2=c2.some(x=>x.num===actual2);
      const ok3=c3.some(x=>actual3.has(x.num));
      if(c2.length){total2++; if(ok2)hit2++;}
      if(c3.length){total3++; if(ok3)hit3++;}
      if(samples.length<6)samples.push({date:curr.date,actual2,actual3:[...actual3].slice(0,5),c2:c2.map(x=>x.num),c3:c3.map(x=>x.num),ok2,ok3});
    }
    const pct=(a,b)=>b?`${(a/b*100).toFixed(1)}%`:'-';
    panel.innerHTML=`<div class="dc-bt-panel">
      <div class="dc-bt-head">
        <div><div class="dc-bt-title">Backtest เลขเด่น Decision Center</div><div class="dc-bt-sub">Rolling ${tested} งวดล่าสุด · วัดชั้นสูตรคำนวณ + น้ำหนัก backtest ก่อนนำไปผสมกับ Predict</div></div>
        <span class="dc-status good">tested</span>
      </div>
      <div class="dc-bt-grid">
        <div class="dc-bt-card"><div class="dc-bt-val">${tested}</div><div class="dc-bt-label">งวดที่ทดสอบ</div></div>
        <div class="dc-bt-card"><div class="dc-bt-val">${pct(hit2,total2)}</div><div class="dc-bt-label">Hit 2 ตัว (${hit2}/${total2})</div></div>
        <div class="dc-bt-card"><div class="dc-bt-val">${pct(hit3,total3)}</div><div class="dc-bt-label">Hit 3 หลัก (${hit3}/${total3})</div></div>
        <div class="dc-bt-card"><div class="dc-bt-val">${btRows[0]?.edge>=0?'+':''}${(btRows[0]?.edge||0).toFixed(1)}%</div><div class="dc-bt-label">สูตร edge สูงสุด</div></div>
      </div>
      <div class="dc-bt-list">${samples.map(s=>`<div class="dc-bt-row">
        <div><b>${escHtml(s.date)}</b> · 2ตัว ${escHtml(s.actual2)} <span class="${s.ok2?'dc-bt-hit':'dc-bt-miss'}">${s.ok2?'เข้า':'ไม่เข้า'}</span> · 3หลัก <span class="${s.ok3?'dc-bt-hit':'dc-bt-miss'}">${s.ok3?'เข้า':'ไม่เข้า'}</span></div>
        <div class="dc-bt-label">คัด 2ตัว: ${s.c2.slice(0,5).join(' ')||'-'}</div>
        <div class="dc-bt-label">คัด 3หลัก: ${s.c3.slice(0,5).join(' ')||'-'}</div>
      </div>`).join('')}</div>
      <div class="dc-bt-sub" style="margin-top:9px">หมายเหตุ: Backtest นี้วัดความแม่นของชั้นสูตรคำนวณ/consensus แบบ rolling ส่วนโมเดล Predict รางวัลที่ 1 ดูต่อได้ที่ปุ่ม Backtest รางวัลที่ 1</div>
    </div>`;
  }catch(e){
    panel.innerHTML='<div class="dc-bt-panel"><div class="dc-bt-title">Backtest ไม่สำเร็จ</div><div class="dc-bt-sub">ข้อมูลย้อนหลังไม่พอหรือสูตรคำนวณยังโหลดไม่ครบ ลองรีเฟรชหน้าอีกครั้ง</div></div>';
  }
}

async function loadDecisionCenterOld(){
  const root=document.getElementById('dc-root-old');
  if(!root)return;
  root.className='dc-loading';
  root.textContent='กำลังรวมสัญญาณงวดนี้...';
  const dateEl=document.getElementById('dc-date-old');
  if(dateEl&&!dateEl.options.length){
    try{
      const nd=await api('next-draws');
      dateEl.innerHTML=(nd.draws||[]).map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
    }catch(e){}
  }
  const next=dateEl?.value||nextDrawInfo().iso;
  const mode=document.getElementById('dc-mode-old')?.value||'balanced';
  try{
    const [summary,pred,hist]=await Promise.all([
      api('summary'),
      api(`predict/all?top_n=10&date=${next}&beam_width=500&k_back=100&preset=optimized`),
      api('prize-history?n=260')
    ]);
    const cats=pred.categories||{};
    const p1=(cats.prize1?.numbers||[]).slice(0,5);
    const bottom=(cats.bottom2?.numbers||[]).slice(0,8);
    const front=[...(cats.front3_1?.numbers||[]).slice(0,4),...(cats.front3_2?.numbers||[]).slice(0,4)].map(predNum).filter(Boolean);
    const support=predictionSupportMap(cats);
    const latest=summary.latest||{};
    const healthStatus=latest.prize1?'good':'bad';
    const healthText=latest.prize1?'พร้อมใช้':'ข้อมูลยังไม่พร้อม';
    const formulaResults=dcComputeFormulaResultsOld(hist.data,next);
    const formulaMatches=dcBuildPredictFormulaMatchesOld(cats,formulaResults);
    const btRows=dcFormulaBacktestRowsOld(hist.data,80);
    const secondarySignals=dcSecondaryPrizeSignalsOld(hist.data,10);
    const scored=dcBuildScoreRowsOld({cats,formulaResults,formulaMatches,btRows,mode,secondarySignals});
    const formulaMatchHtml=dcFormulaMatchHtmlOld(formulaMatches);
    const lottoBoardHtml=dcLottoSummaryBoardOld({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support});
    _dcHistRowsOld=hist.data||[];
    _dcLastSnapshotOld={
      date:next,
      mode,
      picks:scored.picks.map(x=>({num:x.num,score:x.score,type:x.type,explain:dcExplainPickOld(x)})),
      pattern:scored.all.filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,5).map(x=>({num:x.num,score:x.score})),
      matches:formulaMatches.length
    };
    dcAutoSaveSnapshotOld(_dcLastSnapshotOld);
    const trend=dcHitRateTrendOld(dcSnapshotsOld(),_dcHistRowsOld,5,20);
    const trendHtml=trend.length
      ?`<div style="height:180px"><canvas id="dc-trend-chart-old" role="img" aria-label="กราฟแนวโน้มอัตราถูกของ Decision Center"></canvas></div>`
      :'<div class="dash-empty">ยังไม่มีงวดที่มีผลจริงพอจะคำนวณแนวโน้ม — auto-save จะสะสมทุกครั้งที่เปิดหน้านี้</div>';
    root.className='';
    root.innerHTML=`${lottoBoardHtml}
    <div class="dc-grid">
      <div class="dc-card dc-card-wide"><div class="dc-label">Snapshot + Track Record</div><div class="dc-signal-sub" style="margin-bottom:8px">บันทึกอัตโนมัติทุกครั้งที่เปิดหน้านี้ · &quot;ถูก&quot; = มีเลขอย่างน้อย 1 ตัวในชุดที่ตรงผลจริง</div><div id="dc-snapshot-list-old" class="dc-row">${dcSnapshotTrackHtmlOld(_dcHistRowsOld)}</div></div>
      <div class="dc-card dc-card-wide"><div class="dc-label">แนวโน้มอัตราถูก (20 งวดล่าสุดที่มีผล · rolling 5 งวด)</div>${trendHtml}</div>
    </div>
    <div id="dc-backtest-panel-old"></div>
    <div class="dc-panel">
      <div class="dc-label">Data Health</div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">ผลงวดล่าสุด</div><div class="dc-signal-sub">${latest.date||'-'} · ${latest.prize1||'-'}</div></div><span class="dc-status ${healthStatus}">${healthText}</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">จำนวนงวดในระบบ</div><div class="dc-signal-sub">${summary.total_draws||summary.total||'-'} งวด</div></div><span class="dc-status good">DATA</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">สูตรคำนวณ</div><div class="dc-signal-sub">กดเปิดสูตรเพื่อ refresh Formula Final Picks</div></div><span class="dc-status warn">optional</span></div>
    </div>
    <div class="dc-grid">
      <div class="dc-card dc-card-wide"><div class="dc-label">Predict × สูตรคำนวณ ตรงกัน</div><div class="dc-row">${formulaMatchHtml}</div></div>
      <div class="dc-card dc-card-wide"><div class="dc-label">สัญญาณจากรางวัลรอง 10 งวดล่าสุด</div>${dcSecondarySignalsHtmlOld(secondarySignals)}</div>
      <div class="dc-card"><div class="dc-label">ตัดเลขเสี่ยง</div><div class="dc-row">${dcRiskHtmlOld(scored.risks)}</div></div>
    </div>`;
    if(trend.length){
      const opts=chartOpts('% ถูก');
      opts.scales.y.min=0;opts.scales.y.max=100;
      mkChart('dc-trend-chart-old',{type:'line',data:{
        labels:trend.map(t=>fmtDate(t.date)),
        datasets:[{label:'% ถูก (rolling 5 งวด)',data:trend.map(t=>t.value),borderColor:'#3dd68c',backgroundColor:'rgba(61,214,140,.15)',tension:.3,fill:true,pointRadius:2}]
      },options:opts});
    }
  }catch(e){
    root.className='dc-loading';
    root.textContent='โหลด Decision Center ไม่สำเร็จ ลองใหม่อีกครั้ง';
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function fmtDate(s){
  if(!s) return '—';
  const [y,m,dd] = s.includes('-') ? s.split('-') : [s.slice(4),s.slice(2,4),s.slice(0,2)];
  const M=['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${parseInt(dd)} ${M[parseInt(m)]} ${parseInt(y)+543}`;
}

function clientDraws(count=6){
  const MTHS=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const now=new Date();
  const bkk=new Date(now.getTime()+7*3600*1000);
  const h=bkk.getUTCHours(),day=bkk.getUTCDate();
  const draws=[];
  let cur=((day===1||day===16)&&h<16)
    ?new Date(Date.UTC(bkk.getUTCFullYear(),bkk.getUTCMonth(),day))
    :new Date(Date.UTC(bkk.getUTCFullYear(),bkk.getUTCMonth(),day+1));
  while(draws.length<count){
    const dd=cur.getUTCDate(),mm=cur.getUTCMonth(),yy=cur.getUTCFullYear();
    if(dd===1||dd===16){
      const iso=`${yy}-${String(mm+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      draws.push({date:iso,label:`${dd} ${MTHS[mm]} ${yy+543}`});
    }
    cur=new Date(cur.getTime()+86400000);
  }
  return draws;
}

function nextDrawInfo(){
  const now=new Date();
  const bkk=new Date(now.getTime()+7*3600*1000);
  const y=bkk.getUTCFullYear(),m=bkk.getUTCMonth(),d=bkk.getUTCDate();
  const h=bkk.getUTCHours(),mn=bkk.getUTCMinutes();
  const pastDraw=day=>d>day||(d===day&&(h>16||(h===16&&mn>=0)));
  let day,mon=m,yr=y;
  if(!pastDraw(1))day=1;
  else if(!pastDraw(16))day=16;
  else{day=1;mon=m+1;if(mon>11){mon=0;yr=y+1;}}
  const date=new Date(Date.UTC(yr,mon,day,9,0,0));
  const iso=`${yr}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return {date,iso,label:date.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})};
}

function dashNum(row){
  return row?.['เลข']??row?.number??row?.num??row?.['à¹€à¸¥à¸‚']??'';
}

function dashCount(row){
  const keys=['ล่าสุด','จำนวนครั้ง','ทั้งหมด','count','frequency','freq','à¸¥à¹ˆà¸²à¸ªà¸¸à¸”','à¸ˆà¸³à¸™à¸§à¸™à¸„à¸£à¸±à¹‰à¸‡','à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”'];
  for(const k of keys){
    const v=row?.[k];
    if(typeof v==='number'&&Number.isFinite(v))return v;
  }
  const nums=Object.values(row||{}).filter(v=>typeof v==='number'&&Number.isFinite(v));
  return nums.length?Math.max(...nums):0;
}

function renderLatestItem(label,value){
  return `<div class="dash-result-item"><div class="dash-result-label">${label}</div><div class="dash-result-value">${value||'—'}</div></div>`;
}

async function loadDashboard(){
  const d = await api('summary');
  if(d.error){ toast(d.error,'error'); return; }
  document.getElementById('s-total').textContent = (d.total_draws||0).toLocaleString();
  document.getElementById('s-date').textContent = fmtDate(d.latest?.date);
  const rangeEl=document.getElementById('dash-range');
  if(rangeEl)rangeEl.textContent=`ตั้งแต่ ${fmtDate(d.date_min)}`;
  const cache=d.cache_info||{};
  const cacheEl=document.getElementById('dash-cache-info');
  if(cacheEl)cacheEl.textContent=cache.exists===false?'ยังไม่มี cache':`อัปเดตล่าสุด ${cache.modified||cache.last_modified||fmtDate(d.date_max)}`;
  const statusEl=document.getElementById('dash-data-status');
  if(statusEl){
    statusEl.classList.remove('warn');
    statusEl.textContent=`พร้อมใช้งาน · ${fmtDate(d.date_max)}`;
  }
  const p1 = d.latest?.prize1||'';
  document.getElementById('s-prize1').innerHTML = p1.split('').map(c=>`<div class="digit-box">${c}</div>`).join('');
  const lt = d.latest||{};
  document.getElementById('latest-draw-detail').innerHTML = `
    ${renderLatestItem('3 ตัวบน',lt.top3)}
    ${renderLatestItem('2 ตัวบน',lt.top2)}
    ${renderLatestItem('3 ตัวหน้า',`${lt.front3_1||'—'} / ${lt.front3_2||'—'}`)}
    ${renderLatestItem('3 ตัวล่าง',`${lt.back3_1||'—'} / ${lt.back3_2||'—'}`)}
    ${renderLatestItem('2 ตัวล่าง',lt.bottom2)}
    ${renderLatestItem('วันที่',fmtDate(lt.date))}`;
  const hot = d.hot_top3||[];
  const maxHot = Math.max(1,...hot.map(dashCount));
  document.getElementById('hot-list').innerHTML = hot.length?hot.slice(0,10).map((r,i)=>{
    const num = dashNum(r);
    const cnt = dashCount(r);
    return `<div class="dash-hot-row" onclick="showPage('frequency')" title="เปิดตารางความถี่"><span class="rank-badge ${i<3?'rank-'+(i+1):''}">${i+1}</span><span class="hc-num">${num}</span><span class="hc-val">${cnt} ครั้ง</span><div style="grid-column:2/4" class="hc-bar-wrap"><div class="hc-bar-fill hot-fill" style="width:${(cnt/maxHot*100).toFixed(0)}%"></div></div></div>`;
  }).join(''):'<div class="dash-empty">ยังไม่มีข้อมูลเลขร้อน</div>';
  const recentRows=d.recent_draws||[];
  document.getElementById('recent-compact').innerHTML=recentRows.slice(-5).reverse().map(r=>`<div class="dash-recent-item" onclick="showPage('history')">
    <div class="dash-recent-date">${r.date||''}</div>
    <div class="dash-recent-prize">${r.prize1||''}</div>
    <div class="dash-recent-sub">บน ${r.top3||'—'} · ล่าง ${r.bottom2||'—'}</div>
  </div>`).join('')||'<div class="dash-empty">ยังไม่มีประวัติงวดล่าสุด</div>';
  document.getElementById('recent-tbody').innerHTML = recentRows.map(r=>`<tr>
    <td>${r.date||''}</td><td><b style="font-family:'IBM Plex Mono',monospace">${r.prize1||''}</b></td>
    <td>${r.top3||''}</td><td>${r.top2||''}</td><td>${r.front3_1||''}</td>
    <td>${r.front3_2||''}</td><td>${r.back3_1||''}</td><td>${r.back3_2||''}</td><td>${r.bottom2||''}</td>
  </tr>`).join('');
  loadDashboardFormulaPicks();
  if(!window._p1WidgetLoaded){window._p1WidgetLoaded=true;loadP1Widget();}
}

async function loadDashboardFormulaPicks(){
  const root=document.getElementById('dashboard-formula-picks');
  if(!root)return;
  root.innerHTML='<div class="dash-empty">กำลังจัดอันดับสูตร...</div>';
  if(typeof _computeFormulasBatch!=='function'){
    root.innerHTML='<div class="dash-empty">ยังโหลด formula engine ไม่ครบ</div>';
    return;
  }
  try{
    const date=document.getElementById('shared-draw-date')?.value||nextDrawInfo().iso;
    const h=await api('prize-history?n=260');
    const rows=Array.isArray(h.data)?h.data:[];
    if(rows.length<30){root.innerHTML='<div class="dash-empty">ข้อมูลย้อนหลังยังไม่พอสำหรับจัดอันดับสูตร</div>';return;}
    const btRows=dcFormulaBacktestRows(rows,200)
      .filter(r=>r.total>=50&&r.edge>-5)
      .slice(0,3);
    const formulaResults=dcComputeFormulaResults(rows,date);
    const byName=new Map(formulaResults.map(fr=>[fr.name,fr]));
    const byCode=new Map(formulaResults.map(fr=>[String(fr.name||'').match(/^([A-Z]+\d+)/)?.[1],fr]).filter(([k])=>k));
    const cards=btRows.map(row=>{
      const code=String(row.name||'').match(/^([A-Z]+\d+)/)?.[1];
      const fr=byName.get(row.name)||byCode.get(code);
      const nums=(fr?.preds||[]).filter(n=>/^\d{1,6}$/.test(String(n))).slice(0,8);
      return `<div class="dash-formula-item">
        <div class="dash-formula-head">
          <div class="dash-formula-name">${escHtml(row.name)}</div>
          <span class="dash-formula-edge">${row.edge>=0?'+':''}${row.edge.toFixed(1)}%</span>
        </div>
        <div class="dc-row">${nums.length?nums.map(n=>numChip(n)).join(''):'<span class="dash-empty">สูตรนี้ไม่มีเลขสำหรับงวดหลัก</span>'}</div>
      </div>`;
    });
    root.innerHTML=cards.join('')||'<div class="dash-empty">ยังไม่มีสูตรที่ชนะ baseline ใน 200 งวดล่าสุด</div>';
  }catch(e){
    root.innerHTML='<div class="dash-empty">โหลดสูตรเด่นไม่สำเร็จ</div>';
  }
}

async function refreshData(){
  toast('กำลังรีเฟรช...');
  const r = await fetch('/api/refresh',{method:'POST'});
  const d = await r.json();
  toast(`อัปเดต ${d.rows} งวด`,'success');
  loadDashboard();
}

// ─── Frequency ────────────────────────────────────────────────────────────────
async function loadFreq(){
  const col = document.getElementById('freq-col').value;
  const top = document.getElementById('freq-top').value;
  const isSanook = ['near1','prize2','prize3','prize4','prize5'].includes(col);
  let rows, never=[];
  document.getElementById('freq-tbody').innerHTML='<tr><td colspan="5"><div class="predict-empty">กำลังโหลดตารางความถี่...</div></td></tr>';
  const neverEl = document.getElementById('never-list');
  if(neverEl)neverEl.innerHTML='<span style="color:var(--text3)">กำลังโหลด...</span>';
  if(isSanook){
    const d = await api(`prize-freq?prize=${col}&top_n=${top}`);
    rows = (d.data||[]).map(r=>({'เลข':r.number,'จำนวนครั้ง':r.count,'อัตรา (%)':r.pct}));
  } else {
    const d = await api(`freq-table?col=${col}&top_n=${top}`);
    rows = d.data||[];
    never = d.never||[];
  }
  const maxCnt = rows[0]?.['จำนวนครั้ง']||1;
  document.getElementById('freq-tbody').innerHTML = rows.map((r,i)=>`<tr>
    <td><span class="rank-badge ${i<3?'rank-'+(i+1):''}">${i+1}</span></td>
    <td><b style="font-family:'IBM Plex Mono',monospace">${r['เลข']||''}</b></td>
    <td>${r['จำนวนครั้ง']||0}</td>
    <td>${(r['อัตรา (%)']||0).toFixed(2)}%</td>
    <td><div class="progress-bar"><div class="progress-fill" style="width:${((r['จำนวนครั้ง']||0)/maxCnt*100).toFixed(0)}%"></div></div></td>
  </tr>`).join('');
  neverEl.innerHTML = isSanook
    ? `<span style="color:var(--text3);font-size:.78rem">* ข้อมูล Sanook — งวดเก่าก่อนปี ~2558 อาจไม่ครบ</span>`
    : (never.length
        ? `<div style="color:var(--text3);font-size:.78rem;margin-bottom:8px">ไม่เคยออก ${never.length} เลข:</div>`+never.map(n=>`<span class="num-badge" style="border-color:var(--text3);color:var(--text3)">${n}</span>`).join('')
        : '<span style="color:var(--text3)">ทุกเลขเคยออกแล้ว</span>');
  mkChart('freq-chart',{type:'bar',
    data:{labels:rows.slice(0,20).map(r=>String(r['เลข']||'')),datasets:[{data:rows.slice(0,20).map(r=>r['จำนวนครั้ง']||0),backgroundColor:'rgba(200,168,75,0.7)',borderWidth:0}]},
    options:chartOpts('ครั้ง')});
}


// ─── Lottery Countdown Timer ──────────────────────────────────────────────────
function startCountdown(){
  function getNextDraw(){
    // Thai lottery draw cutoff in this app: 16:00 Bangkok (UTC+7)
    const now = new Date();
    const bkk = new Date(now.getTime() + 7*3600*1000);
    const y=bkk.getUTCFullYear(), m=bkk.getUTCMonth(), d=bkk.getUTCDate();
    const h=bkk.getUTCHours(), mn=bkk.getUTCMinutes();
    const pastDraw = (day) => d > day || (d === day && h >= 16);
    let nextDay, nextMon=m, nextYr=y;
    if(!pastDraw(1) ) { nextDay=1; }
    else if(!pastDraw(16)) { nextDay=16; }
    else { nextDay=1; nextMon=m+1; if(nextMon>11){nextMon=0;nextYr=y+1;} }
    // Next draw in UTC: Bangkok 16:00 = UTC 09:00
    return new Date(Date.UTC(nextYr, nextMon, nextDay, 9, 0, 0));
  }
  function tick(){
    const next=nextDrawInfo().date;
    const now=new Date();
    const diff=next-now;
    if(diff<=0){document.getElementById('countdown-val').textContent='กำลังออกผล!';return;}
    const days=Math.floor(diff/86400000);
    const hrs=Math.floor((diff%86400000)/3600000);
    const mins=Math.floor((diff%3600000)/60000);
    const secs=Math.floor((diff%60000)/1000);
    const pad=n=>String(n).padStart(2,'0');
    document.getElementById('countdown-val').textContent=
      days>0?`${days}วัน ${pad(hrs)}:${pad(mins)}:${pad(secs)}`:`${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    const dateEl=document.getElementById('countdown-date');
    if(dateEl) dateEl.textContent=`งวด ${next.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})}`;
  }
  tick();
  setInterval(tick,1000);
}
startCountdown();

// ─── Export Predictions CSV ───────────────────────────────────────────────────
function exportPredCSV(){
  const data=_lastPredData||[];
  if(!data.length)return;
  const col=_lastPredCol||'';
  const date=_lastPredDate||'';
  const keys=Object.keys(data[0]);
  const rows=[keys.join(','),...data.map(r=>keys.map(k=>{
    const v=r[k]??'';
    return typeof v==='string'&&v.includes(',')?`"${v}"`:v;
  }).join(','))];
  const blob=new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`predict_${col}_${date||'latest'}.csv`;
  a.click();URL.revokeObjectURL(a.href);
}

// ─── Prize1 Dashboard Widget ──────────────────────────────────────────────────
async function loadP1Widget(){
  document.getElementById('p1-widget-body').innerHTML='<span style="color:var(--text3)">กำลังคำนวณ...</span>';
  const nextDraw=document.getElementById('dash-date')?.value||nextDrawInfo().iso;
  document.getElementById('p1-widget-date').textContent='('+nextDraw+')';
  const r=await api(`predict/prize1?top_n=10&beam_width=500&k_back=100&preset=optimized&date=${nextDraw}`);
  if(r.error){
    document.getElementById('p1-widget-body').innerHTML=`<span style="color:var(--red)">${r.error}</span>`;
    return;
  }
  const preds=r.predictions||[];
  if(!preds.length){document.getElementById('p1-widget-body').innerHTML='<span style="color:#f05454">ไม่มีข้อมูล</span>';return;}
  document.getElementById('p1-widget-body').innerHTML=preds.slice(0,5).map((p,i)=>{
    const fb=+(p['Front Beam']||0).toFixed(2);
    const bk=+(p['Back Top3']||0).toFixed(2);
    const score=+(p['คะแนนรวม']||0).toFixed(1);
    const color=i===0?'var(--gold2)':i<3?'var(--accent)':'var(--text2)';
    return `<div style="text-align:center;padding:8px 12px;background:var(--surface2);border-radius:8px;border:1px solid ${i===0?'var(--gold2)':'var(--border)'}">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:${i===0?'1.4rem':'1.1rem'};font-weight:700;color:${color};letter-spacing:3px">${p['เลข']||''}</div>
      <div style="font-size:.65rem;color:var(--text3);margin-top:2px">${p['หน้า 3']||''}·${p['หลัง 3']||''}</div>
      <div style="font-size:.65rem;color:var(--text3)">F:${fb} B:${bk}</div>
    </div>`;
  }).join('');
  document.getElementById('p1-widget-lift').textContent='Front3 lift ~11.1x | Back3 lift ~2.2x | sum ~13.3x (n=80)';
}

// ─── Predict ──────────────────────────────────────────────────────────────────
let _lastPredData=[],_lastPredCol='',_lastPredDate='',_lastPredictSnapshot=null;

function predictSaveSnapshot(){
  if(!_lastPredictSnapshot){toast('ยังไม่มีผลทำนายให้บันทึก','error');return;}
  savePageSnapshot('predict',_lastPredictSnapshot);
}

function formulaSaveSnapshot(){
  const date=document.getElementById('f-target-date')?.value||nextDrawInfo().iso;
  const chips=[...document.querySelectorAll('#formula-final .num-badge,#formula-results-ALL .num-badge')].map(x=>x.textContent.trim()).filter(Boolean);
  const uniq=[...new Set(chips.map(x=>x.replace(/\s+/g,'')))].filter(x=>/^\d{1,6}$/.test(x)).slice(0,40);
  if(!uniq.length){toast('ยังไม่มีผลสูตรให้บันทึก กดคำนวณทุกสูตรก่อน','error');return;}
  const items=uniq.map(num=>({num}));
  const activeTab=document.querySelector('.ftab-btn.active')?.dataset?.ftab||'ALL';
  savePageSnapshot('formula',{
    id:`formula_${date}`,
    title:`สูตรคำนวณ · ${fmtDate(date)}`,
    date,
    kind:activeTab,
    items,
    note:`บันทึกจาก Formula Final/Consensus รวม ${items.length} เลข`
  });
}

function predictConfidence(rank,score,maxScore,support=0){
  const rel=maxScore?score/maxScore:0;
  const boosted=rel+(support>=3 ? .18 : support>=2 ? .1 : support>=1 ? .05 : 0)-(rank>10 ? .1 : 0);
  if(boosted>=.82)return {label:'มั่นใจสูง',cls:'high'};
  if(boosted>=.55)return {label:'น่าเฝ้า',cls:'mid'};
  return {label:'เสี่ยงสูง',cls:'low'};
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
    <summary><span class="pred-num predict-copy" onclick="copyPredNumber('${escHtml(num)}')">${escHtml(num)}</span><span class="pred-pill ${conf.cls}">${conf.label}</span></summary>
    <div class="pred-detail-panel">
      <div class="predict-summary-sub">อันดับ ${rank} · score ${scoreText}${support?` · support ${support}`:''}</div>
      <div class="pred-reasons">${reasonHtml}</div>
      ${formulaHits.length?`<div class="predict-summary-sub">สูตรที่หนุน: ${formulaHits.map(escHtml).join(' · ')}</div>`:''}
      <div class="pred-actions">
        <button class="pred-action-btn" onclick="copyPredNumber('${escHtml(num)}')">copy</button>
      </div>
    </div>
  </details>`;
}

function _renderSimpleRows(rows, tbodyId, badgeId){
  const scoreKey=predScoreKey(rows);
  const maxScore=Math.max(1,...rows.map(r=>predScore(r,scoreKey)));
  const col=({f31:'front3_1',f32:'front3_2',b31:'back3_1',b32:'back3_2',bt2:'bottom2'})[String(tbodyId).split('-')[0]]||'bottom2';
  document.getElementById(tbodyId).innerHTML=rows.length?rows.map((r,i)=>{
    const sv=predScore(r,scoreKey);
    const bw=((sv/maxScore)*100).toFixed(0);
    const num=predNum(r);
    return `<tr>
      <td><span class="rank-badge ${i<3?'rank-'+(i+1):''}">${i+1}</span></td>
      <td>${predDetailHtml({num,col,row:r,rank:i+1,score:sv,maxScore})}</td>
      <td><div style="display:flex;align-items:center;gap:4px"><div class="progress-bar" style="width:50px"><div class="progress-fill" style="width:${bw}%"></div></div><span style="font-size:.7rem;color:var(--text3)">${sv.toFixed(3)}</span></div></td>
    </tr>`;
  }).join(''):`<tr><td colspan="3"><div class="predict-empty">ไม่มีข้อมูล</div></td></tr>`;
  document.getElementById(badgeId).innerHTML=rows.slice(0,5).map(r=>numChip(predNum(r))).join('')||'<span class="dash-empty">—</span>';
}

function predNum(row){
  return row?.['เลข']??row?.number??row?.num??row?.value??row?.['à¹€à¸¥à¸‚']??'';
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

function numChip(num,cls=''){
  const n=escHtml(num);
  return `<span class="num-badge predict-copy ${cls}" onclick="copyPredNumber('${n}')" title="คัดลอก ${n}">${n}</span>`;
}

function setPredictLoading(isLoading,msg='กำลังคำนวณ...'){
  const grid=document.getElementById('all-pred-grid');
  if(grid)grid.style.display='block';
  ['p1-badges','f31-badges','f32-badges','b31-badges','b32-badges','bt2-badges'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&isLoading)el.innerHTML=`<span style="color:var(--text3);font-size:.82rem">${msg}</span>`;
  });
  if(isLoading){
    ['predict-summary','predict-consensus','predict-decision-board','predict-final'].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.remove('active');el.innerHTML='';}});
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
  el.innerHTML=[
    ['งวดเป้าหมาย',date||'-','วันที่อ้างอิงทุกสูตร'],
    ['Prize1 Coverage',`${frontCount}/${backCount}`,`หน้า/ท้ายไม่ซ้ำใน Top ${p1rows.length||0}`],
    ['สูตรรางวัลที่ 1',preset||'optimized',`Beam ${beam} | Back3 ${kback}`],
    ['ผลลัพธ์รวม',totalRows,'จำนวนแถวที่พร้อมใช้งาน'],
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
    ...(cats.front3_1?.numbers||[]).slice(0,3),
    ...(cats.front3_2?.numbers||[]).slice(0,3),
  ].map(predNum).filter(Boolean);
  const bottom=(cats.bottom2?.numbers||[]).slice(0,6).map(predNum).filter(Boolean);
  const supported=[...support.values()].filter(x=>x.count>1).sort((a,b)=>b.count-a.count||a.num.localeCompare(b.num)).slice(0,8);
  const topCopy=[...topP1.map(predNum),...bottom.slice(0,3)].filter(Boolean).join(' ');
  const p1Html=topP1.map((r,i)=>{
    const n=predNum(r),s=(support.get(p1Front(r))?.count||0)+(support.get(p1Back(r))?.count||0);
    return predDetailHtml({num:n,col:'prize1',row:r,rank:i+1,score:predScore(r,scoreKey),maxScore,support:s,extra:[`หน้า ${p1Front(r)}`,`ท้าย ${p1Back(r)}`]});
  }).join('');
  el.innerHTML=`<div class="predict-final-card">
    <div class="predict-final-head">
      <div class="predict-final-title">Final Decision Panel</div>
      <button class="dash-link" onclick="copyPredNumber('${escHtml(topCopy)}')">copy ชุดหลัก</button>
    </div>
    <div class="predict-final-grid">
      <div class="predict-final-block"><div class="predict-final-label">Prize1 เน้นสุด</div><div class="predict-final-row">${p1Html}</div></div>
      <div class="predict-final-block"><div class="predict-final-label">3 ตัวบน / หน้า</div><div class="predict-final-row">${[...new Set(top3)].slice(0,8).map(n=>numChip(n)).join('')||'<span class="dash-empty">-</span>'}</div></div>
      <div class="predict-final-block"><div class="predict-final-label">2 ตัวล่าง + เลขหนุน</div><div class="predict-final-row">${bottom.slice(0,6).map(n=>numChip(n)).join('')}${supported.slice(0,5).map(x=>`<span class="num-badge agree predict-copy" onclick="copyPredNumber('${escHtml(x.num)}')">${escHtml(x.num)}<span style="font-size:.62rem;margin-left:4px;color:var(--text3)">x${x.count}</span></span>`).join('')}</div></div>
    </div>
    <div id="predict-mode-compare" class="predict-mode-compare"><div class="predict-summary-sub">กำลังเทียบ Optimized / Balanced / Coverage...</div></div>
  </div>`;
  el.classList.add('active');
  loadPredictModeCompare(config.date,config.topn||10,config.beam||500,config.kback||100);
}

async function loadPredictModeCompare(date,topn,beam,kback){
  const el=document.getElementById('predict-mode-compare');
  if(!el)return;
  const modes=['optimized','balanced','coverage'];
  try{
    const rows=await Promise.all(modes.map(async preset=>{
      const r=await api(`predict/prize1?top_n=5&date=${date}&beam_width=${beam}&k_back=${kback}&preset=${preset}`);
      return {preset,nums:(r.predictions||[]).slice(0,5).map(predNum).filter(Boolean)};
    }));
    const counts=new Map();
    rows.forEach(row=>row.nums.forEach(n=>counts.set(n,(counts.get(n)||0)+1)));
    el.innerHTML=rows.map(row=>`<div class="predict-mode-card">
      <div class="predict-mode-title">${row.preset}</div>
      <div>${row.nums.map(n=>numChip(n,counts.get(n)>1?'agree':'')).join('')||'<span class="dash-empty">-</span>'}</div>
    </div>`).join('');
  }catch(e){
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
  const coverageTone=frontCount>=p1rows.length*.8&&backCount>=p1rows.length*.8?'ดีมาก':frontCount>=p1rows.length*.5&&backCount>=p1rows.length*.5?'ใช้ได้':'กระจุก';
  const ticket=(title,rows)=>`<div class="predict-ticket"><div class="predict-ticket-title">${title}</div><div class="predict-ticket-row">${rows.map(r=>numChip(predNum(r))).join('')||'<span class="dash-empty">—</span>'}</div></div>`;
  el.innerHTML=`
    <div class="card predict-spotlight">
      <div class="predict-spotlight-head">
        <div>
          <div class="predict-spotlight-label">Best Prize1 Candidate</div>
          <div class="predict-spotlight-num predict-copy" onclick="copyPredNumber('${escHtml(topNum)}')" title="คัดลอก ${escHtml(topNum)}">${escHtml(topNum)}</div>
          <div class="predict-spotlight-sub">หน้า ${escHtml(p1Front(top))} · ท้าย ${escHtml(p1Back(top))} · score ${topScore.toFixed(2)}</div>
        </div>
        <button class="btn btn-primary" onclick="copyPredNumber('${escHtml(topNum)}')">Copy</button>
      </div>
      <div class="predict-signal-grid">
        <div class="predict-signal"><div class="predict-signal-label">Coverage</div><div class="predict-signal-value">${frontCount}/${backCount}</div><div class="predict-summary-sub">${coverageTone}</div></div>
        <div class="predict-signal"><div class="predict-signal-label">Preset</div><div class="predict-signal-value">${escHtml(config.preset||'optimized')}</div><div class="predict-summary-sub">Top ${escHtml(config.topn||p1rows.length)}</div></div>
        <div class="predict-signal"><div class="predict-signal-label">Support</div><div class="predict-signal-value">${supportChips.length}</div><div class="predict-summary-sub">เลขซ้ำ/หนุนกัน</div></div>
      </div>
    </div>
    <div class="card predict-panel">
      <div class="predict-panel-title"><span>ชุดแนะนำเร็ว</span><button class="dash-link" onclick="exportPredCSV()">Export</button></div>
      <div class="predict-portfolio">
        ${ticket('คะแนนสูงสุด',strongest)}
        ${ticket('กระจายหน้า/ท้าย',spread)}
        ${ticket('มีเลขย่อยหนุน',supported)}
      </div>
      <div style="margin-top:12px">
        <div class="predict-signal-label" style="margin-bottom:5px">เลขหนุนข้ามหมวด</div>
        <div class="predict-consensus-row">${supportChips.length?supportChips.map(x=>`<span class="num-badge agree predict-copy" onclick="copyPredNumber('${escHtml(x.num)}')" title="${escHtml([...x.labels].join(', '))}">${escHtml(x.num)}<span style="font-size:.65rem;margin-left:4px;color:var(--text3)">x${x.count}</span></span>`).join(''):'<span class="dash-empty">ยังไม่มีเลขหนุนเด่น</span>'}</div>
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
  const body=top.length?top.map(([n,c])=>`<span class="num-badge agree predict-copy" onclick="copyPredNumber('${escHtml(n)}')">${escHtml(n)}<span style="font-size:.65rem;margin-left:4px;color:var(--text3)">x${c}</span></span>`).join(''):'<span class="dash-empty">ยังไม่มีเลขซ้ำข้ามหมวดเด่น</span>';
  el.innerHTML=`<div class="card"><div class="dash-card-head"><div class="card-title">เลขซ้ำข้ามหมวด</div><button class="dash-link" onclick="resetPredictionFilters()">แสดงทุกหมวด</button></div><div class="predict-consensus-row">${body}</div></div>`;
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
  if(count)count.textContent=`แสดง ${visible}/${cards.length} หมวด`;
}

async function loadPredict(){
  const date = document.getElementById('pred-date').value;
  const topn = document.getElementById('pred-topn').value;
  const preset = document.getElementById('p1-preset')?.value||'optimized';
  const beam = document.getElementById('p1-beam').value;
  const kback = document.getElementById('p1-kback')?.value||100;
  setPredictLoading(true);

  const r = await api(`predict/all?top_n=${topn}&date=${date}&beam_width=${beam}&k_back=${kback}&preset=${preset}`);
  if(r.error){
    setPredictLoading(false);
    document.getElementById('p1-badges').innerHTML=`<div class="predict-empty">${r.error}</div>`;
    toast(r.error,'error');
    return;
  }
  const cats = r.categories||{};

  // prize1
  const p1 = cats.prize1||{};
  const p1rows = p1.numbers||[];
  const scoreKey1 = predScoreKey(p1rows);
  const max1 = Math.max(1,...p1rows.map(r=>predScore(r,scoreKey1)));
  document.getElementById('p1-badges').innerHTML=p1rows.slice(0,5).map(r=>numChip(predNum(r))).join('')||'<span class="dash-empty">—</span>';
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
  }).join(''):`<tr><td colspan="5"><div class="predict-empty">ไม่มีข้อมูลรางวัลที่ 1</div></td></tr>`;

  // front3
  _renderSimpleRows(cats.front3_1?.numbers||[], 'f31-tbody', 'f31-badges');
  _renderSimpleRows(cats.front3_2?.numbers||[], 'f32-tbody', 'f32-badges');
  // back3
  _renderSimpleRows(cats.back3_1?.numbers||[], 'b31-tbody', 'b31-badges');
  _renderSimpleRows(cats.back3_2?.numbers||[], 'b32-tbody', 'b32-badges');
  // bottom2
  _renderSimpleRows(cats.bottom2?.numbers||[], 'bt2-tbody', 'bt2-badges');

  document.getElementById('all-pred-grid').style.display='block';
  const allRows=[
    ...p1rows.map(r=>({group:'prize1',number:predNum(r),score:predScore(r,scoreKey1)})),
    ...['front3_1','front3_2','back3_1','back3_2','bottom2'].flatMap(k=>(cats[k]?.numbers||[]).map(r=>({group:k,number:predNum(r),score:predScore(r,predScoreKey(cats[k]?.numbers||[]))}))),
  ];
  _lastPredData=allRows;
  _lastPredCol='all';
  _lastPredDate=date;
  _lastPredictSnapshot={
    id:`predict_${date}_${preset}_${topn}`,
    title:`ทำนาย · ${fmtDate(date)}`,
    date,topn,preset,
    mode:preset,
    items:[
      ...p1rows.slice(0,5).map(r=>({num:predNum(r),score:'P1'})),
      ...(cats.bottom2?.numbers||[]).slice(0,6).map(r=>({num:predNum(r),score:'2ตัว'})),
      ...(cats.front3_1?.numbers||[]).slice(0,3).map(r=>({num:predNum(r),score:'หน้า3'})),
      ...(cats.back3_1?.numbers||[]).slice(0,3).map(r=>({num:predNum(r),score:'ท้าย3'})),
    ],
    note:`Top ${topn} · ${allRows.length} แถว · Beam ${beam} · Back3 ${kback}`
  };
  renderPredictSummary({date,topn,beam,kback,preset:r.prize1_config?.preset_label||preset,cats,totalRows:allRows.length});
  renderPredictFinalPanel(cats,{date,topn,beam,kback,preset:r.prize1_config?.preset_label||preset});
  renderPredictDecisionBoard(cats,{date,topn,beam,kback,preset:r.prize1_config?.preset_label||preset});
  renderPredictionConsensus(cats);
  filterPredictions();

  // Ref draws (same day+month)
  if(date){
    const [,m,dd]=date.split('-');
    const h=await api('history?n=500');
    const refs=(h.data||[]).filter(row=>{
      if(!row.date) return false;
      const p=row.date.split('/');
      return p[0]===dd&&p[1]===m;
    }).slice(0,15);
    document.getElementById('ref-tbody').innerHTML=refs.map(row=>`<tr>
      <td>${row.date}</td><td>${row.prize1||''}</td><td>${row.top3||''}</td>
      <td>${row.top2||''}</td><td>${row.back3_1||''}</td><td>${row.back3_2||''}</td><td>${row.bottom2||''}</td>
    </tr>`).join('')||'<tr><td colspan="7"><div class="predict-empty">ไม่พบงวดวันเดียวกันในอดีต</div></td></tr>';
  }
}

async function loadLuckyNews(){
  const date = document.getElementById('pred-date').value;
  const sec = document.getElementById('lucky-news-section');
  sec.style.display='block';
  document.getElementById('lucky-source').textContent='กำลังค้นข่าวเลขเด็ด...';
  document.getElementById('lucky-3d').innerHTML='<span style="color:var(--text3);font-size:.8rem">กำลังโหลด...</span>';
  document.getElementById('lucky-2d').innerHTML='<span style="color:var(--text3);font-size:.8rem">กำลังโหลด...</span>';
  const r = await api(`lucky-news${date?'?date='+date:''}`);
  if(r.error){
    document.getElementById('lucky-source').textContent=r.error;
    document.getElementById('lucky-3d').innerHTML='<span style="color:var(--red);font-size:.8rem">โหลดข่าวไม่สำเร็จ</span>';
    document.getElementById('lucky-2d').innerHTML='';
    toast(r.error,'error');
    return;
  }
  document.getElementById('lucky-source').textContent=`แหล่งที่มา: ${(r.sources||[]).join(', ')||'ไม่พบ'} | คำค้น: ${r.query||''}`;
  document.getElementById('lucky-3d').innerHTML=(r.numbers_3||[]).map(n=>`<span class="num-badge" style="font-family:'IBM Plex Mono',monospace">${n}</span>`).join('')||'<span style="color:var(--text3);font-size:.8rem">ไม่พบเลข 3 ตัว</span>';
  document.getElementById('lucky-2d').innerHTML=(r.numbers_2||[]).map(n=>`<span class="num-badge" style="font-family:'IBM Plex Mono',monospace">${n}</span>`).join('')||'<span style="color:var(--text3);font-size:.8rem">ไม่พบเลข 2 ตัว</span>';
  document.getElementById('lucky-note').textContent=r.note||'';
  sec.scrollIntoView({behavior:'smooth',block:'nearest'});
}


// ─── History ──────────────────────────────────────────────────────────────────
function _renderBtTable(){
  if(!_btRowData.length){
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" style="display:block">ยังไม่มีผล Backtest สำหรับชุดข้อมูลนี้</div>';
    return;
  }
  const sorted=[..._btRowData].sort((a,b)=>{
    let av=a[_btSortKey],bv=b[_btSortKey];
    if(typeof av==='string')return _btSortAsc?av.localeCompare(bv):bv.localeCompare(av);
    if(av==null)av=-1;if(bv==null)bv=-1;
    return _btSortAsc?av-bv:bv-av;
  });
  const arr=k=>k===_btSortKey?(_btSortAsc?' ▲':' ▼'):' ⇅';
  const th=(label,key,align)=>`<th style="cursor:pointer;user-select:none;white-space:nowrap${align?';text-align:'+align:''}" onclick="btSort('${key}')">${label}${arr(key)}</th>`;
  const typeColor=t=>t.includes('หน่วย')?'rgba(240,84,84,.18);color:var(--red)':t.includes('วิ่ง')?'rgba(168,85,247,.18);color:var(--purple)':'var(--surface2);color:var(--text2)';
  const rollingHtml=r=>[50,100,200].map(w=>{
    const rw=r.rolling?.[w];
    if(!rw||!rw.total)return `<span style="color:var(--text3)">W${w}: -</span>`;
    const c=rw.edge>3?'var(--green)':rw.edge<-5?'var(--red)':'var(--text3)';
    return `<span style="white-space:nowrap;color:${c}">W${w}: ${rw.edge>=0?'+':''}${rw.edge.toFixed(1)}%</span>`;
  }).join('<br>');
  const rowHtml=r=>{
    const ec=r.edge>3?'var(--green)':r.edge<-3?'var(--red)':'var(--text2)';
    const pc=r.edge>3?'var(--green)':r.edge<-3?'var(--red)':'var(--text1)';
    const badge=r.degraded?'⚠ ต่ำกว่าสุ่ม':r.edge>5?'★':r.edge>0?'✓':r.edge<-5?'×':'~';
    const bc=r.degraded?'var(--red)':r.edge>0?'var(--green)':r.edge<-5?'var(--red)':'var(--text3)';
    const tc=typeColor(r.typeLabel||'');
    const sample=r.total<50?`<span style="color:var(--red);font-size:.68rem;margin-left:6px">low n</span>`:'';
    return `<tr>
      <td><span style="background:${r.groupColor}22;color:${r.groupColor};padding:1px 7px;border-radius:4px;font-size:.7rem;white-space:nowrap;font-weight:600;margin-right:5px">${r.group}</span>${r.name}${sample}</td>
      <td><span style="background:${tc};padding:1px 6px;border-radius:3px;font-size:.7rem;white-space:nowrap">${r.typeLabel}</span></td>
      <td style="text-align:right">${r.total}</td>
      <td style="text-align:right;font-weight:700;color:${pc}">${r.hits}</td>
      <td style="text-align:right;font-weight:700;color:${pc}">${r.pct.toFixed(1)}%</td>
      <td style="text-align:right;font-size:.72rem;color:var(--text3)">${r.ciLow.toFixed(1)}-${r.ciHigh.toFixed(1)}%</td>
      <td style="text-align:right;font-size:.72rem;color:var(--text3)">${r.baseLabel} = ${r.baseP.toFixed(1)}%</td>
      <td style="text-align:right;font-weight:700;color:${ec}">${r.edge>=0?'+':''}${r.edge.toFixed(1)}%</td>
      <td style="text-align:right;font-size:.7rem;line-height:1.35">${rollingHtml(r)}</td>
      <td style="text-align:right;font-size:.75rem;color:${r.subPct!=null&&r.subPct>0?'#4d9de0':'var(--text3)'}" title="ตรงเลขท้ายของ ข้างเคียงร.1 / รางวัลที่ 2 / รางวัลที่ 3 (ข้อมูล Sanook, นับแยกจาก Hit หลัก)">${r.subPct!=null?`${r.subHits}/${r.subTotal} (${r.subPct.toFixed(0)}%)`:'-'}</td>
      <td style="text-align:center;font-weight:700;color:${bc};white-space:nowrap">${badge}</td>
    </tr>`;
  };
  const thead=`<thead><tr>${th('Formula','name')}${th('Type','typeLabel')}${th('Draws','total','right')}${th('Hits','hits','right')}${th('Hit %','pct','right')}<th style="text-align:right;white-space:nowrap">95% CI</th>${th('Random baseline','baseP','right')}${th('Edge','edge','right')}<th style="text-align:right;white-space:nowrap">Rolling edge</th>${th('ถูกรอง','subPct','right')}<th style="text-align:center">Result</th></tr></thead>`;
  const btSummary=typeof _formulaBtSummaryHtml==='function'?_formulaBtSummaryHtml(sorted):'';
  const boardOrder=['2-digit exact','3-digit exact','Run / digit','Prize1 tail','Pool 1-5','Other'];
  const boardTables=boardOrder.map(board=>{
    const rows=sorted.filter(r=>r.board===board);
    if(!rows.length)return '';
    const bestEdge=[...rows].sort((a,b)=>b.edge-a.edge)[0];
    const bestHit=[...rows].sort((a,b)=>b.pct-a.pct)[0];
    const mini=`<div class="formula-summary-bar active" style="margin-bottom:10px">
      <div class="formula-summary-item"><div class="formula-summary-label">สูตรในกลุ่ม</div><div class="formula-summary-value">${rows.length}</div><div class="formula-summary-sub">${board}</div></div>
      <div class="formula-summary-item"><div class="formula-summary-label">Best edge</div><div class="formula-summary-value">${bestEdge.edge>=0?'+':''}${bestEdge.edge.toFixed(1)}%</div><div class="formula-summary-sub">${bestEdge.name}</div></div>
      <div class="formula-summary-item"><div class="formula-summary-label">Best hit rate</div><div class="formula-summary-value">${bestHit.pct.toFixed(1)}%</div><div class="formula-summary-sub">${bestHit.name}</div></div>
    </div>`;
    return `<div class="bt-board">
      <div class="section-h">${board}</div>
      ${mini}
      <div class="tbl-wrap"><table>${thead}<tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
    </div>`;
  }).join('');
  document.getElementById('formula-bt-table').innerHTML=`
    <div class="card">
      <div class="card-title" style="margin-bottom:6px">Backtest ${_btTested} draws · grouped by comparable target</div>
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap">
        <span><b>Edge</b> = actual hit rate minus random baseline.</span>
        <span><b>95% CI</b> helps show uncertainty; small samples are noisy.</span>
        <span style="color:var(--green)">★ Edge&gt;5%</span>
        <span style="color:var(--green)">✓ Edge&gt;0%</span>
        <span style="color:var(--text3)">~ near random</span>
        <span style="color:var(--red)">× below random</span>
        <span style="color:var(--red)">⚠ ต่ำกว่าสุ่ม = W200 edge &lt; -5%</span>
      </div>
      ${typeof _formulaMappingBannerHtml==='function'?_formulaMappingBannerHtml(_btFieldCheck):''}
      ${btSummary}
      ${boardTables}
    </div>`;
}

let _histData=[];
async function loadHistory(){
  const n=document.getElementById('hist-n').value;
  const d=await api(`history?n=${n}`);
  _histData=d.data||[];
  filterHistory();
}
function filterHistory(){
  const q=document.getElementById('hist-search').value.trim().toLowerCase();
  const rows=q?_histData.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(q))):_histData;
  document.getElementById('hist-tbody').innerHTML=rows.map(r=>`<tr>
    <td>${r.date||''}</td><td><b style="font-family:'IBM Plex Mono',monospace;color:var(--gold2)">${r.prize1||''}</b></td>
    <td>${r.top3||''}</td><td>${r.top2||''}</td><td>${r.front3_1||''}</td>
    <td>${r.front3_2||''}</td><td>${r.back3_1||''}</td><td>${r.back3_2||''}</td><td>${r.bottom2||''}</td>
  </tr>`).join('');
}

// ─── Backtest ─────────────────────────────────────────────────────────────────
async function loadBacktest(){
  const n=document.getElementById('bt-n').value;
  const topn=document.getElementById('bt-topn').value;
  const preset=document.getElementById('bt-preset')?.value||'optimized';
  const beam=document.getElementById('bt-beam')?.value||500;
  const kback=document.getElementById('bt-kback')?.value||100;
  document.getElementById('bt-loading').style.display='block';
  document.getElementById('bt-results').style.display='none';
  const d=await api(`backtest?n_draws=${n}&top_n=${topn}&beam_width=${beam}&k_back=${kback}&preset=${preset}`);
  document.getElementById('bt-loading').style.display='none';
  if(d.error){toast('error: '+d.error,'error');return;}
  document.getElementById('bt-results').style.display='block';
  const pct=v=>v!=null?(v*100).toFixed(2)+'%':'—';
  const lx=v=>v!=null?v.toFixed(2)+'x':'—';
  const liftColor=v=>v>=2?'#3dd68c':v>=1.2?'#c8a84b':'#f05454';
  document.getElementById('bt-metrics').innerHTML=`
    <div class="card">
      <div class="card-title">🎯 Front3 Hit Rate (Top-${topn})</div>
      <div class="stat-val">${pct(d.front3_rate)}</div>
      <div class="stat-sub" style="color:${liftColor(d.front3_lift||0)}">Lift ${lx(d.front3_lift)} vs สุ่ม ${pct(d.front3_random)}</div>
    </div>
    <div class="card">
      <div class="card-title">🎯 Back3 Hit Rate (Top-${topn})</div>
      <div class="stat-val">${pct(d.back3_rate)}</div>
      <div class="stat-sub" style="color:${liftColor(d.back3_lift||0)}">Lift ${lx(d.back3_lift)} vs สุ่ม ${pct(d.back3_random)}</div>
    </div>
    <div class="card">
      <div class="card-title">🏆 Prize1 Combined (Top-${topn})</div>
      <div class="stat-val">${d.hits||0} hits</div>
      <div class="stat-sub" style="color:${liftColor(d.lift||0)}">Lift ${lx(d.lift)} | ${pct(d.rate)} vs สุ่ม ${pct(d.random_rate)}</div>
    </div>
    <div class="card">
      <div class="card-title">📊 งวดทดสอบ</div>
      <div class="stat-val">${d.n_tested||n}</div>
      <div class="stat-sub">${d.preset_label||preset} | beam=${d.beam_width||500} k_back=${d.k_back||100} ${d.errors?'❌ '+d.errors+' err':''}</div>
    </div>
    <div class="card">
      <div class="card-title">Pairing Diagnostics</div>
      <div class="stat-val">${d.paired_halves_available||0}</div>
      <div class="stat-sub">both halves present | F rank ${d.avg_front3_hit_rank??'—'} | B rank ${d.avg_back3_hit_rank??'—'}</div>
    </div>`;
  mkChart('bt-lift-chart',{type:'bar',
    data:{labels:['Front3 Lift','Back3 Lift','Combined Lift','Random (1x)'],datasets:[
      {label:'Lift vs Random',
       data:[+(d.front3_lift||0).toFixed(3),+(d.back3_lift||0).toFixed(3),+(d.lift||0).toFixed(3),1],
       backgroundColor:['rgba(61,214,140,0.7)','rgba(77,157,224,0.7)','rgba(200,168,75,0.7)','rgba(120,120,120,0.4)'],
       borderWidth:0}
    ]},
    options:{...chartOpts('x',true),scales:{y:{min:0,ticks:{callback:v=>v+'x'}}}}});
}


// ─── Chart defaults ───────────────────────────────────────────────────────────
function chartOpts(yLabel='',legend=false){
  return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:legend,labels:{color:'#9090a8',font:{size:11}}},tooltip:{callbacks:{label:ctx=>` ${ctx.parsed.y??ctx.parsed.x}`}}},scales:{x:{ticks:{color:'#9090a8',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#9090a8',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'},title:{display:!!yLabel,text:yLabel,color:'#5a5a72'}}}};
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
