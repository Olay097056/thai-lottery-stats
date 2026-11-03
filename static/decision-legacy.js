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
    case 'back3_suffix2': return preds.includes(p(actual.back3_1,3).slice(-2))||preds.includes(p(actual.back3_2,3).slice(-2));
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
  if(field==='back3')return null; // legacy field mixes exact-3 and suffix-2; no comparable baseline
  if(field==='bottom2'||field==='prize1_last2')return k;
  if(['bottom2_unit','front3_unit','back3_unit','prize1_unit'].includes(field))return k*10;
  if(field==='top3')return k/1000*100;
  if(field==='front3'||field==='back3exact')return (1-Math.pow(1-Math.min(k,1000)/1000,2))*100;
  if(field==='back3_suffix2')return (1-Math.pow(1-Math.min(k,100)/100,2))*100;
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
    const frs=_formulaBacktestRowsForTargets(_computeFormulasBatch(prev,iso,rows.slice(i+2,i+202))||[]);
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
    const edge=Number.isFinite(baseP)?pct-baseP:null;
    const weight=edge==null?1:Math.max(.25,Math.min(1.8,1+edge/35));
    return {...s,pct,baseP,edge,weight};
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
    <div class="dc-row">${items.length?items.map(x=>copyPredButton(x.num,'',x.count,x.sources.join(', '))).join(''):'<span class="dash-empty">ยังไม่พบเลขซ้ำเด่น</span>'}</div>
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
        <span style="display:flex;align-items:center;gap:6px"><span class="dc-score" aria-label="คะแนนจัดอันดับ ${r.score} จาก 100">${r.score}/100</span>${dcEdgeBadgeOld(r.topEdge)}</span>
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
  if(!snapshot?.picks?.length)return false;
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
      <div class="dc-row">${(s.picks||[]).map(p=>`<span class="num-badge">${escHtml(p.num)}<span style="font-size:.8rem;margin-left:4px;color:var(--text3)">${p.score}/100</span></span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
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
  return deleteWithUndo('lottery_dc_snapshots_old','ลบ Snapshot แล้ว',()=>{
    const list=dcSnapshotsOld().filter(x=>x.date!==date);
    localStorage.setItem('lottery_dc_snapshots_old',JSON.stringify(list));
  },()=>{
    const el=document.getElementById('dc-snapshot-list-old');
    if(el)el.innerHTML=dcSnapshotTrackHtmlOld(LotteryServerData.legacyDecision.history);
  });
}

function dcClearSnapshotsOld(){
  if(!confirm('ลบ Snapshot รุ่นเดิมทั้งหมดหรือไม่?'))return false;
  return deleteWithUndo('lottery_dc_snapshots_old','ลบ Snapshot ทั้งหมดแล้ว',()=>localStorage.removeItem('lottery_dc_snapshots_old'),()=>{
    const el=document.getElementById('dc-snapshot-list-old');
    if(el)el.innerHTML=dcSnapshotTrackHtmlOld(LotteryServerData.legacyDecision.history);
  });
}
function dcLottoSummaryBoardOld({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support,resolvedSamples=0}){
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
  const supportHtml=supportTop.map(x=>copyPredButton(x.num,'agree',x.count)).join('')||'<span class="dash-empty">-</span>';
  const bestFormula=(btRows||[]).slice(0,3);
  const formulaLead=(formulaMatches||[]).slice(0,3);
  const patternLead=(scored.all||[]).filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,2);
  const formulaItems=[
    ...patternLead.map(x=>({title:`Pattern Link · ${x.num}`,sub:`คะแนนจัดอันดับ ${x.score}/100 · ${String(x.sources.find(s=>String(s).includes('Pattern Link'))||'สูตรเชื่อมโยงแพทเทิร์น')}`})),
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
        <div class="dc-lotto-label">Combined Pick · อันดับ 1</div>
        <div class="dc-lotto-number">${escHtml(best.num||'-')}</div>
        <div class="dc-lotto-note">${best.score!=null?`คะแนนจัดอันดับ ${best.score}/100 · ${escHtml(dcExplainPickOld(best))}`:'ยังไม่มีเลขผ่านเกณฑ์'}</div>
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
      <div class="dc-lotto-label">คะแนนจัดอันดับ · ${modeLabel}</div><p class="dc-score-note">คะแนนนี้จัดอันดับจากสัญญาณ ไม่ใช่ความน่าจะเป็น · Track Record ที่ทราบผล ${resolvedSamples} งวด (ดูผลแยกด้านล่าง)</p>
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
      ${copyPredActionButton([...(p1||[]).map(predNum),...(bottom||[]).slice(0,4).map(predNum)].filter(Boolean).join(' '),'copy ชุดหลัก','btn btn-secondary')}
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
  const requestId=++LotteryUiState.legacyDecision.loadRequestId;
  const root=document.getElementById('dc-root-old');
  if(!root)return;
  root.className='dc-loading';
  root.textContent='กำลังรวมสัญญาณงวดนี้...';
  setPageStatus('oldver-status','กำลังรวมสัญญาณงวดนี้...');
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
      api('summary',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true}),
      api(`predict/all?top_n=10&date=${next}&beam_width=500&k_back=100&preset=optimized`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true}),
      api('prize-history?n=260',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true})
    ]);
    if(requestId!==LotteryUiState.legacyDecision.loadRequestId)return;
    const failure=[summary,pred,hist].some(data=>!data||data.ok===false||data.error);
    const partial=pred.report_status==='partial'||Object.values(pred.categories||{}).some(category=>category.error);
    if(failure||partial||!summary.latest?.prize1||!Array.isArray(hist.data)||!hist.data.length||!Object.keys(pred.categories||{}).length){
      LotteryUiState.legacyDecision.lastSnapshotOld=null;
      throw new Error('required inputs unavailable');
    }
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

    LotteryServerData.legacyDecision.history=hist.data||[];
    LotteryUiState.legacyDecision.lastSnapshotOld={
      date:next,
      mode,
      picks:scored.picks.map(x=>({num:x.num,score:x.score,type:x.type,explain:dcExplainPickOld(x)})),
      pattern:scored.all.filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,5).map(x=>({num:x.num,score:x.score})),
      matches:formulaMatches.length
    };
    dcAutoSaveSnapshotOld(LotteryUiState.legacyDecision.lastSnapshotOld);
    const resolvedSamples=new Set(dcSnapshotsOld().filter(s=>dcActualForDateOld(LotteryServerData.legacyDecision.history,s.date)).map(s=>s.date)).size;
    const lottoBoardHtml=dcLottoSummaryBoardOld({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support,resolvedSamples});
    const trend=dcHitRateTrendOld(dcSnapshotsOld(),LotteryServerData.legacyDecision.history,5,20);
    const trendHtml=trend.length
      ?`<div style="height:180px"><canvas id="dc-trend-chart-old" role="img" aria-label="กราฟแนวโน้มอัตราถูกของ Decision Center"></canvas></div>`
      :'<div class="dash-empty">ยังไม่มีงวดที่มีผลจริงพอจะคำนวณแนวโน้ม — auto-save จะสะสมทุกครั้งที่เปิดหน้านี้</div>';
    root.className='';
    root.innerHTML=`${lottoBoardHtml}
    <div class="dc-grid">
      <section class="dc-card dc-card-wide"><h2 class="dc-label">Snapshot + Track Record</h2><div class="dc-signal-sub" style="margin-bottom:8px">เปิดหน้านี้หรือคำนวณซ้ำแล้วบันทึก Snapshot ล่าสุดทับงวดเดิมในเบราว์เซอร์ · &quot;ถูก&quot; = มีเลขอย่างน้อย 1 ตัวในชุดที่ตรงผลจริง</div><div id="dc-snapshot-list-old" class="dc-row">${dcSnapshotTrackHtmlOld(LotteryServerData.legacyDecision.history)}</div></section>
      <section class="dc-card dc-card-wide"><h2 class="dc-label">แนวโน้มอัตราถูก (20 งวดล่าสุดที่มีผล · rolling 5 งวด)</h2>${trendHtml}</section>
    </div>
    <div id="dc-backtest-panel-old"></div>
    <div class="dc-panel">
      <h2 class="dc-label">Data Health</h2>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">ผลงวดล่าสุด</div><div class="dc-signal-sub">${latest.date||'-'} · ${latest.prize1||'-'}</div></div><span class="dc-status ${healthStatus}">${healthText}</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">จำนวนงวดในระบบ</div><div class="dc-signal-sub">${summary.total_draws||summary.total||'-'} งวด</div></div><span class="dc-status good">DATA</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">สูตรคำนวณ</div><div class="dc-signal-sub">กดเปิดสูตรเพื่อ refresh Formula Final Picks</div></div><span class="dc-status warn">optional</span></div>
    </div>
    <div class="dc-grid">
      <section class="dc-card dc-card-wide"><h2 class="dc-label">Predict × สูตรคำนวณ ตรงกัน</h2><div class="dc-row">${formulaMatchHtml}</div></section>
      <section class="dc-card dc-card-wide"><h2 class="dc-label">สัญญาณจากรางวัลรอง 10 งวดล่าสุด</h2>${dcSecondarySignalsHtmlOld(secondarySignals)}</section>
      <section class="dc-card"><h2 class="dc-label">ตัดเลขเสี่ยง</h2><div class="dc-row">${dcRiskHtmlOld(scored.risks)}</div></section>
    </div>`;
    setPageStatus('oldver-status','สรุปงวดนี้พร้อมแล้ว');
    if(trend.length){
      const opts=chartOpts('% ถูก');
      opts.scales.y.min=0;opts.scales.y.max=100;
      mkChart('dc-trend-chart-old',{type:'line',data:{
        labels:trend.map(t=>fmtDate(t.date)),
        datasets:[{label:'% ถูก (rolling 5 งวด)',data:trend.map(t=>t.value),themeColor:'--green-text',themeFill:'--green-soft',tension:.3,fill:true,pointRadius:2}]
      },options:opts});
    }
  }catch(e){
    if(requestId!==LotteryUiState.legacyDecision.loadRequestId)return;
    LotteryUiState.legacyDecision.lastSnapshotOld=null;
    root.className='dc-loading';
    root.textContent='ข้อมูลสรุปงวดนี้ไม่ครบหรือโหลดไม่สำเร็จ · ยังไม่บันทึก · กดคำนวณเพื่อลองใหม่';
    setPageStatus(root.id==='dc-root-old'?'oldver-status':'decision-status',root.textContent);
  }
}

