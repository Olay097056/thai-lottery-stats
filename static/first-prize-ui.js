var FirstPrizeFeature = (() => {
  let busy=false;
  const boardRequests=new Map();
  const status = (text,id='first-prize-status') => {const el=document.getElementById(id);if(el)el.textContent=text;};
  async function board(targetId='first-prize-board'){
    const root=document.getElementById(targetId);
    if(!root)return;
    const statusId=root.dataset.statusId||'first-prize-status';
    const serverExperiments=root.dataset.scope==='server-experiments';
    const requestId=(boardRequests.get(targetId)||0)+1;
    boardRequests.set(targetId,requestId);
    status('กำลังอ่านคำทำนายที่ลงทะเบียนไว้...',statusId);
    const response=await api('first-prize');
    if(boardRequests.get(targetId)!==requestId)return;
    if(response.ok===false){status(response.error,statusId);return;}
    const include=method=>!serverExperiments||method==='astra-v1'||method.startsWith('astra-sigma-')||method.startsWith('sigma-without-')||method.startsWith('fano-v');
    const data={...response,records:response.records.filter(r=>include(r.method)),summaries:response.summaries.filter(s=>include(s.method)).map(s=>({...s}))};
    if(serverExperiments){
      for(const [method,label] of [['astra-v1','Astra v1 · ทดลอง'],['astra-sigma-v0.1','Astra-Σ v0.1 · ทดลอง'],['fano-v4-variable-neighborhood-cover','ระนาบฟาโน v4 · Variable Neighborhood Cover'],['fano-v5-adaptive-rank-codebook','ระนาบฟาโน v5 · Adaptive Rank Codebook · post-hoc']]){
        if(!data.summaries.some(s=>s.method===method))data.summaries.push({method,label,code_sha256:'',draws:0,hits:0,expected_hits:0,pending:0,probability_draws:0,empty:true});
      }
    }
    const overlaps=[];
    for(let i=0;i<data.records.length;i++)for(let j=i+1;j<data.records.length;j++){
      const a=data.records[i],b=data.records[j];
      if(a.target_date!==b.target_date)continue;
      const common=a.numbers.filter(n=>b.numbers.includes(n));
      if(common.length)overlaps.push(`<li>${escHtml(a.target_date)} · ${escHtml(a.method)} / ${escHtml(b.method)}: ซ้ำ ${common.length}/5 ชุด</li>`);
    }
    const loggedDraws=data.summaries.reduce((sum,s)=>sum+(Number(s.draws)||0),0);
    const pendingDraws=data.summaries.reduce((sum,s)=>sum+(Number(s.pending)||0),0);
    const scoredSummaries=data.summaries.filter(s=>Number(s.probability_draws)>0);
    const methodsTitleId=`${targetId}-methods-title`;
    const recordsTitleId=`${targetId}-records-title`;
    root.innerHTML=`<div class="prospective-ledger">
      <div class="prospective-metrics" aria-label="ภาพรวมทะเบียนทดลอง">
        <article class="prospective-metric"><span>วิธีที่ติดตาม</span><strong>${data.summaries.length}</strong><small>แยกตามเวอร์ชันโค้ด</small></article>
        <article class="prospective-metric"><span>คำทำนายที่มีผลแล้ว</span><strong>${loggedDraws}</strong><small>นับแยกตามวิธี</small></article>
        <article class="prospective-metric"><span>คำทำนายที่รอผล</span><strong>${pendingDraws}</strong><small>ผลจะอัปเดตเมื่อมีงวดจริง</small></article>
      </div>
      <aside class="prospective-baseline" aria-label="เกณฑ์เปรียบเทียบ">
        <span class="prospective-baseline-mark" aria-hidden="true">01</span>
        <div><span class="prospective-eyebrow">RANDOM BASELINE</span><p><strong>0.0005%</strong><span>โอกาสสุ่มถูกรางวัลที่ 1 ตรง 6 หลักต่องวด</span></p></div>
        <small>ใช้ 5 เลขไม่ซ้ำต่อวิธี · ตอนนี้ยังไม่มีหลักฐานว่าวิธีใดได้เปรียบการสุ่ม</small>
      </aside>
      <section class="prospective-methods" aria-labelledby="${methodsTitleId}">
        <div class="prospective-section-heading"><div><span class="prospective-eyebrow">METHODS</span><h3 id="${methodsTitleId}">ภาพรวมแยกตามวิธี</h3></div><span>โค้ดคนละเวอร์ชันจะแสดงแยกกัน</span></div>
        ${data.summaries.length?`<div class="table-wrap prospective-table-wrap" tabindex="0" role="region" aria-label="ภาพรวมผลแยกตามวิธี เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม"><table class="prospective-table"><caption class="sr-only">ผลสะสมแยกตามวิธีและเวอร์ชันโค้ด</caption><thead><tr><th scope="col">วิธี / เวอร์ชัน</th><th scope="col">มีผลแล้ว</th><th scope="col">ถูกครบ 6 หลัก</th><th scope="col">คาดจากสุ่ม</th><th scope="col">สถานะ</th></tr></thead><tbody>${data.summaries.map(s=>`<tr class="${s.empty?'is-empty':''}"><th scope="row"><span class="prospective-method-name">${escHtml(s.label||s.method)}</span>${s.code_sha256?`<code class="prospective-version">${escHtml(s.code_sha256.slice(0,8))}</code>`:''}</th><td>${s.empty?'—':escHtml(String(s.draws))}</td><td>${s.empty?'—':escHtml(String(s.hits))}</td><td>${s.empty?'—':escHtml(Number(s.expected_hits||0).toFixed(6))}</td><td><span class="prospective-state ${s.empty?'is-empty':Number(s.pending)>0?'is-pending':'is-complete'}">${s.empty?'ยังไม่มีคำทำนาย':Number(s.pending)>0?`รอผล ${escHtml(String(s.pending))} งวด`:'อัปเดตแล้ว'}</span></td></tr>`).join('')}</tbody></table></div>`:'<p class="prospective-empty">ยังไม่มีคำทำนายลงทะเบียน</p>'}
      </section>
      <details class="prospective-reading-guide"><summary>วิธีอ่านผลและข้อจำกัด</summary><p>จำนวนงวดยังน้อยเกินกว่าจะสรุปความแม่นได้ · การตรงบางหลักเป็นข้อมูลประกอบเท่านั้น · Pool 1–5 และเลขท้ายไม่รวมในตารางนี้</p><p>Mix ใช้ข้อมูลจากกลุ่มสูตรเดิม และ Sigma ใช้ฐานร่วมกัน จึงไม่ใช่หลักฐานอิสระ แม้เลขไม่ซ้ำก็ไม่ได้ยืนยันว่าผลเป็นอิสระ</p></details>
      ${scoredSummaries.length?`<section class="prospective-probabilities" aria-label="ผลประเมินความน่าจะเป็น">${scoredSummaries.map(s=>`<article class="prospective-probability-card"><div><span class="prospective-eyebrow">PROBABILITY CHECK</span><strong>${escHtml(s.label||s.method)}</strong></div><dl><div><dt>Log loss เฉลี่ย</dt><dd>${(s.log_loss_sum/s.probability_draws).toFixed(4)}</dd></div><div><dt>เทียบ Uniform</dt><dd>${Math.log(1000000).toFixed(4)}</dd></div><div><dt>จำนวนงวด</dt><dd>${escHtml(String(s.probability_draws))}</dd></div><div><dt>คาด / ถูกจริง</dt><dd>${Number(s.model_expected_hits||0).toFixed(6)} / ${escHtml(String(s.hits))}</dd></div></dl><p>Log loss ยิ่งต่ำยิ่งดี แต่ต้องสะสมงวดใหม่มากพอจึงจะประเมินได้</p></article>`).join('')}</section>`:''}
      <details class="prospective-overlaps"><summary><span>เลขเต็มซ้ำระหว่างวิธี</span><span class="prospective-count">${overlaps.length} คู่</span></summary><p>เลขซ้ำแสดงว่าวิธีอาจใช้สัญญาณร่วมกัน ส่วนเลขไม่ซ้ำก็ยังไม่พิสูจน์ว่าผลเป็นอิสระ</p><ul>${overlaps.join('')||'<li>ยังไม่พบเลขเต็มซ้ำในทะเบียน</li>'}</ul></details>
      <section class="prospective-records" aria-labelledby="${recordsTitleId}"><div class="prospective-section-heading"><div><span class="prospective-eyebrow">DRAW LOG</span><h3 id="${recordsTitleId}">คำทำนายรายงวด</h3></div><span>${data.records.length} รายการ</span></div>
        ${data.records.length?`<div class="prospective-record-list">${data.records.map(r=>`<details class="prospective-record"><summary><time datetime="${escHtml(r.target_date)}">${escHtml(r.target_date)}</time><span class="prospective-record-method">${escHtml(r.settings.name||r.method)}</span><span class="prospective-result ${r.hit===null?'is-pending':r.hit?'is-hit':'is-miss'}">${r.hit===null?'รอผล':r.hit?'ถูกรางวัลที่ 1':'ไม่ถูกรางวัลที่ 1'}</span></summary><div class="prospective-record-body"><div class="prospective-number-list" aria-label="เลขที่ลงทะเบียน">${r.numbers.map(n=>`<span>${escHtml(n)}</span>`).join('')}</div><dl class="prospective-record-facts"><div><dt>บันทึกเมื่อ</dt><dd>${escHtml(LotteryReports.reportDisplayTime(r.registered_at))}</dd></div><div><dt>แหล่งข้อมูล</dt><dd>${escHtml(r.source==='server_existing_cache'?'คำนวณจากแคชเดิมบนเซิร์ฟเวอร์':'ส่งจากเบราว์เซอร์ · ยังไม่ยืนยันแหล่งข้อมูล')}</dd></div><div><dt>ผลจริง</dt><dd>${escHtml(r.actual||'ยังไม่มี')}</dd></div><div><dt>ตรงมากที่สุด</dt><dd>${escHtml(String(r.matched_positions??'—'))}/6 หลัก</dd></div><div><dt>ตัดเลขซ้ำ</dt><dd>${escHtml(String(r.duplicates_removed))} ชุด</dd></div>${r.log_loss!=null?`<div><dt>Log loss</dt><dd>${r.log_loss.toFixed(4)} · Uniform ${r.uniform_log_loss.toFixed(4)}</dd></div>`:''}</dl><details class="prospective-provenance"><summary>รายละเอียดสูตรและที่มาของรายงาน</summary><p>SHA256 <code>${escHtml(r.sha256)}</code></p><pre>${escHtml(JSON.stringify({settings:r.settings,provenance:r.provenance},null,2))}</pre></details></div></details>`).join('')}</div>`:'<p class="prospective-empty">ยังไม่มีคำทำนายที่ลงทะเบียนไว้ · เปิดหน้าทำนายเพื่อล็อกชุดก่อนงวด</p>'}
      </section>
    </div>`;
    status(data.records.length?'อ่านทะเบียนแล้ว · งวดที่ยังไม่มีผลแสดงรอผล':'ยังไม่มีคำทำนายที่ลงทะเบียนไว้ · เปิดหน้าทำนายเพื่อล็อกชุดก่อนงวด',statusId);
  }
  async function experiment(){
    if(busy)return;
    const date=document.getElementById('shared-draw-date')?.value;
    busy=true;status('กำลังคำนวณและลงทะเบียน Astra v1, Sigma, ระนาบฟาโน v4 + v5 และชุดถอดองค์ประกอบ...');
    try{
      const result=await api('first-prize/experiment?date='+encodeURIComponent(date),{method:'POST'});
      if(result.ok===false){status(result.error);return;}
      await board();
    }finally{busy=false;}
  }
  async function registerClient(method,numbers,date,settings,provenance){
    return api('first-prize/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_date:date,method,numbers,settings,provenance:provenance||{}})});
  }
  async function formulas(){
    if(busy)return;
    const date=document.getElementById('shared-draw-date')?.value;
    const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
    if(!date||date<=today){status('เลือกงวดอนาคตก่อนลงทะเบียน');return;}
    busy=true;status('กำลังสร้างคำทำนายสูตรเลขเต็มจากข้อมูลก่อนงวด...');
    try{
      const response=await api('prize-history?n=260');
      if(response.ok===false){status(response.error);return;}
      const history=(response.data||[]).map(r=>{
        const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.date||'');
        return {...r,date:match?`${match[3]}-${match[2]}-${match[1]}`:(r.date||'').slice(0,10)};
      }).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date<date&&r.date<=today).sort((a,b)=>b.date.localeCompare(a.date));
      if(!history.length){status('ไม่มีประวัติที่ใช้ได้');return;}
      const results=dcComputeFormulaResults(history,date);
      const mix=_mixCompute(results);
      const eligible=results.filter(r=>['pool6','pool6_14','prize1'].includes(r.field));
      if(mix?.preds)eligible.push({name:'Mix',preds:mix.preds});
      let saved=0,skipped=0;
      for(const row of eligible){
        const numbers=(row.preds||[]).filter(n=>typeof n==='string'&&/^[0-9]{6}$/.test(n));
        if(new Set(numbers).size<5){skipped++;continue;}
        const method='formula-v1-'+(row.name==='Mix'?'Mix':Array.from(row.name).map(c=>c.codePointAt(0).toString(16)).join('').slice(0,95));
        const out=await registerClient(method,numbers,date,{target:'prize1_exact',original_field:row.field||'derived',name:row.name},{source:'client_formula_history',cutoff:history[0].date,unverified:true});
        if(out.ok===false){status(out.error);return;}
        saved++;
      }
      await board();status(`ลงทะเบียน ${saved} วิธี · ข้าม ${skipped} วิธีที่เลขเต็มไม่ถึง 5 ชุด · สูตรเลขท้ายไม่ถูกยืดเป็นเลขเต็ม`);
    }finally{busy=false;}
  }
  async function predict(){
    const report=LotteryUiState.predict.lastPredictSnapshot;
    if(!report){status('คำนวณหน้าทำนายก่อนลงทะเบียน');return;}
    const numbers=(report.report?.categories?.prize1?.numbers||[]).map(r=>predNum(r));
    if(new Set(numbers).size<5){status('ต้องมีเลขเต็มไม่ซ้ำอย่างน้อย 5 ชุด');return;}
    const settings=report.provenance?.settings||{};
    const method='predict-v1-'+[report.preset,settings.beam,settings.kback].join('-').replace(/[^A-Za-z0-9_.:-]/g,'_');
    const out=await registerClient(method,numbers,report.date,settings,report.provenance);
    if(out.ok===false){status(out.error);return;}await board();
  }
  async function exportRecords(){
    const data=await api('first-prize');if(data.ok===false){status(data.error);return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='first-prize-prospective.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function openRegistration(){
    showPage('predict');
    const panel=document.getElementById('first-prize-panel');
    if(panel){panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'});panel.querySelector('summary')?.focus();}
  }
  return Object.freeze({board,experiment,formulas,predict,exportRecords,openRegistration});
})();
