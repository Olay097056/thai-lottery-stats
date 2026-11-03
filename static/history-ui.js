// ─── History ──────────────────────────────────────────────────────────────────
function _renderBtTable(){
  if(!LotteryServerData.formula.backtestRows.length){
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" style="display:block">ยังไม่มีผล Backtest สำหรับชุดข้อมูลนี้</div>';
    return;
  }
  const sorted=[...LotteryServerData.formula.backtestRows].sort((a,b)=>{
    let av=a[LotteryUiState.formula.sortKey],bv=b[LotteryUiState.formula.sortKey];
    if(typeof av==='string')return LotteryUiState.formula.sortAsc?av.localeCompare(bv):bv.localeCompare(av);
    if(av==null)av=-1;if(bv==null)bv=-1;
    return LotteryUiState.formula.sortAsc?av-bv:bv-av;
  });
  const arr=k=>k===LotteryUiState.formula.sortKey?(LotteryUiState.formula.sortAsc?' ▲':' ▼'):' ⇅';
  const th=(label,key,align)=>{
    const ariaSort=key===LotteryUiState.formula.sortKey?(LotteryUiState.formula.sortAsc?'ascending':'descending'):'none';
    return `<th scope="col" aria-sort="${ariaSort}" style="white-space:nowrap${align?';text-align:'+align:''}"><button type="button" class="bt-sort-btn" onclick="btSort('${key}')">${label}<span aria-hidden="true">${arr(key)}</span></button></th>`;
  };
  const typeColor=t=>t.includes('หน่วย')?'rgba(240,84,84,.18);color:var(--red-text)':t.includes('วิ่ง')?'rgba(168,85,247,.18);color:var(--purple)':'var(--surface2);color:var(--text2)';
  const rollingHtml=r=>[50,100,200].map(w=>{
    const rw=r.rolling?.[w];
    if(!rw||!rw.total)return `<span style="color:var(--text3)">W${w}: -</span>`;
    if(!Number.isFinite(rw.edge))return `<span style="color:var(--text3)">W${w}: —</span>`;
    const c=rw.edge>3?'var(--green-text)':rw.edge<-5?'var(--red-text)':'var(--text3)';
    const precision=r.field==='prize1_exact'?4:1;
    return `<span style="white-space:nowrap;color:${c}">W${w}: ${rw.edge>=0?'+':''}${rw.edge.toFixed(precision)} pp</span>`;
  }).join('<br>');
  const rowHtml=r=>{
    const hasSample=Number.isFinite(r.pct)&&Number.isFinite(r.edge);
    const precision=r.field==='prize1_exact'?4:1;
    const ec=hasSample?(r.edge>3?'var(--green-text)':r.edge<-3?'var(--red-text)':'var(--text2)'):'var(--text3)';
    const pc=hasSample?(r.edge>3?'var(--green-text)':r.edge<-3?'var(--red-text)':'var(--text)'):'var(--text3)';
    const badge=!hasSample?'—':r.degraded?'⚠ ต่ำกว่าสุ่ม':r.edge>5?'★':r.edge>0?'✓':r.edge<-5?'×':'~';
    const bc=!hasSample?'var(--text3)':r.degraded?'var(--red-text)':r.edge>0?'var(--green-text)':r.edge<-5?'var(--red-text)':'var(--text3)';
    const tc=typeColor(r.typeLabel||'');
    const sample=r.total>0&&r.total<50?`<span style="color:var(--red-text);font-size:.78rem;margin-left:6px">low n</span>`:'';
    const trustHtml=r.trust?`<span class="trust-badge">${r.trust}</span>`:'';
    return `<tr>
      <td><span style="background:${r.groupColor}22;color:${r.groupColor};padding:1px 7px;border-radius:4px;font-size:.78rem;white-space:nowrap;font-weight:600;margin-right:5px">${r.group}</span>${r.name}${trustHtml}${sample}</td>
      <td><span style="background:${tc};padding:1px 6px;border-radius:3px;font-size:.78rem;white-space:nowrap">${r.typeLabel}</span></td>
      <td style="text-align:right">${r.total}</td>
      <td style="text-align:right;font-weight:700;color:${pc}">${r.hits}</td>
      <td style="text-align:right;font-weight:700;color:${pc}">${r.pct==null?'—':`${r.pct.toFixed(precision)}%`}</td>
      <td style="text-align:right;font-size:.8rem;color:var(--text3)">${r.ciLow==null||r.ciHigh==null?'—':`${r.ciLow.toFixed(precision)}-${r.ciHigh.toFixed(precision)}%`}</td>
      <td style="text-align:right;font-size:.8rem;color:var(--text3)">${r.baseP==null?'—':`${r.baseLabel} = ${r.baseP.toFixed(precision)}%`}</td>
      <td style="text-align:right;font-weight:700;color:${ec}">${r.edge==null?'—':`${r.edge>=0?'+':''}${r.edge.toFixed(precision)} pp`}</td>
      <td style="text-align:right;font-size:.78rem;line-height:1.35">${rollingHtml(r)}</td>
      <td style="text-align:right;font-size:.8rem;color:${r.subPct!=null&&r.subPct>0?'var(--blue)':'var(--text3)'}" title="ตรงเลขท้ายของ ข้างเคียงร.1 / รางวัลที่ 2 / รางวัลที่ 3 (ข้อมูล Sanook, นับแยกจาก Hit หลัก)">${r.subPct!=null?`${r.subHits}/${r.subTotal} (${r.subPct.toFixed(0)}%)`:'-'}</td>
      <td style="text-align:center;font-weight:700;color:${bc};white-space:nowrap">${badge}</td>
    </tr>`;
  };
  const thead=`<thead><tr>${th('สูตร','name')}${th('เป้าหมาย','typeLabel')}${th('งวด','total','right')}${th('ถูก','hits','right')}${th('อัตราถูก','pct','right')}<th style="text-align:right;white-space:nowrap">95% CI</th>${th('ฐานสุ่ม','baseP','right')}${th('Edge','edge','right')}<th style="text-align:right;white-space:nowrap">Rolling edge</th>${th('ถูกรอง','subPct','right')}<th style="text-align:center">สถานะ</th></tr></thead>`;
  
  const boardOrder=['รางวัลที่ 1 · ตรง 6 หลัก','2-digit exact','3-digit exact','Run / digit','Prize1 tail','Pool 1-5','Pool 1-4','Other'];
  const boardTables=boardOrder.map((board,boardIndex)=>{
    const rows=sorted.filter(r=>r.board===board);
    if(!rows.length)return '';
    const scored=rows.filter(r=>Number.isFinite(r.edge)&&Number.isFinite(r.pct));
    const bestEdge=scored.length?[...scored].sort((a,b)=>b.edge-a.edge)[0]:null;
    const bestHit=scored.length?[...scored].sort((a,b)=>b.pct-a.pct)[0]:null;
    const mini=board==='รางวัลที่ 1 · ตรง 6 หลัก'
      ?`<div class="astra-warnings" role="note" style="margin-bottom:10px">เลขที่ทาย 5 ชุดมีโอกาสสุ่มถูกรางวัลที่ 1 เพียง 5/1,000,000 = 0.0005% ต่องวด · ช่วงความเชื่อมั่นใช้ Wilson score เพื่อไม่ให้ 0 hit แสดงเป็นไม่มีความไม่แน่นอน · Backtest สูงสุด 200 งวดยังไม่พอจะบอกว่าสูตรใดเหนือกว่าสุ่ม · การครอบคลุม 2 ลูกจาก Lotto อังกฤษใช้กับรางวัลที่ 1 ไทยไม่ได้</div>`
      :`<div class="formula-summary-bar active" style="margin-bottom:10px">
      <div class="formula-summary-item"><div class="formula-summary-label">สูตรในกลุ่ม</div><div class="formula-summary-value">${rows.length}</div><div class="formula-summary-sub">${board}</div></div>
      <div class="formula-summary-item"><div class="formula-summary-label">Edge สูงสุดในกลุ่ม</div><div class="formula-summary-value">${bestEdge?`${bestEdge.edge>=0?'+':''}${bestEdge.edge.toFixed(1)} pp`:'—'}</div><div class="formula-summary-sub">${bestEdge?bestEdge.name:'ไม่มีข้อมูลครบ'}</div></div>
      <div class="formula-summary-item"><div class="formula-summary-label">อัตราถูกสูงสุดในกลุ่ม</div><div class="formula-summary-value">${bestHit?`${bestHit.pct.toFixed(1)}%`:'—'}</div><div class="formula-summary-sub">${bestHit?bestHit.name:'ไม่มีข้อมูลครบ'}</div></div>
    </div>`;
    return `<div class="bt-board" id="bt-board-${boardIndex}">
      <h2 class="section-h">${board}</h2>
      ${mini}
      <div class="tbl-wrap" tabindex="0" role="region" aria-label="ตาราง Backtest ${escHtml(board)} เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม"><table><caption class="sr-only">ผล Backtest ${escHtml(board)}</caption>${thead}<tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
    </div>`;
  }).join('');
  document.getElementById('formula-bt-table').innerHTML=`
    <div class="card bt-report">
      <header class="bt-report-header"><h2>ผล Backtest · ${LotteryServerData.formula.testedDraws} งวด</h2><p>เปรียบเทียบแยกตามเป้าหมาย · อัตราถูกข้ามกลุ่มใช้จัดอันดับสูตรร่วมกันไม่ได้</p></header>
      <details class="bt-explainer"><summary>วิธีอ่าน Edge และความไม่แน่นอน</summary><div class="bt-legend">
        <span><b>Edge</b> = อัตราถูก ลบ ฐานสุ่ม (หน่วย: จุดเปอร์เซ็นต์)</span>
        <span><b>95% CI</b> แสดงความไม่แน่นอน · งวดน้อยยังสรุปความแม่นไม่ได้</span>
        <span style="color:var(--green-text)">★ Edge&gt;5%</span>
        <span style="color:var(--green-text)">✓ Edge&gt;0%</span>
        <span style="color:var(--text3)">~ near random</span>
        <span style="color:var(--red-text)">× below random</span>
        <span style="color:var(--red-text)">⚠ ต่ำกว่าสุ่ม = W200 edge &lt; -5%</span>
      </div></details>
      ${typeof _formulaMappingBannerHtml==='function'?_formulaMappingBannerHtml(LotteryServerData.formula.backtestFieldCheck):''}
      ${LotteryServerData.formula.backtestNotice?`<div class="astra-warnings" role="note">${LotteryServerData.formula.backtestPartial?'<strong>ผลบางส่วน</strong> · ':''}${_formulaEsc(LotteryServerData.formula.backtestNotice)}${LotteryServerData.formula.backtestPartial?`<div>${LotteryServerData.formula.backtestRetryable?'โหลดบางวิธีไม่สำเร็จ · ดูขั้นตอนที่ล้มเหลวด้านบนแล้วกด “ลอง Backtest อีกครั้ง”':'โหลดบางวิธีไม่สำเร็จ · ตารางนี้อาจไม่มีผลของสูตรที่ระบุว่าโหลดไม่สำเร็จ'}</div>`:''}</div>`:''}
      
      <nav class="bt-board-nav" aria-label="ข้ามไปยังกลุ่มเป้าหมาย">${boardOrder.map((board,index)=>sorted.some(row=>row.board===board)?`<a href="#bt-board-${index}">${escHtml(board)}</a>`:'').join('')}</nav>
      ${boardTables}
      ${typeof _renderPool14Comparison==='function'?_renderPool14Comparison(sorted):''}
    </div>`;
}

