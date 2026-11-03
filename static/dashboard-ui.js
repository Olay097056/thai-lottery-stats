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
  return `<div class="dash-result-item"><div class="dash-result-label">${escHtml(label)}</div><div class="dash-result-value">${escHtml(value||'—')}</div></div>`;
}

async function loadDashboard(){
  setPageStatus('dash-data-status','กำลังโหลดข้อมูล Dashboard...');
  const d = await api('summary',{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
  if(d.error){
    const statusEl=document.getElementById('dash-data-status');
    if(statusEl)statusEl.classList.add('warn');
    setPageStatus('dash-data-status','โหลดข้อมูล Dashboard ไม่สำเร็จ ลองใหม่อีกครั้ง');
    document.getElementById('dashboard-formula-picks').textContent='โหลดข้อมูลสูตรไม่ได้ · ลองโหลด Dashboard ใหม่';
    document.getElementById('p1-widget-body').textContent='โหลดรายงานไม่ได้ · กดคำนวณใหม่เพื่อลองอีกครั้ง';
    toast(d.error,'error',{announce:false});
    return;
  }
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
  document.getElementById('s-prize1').innerHTML = p1.split('').map(c=>`<div class="digit-box">${escHtml(c)}</div>`).join('');
  const lt = d.latest||{};
  document.getElementById('latest-draw-detail').innerHTML = `
    ${renderLatestItem('3 ตัวบน',lt.top3)}
    ${renderLatestItem('2 ตัวบน',lt.top2)}
    ${renderLatestItem('3 ตัวหน้า',`${lt.front3_1||'—'} / ${lt.front3_2||'—'}`)}
    ${renderLatestItem('3 ตัวล่าง',`${lt.back3_1||'—'} / ${lt.back3_2||'—'}`)}
    ${renderLatestItem('2 ตัวล่าง',lt.bottom2)}
    ${renderLatestItem('วันที่',fmtDate(lt.date))}`;
  const hot = d.hot_top3||[];
  const positiveHot=hot.map(row=>({row,count:dashCount(row)})).filter(item=>item.count>0).slice(0,10);
  const maxHot=Math.max(0,...positiveHot.map(item=>item.count));
  const lowSignal=positiveHot.length<10||maxHot<=1;
  const hotStatus=positiveHot.length
    ?(lowSignal
      ?'<p class="dash-hot-status" role="note">ข้อมูล 12 เดือนยังบาง · '+positiveHot.length+'/10 เลขในรายการพบอย่างน้อย 1 ครั้ง และพบซ้ำสูงสุด '+maxHot+' ครั้ง</p>'
      :'')
    :'<p class="dash-hot-status" role="note">ไม่พบเลข 3 ตัวบนที่ออกในช่วง 12 เดือนล่าสุด</p>';
  const maxHotBar=Math.max(1,...positiveHot.map(item=>item.count));
  document.getElementById('hot-list').innerHTML=positiveHot.length
    ?hotStatus+positiveHot.map((item,i)=>{
      const num=escHtml(dashNum(item.row));
      const cnt=item.count;
      return '<button type="button" class="dash-hot-row" onclick="showPage(&quot;frequency&quot;)" aria-label="เปิดตารางความถี่: เลข '+num+' ออก '+cnt+' ครั้งใน 12 เดือนล่าสุด"><span class="rank-badge '+(i<3?'rank-'+(i+1):'')+'">'+(i+1)+'</span><span class="hc-num">'+num+'</span><span class="hc-val">'+cnt+' ครั้ง</span><span aria-hidden="true" class="hc-bar-wrap"><span class="hc-bar-fill hot-fill" style="width:'+(cnt/maxHotBar*100).toFixed(0)+'%"></span></span></button>';
    }).join('')
    :hotStatus;
  const recentRows=d.recent_draws||[];
  document.getElementById('recent-compact').innerHTML=recentRows.slice(-5).reverse().map(r=>`<button type="button" class="dash-recent-item" onclick="showPage('history')" aria-label="ดูผลย้อนหลัง งวด ${escHtml(r.date||'')} รางวัลที่ 1 ${escHtml(r.prize1||'')} 3 ตัวบน ${escHtml(r.top3||'—')} 2 ตัวล่าง ${escHtml(r.bottom2||'—')}">
    <span class="dash-recent-date">${escHtml(r.date||'')}</span>
    <span class="dash-recent-prize">${escHtml(r.prize1||'')}</span>
    <span class="dash-recent-sub">บน ${escHtml(r.top3||'—')} · ล่าง ${escHtml(r.bottom2||'—')}</span>
  </button>`).join('')||'<div class="dash-empty">ยังไม่มีประวัติงวดล่าสุด</div>';
  document.getElementById('recent-tbody').innerHTML = recentRows.map(r=>`<tr>
    <td>${escHtml(r.date||'')}</td><td><b style="font-family:'IBM Plex Mono',monospace">${escHtml(r.prize1||'')}</b></td>
    <td>${escHtml(r.top3||'')}</td><td>${escHtml(r.top2||'')}</td><td>${escHtml(r.front3_1||'')}</td>
    <td>${escHtml(r.front3_2||'')}</td><td>${escHtml(r.back3_1||'')}</td><td>${escHtml(r.back3_2||'')}</td><td>${escHtml(r.bottom2||'')}</td>
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
  let statusChecked=false;
  try{
    let previous=LotteryServerData.health.report;
    if(!previous&&typeof loadDataStatus==='function')previous=await loadDataStatus();
    const previousVersion=previous?.data_version||null;
    const d = await api('refresh',{method:'POST',suppressNetworkToast:true});
    if(d.error||d.ok===false)throw new Error('refresh_failed');
    let current=null;
    if(typeof loadDataStatus==='function'){
      try{current=await loadDataStatus();statusChecked=true;}catch{}
    }
    const verified=Boolean(previousVersion&&current?.data_version);
    const changed=verified?previousVersion!==current.data_version:null;
    if(changed!==false){
      const verified=changed===true;
      if(typeof markLotteryReportsStale==='function')markLotteryReportsStale({verified});
      if(typeof broadcastLotteryReportsStale==='function')broadcastLotteryReportsStale({verified});
    }
    toast(`อัปเดต ${d.rows} งวด`,'success');
    loadDashboard();
  }catch{toast('รีเฟรชข้อมูลไม่สำเร็จ กรุณาลองใหม่','error');}
  finally{if(!statusChecked&&typeof loadDataStatus==='function')loadDataStatus();}
}

// ─── Frequency ────────────────────────────────────────────────────────────────
async function loadFreq(){
  const requestId=++LotteryUiState.frequency.freqLoadRequestId;
  const col = document.getElementById('freq-col').value;
  const topEl=document.getElementById('freq-top');
  const isSanook = ['near1','prize2','prize3','prize4','prize5'].includes(col);
  const statusEl=document.getElementById('freq-status');
  const announce=message=>{if(statusEl)statusEl.textContent=message;};
  announce('กำลังโหลดตารางความถี่...');
  [...topEl.options].forEach(option=>{option.disabled=isSanook&&Number(option.value)>50;});
  if(isSanook&&Number(topEl.value)>50)topEl.value='50';
  const top = topEl.value;
  let rows, never=[];
  const freqBody=document.getElementById('freq-tbody');
  freqBody.innerHTML='<tr><td colspan="5"><div class="predict-empty">กำลังโหลดตารางความถี่...</div></td></tr>';
  const neverEl = document.getElementById('never-list');
  if(neverEl)neverEl.innerHTML='<span style="color:var(--text3)">กำลังโหลด...</span>';
  const showError=()=>{
    announce('โหลดตารางความถี่ไม่สำเร็จ ลองใหม่อีกครั้ง');
    freqBody.innerHTML='<tr><td colspan="5"><div class="predict-empty">โหลดตารางความถี่ไม่สำเร็จ<button type="button" class="btn btn-secondary retry-inline" onclick="loadFreq()">ลองอีกครั้ง</button></div></td></tr>';
    if(neverEl)neverEl.innerHTML='<span style="color:var(--text3)">โหลดข้อมูลความถี่ไม่สำเร็จ</span>';
    destroyChart('freq-chart');
  };
  const isRecord=row=>row!==null&&typeof row==='object'&&!Array.isArray(row);
  const isValidSanookRow=row=>isRecord(row)&&typeof row.number==='string'&&Number.isSafeInteger(row.count)&&row.count>=0&&typeof row.pct==='number'&&Number.isFinite(row.pct);
  const isValidFrequencyRow=row=>isRecord(row)&&typeof row['เลข']==='string'&&Number.isSafeInteger(row['จำนวนครั้ง'])&&row['จำนวนครั้ง']>=0&&(row['อัตรา (%)']==null||(typeof row['อัตรา (%)']==='number'&&Number.isFinite(row['อัตรา (%)'])));
  if(isSanook){
    const d = await api(`prize-freq?prize=${col}&top_n=${top}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(requestId!==LotteryUiState.frequency.freqLoadRequestId)return;
    if(d?.error||!Array.isArray(d?.data)||!d.data.every(isValidSanookRow)){showError();return;}
    rows = d.data.map(r=>({'เลข':r.number,'จำนวนครั้ง':r.count,'อัตรา (%)':r.pct}));
  } else {
    const d = await api(`freq-table?col=${col}&top_n=${top}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(requestId!==LotteryUiState.frequency.freqLoadRequestId)return;
    if(d?.error||!Array.isArray(d?.data)||!d.data.every(isValidFrequencyRow)||!Array.isArray(d?.never)||!d.never.every(n=>typeof n==='string')){showError();return;}
    rows = d.data;
    never = d.never;
  }
  const maxCnt = rows[0]?.['จำนวนครั้ง']||1;
  const formatRate=value=>Number.isFinite(value)?`${value.toFixed(2)}%`:'—';
  announce(rows.length ? `แสดงผลความถี่ ${rows.length} รายการ` : 'ยังไม่มีข้อมูลความถี่');
  freqBody.innerHTML = rows.length ? rows.map((r,i)=>`<tr>
    <td><span class="rank-badge ${i<3?'rank-'+(i+1):''}">${i+1}</span></td>
    <td><b style="font-family:'IBM Plex Mono',monospace">${escHtml(r['เลข']||'')}</b></td>
    <td>${r['จำนวนครั้ง']||0}</td>
    <td>${formatRate(r['อัตรา (%)'])}</td>
    <td><div class="progress-bar"><div class="progress-fill" style="width:${((r['จำนวนครั้ง']||0)/maxCnt*100).toFixed(0)}%"></div></div></td>
  </tr>`).join('') : '<tr><td colspan="5"><div class="predict-empty">ยังไม่มีข้อมูลความถี่</div></td></tr>';
  neverEl.innerHTML = isSanook
    ? `<span style="color:var(--text3);font-size:.78rem">* ข้อมูล Sanook — งวดเก่าก่อนปี ~2558 อาจไม่ครบ</span>`
    : col==='prize1'
        ? '<span style="color:var(--text3);font-size:.78rem">ไม่รองรับรายการเลขที่ไม่เคยออกสำหรับรางวัลที่ 1</span>'
        : (never.length
            ? `<div style="color:var(--text3);font-size:.78rem;margin-bottom:8px">ไม่เคยออก ${never.length} เลข:</div>`+never.map(n=>`<span class="num-badge" style="border-color:var(--text3);color:var(--text3)">${escHtml(n)}</span>`).join('')
            : '<span style="color:var(--text3)">ทุกเลขเคยออกแล้ว</span>');
  mkChart('freq-chart',{type:'bar',
    data:{labels:rows.slice(0,20).map(r=>String(r['เลข']||'')),datasets:[{data:rows.slice(0,20).map(r=>r['จำนวนครั้ง']||0),themeColor:'--gold',backgroundColor:typeof getComputedStyle==='function'?getComputedStyle(document.documentElement).getPropertyValue('--gold').trim():'#b45309',borderWidth:0}]},
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
  const data=LotteryServerData.predict.rows||[];
  if(!data.length)return;
  const col=LotteryUiState.predict.lastPredCol||'';
  const date=LotteryUiState.predict.lastPredDate||'';
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
    document.getElementById('p1-widget-body').innerHTML=`<span style="color:var(--red-text)">${r.error}</span>`;
    return;
  }
  const preds=r.predictions||[];
  if(!preds.length){document.getElementById('p1-widget-body').innerHTML='<span style="color:var(--red-text)">ไม่มีข้อมูล</span>';return;}
  document.getElementById('p1-widget-body').innerHTML=preds.slice(0,5).map((p,i)=>{
    const fb=+(p['Front Beam']||0).toFixed(2);
    const bk=+(p['Back Top3']||0).toFixed(2);
    const score=+(p['คะแนนรวม']||0).toFixed(1);
    const color=i===0?'var(--gold2)':i<3?'var(--accent)':'var(--text2)';
    return `<div style="text-align:center;padding:8px 12px;background:var(--surface2);border-radius:8px;border:1px solid ${i===0?'var(--gold2)':'var(--border)'}">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:${i===0?'1.4rem':'1.1rem'};font-weight:700;color:${color};letter-spacing:3px">${p['เลข']||''}</div>
      <div style="font-size:.8rem;color:var(--text3);margin-top:2px">${p['หน้า 3']||''}·${p['หลัง 3']||''}</div>
      <div style="font-size:.8rem;color:var(--text3)">F:${fb} B:${bk}</div>
    </div>`;
  }).join('');
  document.getElementById('p1-widget-lift').textContent='คะแนนใช้จัดอันดับ · ยังไม่มีรายงานประเมินความแม่นสำหรับผลชุดนี้';
}

