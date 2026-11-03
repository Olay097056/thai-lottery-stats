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

// Shared rolling-hit-rate tail for both trend series (Pick + เลขแนะนำ): takes ascending-date
// {date,status:'hit'|'miss'} rows, keeps the most recent `take`, and emits a rolling-window
// % series. The two trends differ only in how they resolve rounds into hit/miss upstream.
function dcRollingRate(resolved,window=5,take=20){
  const recent=(resolved||[]).slice(-take);
  return recent.map((r,i)=>{
    const start=Math.max(0,i-window+1);
    const win=recent.slice(start,i+1);
    const hitCount=win.filter(w=>w.status==='hit').length;
    return {date:r.date,value:+(hitCount/win.length*100).toFixed(1)};
  });
}

function dcHitRateTrend(snapshots,rows,window=5,take=20){
  const resolved=(snapshots||[])
    .map(s=>({date:s.date,...dcSnapshotResult(s,rows)}))
    .filter(r=>r.status!=='pending')
    .sort((a,b)=>a.date.localeCompare(b.date));
  return dcRollingRate(resolved,window,take);
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
    <div class="dc-row">${items.length?items.map(x=>copyPredButton(x.num,'',x.count,x.sources.join(', '))).join(''):'<span class="dash-empty">ยังไม่พบเลขซ้ำเด่น</span>'}</div>
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
  // ทดลอง badge propagation (ISSUE-14): a Pick carries the badge if ANY contributing
  // formula does, per ADR-0003 — display-only, never affects score/rank below.
  const trustMap=new Map((formulaResults||[]).map(fr=>[fr.name,fr.trust||null]));
  const cfg={strict:{min:58,limit:4},balanced:{min:42,limit:6},coverage:{min:26,limit:10}}[mode]||{min:42,limit:6};
  const add=(num,type,source,points,reason,meta={})=>{
    const n=String(num||'').trim(); if(!n)return;
    const r=map.get(n)||{num:n,type,sources:[],score:0,reasons:[],warnings:[],formulaWeight:0,predictCount:0,formulaCount:0,topEdge:null,trust:null};
    r.type=r.type||type;
    r.score+=points;
    r.sources.push(source);
    if(reason)r.reasons.push(reason);
    if(meta.predict)r.predictCount++;
    if(meta.formula){
      r.formulaCount++;r.formulaWeight+=meta.weight||1;
      if(typeof meta.edge==='number')r.topEdge=r.topEdge==null?meta.edge:Math.max(r.topEdge,meta.edge);
      if(meta.trust==='ทดลอง')r.trust='ทดลอง';
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
      add(n,`${len} หลัก`,fr.name,5*w,`สูตร ${fr.name} ให้เลขนี้โดยตรง${bt?` (edge ${edge>=0?'+':''}${edge.toFixed(1)}%)`:''}`,{formula:true,weight:w,edge:bt?bt.edge:undefined,trust:fr.trust||null});
    });
  });
  (formulaMatches||[]).forEach(m=>{
    m.formula.forEach(f=>{
      const bt=btMap.get(f.label);
      const w=bt?.weight||1;
      const edge=bt?`backtest edge ${bt.edge>=0?'+':''}${bt.edge.toFixed(1)}%`:'ยังไม่มี backtest weight';
      add(m.num,String(m.num).length+' หลัก',f.label,10*w,`สูตร ${f.label} สนับสนุน (${edge})`,{formula:true,weight:w,edge:bt?.edge,trust:trustMap.get(f.label)||null});
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

// ทดลอง trust badge (ISSUE-14) — display-only, shared by Pick chips and เลขแนะนำ chips.
// Reuses the .trust-badge CSS class introduced for formula-level badges in ISSUE-13.
function dcTrustBadge(trust){
  if(trust!=='ทดลอง')return '';
  return `<span class="trust-badge">${trust}</span>`;
}

function dcScoreHtml(rows){
  if(!rows?.length)return '<div class="dash-empty">ยังไม่มีเลขที่ผ่านโหมดคัดเลขนี้</div>';
  return `<div class="dc-decision-list">${rows.map((r,i)=>`
    <details class="dc-pick ${i===0?'top':''}" ${i===0?'open':''}>
      <summary class="dc-pick-head">
        <span class="dc-pick-num">${escHtml(r.num)}</span>
        <span style="display:flex;align-items:center;gap:6px"><span class="dc-score" aria-label="คะแนนจัดอันดับ ${r.score} จาก 100">${r.score}/100</span>${dcEdgeBadge(r.topEdge)}${dcTrustBadge(r.trust)}</span>
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

function dcSnapshots(){
  try{const list=JSON.parse(localStorage.getItem('lottery_dc_snapshots')||'[]');return Array.isArray(list)?list.filter(x=>x&&typeof x==='object'):[];}catch(e){return [];}
}
function dcAutoSaveSnapshot(snapshot){
  if(!snapshot?.picks?.length)return false;
  if(typeof reportStoreCanWrite==='function'&&!reportStoreCanWrite('lottery_dc_snapshots')){toast('บันทึกเดิมอ่านไม่ได้ จึงยังไม่เขียนรายงานใหม่','error');return false;}
  const list=dcSnapshots();
  if(list.some(x=>x.date===snapshot.date))return;
  list.unshift({...snapshot,schema_version:2,savedAt:new Date().toISOString()});
  try{localStorage.setItem('lottery_dc_snapshots',JSON.stringify(list));}
  catch{toast('บันทึกสรุปงวดนี้ไม่ได้ กรุณาส่งออกบันทึกและตรวจพื้นที่จัดเก็บ','error');}
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
      <div class="dc-row">${(s.picks||[]).map(p=>`<span class="num-badge">${escHtml(p.num)}<span style="font-size:.8rem;margin-left:4px;color:var(--text3)">${p.score}/100</span></span>`).join('')||'<span class="dash-empty">ไม่มีเลข</span>'}</div>
      ${dcRecoSnapshotBadgesHtml(s,rows)}
      ${typeof reportProvenanceHtml==='function'?reportProvenanceHtml(s.provenance):''}
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
  return deleteWithUndo('lottery_dc_snapshots','ลบ Snapshot แล้ว',()=>{
    const list=dcSnapshots().filter(x=>x.date!==date);
    localStorage.setItem('lottery_dc_snapshots',JSON.stringify(list));
  },()=>{
    const el=document.getElementById('dc-snapshot-list');
    if(el)el.innerHTML=dcSnapshotTrackHtml(LotteryServerData.decision.history);
  });
}

function dcClearSnapshots(){
  if(!confirm('ลบ Snapshot ที่บันทึกไว้ทั้งหมดหรือไม่?'))return false;
  return deleteWithUndo('lottery_dc_snapshots','ลบ Snapshot ทั้งหมดแล้ว',()=>localStorage.removeItem('lottery_dc_snapshots'),()=>{
    const el=document.getElementById('dc-snapshot-list');
    if(el)el.innerHTML=dcSnapshotTrackHtml(LotteryServerData.decision.history);
  });
}

function dcLottoSummaryBoard({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support,resolvedSamples=0}){
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
        <div class="dc-lotto-number">${escHtml(best.num||'-')}${dcTrustBadge(best.trust)}</div>
        <div class="dc-lotto-note">${best.score!=null?`คะแนนจัดอันดับ ${best.score}/100 · ${escHtml(dcExplainPick(best))}`:'ยังไม่มีเลขผ่านเกณฑ์'}</div>
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
      ${copyPredActionButton([...(p1||[]).map(predNum),...(bottom||[]).slice(0,4).map(predNum)].filter(Boolean).join(' '),'copy ชุดหลัก','btn btn-secondary')}
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
    const exact3=['top3','front3','back3','back3exact'].includes(fr.field);
    const exact2=['bottom2','prize1_last2'].includes(fr.field);
    if((len===3&&!exact3)||(len===2&&!exact2))return;
    (fr.preds||[]).forEach(n=>{
      const raw=String(n||'');
      if(!new RegExp(`^\\d{${len}}$`).test(raw))return;
      const btName=fr.field==='back3'&&len===3?`${fr.name} · ท้าย 3 ตรง`:fr.name;
      const bt=btMap.get(btName);
      const weight=Math.max(.4,Math.min(2,bt?.weight||1));
      const num=raw;
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
  // ทดลอง badge propagation (ISSUE-14): a เลขแนะนำ candidate carries the badge if ANY of its
  // agreeing top-level groups has a ทดลอง formula — display-only, never affects ranking below.
  // Group key = explicit fr.group (HM · Hermes Pool 1-4, PRD-hermes-pool-1-4.md) else name[0]
  // (J1/J2 → 'J', X1.. → 'X') — the explicit field stops 'HM' from collapsing into 'H'
  // (มิสเตอร์ซี) and falsely badging H-supported เลขแนะนำ.
  const groupKeyOf=fr=>fr?.group||String(fr?.name||'')[0]||'?';
  const experimentalGroups=new Set((formulaResults||[]).filter(fr=>fr?.trust==='ทดลอง').map(groupKeyOf));
  (formulaResults||[]).forEach(fr=>{
    const field=fr?.field;
    if(!field)return;
    const groupKey=groupKeyOf(fr);
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
      const trust=groups.some(g=>experimentalGroups.has(g))?'ทดลอง':null;
      list.push({num,groups,combinedEdge,trust});
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
const DC_RECO_PRODUCER_GROUPS={bottom2:8,top3:3,front3:2,back3exact:2,prize1_last2:2};
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

// เลขแนะนำ hit-rate trend (ISSUE-11) — same conventions as dcHitRateTrend for Picks
// (resolved-only, last `take`, rolling `window`, ascending dates) but over each snapshot's
// reco entries: a round is a hit if >=1 of its เลขแนะนำ hit; rounds with no reco entries are
// excluded entirely (no เลขแนะนำ signal existed that round to judge). Kept as a genuinely
// separate series from the Pick trend — never merged into the same line (spec requirement).
function dcRecoHitRateTrend(snapshots,rows,window=5,take=20){
  const resolved=(snapshots||[])
    .filter(s=>(s?.reco||[]).length)
    .map(s=>{
      const actual=dcActualForDate(rows,s.date);
      if(!actual)return null;
      const hit=s.reco.some(r=>dcCheckHit(r.num,actual)==='hit');
      return {date:s.date,status:hit?'hit':'miss'};
    })
    .filter(Boolean)
    .sort((a,b)=>a.date.localeCompare(b.date));
  return dcRollingRate(resolved,window,take);
}

function dcRecoExplainText(candidate){
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
      <div class="dc-reco-more-row">${rest.map(c=>`<span class="dc-reco-more-chip" title="${escHtml(dcRecoExplainText(c))}${c.trust==='ทดลอง'?' (ทดลอง)':''}">${escHtml(c.num)}</span>`).join('')}</div>
    </details>`:'';
  return `<div class="dc-reco-card has-num">
    <div class="dc-reco-field-label">${escHtml(label)}</div>
    <div class="dc-reco-num">${escHtml(top.num)}${dcTrustBadge(top.trust)}</div>
    <div class="dc-reco-explain">${escHtml(dcRecoExplainText(top))}</div>
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
        <div class="dc-reco-title">Formula consensus</div>
        <div class="dc-reco-kicker">สูตรที่เห็นตรงกันข้ามกลุ่ม · แยกจาก Combined Pick</div>
      </div>
      ${dcRecoCoverageBadgeHtml(reco)}
    </div>
    <div class="dc-reco-grid">${cards}</div>
  </div>`;
}

// #1 เลขแนะนำ across ALL field types (ISSUE-12) — each field's top candidate competes under
// the same ranking rule used within a field: more agreeing groups wins, tie-break by combined
// Edge. Returns {field,label,num,groups,combinedEdge} or null when nothing qualifies.
function dcRecoTopOverall(reco){
  let best=null;
  DC_RECO_FIELDS.forEach(([field,label])=>{
    const top=(reco?.[field]||[])[0];
    if(!top)return;
    // Full comparator identical to the within-field rule (dcRecommendedNumbers): group count
    // desc → combined Edge desc → num asc, so a complete tie resolves deterministically by
    // number rather than by DC_RECO_FIELDS ordering.
    if(!best
      ||top.groups.length>best.groups.length
      ||(top.groups.length===best.groups.length&&top.combinedEdge>best.combinedEdge)
      ||(top.groups.length===best.groups.length&&top.combinedEdge===best.combinedEdge&&top.num.localeCompare(best.num)<0)){
      best={field,label,num:top.num,groups:top.groups,combinedEdge:top.combinedEdge,trust:top.trust||null};
    }
  });
  return best;
}

// Comparison strip (ISSUE-12): this round's #1 เลขแนะนำ side by side with the #1 Pick from
// the existing คะแนนจัดอันดับ Score list. Reads only already-computed results — no new
// fetch, no touch of dcBuildScoreRows. Visually distinguishes agree (same number) vs differ.
function dcRecoCompareStripHtml(topReco,bestPick){
  if(!topReco&&!bestPick)return '';
  const agree=!!(topReco&&bestPick&&topReco.num===String(bestPick.num||''));
  const verdict=agree
    ?'<span class="dc-status good">สองสัญญาณชี้เลขเดียวกัน</span>'
    :'<span class="dc-status warn">สองสัญญาณชี้คนละเลข</span>';
  const recoSide=topReco
    ?`<div class="dc-compare-num">${escHtml(topReco.num)}${dcTrustBadge(topReco.trust)}</div><div class="dc-compare-sub">${escHtml(topReco.label)} · ${escHtml(dcRecoExplainText(topReco))}</div>`
    :'<div class="dc-compare-empty">ไม่มีเลขแนะนำงวดนี้</div>';
  const pickSide=bestPick&&bestPick.num
    ?`<div class="dc-compare-num">${escHtml(bestPick.num)}${dcTrustBadge(bestPick.trust)}</div><div class="dc-compare-sub">คะแนนจัดอันดับ ${bestPick.score}/100</div>`
    :'<div class="dc-compare-empty">ไม่มี Pick ผ่านเกณฑ์งวดนี้</div>';
  return `<section class="dc-compare-strip ${agree?'agree':''}" aria-label="เปรียบเทียบ Combined Pick กับ Formula consensus">
    <h2 class="sr-only">เปรียบเทียบ Combined Pick กับ Formula consensus</h2>
    <div class="dc-compare-col"><h3 class="dc-compare-label">Combined Pick · อันดับ 1</h3>${pickSide}</div>
    <div class="dc-compare-mid">${agree?'=':'≠'}<div>${verdict}</div></div>
    <div class="dc-compare-col"><h3 class="dc-compare-label">Formula consensus · อันดับ 1</h3>${recoSide}</div>
  </section>`;
}

// เลขแนะนำ Edge card — its own labelled metric, never merged into a formula Edge or the
// คะแนนจัดอันดับ Score. Shows, per field type: producing-group count, how many resolved
// rounds it was shown in, its unconditional hit rate, its own group-count-aware baseline,
// and Edge = hitRate − baseline.
function dcRecoEdgeCardHtml(edgeRows){
  const anyResolved=(edgeRows||[]).some(r=>r.totalResolved>0);
  if(!anyResolved){
    return `<div class="dc-card dc-card-wide">
      <h2 class="dc-label">เลขแนะนำ · Edge (จาก Track Record)</h2>
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
    <h2 class="dc-label">เลขแนะนำ · Edge (จาก Track Record · ${total} งวดที่มีผล)</h2>
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
  const requestId=++LotteryUiState.decision.loadRequestId;
  const root=document.getElementById('dc-root');
  if(!root)return;
  root.className='dc-loading';
  root.textContent='กำลังรวมสัญญาณงวดนี้...';
  setPageStatus('decision-status','กำลังรวมสัญญาณงวดนี้...');
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
      api('summary',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true}),
      api(`predict/all?top_n=10&date=${next}&beam_width=500&k_back=100&preset=optimized`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true}),
      api('prize-history?n=260',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true})
    ]);
    if(requestId!==LotteryUiState.decision.loadRequestId)return;
    const failure=[summary,pred,hist].some(data=>!data||data.ok===false||data.error);
    const partial=pred.report_status==='partial'||Object.values(pred.categories||{}).some(category=>category.error);
    if(failure||partial||!summary.latest?.prize1||!Array.isArray(hist.data)||!hist.data.length||!Object.keys(pred.categories||{}).length){
      LotteryUiState.decision.lastSnapshot=null;
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

    LotteryServerData.decision.history=hist.data||[];
    LotteryUiState.decision.lastSnapshot={
      date:next,
      mode,
      picks:scored.picks.map(x=>({num:x.num,score:x.score,type:x.type,explain:dcExplainPick(x)})),
      pattern:scored.all.filter(x=>(x.sources||[]).some(s=>String(s).includes('Pattern Link'))).slice(0,5).map(x=>({num:x.num,score:x.score})),
      reco:recoTops,
      matches:formulaMatches.length,
      provenance:typeof buildReportProvenance==='function'?buildReportProvenance('decision-center',next,{mode},{source:'loaded_history',history_cutoff:LotteryReports.latestEligibleDate(hist.data,next)}):null
    };
    dcAutoSaveSnapshot(LotteryUiState.decision.lastSnapshot);
    const resolvedSamples=new Set(dcSnapshots().filter(s=>dcActualForDate(LotteryServerData.decision.history,s.date)).map(s=>s.date)).size;
    const lottoBoardHtml=dcLottoSummaryBoard({next,scored,formulaMatches,btRows,p1,bottom,front,cats,mode,support,resolvedSamples});
    const recoEdgeHtml=dcRecoEdgeCardHtml(dcRecoEdgeRows(dcSnapshots(),LotteryServerData.decision.history));
    // ISSUE-12: comparison strip — reads only already-computed results (recoObj + scored).
    const compareHtml=dcRecoCompareStripHtml(dcRecoTopOverall(recoObj),scored.picks[0]||scored.all[0]||null);
    const trend=dcHitRateTrend(dcSnapshots(),LotteryServerData.decision.history,5,20);
    const trendHtml=trend.length
      ?`<div style="height:180px"><canvas id="dc-trend-chart" role="img" aria-label="กราฟแนวโน้มอัตราถูกของ Decision Center"></canvas></div>`
      :'<div class="dash-empty">ยังไม่มีงวดที่มีผลจริงพอจะคำนวณแนวโน้ม — auto-save จะสะสมทุกครั้งที่เปิดหน้านี้</div>';
    // ISSUE-11: เลขแนะนำ's own trend chart — a genuinely separate canvas from the Pick trend
    // (its date axis differs: rounds without a เลขแนะนำ are excluded, not counted as misses).
    const recoTrend=dcRecoHitRateTrend(dcSnapshots(),LotteryServerData.decision.history,5,20);
    const recoTrendHtml=recoTrend.length
      ?`<div style="height:180px"><canvas id="dc-reco-trend-chart" role="img" aria-label="กราฟแนวโน้มอัตราถูกของเลขแนะนำ"></canvas></div>`
      :'<div class="dash-empty">ยังไม่มีงวดที่มีผลจริงพร้อมเลขแนะนำ — สะสมจาก auto-save เพื่อเทียบกับ Pick ได้ตรงๆ</div>';
    root.className='';
    root.innerHTML=`${lottoBoardHtml}
    ${compareHtml}
    ${recoHtml}
    <div class="dc-grid">${recoEdgeHtml}</div>
    <div class="dc-grid">
      <section class="dc-card dc-card-wide"><h2 class="dc-label">Snapshot + Track Record</h2><div class="dc-signal-sub" style="margin-bottom:8px">บันทึก Snapshot แรกของแต่ละงวดอัตโนมัติในเบราว์เซอร์ · &quot;ถูก&quot; = มีเลขอย่างน้อย 1 ตัวในชุดที่ตรงผลจริง</div><div id="dc-snapshot-list" class="dc-row">${dcSnapshotTrackHtml(LotteryServerData.decision.history)}</div></section>
      <section class="dc-card dc-card-wide"><h2 class="dc-label">แนวโน้มอัตราถูก (20 งวดล่าสุดที่มีผล · rolling 5 งวด)</h2>${trendHtml}</section>
      <section class="dc-card dc-card-wide"><h2 class="dc-label">แนวโน้มอัตราถูกของเลขแนะนำ (20 งวดล่าสุดที่มีผล · rolling 5 งวด)</h2><div class="dc-signal-sub" style="margin-bottom:8px">นับเฉพาะงวดที่มีเลขแนะนำ · ถูก = เลขแนะนำอย่างน้อย 1 ตัวตรงผลจริง · แยกจากกราฟ Pick ด้านบนเพื่อเทียบกันตรงๆ</div>${recoTrendHtml}</section>
    </div>
    <div id="dc-backtest-panel"></div>
    <div class="dc-panel">
      <h2 class="dc-label">Data Health</h2>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">ผลงวดล่าสุด</div><div class="dc-signal-sub">${latest.date||'-'} · ${latest.prize1||'-'}</div></div><span class="dc-status ${healthStatus}">${healthText}</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">จำนวนงวดในระบบ</div><div class="dc-signal-sub">${summary.total_draws||summary.total||'-'} งวด</div></div><span class="dc-status good">DATA</span></div>
      <div class="dc-signal"><div class="dc-signal-main"><div class="dc-signal-title">สูตรคำนวณ</div><div class="dc-signal-sub">กดเปิดสูตรเพื่อ refresh Formula Final Picks</div></div><span class="dc-status warn">optional</span></div>
    </div>
    <div class="dc-grid">
      <section class="dc-card dc-card-wide"><h2 class="dc-label">Predict × สูตรคำนวณ ตรงกัน</h2><div class="dc-row">${formulaMatchHtml}</div></section>
      <section class="dc-card dc-card-wide"><h2 class="dc-label">สัญญาณจากรางวัลรอง 10 งวดล่าสุด</h2>${dcSecondarySignalsHtml(secondarySignals)}</section>
      <section class="dc-card"><h2 class="dc-label">ตัดเลขเสี่ยง</h2><div class="dc-row">${dcRiskHtml(scored.risks)}</div></section>
    </div>`;
    setPageStatus('decision-status','สรุปงวดนี้พร้อมแล้ว');
    if(trend.length){
      const opts=chartOpts('% ถูก');
      opts.scales.y.min=0;opts.scales.y.max=100;
      mkChart('dc-trend-chart',{type:'line',data:{
        labels:trend.map(t=>fmtDate(t.date)),
        datasets:[{label:'% ถูก (rolling 5 งวด)',data:trend.map(t=>t.value),themeColor:'--green-text',themeFill:'--green-soft',tension:.3,fill:true,pointRadius:2}]
      },options:opts});
    }
    if(recoTrend.length){
      const opts=chartOpts('% ถูก');
      opts.scales.y.min=0;opts.scales.y.max=100;
      mkChart('dc-reco-trend-chart',{type:'line',data:{
        labels:recoTrend.map(t=>fmtDate(t.date)),
        datasets:[{label:'เลขแนะนำ % ถูก (rolling 5 งวด)',data:recoTrend.map(t=>t.value),themeColor:'--blue',themeFill:'--gold-soft',tension:.3,fill:true,pointRadius:2}]
      },options:opts});
    }
  }catch(e){
    if(requestId!==LotteryUiState.decision.loadRequestId)return;
    LotteryUiState.decision.lastSnapshot=null;
    root.className='dc-loading';
    root.textContent='ข้อมูลสรุปงวดนี้ไม่ครบหรือโหลดไม่สำเร็จ · ยังไม่บันทึก · กดคำนวณเพื่อลองใหม่';
    setPageStatus(root.id==='dc-root-old'?'oldver-status':'decision-status',root.textContent);
  }
}