async function loadHistory(){
  const requestId=++LotteryUiState.history.loadRequestId;
  const n=document.getElementById('hist-n').value;
  LotteryUiState.history.loadPending=true;
  LotteryUiState.history.loadError=false;
  LotteryServerData.history.rows=[];
  filterHistory();
  const d=await api(`history?n=${n}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
  if(requestId!==LotteryUiState.history.loadRequestId)return;
  LotteryUiState.history.loadPending=false;
  const resultFields=['prize1','top3','top2','front3_1','front3_2','back3_1','back3_2','bottom2'];
  const isValidHistoryRow=row=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&typeof row.date==='string'&&resultFields.every(field=>row[field]==null||typeof row[field]==='string');
  LotteryUiState.history.loadError=!!d?.error||!Array.isArray(d?.data)||!d.data.every(isValidHistoryRow);
  LotteryServerData.history.rows=LotteryUiState.history.loadError?[]:d.data;
  filterHistory();
}
function filterHistory(){
  const tbody=document.getElementById('hist-tbody');
  const statusEl=document.getElementById('hist-status');
  const announceStatus=(message,debounced=false)=>{
    if(LotteryUiState.history.statusTimer!==null){clearTimeout(LotteryUiState.history.statusTimer);LotteryUiState.history.statusTimer=null;}
    const announcementId=++LotteryUiState.history.statusAnnouncementId;
    if(!statusEl)return;
    if(debounced){
      const requestId=LotteryUiState.history.loadRequestId;
      let timerId;
      timerId=setTimeout(()=>{
        if(LotteryUiState.history.statusTimer===timerId)LotteryUiState.history.statusTimer=null;
        if(announcementId===LotteryUiState.history.statusAnnouncementId&&!LotteryUiState.history.loadPending&&requestId===LotteryUiState.history.loadRequestId)statusEl.textContent=message;
      },250);
      LotteryUiState.history.statusTimer=timerId;
    }else statusEl.textContent=message;
  };
  if(LotteryUiState.history.loadPending){
    announceStatus('กำลังโหลดผลย้อนหลัง...');
    tbody.innerHTML='<tr><td colspan="9"><div class="predict-empty">กำลังโหลดผลย้อนหลัง...</div></td></tr>';
    return;
  }
  const q=document.getElementById('hist-search').value.trim().toLowerCase();
  const rows=q?LotteryServerData.history.rows.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(q))):LotteryServerData.history.rows;
  if(LotteryUiState.history.loadError){
    announceStatus('โหลดผลย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง');
    tbody.innerHTML='<tr><td colspan="9"><div class="predict-empty">โหลดผลย้อนหลังไม่สำเร็จ<button type="button" class="btn btn-secondary retry-inline" onclick="loadHistory()">ลองอีกครั้ง</button></div></td></tr>';
    return;
  }
  if(!rows.length){
    announceStatus('ไม่พบผลย้อนหลัง',!!q);
    tbody.innerHTML='<tr><td colspan="9"><div class="predict-empty">ไม่พบผลย้อนหลัง</div></td></tr>';
    return;
  }
  announceStatus(`แสดงผลย้อนหลัง ${rows.length} รายการ`,!!q);
  tbody.innerHTML=rows.map(r=>`<tr>
    <td>${escHtml(r.date||'')}</td><td><b style="font-family:'IBM Plex Mono',monospace;color:var(--gold2)">${escHtml(r.prize1||'')}</b></td>
    <td>${escHtml(r.top3||'')}</td><td>${escHtml(r.top2||'')}</td><td>${escHtml(r.front3_1||'')}</td>
    <td>${escHtml(r.front3_2||'')}</td><td>${escHtml(r.back3_1||'')}</td><td>${escHtml(r.back3_2||'')}</td><td>${escHtml(r.bottom2||'')}</td>
  </tr>`).join('');
}

// ─── Backtest ─────────────────────────────────────────────────────────────────
async function loadBacktest(){
  const n=document.getElementById('bt-n').value;
  const topn=document.getElementById('bt-topn').value;
  const preset=document.getElementById('bt-preset')?.value||'optimized';
  const beam=document.getElementById('bt-beam')?.value||500;
  const kback=document.getElementById('bt-kback')?.value||100;
  setPageStatus('backtest-status','กำลังรัน Backtest...');
  document.getElementById('bt-loading').style.display='block';
  document.getElementById('bt-results').style.display='none';
  const d=await api(`backtest?n_draws=${n}&top_n=${topn}&beam_width=${beam}&k_back=${kback}&preset=${preset}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
  document.getElementById('bt-loading').style.display='none';
  if(!d||d.error){
    const message=d?.error?'Backtest ไม่สำเร็จ ลองใหม่อีกครั้ง':'Backtest ไม่คืนข้อมูลที่ใช้ได้';
    setPageStatus('backtest-status',message);
    toast(d?.error?'error: '+d.error:message,'error',{announce:false});
    return;
  }
  document.getElementById('bt-results').style.display='block';
  const pct=v=>v!=null?(v*100).toFixed(2)+'%':'—';
  const lx=v=>v!=null?v.toFixed(2)+'x':'—';
  const liftColor=v=>v>=2?'var(--green-text)':v>=1.2?'var(--orange-text)':'var(--red-text)';
  document.getElementById('bt-metrics').innerHTML=`
    <div class="card">
      <h2 class="card-title">🎯 Front3 Hit Rate (Top-${topn})</h2>
      <div class="stat-val">${pct(d.front3_rate)}</div>
      <div class="stat-sub" style="color:${liftColor(d.front3_lift||0)}">Lift ${lx(d.front3_lift)} vs สุ่ม ${pct(d.front3_random)}</div>
    </div>
    <div class="card">
      <h2 class="card-title">🎯 Back3 Hit Rate (Top-${topn})</h2>
      <div class="stat-val">${pct(d.back3_rate)}</div>
      <div class="stat-sub" style="color:${liftColor(d.back3_lift||0)}">Lift ${lx(d.back3_lift)} vs สุ่ม ${pct(d.back3_random)}</div>
    </div>
    <div class="card">
      <h2 class="card-title">🏆 Prize1 Combined (Top-${topn})</h2>
      <div class="stat-val">${d.hits||0} hits</div>
      <div class="stat-sub" style="color:${liftColor(d.lift||0)}">Lift ${lx(d.lift)} | ${pct(d.rate)} vs สุ่ม ${pct(d.random_rate)}</div>
    </div>
    <div class="card">
      <h2 class="card-title">📊 งวดทดสอบ</h2>
      <div class="stat-val">${d.n_tested||n}</div>
      <div class="stat-sub">${d.preset_label||preset} | beam=${d.beam_width||500} k_back=${d.k_back||100} ${d.errors?'❌ '+d.errors+' err':''}</div>
    </div>
    <div class="card">
      <h2 class="card-title">Pairing Diagnostics</h2>
      <div class="stat-val">${d.paired_halves_available||0}</div>
      <div class="stat-sub">both halves present | F rank ${d.avg_front3_hit_rank??'—'} | B rank ${d.avg_back3_hit_rank??'—'}</div>
    </div>`;
  mkChart('bt-lift-chart',{type:'bar',
    data:{labels:['Front3 Lift','Back3 Lift','Combined Lift','Random (1x)'],datasets:[
      {label:'Lift vs Random',
       data:[+(d.front3_lift||0).toFixed(3),+(d.back3_lift||0).toFixed(3),+(d.lift||0).toFixed(3),1],
       backgroundColor:['--green-text','--blue','--gold','--text3'].map(token=>getComputedStyle(document.documentElement).getPropertyValue(token).trim()),
       borderWidth:0}
    ]},
    options:{...chartOpts('x',true),scales:{y:{min:0,ticks:{callback:v=>v+'x'}}}}});
  setPageStatus('backtest-status',`Backtest เสร็จแล้ว ${d.n_tested??n} งวด`);
}
