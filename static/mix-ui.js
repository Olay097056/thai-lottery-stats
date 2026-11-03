function syncMixTargetDate(date){
  const dateEl=document.getElementById('mix-date');
  if(!dateEl||!date)return false;
  if(!dateEl.options.length){
    dateEl.innerHTML=clientDraws().map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
  }
  if(![...dateEl.options].some(option=>option.value===date)){
    const option=document.createElement('option');
    option.value=date;
    option.textContent=typeof fmtDate==='function'?fmtDate(date):date;
    dateEl.appendChild(option);
  }
  dateEl.value=date;
  return dateEl.value===date;
}

function markMixDataStale(message){
  const root=document.getElementById('mix-root');
  const state=LotteryUiState.mix;
  if(!root||(!LotteryServerData.mix.predictions.length&&!LotteryServerData.mix.history.length&&root.dataset.state!=='loading'))return;
  state.sourceStale=true;
  state.loadRequestId++;
  root.setAttribute('aria-busy','false');
  if(root.dataset.state==='loading'){
    root.className='';root.dataset.state='stale';
    root.textContent='การคำนวณเริ่มก่อนอัปเดตข้อมูลและถูกยกเลิก · ผสมเลขใหม่เพื่อใช้แคชปัจจุบัน';
  }
  root.querySelectorAll?.('button[onclick="mixRandomPick()"],button[onclick="bpFromMix()"]')
    .forEach(button=>{button.disabled=true;button.title='ผล Mix ใช้ข้อมูลก่อนรีเฟรช · คำนวณใหม่ก่อนใช้ผลนี้';});
  showCacheRefreshNotice('mix-data-refresh-notice','mix-root','ผล Mix ใช้ข้อมูลก่อนรีเฟรช',
    `${message} · กดผสมเลขใหม่เพื่อคำนวณและตรวจแหล่งข้อมูลอีกครั้ง`,'ผสมเลขใหม่',()=>loadMixPage());
  setPageStatus('mix-status',`${message} · ผล Mix ยังไม่อัปเดต`);
}
window.markMixDataStale=markMixDataStale;

async function loadMixPage(){
  const root=document.getElementById('mix-root');
  if(!root)return;
  LotteryUiState.mix.sourceStale=false;
  clearCacheRefreshNotice('mix-data-refresh-notice');
  const requestId=++LotteryUiState.mix.loadRequestId;
  root.className='dc-loading';
  root.textContent='กำลังผสมเลขจากทุกสูตร...';
  root.dataset.state='loading';
  root.setAttribute('aria-busy','true');
  LotteryServerData.mix.history=[];
  LotteryServerData.mix.predictions=[];
  setPageStatus('mix-status','กำลังผสมเลขจากทุกสูตร...');
  const dateEl=document.getElementById('mix-date');
  if(dateEl&&!dateEl.options.length){
    dateEl.innerHTML=clientDraws().map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
  }
  const next=dateEl?.value||nextDrawInfo().iso;
  try{
    const hist=await api('prize-history?n=260',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(requestId!==LotteryUiState.mix.loadRequestId)return;
    if(hist?.error||hist?.ok===false||!Array.isArray(hist?.data))throw new Error('history unavailable');
    const rows=hist.data.filter(Boolean);
    if(!rows.length){
      root.className='';root.dataset.state='empty';root.setAttribute('aria-busy','false');
      root.innerHTML='<section class="card feature-state" role="status"><div class="feature-state-mark" aria-hidden="true">…</div><div><h2>ยังไม่มีข้อมูลย้อนหลังสำหรับ Mix</h2><div class="feature-state-date">งวดเป้าหมาย '+escHtml(fmtDate(next))+'</div><p>ไม่พบผลรางวัลในข้อมูลที่โหลดมา จึงยังผสมเลขให้ไม่ได้</p><button type="button" class="btn" onclick="loadMixPage()">↻ ลองโหลดอีกครั้ง</button></div></section>';
      setPageStatus('mix-status','ไม่พบข้อมูลรางวัลย้อนหลังสำหรับ Mix · ลองโหลดอีกครั้ง');
      return;
    }
    if(typeof _mixCompute!=='function')throw new Error('mix calculator unavailable');
    const frs=dcComputeFormulaResults(rows,next);
    const mix=_mixCompute(frs);
    if(!mix||!mix.preds.length){
      root.className='';root.dataset.state='empty';root.setAttribute('aria-busy','false');
      root.innerHTML='<section class="card feature-state" role="status"><div class="feature-state-mark" aria-hidden="true">…</div><div><h2>ยังผสมเลขงวดนี้ไม่ได้</h2><div class="feature-state-date">งวดเป้าหมาย '+escHtml(fmtDate(next))+'</div><p>ข้อมูลที่มีไม่พอสำหรับสร้างชุด Mix · ลองโหลดใหม่หลังตรวจข้อมูลย้อนหลัง</p><button type="button" class="btn" onclick="loadMixPage()">↻ ลองอีกครั้ง</button></div></section>';
      setPageStatus('mix-status','ข้อมูลที่มีไม่พอสำหรับสร้างชุด Mix · ลองโหลดอีกครั้ง');
      return;
    }
    LotteryServerData.mix.history=rows;
    LotteryServerData.mix.predictions=mix.preds;
    const savedSnapshots=mixSnapshots();
    const priorSnapshotExists=Array.isArray(savedSnapshots)&&savedSnapshots.some(snapshot=>snapshot.date===next);
    const snapshotSaved=mixAutoSaveSnapshot({date:next,picks:mix.preds,provenance:typeof buildReportProvenance==='function'?buildReportProvenance('mix',next,{voting:'one_group_one_vote'}):null},savedSnapshots);
    const snapshotNotice=snapshotSaved===false
      ?`<div class="card" role="status">${savedSnapshots===null?'อ่านประวัติ Mix ไม่ได้ — แสดงผลการผสมได้ แต่ข้อมูลเดิมจะไม่ถูกเขียนทับ':'บันทึกประวัติ Mix ไม่สำเร็จ — แสดงผลการผสมได้ แต่ประวัติงวดนี้ยังไม่ถูกเก็บ'}</div>`
      :priorSnapshotExists
        ?'<div class="card" role="status">มีชุด Mix ที่บันทึกไว้แล้วสำหรับงวดนี้ · ผลด้านล่างคือการคำนวณปัจจุบัน ส่วนประวัติจะคงชุดแรกและไม่เขียนทับ</div>'
        :'<div class="card" role="status">บันทึกชุด Mix แรกของงวดนี้แล้ว · เปิดหน้านี้ซ้ำจะคงชุดที่บันทึกไว้ ไม่เขียนทับด้วยผลคำนวณใหม่</div>';

    const top=mix.preds[0],rest=mix.preds.slice(1);
    // ระดับฉันทามติ = ค่าเฉลี่ยต่อหลักของ (สัดส่วนกลุ่มที่โหวตเลขผู้ชนะ)
    const shares=mix.positions.map(p=>p.groupCount?p.ranked[0].groups.length/p.groupCount:0);
    const consensus=Math.round(shares.reduce((a,b)=>a+b,0)/mix.positions.length*100);
    const level=consensus>=70?'เสียงชัดมาก':consensus>=45?'เสียงค่อนข้างตรงกัน':'เสียงแตก';
    const levelCls=consensus>=70?'good':consensus>=45?'warn':'bad';

    const heroHtml=`<div class="card mix-hero">
      <h2 class="dc-label">ชุด Mix งวด ${fmtDate(next)} · สรุปเสียงจากกลุ่มสูตร</h2>
      <div class="mix-hero-num">${escHtml(top)}</div>
      <div class="dc-signal-sub">อันดับ 1 จากการโหวตรายหลักของทุกกลุ่มสูตร${mix.fallbackUsed?' · หลักหน้าใช้เสียงสำรองจากกลุ่ม I/J (งวดนี้ไม่มีเสียงหน้า 3)':''}</div>
      <div class="dc-row" style="margin-top:12px;justify-content:center">${rest.map((n,i)=>`<span class="num-badge" title="อันดับ ${i+2}">${escHtml(n)}</span>`).join('')}</div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="mixRandomPick()">🎲 สุ่ม 1 เลข · ถ่วงตามอันดับ</button>
        <button class="btn" onclick="bpFromMix()">🧾 จัดชุดซื้อจากเลขชุดนี้ →</button>
        <span id="mix-random-result"></span>
      </div>
      <div class="dc-signal-sub" style="margin-top:8px">อันดับต้นมีน้ำหนักสุ่มมากกว่าอันดับท้าย</div>
    </div>`;

    const posLabels=['หลัก 1','หลัก 2','หลัก 3','หลัก 4','หลัก 5','หลัก 6'];
    const voteCols=mix.positions.map((p,i)=>{
      const w=p.ranked[0];
      const share=p.groupCount?Math.round(w.groups.length/p.groupCount*100):0;
      const runner=p.ranked[1];
      return `<div class="mix-vote-col">
        <div class="mix-vote-poslabel">${posLabels[i]}${i<3?'<span class="mix-front-tag">ครึ่งหน้า</span>':''}</div>
        <div class="mix-digit">${escHtml(w.digit)}</div>
        <div class="dc-signal-sub">${w.groups.length}/${p.groupCount} กลุ่ม (${share}%)</div>
        <div class="mix-vote-groups">${w.groups.map(g=>`<span class="dc-source-chip">${escHtml(g)}</span>`).join('')||'<span class="dc-signal-sub">—</span>'}</div>
        ${runner&&runner.score>0?`<div class="dc-signal-sub" style="margin-top:4px">รอง: ${escHtml(runner.digit)}</div>`:''}
      </div>`;
    }).join('');
    const voteHtml=`<div class="card">
      <h2 class="dc-label">ทำไมถึงเป็นเลขนี้ — ผลโหวตรายหลัก</h2>
      <div class="dc-signal-sub" style="margin-bottom:10px">หนึ่งกลุ่มสูตร = หนึ่งเสียงต่อหลัก (ไม่ถ่วงตาม Edge) · หลัก 1-3 ฟังเฉพาะสูตรหน้า 3 (กลุ่ม D, F) · หลัก 4-6 ฟังทุกสูตรที่ทายท้ายเลข + เลขเต็มของกลุ่ม I/J</div>
      <div class="mix-vote-grid">${voteCols}</div>
    </div>`;

    const meterHtml=`<div class="card">
      <h2 class="dc-label">ระดับฉันทามติงวดนี้ <span class="dc-status ${levelCls}">${level}</span></h2>
      <div class="dc-meter" style="margin-top:10px"><div class="dc-meter-fill" style="width:${consensus}%"></div></div>
      <div class="dc-signal-sub" style="margin-top:7px">${consensus}/100 — ยิ่งสูง แปลว่าหลายกลุ่มสูตรโหวตเลขเดียวกันในแต่ละหลัก · กลุ่มสูตรอาจพึ่งข้อมูลหรือวิธีเดียวกัน เสียงตรงกันจึงไม่ใช่หลักฐานอิสระ และเปอร์เซ็นต์นี้ไม่ใช่โอกาสถูกรางวัล</div>
    </div>`;

    const cutsHtml=`<div class="card">
      <h2 class="dc-label">เลขตัดสำหรับงบน้อย <span class="dc-status warn">ตัดจากชุดใหญ่อันดับ 1 — ไม่ใช่ Pick</span></h2>
      <div class="dc-row" style="margin-top:10px">
        <span class="num-badge">2 ตัวล่าง → ${escHtml(top.slice(-2))}</span>
        <span class="num-badge">3 ตัวบน → ${escHtml(top.slice(-3))}</span>
        <span class="num-badge">หน้า 3 → ${escHtml(top.slice(0,3))}</span>
      </div>
      <div class="dc-signal-sub" style="margin-top:7px">แค่การตัดหัว/ท้ายของเลข 6 หลักอันดับ 1 ตรงๆ — ไม่ได้ผ่านการคัดกรองแบบ Pick ของหน้า สรุปงวดนี้</div>
    </div>`;

    const trend=mixHitRateTrend(mixSnapshots(),rows,5,20);
    const trendHtml=trend.length
      ?`<div style="height:180px"><canvas id="mix-trend-chart" role="img" aria-label="กราฟแนวโน้มอัตราถูกของสูตร Mix"></canvas></div>`
      :'<div class="dash-empty">ยังไม่มีงวดที่มีผลจริง — เปิดหน้านี้ทุกงวดเพื่อสะสมประวัติ</div>';
    const trackHtml=`<div class="dc-grid">
      <div class="dc-card dc-card-wide"><h2 class="dc-label">Track Record รวมรางวัลที่ 1–5 (ไม่ใช่ความแม่นรางวัลที่ 1)</h2><div class="dc-signal-sub" style="margin-bottom:8px">บันทึกผลครั้งแรกของแต่ละงวดอัตโนมัติ · เปิดซ้ำจะเก็บชุดเดิมและไม่เขียนทับ · "ถูก" = อย่างน้อย 1 ใน 10 ชุดตรงกับเลขใดก็ได้ใน pool รางวัลที่ 1-5 (~168 ใบ) ของงวดนั้น</div><div id="mix-track-list" class="dc-row">${mixTrackHtml(rows)}</div></div>
      <div class="dc-card dc-card-wide"><h2 class="dc-label">แนวโน้มถูก Pool 1–5 (rolling 5 งวด)</h2>${trendHtml}</div>
    </div>`;

    root.className='';
    root.dataset.state='ready';root.setAttribute('aria-busy','false');
    root.innerHTML=snapshotNotice+heroHtml+voteHtml+`<div class="mix-two-col">${meterHtml}${cutsHtml}</div>`+trackHtml;
    if(trend.length){
      const opts=chartOpts('% ถูก');
      opts.scales.y.min=0;opts.scales.y.max=100;
      mkChart('mix-trend-chart',{type:'line',data:{
        labels:trend.map(t=>fmtDate(t.date)),
        datasets:[{label:'Mix % ถูก (rolling 5 งวด)',data:trend.map(t=>t.value),themeColor:'--blue',themeFill:'--gold-soft',tension:.3,fill:true,pointRadius:2}]
      },options:opts});
    }
    setPageStatus('mix-status',`ผสมเลขเสร็จแล้ว ${mix.preds.length} ชุด`);
  }catch(e){
    if(requestId!==LotteryUiState.mix.loadRequestId)return;
    console.warn('loadMixPage failed',e);
    LotteryServerData.mix.history=[];
    LotteryServerData.mix.predictions=[];
    root.className='';root.dataset.state='error';root.setAttribute('aria-busy','false');
    root.innerHTML='<section class="card feature-state feature-state-error" role="alert"><div class="feature-state-mark" aria-hidden="true">!</div><div><h2>โหลดข้อมูลย้อนหลังไม่สำเร็จ</h2><div class="feature-state-date">งวดเป้าหมาย '+escHtml(fmtDate(next))+'</div><p>Mix ต้องใช้ผลรางวัลย้อนหลังเพื่อคำนวณ ตรวจการเชื่อมต่อหรือข้อมูลแคช แล้วลองใหม่</p><button type="button" class="btn btn-primary" onclick="loadMixPage()">↻ ลองโหลดอีกครั้ง</button></div></section>';
    setPageStatus('mix-status','โหลดข้อมูลย้อนหลังสำหรับ Mix ไม่สำเร็จ · ลองโหลดอีกครั้ง');
  }
}
window.loadMixPage=loadMixPage;
window.mixRandomPick=mixRandomPick;
window.mixDeleteSnapshot=mixDeleteSnapshot;
window.mixClearSnapshots=mixClearSnapshots;
window.mixDownloadSnapshotBackup=mixDownloadSnapshotBackup;

