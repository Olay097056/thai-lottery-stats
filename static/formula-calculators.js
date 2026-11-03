// ─── E. สายมู/ความเชื่อ (อ้างอิงวันที่งวด + โหราศาสตร์ไทย) ───────────────────────
// คืน array ของ object สูตรความเชื่อ ใช้ร่วมกันทั้งหน้าคำนวณและ backtest
function _formulaEsc(v){
  return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function _formulaGroupLabel(group){
  return ({
    A:'A · พื้นบ้าน',B:'B · ล็อตเตอรี่พลัส',C:'C · พิชิตโชค',D:'D · Arithmetic',
    E:'E · สายมู',F:'F · Rolling',G:'G · แม่นขั้นเทพ',H:'H · มิสเตอร์ซี',I:'I · จักรพรรดิ',J:'J · เจ้าสัว',HM:'HM · Hermes Pool 1-4',FANO:'ระนาบฟาโน · รางวัลที่ 1'
  })[group]||group||'-';
}

function _formulaConsensusType(num,target){
  const n=String(num);
  const t=String(target||'').toLowerCase();
  if(n.length===1)return {key:'digit',label:'เลขวิ่ง'};
  if(t.includes('front'))return {key:'front3',label:'หน้า 3'};
  if(t.includes('back')||t.includes('ท้าย'))return {key:'back3',label:'ท้าย 3'};
  if(t.includes('prize1'))return {key:'prize1',label:'รางวัลที่ 1'};
  if(n.length===3)return {key:'top3',label:'3 ตัวบน'};
  if(n.length===2)return {key:'bottom2',label:'2 ตัว'};
  return {key:'other',label:'อื่น ๆ'};
}

function _formulaBacktestEdgeByName(){
  const map=new Map();
  for(const row of LotteryServerData.formula.backtestRows||[]){
    const clean=String(row.name||'').replace(/\s+/g,' ').trim();
    if(clean)map.set(clean,row.edge||0);
    const code=clean.match(/^([A-Z]\d+)/)?.[1];
    if(code)map.set(code,row.edge||0);
  }
  return map;
}

function _formulaBacktestRowsByName(){
  const map=new Map();
  for(const row of LotteryServerData.formula.backtestRows||[]){
    const clean=String(row.name||'').replace(/\s+/g,' ').trim();
    if(clean)map.set(clean,row);
    const code=clean.match(/^([A-Z]+\d+)/)?.[1];
    if(code)map.set(code,row);
  }
  return map;
}

function _formulaTitleCode(title,source){
  const group=String(source||'').trim()[0]||'';
  const t=String(title||'');
  const direct=t.match(/^([DX]\d+)/)?.[1];
  if(direct)return direct;
  const n=t.match(/(?:แม่นขั้นเทพ|มิสเตอร์ซี)\s*(\d+)/)?.[1];
  if(group&&n)return `${group}${n}`;
  return '';
}

function _formulaBacktestProfileForTitle(title,source){
  const map=_formulaBacktestRowsByName();
  const clean=String(title||'').replace(/\s+/g,' ').trim();
  const code=_formulaTitleCode(clean,source);
  let row=(code&&map.get(code))||map.get(clean)||null;
  if(!row){
    const tokens=clean.split(/[\s·:()\-—]+/).filter(t=>t.length>1&&!/^\d+$/.test(t));
    let bestScore=0;
    for(const [name,candidate] of map.entries()){
      const rowTokens=String(name).split(/[\s·:()\-—]+/).filter(t=>t.length>1&&!/^[A-Z]?\d+$/.test(t));
      const overlap=tokens.filter(t=>rowTokens.includes(t)).length;
      if(overlap>bestScore){bestScore=overlap;row=candidate;}
    }
    if(bestScore<2)row=null;
  }
  if(!row)return null;
  const r200=row.rolling?.[200]||null;
  const edge200=r200&&r200.total>=180?r200.edge:null;
  return {...row,edge200,degraded:edge200!=null&&edge200<-5};
}

function _formulaBacktestEdgeForTitle(title,source,edgeMap){
  const clean=String(title||'').replace(/\s+/g,' ').trim();
  const code=_formulaTitleCode(clean,source);
  if(code&&edgeMap.has(code))return edgeMap.get(code)||0;
  if(edgeMap.has(clean))return edgeMap.get(clean)||0;
  const tokens=clean.split(/[\s·:()\-—]+/).filter(t=>t.length>1&&!/^\d+$/.test(t));
  let best=0,bestScore=0;
  for(const [name,edge] of edgeMap.entries()){
    const rowTokens=String(name).split(/[\s·:()\-—]+/).filter(t=>t.length>1&&!/^[A-Z]?\d+$/.test(t));
    const overlap=tokens.filter(t=>rowTokens.includes(t)).length;
    if(overlap>bestScore){bestScore=overlap;best=edge||0;}
  }
  return bestScore>=2?best:0;
}

function _collectFormulaConsensus(){
  const root=document.getElementById('formula-results-ALL');
  if(!root)return [];
  const edgeMap=_formulaBacktestEdgeByName();
  const byKey=new Map();
  const cards=[...root.querySelectorAll('.formula-card')];
  for(const card of cards){
    const title=(card.querySelector('.card-title')?.textContent||'').trim();
    const source=(card.querySelector('.card-title + div')?.textContent||'').trim();
    const group=card.getAttribute('data-group')||'?';
    const target=(card.querySelector('.formula-chip.target')?.textContent||'').trim();
    const raw=[...card.querySelectorAll('.formula-result-row span')]
      .map(el=>(el.textContent||'').trim())
      .filter(v=>/^\d{1,6}$/.test(v));
    const nums=[...new Set(raw)];
    if(!nums.length)continue;
    const widthPenalty=1/Math.sqrt(Math.max(nums.length,1));
    const edge=_formulaBacktestEdgeForTitle(title,source,edgeMap);
    for(const num of nums){
      const type=_formulaConsensusType(num,target);
      const key=`${type.key}:${num}`;
      if(!byKey.has(key)){
        byKey.set(key,{num,typeKey:type.key,typeLabel:type.label,formulaCount:0,groups:new Set(),sources:[],weighted:0,edgeBoost:0});
      }
      const rec=byKey.get(key);
      rec.formulaCount++;
      rec.groups.add(group);
      rec.weighted+=widthPenalty;
      if(edge>0)rec.edgeBoost+=Math.min(edge,20)/20;
      rec.sources.push({title,source,group,target,count:nums.length,edge});
    }
  }
  return [...byKey.values()].map(rec=>{
    const groupCount=rec.groups.size;
    const score=(rec.formulaCount*10)+(groupCount*9)+(rec.weighted*14)+(rec.edgeBoost*7);
    const badges=[];
    if(rec.formulaCount>=5)badges.push('HOT');
    if(groupCount>=3)badges.push('STRONG');
    if(rec.edgeBoost>0)badges.push('BACKTEST+');
    if(rec.formulaCount===1)badges.push('NEW');
    return {...rec,groupCount,score,badges};
  }).sort((a,b)=>b.score-a.score||b.formulaCount-a.formulaCount||a.num.localeCompare(b.num));
}

function _formulaConsensusChip(item){
  const sources=item.sources
    .sort((a,b)=>a.count-b.count||a.title.localeCompare(b.title))
    .slice(0,8);
  const more=item.sources.length-sources.length;
  const srcHtml=sources.map(s=>`<span class="consensus-source" data-group="${_formulaEsc(s.group)}" title="${_formulaEsc(s.source)}">${_formulaEsc(s.title)}${s.count>1?` <b>${s.count}ช.</b>`:''}</span>`).join('');
  const badgeHtml=item.badges.map(b=>`<span class="consensus-badge ${b.toLowerCase().replace('+','plus')}">${b}</span>`).join('');
  return `<details class="consensus-chip type-${_formulaEsc(item.typeKey)}">
    <summary>
      <span class="consensus-num">${_formulaEsc(item.num)}</span>
      <span class="consensus-mini">x${item.formulaCount}</span>
    </summary>
    <div class="consensus-detail">
      <div class="consensus-line"><span>${_formulaEsc(item.typeLabel)}</span><span>Score ${item.score.toFixed(1)}</span></div>
      <div class="consensus-stats">${item.formulaCount} สูตร · ${item.groupCount} หมวด · น้ำหนัก ${item.weighted.toFixed(2)}</div>
      <div class="consensus-badges">${badgeHtml||'<span class="consensus-badge soft">WATCH</span>'}</div>
      <div class="consensus-sources">${srcHtml}${more>0?`<span class="consensus-source more">+${more}</span>`:''}</div>
      <div class="consensus-note">สูตรที่ปล่อยเลขน้อยจะได้น้ำหนักมากกว่าสูตรชุดใหญ่ เพื่อลดเลขซ้ำหลอก</div>
    </div>
  </details>`;
}

function _renderFormulaConsensusHeatmap(items){
  const digitStats=Array.from({length:10},(_,d)=>({d,count:0,score:0}));
  for(const item of items){
    for(const ch of item.num){
      const d=parseInt(ch,10);
      if(Number.isFinite(d)){
        digitStats[d].count+=item.formulaCount;
        digitStats[d].score+=item.score;
      }
    }
  }
  const max=Math.max(...digitStats.map(x=>x.score),1);
  return `<div class="consensus-heatmap">
    ${digitStats.map(x=>{
      const alpha=.08+(x.score/max)*.34;
      return `<div class="consensus-heat" style="background:rgba(245,158,11,${alpha.toFixed(3)})"><b>${x.d}</b><span>${x.count}</span></div>`;
    }).join('')}
  </div>`;
}

function _formulaFinalCopy(type){
  const items=_collectFormulaConsensus().filter(x=>x.formulaCount>1);
  const pick=(key,n)=>items.filter(x=>x.typeKey===key).slice(0,n).map(x=>x.num);
  const nums=type==='top3'?pick('top3',10):type==='bottom2'?pick('bottom2',10):type==='digit'?pick('digit',5):[
    ...pick('top3',6),...pick('bottom2',6),...pick('digit',4)
  ];
  const text=[...new Set(nums)].join(' ');
  if(text&&typeof copyPredNumber==='function')copyPredNumber(text);
}

function _renderFormulaFinalPicks(){
  const el=document.getElementById('formula-final');
  if(!el)return;
  const items=_collectFormulaConsensus().filter(x=>x.formulaCount>1);
  if(!items.length){el.classList.remove('active');el.innerHTML='';return;}
  const pick=(key,n)=>items.filter(x=>x.typeKey===key).slice(0,n);
  const block=(label,arr)=>`<div class="formula-final-block"><div class="formula-final-label">${label}</div><div class="formula-final-row">${arr.length?arr.map(_formulaConsensusChip).join(''):'<span class="formula-insight-empty">ยังไม่มีเลขซ้ำเด่น</span>'}</div></div>`;
  const btRows=Array.isArray(LotteryServerData.formula.backtestRows)?LotteryServerData.formula.backtestRows:[];
  const bestFormula=btRows.filter(r=>Number.isFinite(r?.edge)).sort((a,b)=>b.edge-a.edge)[0];
  const btEmpty=btRows.length
    ? '<span class="formula-insight-empty">— · ไม่มีข้อมูลครบสำหรับจัดอันดับสูตร</span>'
    : '<span class="formula-insight-empty">รัน Backtest เพื่อจัดอันดับสูตร</span>';
  const btHtml=bestFormula
    ? `<div class="formula-final-block"><div class="formula-final-label">สูตร Backtest เด่น</div><div class="formula-final-row"><span class="formula-quality bt">${_formulaEsc(bestFormula.edge>=0?'+':'')}${bestFormula.edge.toFixed(1)}%</span><span class="formula-insight-empty">${_formulaEsc(bestFormula.name)}</span></div></div>`
    : `<div class="formula-final-block"><div class="formula-final-label">สูตร Backtest เด่น</div><div class="formula-final-row">${btEmpty}</div></div>`;
  el.innerHTML=`<div class="formula-final-card">
    <div class="formula-final-head">
      <div class="formula-final-title">เลขที่หลายสูตรเห็นตรงกัน</div>
      <div class="formula-final-actions">
        <button class="dash-link" onclick="_formulaFinalCopy('top3')">คัดลอก 3 ตัวบน</button>
        <button class="dash-link" onclick="_formulaFinalCopy('bottom2')">คัดลอก 2 ตัว</button>
        <button class="dash-link" onclick="_formulaFinalCopy('all')">คัดลอกชุดรวม</button>
      </div>
    </div>
    <div class="formula-final-grid">
      ${block('3 ตัวบนเด่นสุด',pick('top3',5))}
      ${block('2 ตัวเด่นสุด',pick('bottom2',5))}
      ${block('เลขวิ่งเด่นสุด',pick('digit',5))}
      ${btHtml}
    </div>
  </div>`;
  el.classList.add('active');
  bindFormulaConsensusDetails();
}

function setFormulaConsensusFilter(type){
  LotteryUiState.formula.consensusFilter=type||'all';
  _renderFormulaInsights();
}

function bindFormulaConsensusDetails(){
  document.querySelectorAll('#formula-insights .consensus-chip').forEach(detail=>{
    detail.addEventListener('toggle',()=>{
      if(!detail.open)return;
      document.querySelectorAll('#formula-insights .consensus-chip[open]').forEach(other=>{
        if(other!==detail)other.open=false;
      });
    });
  });
}

function _renderFormulaInsights(){
  const el=document.getElementById('formula-insights');
  if(!el)return;
  const allItems=_collectFormulaConsensus();
  const filtered=allItems.filter(x=>x.formulaCount>1&&(LotteryUiState.formula.consensusFilter==='all'||x.typeKey===LotteryUiState.formula.consensusFilter));
  const topPicks=[
    ['3 ตัวบนเด่น',allItems.filter(x=>x.typeKey==='top3'&&x.formulaCount>1).slice(0,5)],
    ['2 ตัวเด่น',allItems.filter(x=>x.typeKey==='bottom2'&&x.formulaCount>1).slice(0,5)],
    ['เลขวิ่งเด่น',allItems.filter(x=>x.typeKey==='digit'&&x.formulaCount>1).slice(0,5)],
  ];
  const filters=[
    ['all','ทั้งหมด'],['digit','เลขวิ่ง'],['bottom2','2 ตัว'],['top3','3 ตัวบน'],['front3','หน้า 3'],['back3','ท้าย 3'],['prize1','รางวัลที่ 1']
  ];
  const filterHtml=filters.map(([key,label])=>`<button class="consensus-filter ${LotteryUiState.formula.consensusFilter===key?'active':''}" onclick="setFormulaConsensusFilter('${key}')">${label}</button>`).join('');
  const topHtml=topPicks.map(([title,items])=>`<div class="consensus-pick-card">
    <div class="formula-insight-title">${title}</div>
    <div class="consensus-chip-row">${items.length?items.map(_formulaConsensusChip).join(''):'<span class="formula-insight-empty">ยังไม่มีเลขซ้ำเด่น</span>'}</div>
  </div>`).join('');
  const listHtml=filtered.length
    ? filtered.slice(0,24).map(_formulaConsensusChip).join('')
    : '<div class="formula-tab-empty" style="display:block;grid-column:1/-1">ยังไม่มีเลขซ้ำในกลุ่มนี้</div>';
  const showListOpen=LotteryUiState.formula.consensusFilter!=='all';
  el.innerHTML=`<div class="consensus-board">
    <div class="consensus-head">
      <div>
        <div class="consensus-title">เลขซ้ำจากหลายสูตร</div>
      </div>
      <div class="consensus-filters">${filterHtml}</div>
    </div>
    <div class="consensus-top-grid">${topHtml}</div>
    <details class="consensus-all-details" ${showListOpen?'open':''}>
      <summary>${showListOpen?'ผลลัพธ์ตามตัวกรอง':'ดูเลขซ้ำทั้งหมด'}</summary>
      <div class="consensus-list">${listHtml}</div>
    </details>
    <details class="consensus-heat-details">
      <summary>ดู Digit Heatmap</summary>
      ${_renderFormulaConsensusHeatmap(allItems)}
    </details>
  </div>`;
  el.classList.add('active');
  bindFormulaConsensusDetails();
}

function resetFormulaFilters(){
  const q=document.getElementById('formula-search');
  const t=document.getElementById('formula-target-filter');
  if(q)q.value='';
  if(t)t.value='';
  filterFormulaCards();
}

function filterFormulaCards(){
  const tools=document.getElementById('formula-tools');
  const countEl=document.getElementById('formula-filter-count');
  const active=document.querySelector('.formula-results-panel.active');
  if(!active||LotteryUiState.formula.activeTab==='BT'||!LotteryUiState.formula.hasRun){
    if(tools)tools.classList.remove('active');
    if(countEl)countEl.textContent='';
    return;
  }
  if(tools)tools.classList.add('active');
  const query=(_fv('formula-search')||'').toLowerCase();
  const target=(_fv('formula-target-filter')||'').toLowerCase();
  const cards=[...active.querySelectorAll('.formula-card')];
  let visible=0;
  cards.forEach(card=>{
    const text=(card.textContent||'').toLowerCase();
    const targetText=(card.querySelector('.formula-chip.target')?.textContent||'').toLowerCase();
    const ok=(!query||text.includes(query))&&(!target||targetText.includes(target));
    card.style.display=ok?'':'none';
    if(ok)visible++;
  });
  let empty=active.querySelector('.formula-filter-empty');
  if(!empty){
    empty=document.createElement('div');
    empty.className='formula-tab-empty formula-filter-empty';
    empty.style.cssText='display:none;grid-column:1/-1';
    empty.textContent='ไม่พบสูตรที่ตรงกับตัวกรอง';
    active.appendChild(empty);
  }
  empty.style.display=(cards.length&&visible===0)?'block':'none';
  if(countEl)countEl.textContent=cards.length?`แสดง ${visible}/${cards.length} สูตร`:'';
}

const _THAI_DAYS=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const _KAMLANG=[6,15,8,17,19,21,10]; // เลขกำลังวัน อา-ส
function _beliefData(day,mon,year2,dateStr){
  function uniq(a){return[...new Set(a)];}
  function d2(n){n=((Math.round(n)%100)+100)%100;return String(n).padStart(2,'0');}
  function digsOf(nums){return uniq(nums.join('').split(''));}
  let wd=0;
  if(dateStr){const[y,m,dd]=dateStr.split('-').map(Number);wd=new Date(y,m-1,dd).getDay();}
  const out=[];

  // E1 เลขวันที่หวยออก
  const e1nums=uniq([d2(day),d2(mon),d2(day+mon),d2(day*mon),d2(year2),String(day%10)+String(mon%10)]);
  out.push({name:'E1 เลขวันที่หวยออก',icon:'📅',
    lines:[`งวดวันที่ ${day}/${mon}/${year2}`,`วัน=${day} เดือน=${mon} ปีพ.ศ.=${year2}`,`เลขวัน·เดือน·ผลรวม·ผลคูณ`],
    nums:e1nums,digits:digsOf(e1nums)});

  // E2 เลขกำลังวัน (โหราศาสตร์ไทย)
  const k=_KAMLANG[wd];
  const e2nums=uniq([d2(k),d2(k).split('').reverse().join(''),d2(k+day),d2(k+mon)]);
  out.push({name:'E2 เลขกำลังวัน',icon:'🪐',
    lines:[`งวดออกวัน${_THAI_DAYS[wd]}`,`กำลังวัน${_THAI_DAYS[wd]} = ${k}`,`เลขกำลัง·กลับเลข·บวกวัน/เดือน`],
    nums:e2nums,digits:digsOf(e2nums)});

  // E3 เลขมงคล พ.ศ.
  const sumYMD=day+mon+year2;
  const e3nums=uniq([d2(year2),d2(2500+year2),d2(sumYMD),d2(year2+day),d2(year2+mon)]);
  out.push({name:'E3 เลขมงคล พ.ศ.',icon:'🔢',
    lines:[`ปี พ.ศ. 25${String(year2).padStart(2,'0')}`,`ผลรวม วัน+เดือน+ปี = ${sumYMD}`,`เลขท้ายปี·ผลรวมมงคล`],
    nums:e3nums,digits:digsOf(e3nums)});

  // E4 เลขเด็ดยอดนิยม (เลขเบิ้ล/เลขตอง/9 มงคล) — แปรตามวันที่
  const seed=(day*7+mon*3+year2)%10;
  const e4nums=uniq([String(seed)+String(seed),String((seed+1)%10)+String((seed+1)%10),'99',d2(seed*11),d2(seed+90)]);
  out.push({name:'E4 เลขเด็ดยอดนิยม',icon:'✨',
    lines:[`สายมูยอดฮิต งวดนี้`,`เลขเบิ้ลเด่น = ${seed}${seed}`,`เลขเบิ้ล·เลข 9 มงคล (แปรตามวันที่งวด)`],
    nums:e4nums,digits:digsOf(e4nums)});

  return out;
}
// เปิดค้นข่าวเลขเด็ดงวดที่เลือก (เปิด Google ในแท็บใหม่ — ดึงความเชื่อจริง ณ งวดนั้น)
function searchLuckyNews(extra){
  const dateStr=document.getElementById('f-target-date').value||'';
  let label='งวดล่าสุด';
  if(dateStr){const[y,m,d]=dateStr.split('-').map(Number);label=`${d}/${m}/${y+543}`;}
  const q=encodeURIComponent(`${extra} หวย งวด ${label}`);
  window.open(`https://www.google.com/search?q=${q}`,'_blank');
}
function _computeBeliefCards(day,mon,year2,dateStr){
  return _beliefData(day,mon,year2,dateStr).map(f=>{
    const numHtml=`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${f.nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:1rem;background:rgba(236,72,153,.12);border:1px solid #ec489966;color:var(--text);padding:4px 11px;border-radius:7px;font-weight:700">${n}</span>`).join('')}</div>`;
    const runHtml=`<div style="margin-top:8px;font-size:.82rem;color:var(--text2)">เลขวิ่ง: <b style="color:var(--text);font-family:'IBM Plex Mono',monospace">${f.digits.join(' ')}</b></div>`;
    return _mkFormulaCard(`${f.icon} ${f.name}`,'E. สายมู/ความเชื่อ',f.lines,[],numHtml+runHtml);
  });
}


// ─── สูตรเจ้าพ่อ Claude (หมวด D) — คำนวณเลขเต็มตรงๆ จากงวดก่อน ไม่ใช่พูลเลขเดี่ยว ───
// ใช้ร่วมกันทั้งการ์ดและ backtest เพื่อให้ตรงกันเป๊ะ
// DSUM (วัน+เดือน+ปี พ.ศ. 2 หลัก ของงวดถัดไป) ใช้ร่วมกับ Group J's bottom2 leg (ISSUE-13) —
// แยกเป็นฟังก์ชันเดียวเพื่อไม่ให้มีสองจุดคำนวณค่าเดียวกัน
function _dsumValue(nextDay,nextMonth,nextYear2){
  return nextDay+nextMonth+nextYear2;
}

function _claudeFormulas(ctx){
  const {p6,t3,b2,bk1,bk2,drawday,nextDay,nextMonth,nextYear2}=ctx;
  const P=parseInt(p6)||0,B2=parseInt(b2)||0,BK1=parseInt(bk1)||0,BK2=parseInt(bk2)||0,T3=parseInt(t3)||0;
  const pad2=n=>String(((Math.round(n)%100)+100)%100).padStart(2,'0');
  const pad3=n=>String(((Math.round(n)%1000)+1000)%1000).padStart(3,'0');
  const pad6=n=>String(((Math.round(n)%1000000)+1000000)%1000000).padStart(6,'0');
  const rev=s=>s.split('').reverse().join('');
  const uniq=a=>[...new Set(a)];
  const DSUM=_dsumValue(nextDay,nextMonth,nextYear2);
  const b2a=parseInt(b2[0]||'0'),b2b=parseInt(b2[1]||'0');

  // D1 ท้าย 2 ตัว — 10 สูตรย่อย, แหล่งที่มาหลากหลาย ไม่ซ้ำกัน
  const d1=uniq([
    pad2(B2),                               // ①ท้าย2งวดก่อนซ้ำ
    rev(pad2(B2)),                          // ②กลับเลขท้าย2
    pad2(99 - B2),                          // ③เลขสลับขั้ว (99-ท้าย2)
    pad2(P%100 + B2),                       // ④ท้าย2รางวัล + ท้าย2ล่าง
    pad2(BK1%100 + BK2%100),               // ⑤ท้าย2ของท้าย3ทั้งคู่
    pad2(P%100),                            // ⑥ท้าย2รางวัลที่1
    pad2(BK1%100),                          // ⑦ท้าย2ของท้าย3ชุด1
    pad2(DSUM + b2b),                       // ⑧วัน+เดือน+ปี+หน่วยล่าง
    pad2(nextDay*nextMonth + b2a),          // ⑨วัน×เดือน+สิบล่าง
    pad2(Math.floor(P/100)%100),            // ⑩หน้า2ของท้าย4รางวัล
  ]);

  // D2 หน้า 3 ตัว — 6 สูตรย่อย ให้ "เลข 3 หลักจริง"
  const d2=uniq([
    pad3(Math.floor(P/1000) + BK1),         // ①3หน้ารางวัล + ท้าย3ชุด1
    pad3(P%1000 + nextDay*nextMonth),       // ②3ท้ายรางวัล + วัน×เดือน
    pad3(BK1 + BK2 + T3),                   // ③ท้าย3ทั้งคู่ + 3ตัวบน
    rev(pad3(Math.floor(P/1000))),          // ④กลับ3หน้ารางวัล
    pad3(BK1 + nextDay*10 + nextMonth),    // ⑤ท้าย3ชุด1 + วันเดือน
    pad3(P%1000 + B2),                      // ⑥3ท้ายรางวัล + ท้าย2
  ]);

  // D3 ท้าย 3 ตัว — 6 สูตรย่อย ให้ "เลข 3 หลักจริง"
  const d3=uniq([
    pad3(BK1 + BK2),                        // ①ท้าย3สองชุดบวกกัน
    pad3(P%1000 + nextDay),                 // ②3ท้ายรางวัล + วัน
    rev(pad3(BK1)),                         // ③กลับท้าย3ชุด1
    pad3(BK2 + nextMonth*nextYear2),        // ④ท้าย3ชุด2 + เดือน×ปี
    pad3(BK1 + B2*10),                      // ⑤ท้าย3ชุด1 + ท้าย2×10
    pad3(Math.floor(P/1000) + BK2),        // ⑥3หน้ารางวัล + ท้าย3ชุด2
  ]);

  // D4 รางวัลที่ 1 — เลข 6 หลักเต็ม + ท้าย 2 ตัวสำหรับ backtest
  const d4full=uniq([
    pad6(P + BK1*BK2),                      // ①รางวัล + ท้าย3คูณ
    pad6(P + nextDay*nextMonth*nextYear2),  // ②รางวัล + วัน×เดือน×ปี
    rev(p6),                                // ③กลับเลขรางวัล
  ]);
  const d4two=uniq([
    pad2(P + B2),                           // ①รางวัล + ท้าย2
    pad2(Math.floor(P/100)%100 + T3),       // ②(พัน-ร้อย) + 3ตัวบน
    pad2(P%100 + nextYear2),                // ③ท้าย2รางวัล + ปี
  ]);

  return {d1,d2,d3,d4full,d4two};
}

// ─── J. เจ้าสัว — bottom2 leg (ISSUE-13) ───────────────────────────────────────
// Search finalist from the (closed) Group J promotion-gate search: pad2(|BK2 - DSUM|),
// where BK2 = previous draw's back3_2 and DSUM reuses Group D's _dsumValue. Failed the
// holdout gate (train +0.72%, validation +1.67%, holdout -0.21%) — ships anyway under
// ทดลอง per ADR-0003 rather than being deleted. Skips (no fallback) when back3_2 or the
// target date is missing, unlike Group D which defaults missing digits to 0.
function _tycoonBottom2Formula(prevRow, nextDay, nextMonth, nextYear2){
  const bk2raw=String(prevRow?.back3_2??'').trim();
  if(!bk2raw)return [];
  if(nextDay==null||nextMonth==null||nextYear2==null||isNaN(nextDay)||isNaN(nextMonth)||isNaN(nextYear2))return [];
  const pad2=n=>String(((Math.round(n)%100)+100)%100).padStart(2,'0');
  const BK2=parseInt(bk2raw)||0;
  const DSUM=_dsumValue(nextDay,nextMonth,nextYear2);
  return [pad2(Math.abs(BK2-DSUM))];
}

function _codexDateParts(row, fallbackIso=''){
  if(row?.date){
    const [d,m,y]=String(row.date).split('/').map(Number);
    if(d&&m&&y) return {day:d, month:m, year:y};
  }
  if(fallbackIso){
    const [y,m,d]=fallbackIso.split('-').map(Number);
    if(d&&m&&y) return {day:d, month:m, year:y};
  }
  return {day:1, month:1, year:2568};
}

const CODEX_DEFAULT_COEFFS={sameDay:14,sameMonth:4,count:1.4,f80:4,f24:5,overdue:0.18,lastNumDecay:0.7};

// Preset coefficient sets for backtest comparison only (ISSUE-4) — the live
// "ทำนาย" tab / _codexCards always use CODEX_DEFAULT_COEFFS (baseline), never these.
const CODEX_COEFF_PRESETS=[
  {key:'baseline',label:'X1 Codex Sharp',coeffs:CODEX_DEFAULT_COEFFS},
  {key:'recency_heavy',label:'X10 Codex Recency-heavy',coeffs:{sameDay:10,sameMonth:3,count:1.0,f80:8,f24:10,overdue:0.10,lastNumDecay:0.7}},
  {key:'sameday_heavy',label:'X11 Codex Sameday-heavy',coeffs:{sameDay:24,sameMonth:8,count:1.0,f80:3,f24:3,overdue:0.12,lastNumDecay:0.7}},
  {key:'overdue_heavy',label:'X12 Codex Overdue-heavy',coeffs:{sameDay:10,sameMonth:3,count:1.0,f80:3,f24:3,overdue:0.5,lastNumDecay:0.7}},
  {key:'balanced',label:'X13 Codex Balanced',coeffs:{sameDay:6,sameMonth:6,count:2,f80:5,f24:5,overdue:0.3,lastNumDecay:0.85}},
];

// ─── I. จักรพรรดิ — digit-position frequency scorer (ISSUE-6) ─────────────────
// Builds the previous draw's combined prize 1-5 pool (near1 + prize2 + prize3 +
// prize4 + prize5 — same pool the pool6/pool_tail3 field types match against).
// Excludes prize1 itself since จักรพรรดิ only looks at the "secondary" prizes.
function _buildPrize1to5Pool(row){
  const pool=[];
  ['near1_1','near1_2','prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
   'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10'
  ].forEach(k=>{
    const raw=String(row?.[k]||'').trim();
    if(!raw)return; // blank field → not real data, skip (don't let padStart manufacture "000000")
    const v=raw.padStart(6,'0');
    if(/^\d{6}$/.test(v))pool.push(v);
  });
  ['prize4','prize5'].forEach(k=>{
    for(const tok of String(row?.[k]||'').trim().split(/\s+/)){if(/^\d{6}$/.test(tok))pool.push(tok);}
  });
  return pool; // near1+prize2-5 pool; excludes prize1 itself
}

// ─── HM. Hermes Pool 1-4 — value-weighted digit-position frequency (PRD-hermes-pool-1-4.md) ─
// Builds the previous draw's prize 1-4 pool as [{num, w}]: prize2 (5 เลข) + prize3 (10 เลข) +
// prize4 (50 เลข, string คั่น space) = 65 เลข — EXCLUDES near1/prize1/prize5 (เป้าเคร่งครัด
// รางวัล 1–4 ตามเจ้าของ) โดยแต่ละตัวพกน้ำหนักถ่วงมูลค่าเงินจริง 5:2:1 (200k/80k/40k →
// W2=1.0, W3=0.4, W4=0.2) — ค่าคงที่ design decision ประกาศล่วงหน้า ไม่ search (ADR-0003)
// field ว่าง = ข้าม ไม่ padStart กลบ (convention เดียวกับ _buildPrize1to5Pool)
const HERMES_POOL14_WEIGHTS = { prize2: 1.0, prize3: 0.4, prize4: 0.2 };
function _buildPrize1to4Pool(row){
  const pool=[];
  const W=HERMES_POOL14_WEIGHTS;
  [['prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',W.prize2],
   ['prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10',W.prize3]
  ].forEach(cols=>{
    const w=cols[cols.length-1];
    cols.slice(0,-1).forEach(k=>{
      const raw=String(row?.[k]||'').trim();
      if(!raw)return;
      const v=raw.padStart(6,'0');
      if(/^\d{6}$/.test(v))pool.push({num:v,w});
    });
  });
  for(const tok of String(row?.prize4||'').trim().split(/\s+/)){
    if(/^\d{6}$/.test(tok))pool.push({num:tok,w:W.prize4});
  }
  return pool;
}

// Hermes Pool 1-4 — นับความถี่รายหลัก (ตำแหน่ง 0-5) ถ่วงน้ำหนักตามมูลค่ารางวัลของแต่ละเลขใน
// pool 1-4 ของงวดก่อนหน้า จัดอันดับ 0-9 ต่อหลัก (tie-break digit น้อยก่อน เหมือน _digitPosFreq)
// แล้วประกอบ topN ชุดผ่าน _imperialRoundRobin (K=8) — ลายเซ็น Hermes: เน้นสัญญาณจากรางวัลใหญ่
// (prize2/3) ที่ freq ล้วนแบบ I1 กลบด้วย prize4 50 เลข; ต่างจาก I2/J2 ที่ blend เลขคณิต
// (Hermes ไม่ใช้เลขคณิต/วันที่เลย — อินพุต = งวดก่อนหน้า 1 งวดเท่านั้น)
function _hermesPool14Formula(prevRow, topN=10){
  const pool=_buildPrize1to4Pool(prevRow);
  if(pool.length===0)return [];
  const counts=Array.from({length:6},()=>new Array(10).fill(0));
  for(const e of pool){
    for(let pos=0;pos<6;pos++)counts[pos][Number(e.num[pos])]+=e.w;
  }
  const ranked=counts.map(posCounts=>
    posCounts.map((count,digit)=>({digit:String(digit),count}))
      .sort((a,b)=>b.count-a.count || Number(a.digit)-Number(b.digit))
  );
  return _imperialRoundRobin(ranked.map(posRanked=>posRanked.map(e=>e.digit)),topN,8);
}

// Reusable digit-position frequency scorer — counts digit occurrences per
// position (0-5) across a pool of 6-digit numbers, ranks digits per position
// by frequency (ties broken by ascending digit value). Reused by จักรพรรดิ and
// any future formula targeting the same pool (e.g. ISSUE-7's จักรพรรดิทองคำ).
function _digitPosFreq(pool6){
  if(!Array.isArray(pool6)||pool6.length===0)return null;
  const counts=Array.from({length:6},()=>new Array(10).fill(0));
  for(const num of pool6){
    if(!/^\d{6}$/.test(num))continue;
    for(let pos=0;pos<6;pos++)counts[pos][Number(num[pos])]++;
  }
  return counts.map(posCounts=>
    posCounts.map((count,digit)=>({digit:String(digit),count}))
      .sort((a,b)=>b.count-a.count || Number(a.digit)-Number(b.digit))
  );
}

// สร้าง candidate สุดท้ายแบบ round-robin ต่อหลัก (candidate diversity fix รอบ 2 — เดิม
// (round 1) สร้าง cartesian pool ใหญ่แล้วคัดด้วย Hamming distance ซึ่งวัดผิดมิติ: ระยะห่าง
// รวมทั้งชุดขยับขึ้นจริงแต่ความหลากหลาย "ต่อหลัก" (ต่อคอลัมน์) ยังต่ำ แถมขยาย cap ต่อหลัก
// เพื่อแก้ (top-8) จะทำให้ cartesian ระเบิดเป็น 8⁶=262,144 ชุดต่อการคำนวณ 1 ครั้ง — แก้ใหม่
// โดยสร้างตรงจาก ranked list ต่อหลัก (ไม่ต้องมี cartesian pool เลย) การันตี K หลักไม่ซ้ำต่อ
// ตำแหน่งแบบเป๊ะด้วยการสร้าง ไม่ใช่ fallback/relax:
// - candidate i (0..topN-1), หลัก p ใช้ rankedPerPosition[p] อันดับที่ (r + lap*(p+1)) % K
//   โดย lap=floor(i/K), r=i%K
// - candidate 0 (lap=0,r=0) เป็นอันดับ 1 (เก่งสุด) ทุกตำแหน่งเสมอ — ตรงกับที่เคยรับประกันไว้
// - candidate 0..K-1 (lap 0) แต่ละหลักใช้อันดับเดียวกันทุกตำแหน่ง (0,1,2,...,K-1 ตามลำดับ) —
//   ครบ K หลักไม่ซ้ำต่อตำแหน่งอยู่แล้วจากแค่ K แถวแรกนี้
// - candidate ที่เกิน K (lap>=1) หมุนอันดับแบบเยื้องต่อตำแหน่ง (offset (p+1)*lap) ไม่ให้ทั้งแถว
//   ซ้ำกับแถวก่อนหน้าเป๊ะ (พิสูจน์ด้วยมือ+เทสกับกรณี worst-case ที่ทุกตำแหน่งมี ranking เดียวกัน)
function _imperialRoundRobin(rankedPerPosition, topN=10, K=8){
  const candidates=[];
  for(let i=0;i<topN;i++){
    const lap=Math.floor(i/K), r=i%K;
    let digits='';
    for(let p=0;p<rankedPerPosition.length;p++){
      const idx=(r+lap*(p+1))%K;
      digits+=rankedPerPosition[p][idx];
    }
    candidates.push(digits);
  }
  return candidates;
}

// จักรพรรดิ — จัดอันดับ 10 หลัก (0-9) ต่อตำแหน่งด้วยความถี่ล้วน (จาก _digitPosFreq) แล้วสร้าง
// topN candidate ตรงผ่าน _imperialRoundRobin (K=8 ต่อหลัก) — ไม่มี cartesian pool อีกต่อไป
function _imperialFormula(prevRow, topN=10){
  const pool=_buildPrize1to5Pool(prevRow);
  if(pool.length===0)return [];
  const ranked=_digitPosFreq(pool);
  if(!ranked)return [];
  return _imperialRoundRobin(ranked.map(posRanked=>posRanked.map(e=>e.digit)),topN,8);
}

// จักรพรรดิทองคำ (ISSUE-7, ปรับ round 2) — เดิมผสม 80% freqScore + 20% ความใกล้เคียงเลขคณิต
// ของ "ทั้งชุด 6 หลัก" ซึ่งใช้ไม่ได้กับสถาปัตยกรรม round-robin ที่สร้างทีละหลักอิสระต่อกัน —
// ปรับเป็นผสม**ต่อหลัก**แทน: แต่ละหลัก จัดอันดับ 10 ตัวเลข (0-9) ใหม่ด้วย 0.8×(ความถี่ปรกติ
// ด้วยความถี่สูงสุดของหลักนั้น) + 0.2×(ความใกล้เคียงกับหลักที่ตรงกันของเลขเป้าหมาย (รางวัลที่1
// + วัน×เดือน×ปี ของงวดถัดไป) mod 1,000,000, normalize ด้วย 9) แล้วสร้าง candidate ผ่าน
// _imperialRoundRobin เหมือนจักรพรรดิ — ยังคงให้ผลต่างจากจักรพรรดิจริง (จัดอันดับต่อหลักต่างกัน)
// แค่เปลี่ยนหน่วยจาก "ทั้งชุด" เป็น "ต่อหลัก" ให้เข้ากับสถาปัตยกรรมใหม่
function _codexPool(rows, col, width, targetIso, topN, coeffs){
  const c=coeffs||CODEX_DEFAULT_COEFFS;
  const target=_codexDateParts(null,targetIso);
  const clean=(rows||[])
    .filter(r=>r && r[col] != null && String(r[col]).trim() !== '')
    .map(r=>({num:String(r[col]).padStart(width,'0').slice(-width), date:_codexDateParts(r)}))
    .reverse(); // oldest -> newest, so recency windows and lag are stable
  const total=clean.length;
  const all=Array.from({length:10**width},(_,i)=>String(i).padStart(width,'0'));
  const pos={};
  clean.forEach((r,i)=>{
    if(!pos[r.num]) pos[r.num]=[];
    pos[r.num].push(i);
  });
  const recent80=clean.slice(-80).map(r=>r.num);
  const recent24=clean.slice(-24).map(r=>r.num);
  const f80=_freqMap(recent80), f24=_freqMap(recent24);
  const lastNum=clean.length ? clean[clean.length-1].num : '';
  return all.map(num=>{
    const hits=pos[num]||[];
    const count=hits.length;
    const overdue=count ? total-hits[hits.length-1]-1 : total;
    let sameDay=0, sameMonth=0;
    for(const i of hits){
      if(clean[i].date.day===target.day) sameDay++;
      if(clean[i].date.month===target.month) sameMonth++;
    }
    let score =
      sameDay*c.sameDay +
      sameMonth*c.sameMonth +
      count*c.count +
      (f80[num]||0)*c.f80 +
      (f24[num]||0)*c.f24 +
      Math.min(overdue,160)*c.overdue;
    if(num===lastNum) score*=c.lastNumDecay;
    return {num,score};
  }).sort((a,b)=>b.score-a.score).slice(0,topN).map(x=>x.num);
}

function _codexUnion(parts, limit){
  const out=[];
  for(const arr of parts){
    for(const n of arr||[]){
      if(n && !out.includes(n)){
        out.push(n);
        if(out.length>=limit) return out;
      }
    }
  }
  return out;
}

function _codexHistoryForTarget(targetIso){
  if(!LotteryServerData.formula.history.length) return [];
  if(!targetIso) return LotteryServerData.formula.history.slice();
  const target=new Date(targetIso);
  return LotteryServerData.formula.history.filter(r=>{
    if(!r.date) return false;
    return _parseThai(r.date)<target;
  });
}

function _codexFormulas(rows, targetIso, coeffs){
  const hist=(rows||[]).filter(Boolean);
  const bottomSharp=_codexPool(hist,'bottom2',2,targetIso,10,coeffs);
  const front3=_codexUnion([
    _codexPool(hist,'front3_1',3,targetIso,3,coeffs),
    _codexPool(hist,'front3_2',3,targetIso,3,coeffs),
  ],6);
  const back3=_codexUnion([
    _codexPool(hist,'back3_1',3,targetIso,3,coeffs),
    _codexPool(hist,'back3_2',3,targetIso,3,coeffs),
  ],6);
  const prize1Last2=_codexPool(hist,'top2',2,targetIso,3,coeffs);
  return {bottomSharp,front3,back3,prize1Last2};
}

function _plDigits(row){
  const val=(col,w)=>String(row?.[col]||'').padStart(w,'0').slice(-w);
  const p=val('prize1',6),t=val('top3',3),b=val('bottom2',2),f1=val('front3_1',3),f2=val('front3_2',3),k1=val('back3_1',3),k2=val('back3_2',3);
  const n=x=>Number.isFinite(parseInt(x,10))?parseInt(x,10):0;
  const r={
    'prize1[0]':n(p[0]),'prize1[1]':n(p[1]),'prize1[2]':n(p[2]),'prize1[3]':n(p[3]),'prize1[4]':n(p[4]),'prize1[5]':n(p[5]),
    'top3[0]':n(t[0]),'top3[1]':n(t[1]),'top3[2]':n(t[2]),
    'bottom2[0]':n(b[0]),'bottom2[1]':n(b[1]),
    'front3_1[0]':n(f1[0]),'front3_1[1]':n(f1[1]),'front3_1[2]':n(f1[2]),
    'front3_2[0]':n(f2[0]),'front3_2[1]':n(f2[1]),'front3_2[2]':n(f2[2]),
    'back3_1[0]':n(k1[0]),'back3_1[1]':n(k1[1]),'back3_1[2]':n(k1[2]),
    'back3_2[0]':n(k2[0]),'back3_2[1]':n(k2[1]),'back3_2[2]':n(k2[2]),
  };
  r.front_units=(r['front3_1[2]']+r['front3_2[2]'])%10;
  r.back_units=(r['back3_1[2]']+r['back3_2[2]'])%10;
  r.all_units=(r['front3_1[2]']+r['front3_2[2]']+r['back3_1[2]']+r['back3_2[2]'])%10;
  r.p_front3=(r['prize1[0]']+r['prize1[1]']+r['prize1[2]'])%10;
  return r;
}

function _plDateShift(row, targetIso, add=0){
  let d=1,m=1;
  if(targetIso){const parts=targetIso.split('-').map(Number);m=parts[1]||1;d=parts[2]||1;}
  else if(row?.date){const dt=_parseThai(row.date);d=dt.getDate();m=dt.getMonth()+1;}
  return (d+m+add)%10;
}

function _patternLinkFormulas(prev, targetIso){
  const d=_plDigits(prev);
  const v=(key,add=0)=>((d[key]||0)+add)%10;
  const pairRules=[
    ['prize1[1]',1,'prize1[2]',3],
    ['back3_2[2]',4,'front_units',3],
    ['front3_1[0]',8,'prize1[0]',3],
    ['prize1[1]',1,'back3_1[1]',4],
    ['top3[0]',8,'back3_1[0]',7],
    ['prize1[3]',8,'back3_1[0]',7],
    ['bottom2[0]',4,'front3_1[2]',2],
    ['front3_2[2]',0,'prize1[0]',8],
    ['back3_1[0]',9,'front3_2[1]',6],
    ['prize1[1]',1,'front3_1[0]',2],
    ['bottom2[0]',4,'top3[2]',0],
    ['back3_2[0]',3,'prize1[5]',0],
    ['back_units',8,'top3[1]',2],
    ['bottom2',8,'front3_1[0]',2],
    ['front_units',7,'front3_1[2]',2],
  ];
  const bottom2=[...new Set(pairRules.map(([a,aa,b,bb])=>`${v(a,aa)}${v(b,bb)}`))];
  const tripleRules=[
    ['prize1[0]',9,'day_month',5,'front3_2[2]',2],
    ['prize1[0]',9,'top3[0]',0,'front3_2[2]',2],
    ['prize1[0]',9,'prize1[3]',0,'front3_2[2]',2],
    ['back3_2[1]',3,'back3_2[2]',9,'day_month',9],
    ['top3[0]',0,'front3_1[1]',0,'day_month',9],
    ['prize1[3]',0,'front3_1[1]',0,'day_month',9],
    ['all_units',4,'p_front3',0,'prize1[1]',0],
    ['back3_1[0]',8,'all_units',9,'top3[1]',0],
    ['front3_2[2]',7,'day_month',5,'prize1[4]',0],
    ['prize1[4]',5,'p_front3',0,'front3_2[2]',5],
  ];
  const get=(key,add=0)=>key==='day_month'?_plDateShift(prev,targetIso,add):v(key,add);
  const any3=[...new Set(tripleRules.map(([a,aa,b,bb,c,cc])=>`${get(a,aa)}${get(b,bb)}${get(c,cc)}`))];
  return {bottom2Tight:bottom2.slice(0,5),bottom2Wide:bottom2.slice(0,10),any3:any3.slice(0,10)};
}

function _patternLinkCards(prev, targetIso){
  const P=_patternLinkFormulas(prev,targetIso);
  const numRow=(nums,color='#38bdf8')=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:${color}1a;border:1px solid ${color}66;color:${color};padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
  return [
    _mkFormulaCard('X5 Pattern Link — 2 ตัวคัดเข้ม','F. Pattern Link',
      ['เชื่อมตำแหน่งงวดก่อนกับ 2 ตัวล่างงวดถัดไปจาก pattern ที่ผ่าน train/test',
       'ใช้กฎเดี่ยวที่เคยให้ edge ดีกว่าสุ่ม เช่น prize1[1]+1 → หลักสิบ และ prize1[2]+3 → หลักหน่วย',
       `คัดเฉพาะ ${P.bottom2Tight.length} ชุดแรกเพื่อใช้เป็นสูตรเน้นแม่น`],
      P.bottom2Tight,'เหมาะสำหรับใช้เป็นตัวตัดร่วมกับ Predict และสูตรอื่น'),
    _mkFormulaCard('X6 Pattern Link — 2 ตัวครอบคลุม','F. Pattern Link',
      ['รวม top pattern หลายตัวเพื่อเพิ่ม coverage',
       'แนวคิดจากผลทดลอง: top 10 pattern ให้ hit สูงกว่าสุ่มเมื่อยอมรับจำนวนเลขมากขึ้น',
       `คัด ${P.bottom2Wide.length} ชุดเพื่อให้ Decision Center เลือกเฉพาะที่ซ้ำกับแหล่งอื่น`],
      P.bottom2Wide,'ใช้ในโหมดสมดุล/ลุ้นสูง'),
    _mkFormulaCard('X7 Pattern Link — 3 หลักเชื่อมโยง','F. Pattern Link',
      ['คำนวณ 3 หลักจาก pattern ข้ามตำแหน่ง เช่น prize1[0]+9, day+month+5, front3_2[2]+2',
       '3 หลักมีความแกว่งสูงกว่า 2 ตัว จึงควรใช้เป็นแรงหนุน ไม่ใช้เดี่ยว',
       `คัด ${P.any3.length} ชุดสำหรับเทียบกับ 3 ตัวบน/หน้า/ท้าย`],
      P.any3,'สูตรนี้ควรผ่าน consensus ก่อนนำไปใช้')
  ];
}

function _codexCards(rows, targetIso){
  const C=_codexFormulas(rows,targetIso);
  const numRow=nums=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:rgba(132,204,22,.10);border:1px solid #84cc1666;color:var(--text);padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
  return [
    _mkFormulaCard(
      'X1 Codex Sharp — ท้าย 2 ตัว','F. เจ้าพ่อ Codex',
      ['ให้คะแนนเลข 00-99 จากวันเดียวกัน, เดือนเดียวกัน, ความถี่รวม, 80/24 งวดล่าสุด และเลขค้าง',
       'ตัดคะแนนเลขที่เพิ่งออกงวดก่อนเล็กน้อย เพื่อลด lag-repeat',
       `Fair match กับ Claude D1: ทาย ${C.bottomSharp.length} เลขเท่ากัน`],
      [],numRow(C.bottomSharp)
    ),
    _mkFormulaCard(
      'X2 Codex Front — หน้า 3 ตัว','F. เจ้าพ่อ Codex',
      ['คำนวณแยกหน้า 3 ชุด 1 และชุด 2 แล้วรวมเลขคะแนนสูงสุดแบบไม่ซ้ำ',
       'ใช้สัญญาณ rolling history ชุดเดียวกับ X1',
       `Fair match กับ Claude D2: ทาย ${C.front3.length} เลขเท่ากัน`],
      [],numRow(C.front3)
    ),
    _mkFormulaCard(
      'X3 Codex Back — ท้าย 3 ตัว','F. เจ้าพ่อ Codex',
      ['คำนวณแยกท้าย 3 ชุด 1 และชุด 2 แล้วรวมเลขคะแนนสูงสุดแบบไม่ซ้ำ',
       'สูตรนี้ยังเป็นสนามยาก แต่ช่วยให้เทียบกับ Claude แบบเลขเต็มได้ตรงประเภท',
       `Fair match กับ Claude D3: ทาย ${C.back3.length} เลขเท่ากัน`],
      [],numRow(C.back3)
    ),
    _mkFormulaCard(
      'X4 Codex Prize Tail — ท้าย 2 รางวัลที่ 1','F. เจ้าพ่อ Codex',
      ['ใช้ประวัติ 2 ตัวบน/top2 เพื่อทายท้าย 2 ของรางวัลที่ 1',
       'เป็นวิธีที่ตรงกว่าเอาเลข 6 หลักมาบวกกันแบบล้วน ๆ',
       `Fair match กับ Claude D4: ทาย ${C.prize1Last2.length} เลขเท่ากัน`],
      [],numRow(C.prize1Last2)
    ),
  ];
}

// ─── I. จักรพรรดิ — digit-position frequency จาก pool รางวัล 1-5 ของงวดก่อนหน้าเดียว ───
function _imperialCards(prevRow,nextDay,nextMonth,nextYear2){
  const numRow=nums=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:rgba(192,132,252,.10);border:1px solid #c084fc66;color:var(--text);padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
  const cards=[];
  const preds=_imperialFormula(prevRow,10);
  if(preds.length){
    cards.push(_mkFormulaCard(
      'I1 จักรพรรดิ · เลขเต็ม6หลัก','I. จักรพรรดิ',
      ['นับความถี่เลขแต่ละหลัก (1-6) จาก pool รางวัลที่ 1-5 ของงวดก่อนหน้าเดียว (near1+prize2-5, ~168 เลข)',
       'เลือกเลข 2 อันดับแรกต่อหลัก แล้วผสมข้ามหลักแบบ cartesian คัดคะแนนรวมสูงสุด',
       `เกณฑ์ถูก (backtest): เลขตรงกับตัวใดตัวหนึ่งใน pool รางวัล 1-5 ของงวดนั้น (${preds.length} ชุด)`],
      [],numRow(preds)
    ));
  }
  return cards;
}

// ─── HM. Hermes Pool 1-4 — การ์ดอธิบายวิธีคิด (tab สูตรคำนวณ) ───────────────────
// เจ้าของต้องการเห็นวิธีคำนวณสูตรที่คิดค้นใหม่: pool 1-4 (65 เลข) → ถ่วงน้ำหนักมูลค่าเงิน 5:2:1
// → จัดอันดับรายหลัก → ประกอบ 10 ชุด round-robin (K=8) — data-group="HM" ต้องตรงกับ
// _formulaGroupKey (ไม่งั้นไปปนกลุ่ม A)
function _hermesCards(prevRow){
  const numRow=nums=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:rgba(45,212,191,.10);border:1px solid #2dd4bf66;color:var(--text);padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
  const cards=[];
  const hm=_hermesPool14Formula(prevRow,10);
  if(hm.length)cards.push(_mkFormulaCard(
    'HM · Hermes Pool 1-4','HM · Hermes Pool 1-4',
    ['รวม pool รางวัลที่ 2/3/4 ของงวดก่อนหน้าเดียว (65 เลข — ไม่รวมที่ 1/ข้างเคียง/ที่ 5 เพราะเป้าเคร่งครัดรางวัล 1–4)',
     'นับความถี่รายหลัก (ตำแหน่ง 1-6) ถ่วงน้ำหนักตามมูลค่าเงินรางวัล: ที่2 ×1.0 · ที่3 ×0.4 · ที่4 ×0.2 (สัดส่วน 5:2:1 ตามเงินจริง 200k/80k/40k — กัน prize4 จำนวน 50 เลขกลบสัญญาณรางวัลใหญ่)',
     'จัดอันดับเลข 0-9 ต่อหลัก แล้วประกอบ 10 ชุดแบบ round-robin (K=8 หลักไม่ซ้ำต่อตำแหน่ง)',
     `เกณฑ์ถูก (backtest): เลขตรงกับตัวใดตัวหนึ่งใน pool รางวัล 1-4 ของงวดนั้น (${hm.length} ชุด · 66/10⁶)`,'ข้อจำกัด: 10 ชุด × 66/1,000,000 × 458 งวด ≈ 0.30 hit โดยบังเอิญภายใต้การสุ่ม — เป็นค่าคาดหมาย ไม่ใช่ผล backtest'],
    [],numRow(hm),
    'ทดลอง'
  ));
  return cards;
}

// ─── RLL. Reinforcement Learn LLM — หนึ่งการเรียก LLM ต่องวด ──────────────────
// ticket 05/06: reward = จำนวนหลักที่ตรงของชุดที่ใกล้ที่สุด ไม่ใช่เงินรางวัล; การ์ดห้าขั้นตามดีไซน์
// (arm → prompt/โมเดล → เลข → ผลเทียบค่าสุ่ม → ข้อจำกัด) และไม่พิมพ์ edge ใด ๆ
function _rllCards(response){
  const row=nums=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:rgba(244,114,182,.10);border:1px solid #f472b666;color:var(--text);padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
  const state=(response.arm_state_before||{})[response.arm]||{n:0,sum_r:0};
  const n=Number(state.n)||0;
  const observed=n?Number(state.sum_r)/n:null;
  return _mkFormulaCard(
    'RLL · Reinforcement Learn LLM','RLL · Reinforcement Learn LLM',
    [`arm ที่ถูกเลือก: ${response.arm} · เล่นมาแล้ว ${n} งวด · reward = จำนวนหลักที่ตรงของชุดที่ใกล้ที่สุด (0–6)`,
     `prompt hash ${String(response.prompt_sha256||'').slice(0,16)}… · โมเดล ${response.model||'—'} · อุณหภูมิ 0 และไม่ใช้ seed (ผู้ให้บริการไม่รับประกันซ้ำ)`,
     `ค่าเฉลี่ยของ arm นี้ ${observed==null?'—':observed.toFixed(3)} เทียบค่าสุ่ม 1.496 ต่องวด · ช่วงปกติ 1–3 หลัก`,
     'ยังไม่มีหลักฐานว่าสูตรนี้ดีกว่าการสุ่ม · การเห็นผลต่าง +50% ต้องใช้ประมาณ 480 งวด (~20 ปี)',
     'ทุกใบมี EV เท่ากัน (ประมาณ −40% ต่อใบ) — สูตรไม่เปลี่ยน EV',
     'หนึ่งการเรียกต่องวด · บันทึกผลครั้งแรกแล้วไม่คำนวณซ้ำ (ไม่มีปุ่มสุ่มใหม่)'],
    [], row(response.numbers||[]),
    'ทดลอง'
  );
}

// เจ้าสัว pool6 leg (ISSUE-15) — reuses จักรพรรดิทองคำ's per-position blend structure
// (0.8×freq + 0.2×closeness-to-target, per digit position, via _imperialRoundRobin) but
// keyed to Group J's own arithmetic atom (|BK2 − DSUM|, ISSUE-13) instead of Group D's,
// so it doesn't collapse to จักรพรรดิ/จักรพรรดิทองคำ's exact candidates for the same draw.
// Permanently ทดลอง per ADR-0003 — no gate applies, this leg exists for J's field-type
// coverage (mirroring จักรพรรดิ's bottom2+pool6 shape), not a claim of statistical edge.
// ─── J. เจ้าสัว — bottom2 leg (ISSUE-13), ทดลอง badge ────────────────────────
function _tycoonCards(prevRow,nextDay,nextMonth,nextYear2){
  const numRow=nums=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:rgba(16,185,129,.10);border:1px solid #10b98166;color:var(--text);padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
  const cards=[];
  const preds=_tycoonBottom2Formula(prevRow,nextDay,nextMonth,nextYear2);
  if(preds.length){
    cards.push(_mkFormulaCard(
      'J1 เจ้าสัว · ท้าย2','J. เจ้าสัว',
      ['สูตรจากการค้นหาระบบ (arithmetic search) เหนือครอบครัวสูตรที่ประกาศไว้ล่วงหน้า ไม่ใช่ภูมิปัญญาพื้นบ้าน',
       'pad2(|ท้าย3ชุด2งวดก่อน − (วัน+เดือน+ปี พ.ศ.2หลัก ของงวดถัดไป)|) — DSUM ใช้สูตรเดียวกับกลุ่ม D',
       'ผ่าน train/validation แต่ไม่ผ่าน holdout (เกณฑ์ล่าสุด: train +0.72% validation +1.67% holdout −0.21%) จึงติดป้ายทดลองตาม ADR-0003 — ยังคงร่วมคำนวณ Picks/เลขแนะนำเต็มรูปแบบ'],
      [],numRow(preds),'ทดลอง'
    ));
  }
  return cards;
}

function _formulaEmptyStateHtml(message){
  const state=document.createElement('div');
  state.className='formula-tab-empty';
  state.style.cssText='display:block;grid-column:1/-1';
  state.setAttribute('role','status');
  state.textContent=message;
  return state.outerHTML;
}

function _formulaResponseTargetMatches(response,target){
  return typeof response?.target_date==='string'&&response.target_date===target;
}

function _formulaResponseHasValidCandidates(response,count=5){
  if(!Array.isArray(response?.numbers)||response.numbers.length!==count)return false;
  return response.numbers.every(number=>typeof number==='string'&&/^[0-9]{6}$/.test(number))
    &&new Set(response.numbers).size===count;
}

function runAllFormulas(options={}){
  const calculation=_runAllFormulas(options);
  const calculationId=Number(window._formulaCalculationRequestId)||0;
  return calculation.catch(()=>{
    if(calculationId===window._formulaCalculationRequestId){
      window._formulaCalculationPending=false;
      syncFormulaSnapshotButton();
    }
    if(typeof window!=='undefined'&&typeof window.setPageStatus==='function')window.setPageStatus('formula-status','คำนวณสูตรไม่สำเร็จ ลองใหม่อีกครั้ง');
    return false;
  });
}

async function _runAllFormulas({userInitiated=false}={}){
  if(LotteryUiState.formula.activeTab==='ASTRA'){
    if(!userInitiated||LotteryUiState.formula.autoFillPending)return false;
    return loadSelectedAstraFormula({recompute:true});
  }
  if(LotteryUiState.formula.sourceStale){
    if(typeof toast==='function')toast('ผลสูตรใช้ข้อมูลก่อนรีเฟรช · โหลดข้อมูลล่าสุดก่อนคำนวณ','error');
    return false;
  }
  if(LotteryUiState.formula.autoFillPending)return false;
  const calculationId=(Number(window._formulaCalculationRequestId)||0)+1;
  window._formulaCalculationRequestId=calculationId;
  window._formulaCalculationPending=false;
  if(!_validateFormulaInputs()){
    LotteryUiState.formula.hasRun=false;
    syncFormulaSnapshotButton();
    if(typeof window!=='undefined'&&typeof window.setPageStatus==='function')window.setPageStatus('formula-status','มีช่องข้อมูลต้องตรวจสอบก่อนคำนวณ');
    return;
  }
  window._formulaCalculationPending=true;
  LotteryUiState.formula.hasRun=false;
  syncFormulaSnapshotButton();
  setFormulaLoading('ขั้น 1/4 · กำลังคำนวณสูตรพื้นฐานจากข้อมูลอ้างอิง...');
  const fanoPanel=document.getElementById('formula-results-FANO');
  if(fanoPanel)fanoPanel.innerHTML=_formulaEmptyStateHtml('กำลังคำนวณระนาบฟาโนจากประวัติทุกงวดก่อนวันเป้าหมาย...');
  const prize1=_fv('f-prize1').padStart(6,'0');
  const top3=_fv('f-top3').padStart(3,'0');
  const bottom2=_fv('f-bottom2').padStart(2,'0');
  const front31=_fv('f-front3-1').padStart(3,'0');
  const front32=_fv('f-front3-2').padStart(3,'0');
  const back31=_fv('f-back3-1').padStart(3,'0');
  const back32=_fv('f-back3-2').padStart(3,'0');
  const drawday=parseInt(_fv('f-drawday'))||1;
  const bday=parseInt(_fv('f-bday'))||0;
  const bmon=parseInt(_fv('f-bmon'))||0;
  const byear=parseInt(_fv('f-byear'))||0;

  // ดึงงวดปัจจุบัน (next draw date) จาก f-target-date
  const predDateStr=document.getElementById('f-target-date').value||'';
  let nextDay=1, nextMonth=1, nextYear2=68;
  if(predDateStr){
    const [y,m,d]=predDateStr.split('-').map(Number);
    nextDay=d; nextMonth=m; nextYear2=(y+543)%100;
  }

  const cards=[];

  // ══ A. สูตรกูชอบ facebook ══

  // 1. สูตรบวกเลขบนล่าง
  try{
    const digits=[...top3,...bottom2].map(Number);
    const total=digits.reduce((a,b)=>a+b,0);
    const d1=total%10;
    const d2=Math.floor(total/10)%10;
    const highlights=[...new Set([d1,d2])].map(String);
    cards.push(_mkFormulaCard(
      'สูตรบวกเลขบนล่าง','A. สูตรกูชอบ',
      [`3ตัวบน: ${top3} + 2ตัวล่าง: ${bottom2}`,`ผลรวมทุกหลัก: ${top3}+${bottom2} = ${digits.join('+')} = ${total}`,`เลขเด่น: หลักสิบ=${d2}, หลักหน่วย=${d1}`],
      highlights,'ใช้ตัวเลขเด่นเป็นตัวนำในงวดถัดไป'
    ));
  }catch(e){}

  // 2. สูตรเลขคี่เลขคู่
  try{
    const allNums=[...prize1,...top3,...bottom2,...back31,...back32].map(Number);
    const odd=allNums.filter(d=>d%2!==0).length;
    const even=allNums.filter(d=>d%2===0).length;
    const trend=odd>even?'งวดนี้มีเลขคี่มาก → งวดหน้ามักออกเลขคู่':'งวดนี้มีเลขคู่มาก → งวดหน้ามักออกเลขคี่';
    const hint=odd>even?['0','2','4','6','8']:['1','3','5','7','9'];
    cards.push(_mkFormulaCard(
      'สูตรเลขคี่เลขคู่','A. สูตรกูชอบ',
      [`เลขคี่ทั้งหมด: ${odd} ตัว, เลขคู่: ${even} ตัว`,trend],
      hint,'เลขเด่นที่ควรให้ความสนใจ'
    ));
  }catch(e){}

  // 3. สูตรคูณหลักร้อย×หลักสิบ (จากรางวัลที่ 1)
  try{
    const d100=parseInt(prize1[3]||'0');
    const d10=parseInt(prize1[4]||'0');
    const prod=d100*d10;
    const result=prod%10;
    cards.push(_mkFormulaCard(
      'สูตรคูณหลักร้อย × หลักสิบ','A. สูตรกูชอบ',
      [`รางวัลที่ 1: ${prize1}`,`หลักร้อย(ตัวที่4)=${d100} × หลักสิบ(ตัวที่5)=${d10} = ${prod}`,`เลขเด่น = หลักหน่วย = ${result}`],
      [String(result)]
    ));
  }catch(e){}

  // 4. สูตรวันหวยออก
  try{
    const dayMap={1:['อาทิตย์(0,1)','จันทร์(2,3)','อังคาร(4,5)','พุธ(6,7)'],16:['พฤหัส(1,4)','ศุกร์(5,7)','เสาร์(2,8,9)']};
    const nums1=[0,1,2,3,4,5,6,7];
    const nums16=[1,2,4,5,7,8,9];
    const recNums=drawday===16?nums16:nums1;
    cards.push(_mkFormulaCard(
      `สูตรวันหวยออก (งวดวันที่ ${drawday})`,`A. สูตรกูชอบ`,
      [`งวดออกวันที่ ${drawday}`,`เลขนำโชคตามวัน: ${(dayMap[drawday]||dayMap[1]).join(', ')}`],
      recNums.map(String)
    ));
  }catch(e){}

  // 5. สูตรอมตะ (36 คู่)
  try{
    const p=prize1.padStart(6,'0');
    const dPhan=parseInt(p[2]); // หลักพัน (ตำแหน่งที่ 3)
    const dSib=parseInt(p[4]);  // หลักสิบ (ตำแหน่งที่ 5)
    const X=(dPhan+dSib)%10;
    const g1=[X,(X+1)%10,(X+2)%10,(X+3)%10,(X+4)%10,(X+6)%10];
    const g2start=(g1[5]+1)%10;
    const g2=[g2start,(g2start+1)%10,(g2start+2)%10,(g2start+3)%10,(g2start+4)%10,(g2start+5)%10];
    const gridHtml=`<div style="display:flex;flex-direction:column;gap:3px;margin-top:6px">`+
      g1.map(a=>`<div style="display:flex;gap:3px">`+
        g2.map(b=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.82rem;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:2px 5px;border-radius:4px;min-width:26px;text-align:center">${a}${b}</span>`).join('')+
      `</div>`).join('')+`</div>`;
    cards.push(_mkFormulaCard(
      'สูตรอมตะ','A. สูตรกูชอบ',
      [`รางวัลที่1: ${p} → หลักพัน(${dPhan}) + หลักสิบ(${dSib}) = ${dPhan+dSib} → X = ${X}`,
       `ชุด 1 (6 ตัว): ${g1.join(', ')}  (X…X+4 แล้วข้าม +2)`,
       `ชุด 2 (6 ตัว): ${g2.join(', ')}  (ต่อจากชุด1+1 นับ 6 ตัว)`,
       `จับคู่ 36 คู่ (ชุด1=สิบ, ชุด2=หน่วย):`],
      [],gridHtml
    ));
  }catch(e){}

  // ══ B. สูตรล็อตเตอรี่พลัส ══

  // 5. สูตรเลขสองตัวล่าง (วัน+เดือน+ปี+หน่วยล่าง)
  try{
    const unit2=parseInt(bottom2[1]||'0');
    let sum=nextDay+nextMonth+nextYear2+unit2;
    if(sum>99) sum-=100;
    const result=_pad(sum,2);
    const rev=result[1]+result[0];
    cards.push(_mkFormulaCard(
      'สูตรเลขสองตัวล่าง (Lottery+)','B. สูตรล็อตเตอรี่พลัส',
      [`วัน(${nextDay})+เดือน(${nextMonth})+ปี(${nextYear2}) = ${nextDay+nextMonth+nextYear2}`,`+หน่วยล่าง(${unit2}) = ${nextDay+nextMonth+nextYear2+unit2}${sum!==nextDay+nextMonth+nextYear2+unit2?' → -100 = '+sum:''}`,`เลขเด่น: ${result} | กลับคู่: ${rev}`],
      [result,rev],'ถ้าเลขซ้ำกับงวดก่อน ให้กลับคู่เสมอ'
    ));
  }catch(e){}

  // 6. สูตรรางวัลที่ 1 (วันเกิด+ราศี)
  if(bday&&bmon&&byear){
    try{
      const zodiacNum=[8,6,9,4,7,3,5,2,8,10,8,6]; // ราศีแต่ละเดือน (ม.ค.ถึงธ.ค.)
      const zodiacName=['มกร','กุมภ์','มีน','เมษ','พฤษภ','เมถุน','กรกฎ','สิงห์','กันย์','ตุลย์','พิจิก','ธนู'];
      const birthY2=(byear-543)%100;
      let sum=bday+bmon+birthY2+nextDay+nextMonth;
      const zodIdx=nextMonth-1;
      const zodNum=zodiacNum[zodIdx]%10;
      sum+=zodNum;
      const result=_pad(sum%100,2);
      cards.push(_mkFormulaCard(
        'สูตรรางวัลที่ 1 (วันเกิด+ราศี)','B. สูตรล็อตเตอรี่พลัส',
        [`วันเกิด ${bday}/${bmon}/${byear} → ${bday}+${bmon}+${birthY2} = ${bday+bmon+birthY2}`,`+งวด(${nextDay}+${nextMonth}) = ${bday+bmon+birthY2+nextDay+nextMonth}`,`+เลขราศีพิจิก(${zodiacName[zodIdx]})=${zodNum} → รวม=${sum} → เลขเด่น=${result}`,`ชุดแนะนำ: ${result}, ${result[1]}${result[0]}, ${prize1[3]}${result}, ${prize1[2]}${result}`],
        [result,result[1]+result[0]],'ทริค: ถ้าซ้ำกับงวดก่อน กลับคู่เสมอ'
      ));
    }catch(e){}
  } else {
    cards.push(_mkFormulaCard(
      'สูตรรางวัลที่ 1 (วันเกิด+ราศี)','B. สูตรล็อตเตอรี่พลัส',
      ['ต้องกรอก วัน/เดือน/ปีเกิด (พ.ศ.) ก่อน'],[],'กรอกข้อมูลวันเกิดด้านบน'
    ));
  }

  // ══ C. สูตรลับพิชิตโชค ══

  // 7. สูตรผันผวนเป็นตัวเงิน (จาก 3ตัวล่างชุด1)
  try{
    const b=back31.padStart(3,'0');
    const r_h=b[0], r_t=b[1], r_u=b[2];
    // ขั้น1: แถว1=[r_h,r_t] แถว2=[r_u,r_u] บวกไม่ทด
    const step1_h=(parseInt(r_h)+parseInt(r_u))%10;
    const step1_t=(parseInt(r_t)+parseInt(r_u))%10;
    const step1=`${step1_h}${step1_t}`;
    // ขั้น2: บวกร้อยมาลัย (step1_h+step1_t) mod 10
    const step2=(step1_h+step1_t)%10;
    // ขั้น3: step1 ลบ step2step2 ไม่ยืม
    const res_h=Math.abs(step1_h-step2)%10;
    const res_t=Math.abs(step1_t-step2)%10;
    const result=`${res_h}${res_t}`;
    cards.push(_mkFormulaCard(
      'สูตรผันผวนเป็นตัวเงิน','C. สูตรลับพิชิตโชค (คุณยายสวัสดิ์)',
      [`3ตัวล่างชุด1: ${b} → ร้อย=${r_h} สิบ=${r_t} หน่วย=${r_u}`,`ขั้น1: [${r_h}+${r_u}]mod10=[${step1_h}], [${r_t}+${r_u}]mod10=[${step1_t}] → ${step1}`,`ขั้น2: (${step1_h}+${step1_t})mod10 = ${step2}`,`ขั้น3: |${step1_h}-${step2}|=${res_h}, |${step1_t}-${step2}|=${res_t} → เลขเด่น: ${result}`],
      [result,result[1]+result[0]],'ใช้ได้กับ 3ตัวบน รางวัลที่1 และ 2ตัวล่าง'
    ));
  }catch(e){}

  // 8. สูตร 2530 ปีทอง
  try{
    const p=prize1.padStart(6,'0');
    // ใช้ 4 หลักหลัง (พัน-ร้อย-สิบ-หน่วย) + 2530 ไม่ทด
    const p4=p.slice(2); // xxxxXX → X4 = p[2..5]
    const add='2530';
    const r=p4.split('').map((d,i)=>(parseInt(d)+parseInt(add[i]))%10).join('');
    cards.push(_mkFormulaCard(
      'สูตร 2530 ปีทอง','C. สูตรลับพิชิตโชค (คุณยายสวัสดิ์)',
      [`รางวัลที่ 1: ${prize1} → ใช้หลักพัน-ร้อย-สิบ-หน่วย: ${p4}`,`บวก 2530 (ไม่ทดเศษ): ${p4} + 2530 = ${r}`,`ทำนาย 4 หลักท้ายรางวัลที่ 1 (Backtest: เทียบตำแหน่ง)`],
      [r],'เปรียบเทียบ 4 หลักท้ายรางวัลที่ 1 ตรงตำแหน่ง'
    ));
  }catch(e){}

  // 9. สูตรหงส์ฟ้าถล่มปฐพี
  try{
    const p=prize1.padStart(6,'0');
    // แถว1=แสน+หมื่น, แถว2=พัน+ร้อย, แถว3=สิบ+หน่วย, แถว4=bottom2
    const rows=[
      [parseInt(p[0]),parseInt(p[1])],
      [parseInt(p[2]),parseInt(p[3])],
      [parseInt(p[4]),parseInt(p[5])],
      [parseInt(bottom2[0]||0),parseInt(bottom2[1]||0)]
    ];
    // บวกแต่ละคอลัมน์ มีการทด
    const colA=rows[0][0]+rows[1][0]+rows[2][0]+rows[3][0];
    const colB=rows[0][1]+rows[1][1]+rows[2][1]+rows[3][1];
    const carry=Math.floor(colB/10);
    const step1_t=(colA+carry)%10;
    const step1_u=colB%10;
    const step1=`${step1_t}${step1_u}`;
    // เอา step1 (2หลัก→3หลัก ถ้าสั้น pad) บวก back32 (ครั้งที่3→ใช้ชุด2)
    const b2=back32.padStart(3,'0');
    const s1_padded=step1.padStart(3,'0');
    let final=0;
    const fa=s1_padded.split('').map(Number);
    const fb=b2.split('').map(Number);
    const raw=fa.map((d,i)=>d+fb[i]);
    // มีทด
    let carry2=0, res=[];
    for(let i=2;i>=0;i--){const s=raw[i]+carry2;res.unshift(s%10);carry2=Math.floor(s/10);}
    const result3=res.join('');
    cards.push(_mkFormulaCard(
      'สูตรหงส์ฟ้าถล่มปฐพี','C. สูตรลับพิชิตโชค (คุณยายสวัสดิ์)',
      [`รางวัลที่1: ${p} + 2ตัวล่าง: ${bottom2}`,`แยกคู่ [${p[0]}${p[1]}]+[${p[2]}${p[3]}]+[${p[4]}${p[5]}]+[${bottom2}] (บวกทด) → ${step1}`,`${step1} + 3ตัวล่างชุด2(${b2}) = ${result3}`,`เลขเด่น: ${result3}`],
      [result3,result3.slice(1)],'ใช้ 3ตัวล่างชุด2 แทน หมุนครั้งที่3'
    ));
  }catch(e){}

  // ══ D. เจ้าพ่อ Claude — arithmetic creative formulas ══
  const p6=prize1.padStart(6,'0');
  const t3=top3.padStart(3,'0');
  const b2=bottom2.padStart(2,'0');
  const bk1=back31.padStart(3,'0');
  const bk2=back32.padStart(3,'0');

  function _digs(arr,k){return[...new Set(arr.map(n=>String(((Math.round(n)%10)+10)%10)))].slice(0,k);}
  function _chip(txt,hl){return `<span style="font-family:'IBM Plex Mono',monospace;font-size:1rem;background:${hl?'rgba(34,211,238,.14)':'var(--surface2)'};border:1px solid ${hl?'#22d3ee66':'var(--border2)'};color:var(--text);padding:4px 11px;border-radius:7px;font-weight:700">${txt}</span>`;}
  function _numRow(nums){return `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:3px 9px;border-radius:6px">${n}</span>`).join('')}</div>`;}
  function _runChips(ds){return `<div style="margin-top:4px">เลขวิ่ง: ${ds.map(d=>_chip(d,true)).join(' ')}</div>`;}
  const p1sumD=p6.split('').map(Number).reduce((a,b)=>a+b,0);

  const _D=_claudeFormulas({p6,t3,b2,bk1,bk2,drawday,nextDay,nextMonth,nextYear2});

  // D1 สายธารรากตัวเลข — ท้าย 2 ตัว (เลขเต็มจากสูตรย่อย)
  cards.push(_mkFormulaCard(
    'D1 สายธารรากตัวเลข — ท้าย 2 ตัว','D. เจ้าพ่อ Claude',
    [`อ้างอิงงวดก่อน → prize1:${p6} ท้าย2:${b2} ท้าย3:${bk1}/${bk2}`,
     `①ซ้ำท้าย2 ②กลับท้าย2 ③สลับขั้ว(99-B2) ④ท้าย2รางวัล+B2 ⑤ท้าย2×2ชุดบวก ⑥ท้าย2รางวัล ⑦ท้าย2ชุด1 ⑧วันเดือนปี+หน่วย ⑨วัน×เดือน+สิบ ⑩หน้า2ท้าย4รางวัล`,
     `เกณฑ์ถูก: เลขท้าย 2 ตัวออกตรงกับชุดนี้`],
    [],`<div style="font-size:.82rem;color:var(--text2);margin-bottom:2px">เลขท้าย 2 ตัวที่ทำนาย (${_D.d1.length} ชุด):</div>`+_numRow(_D.d1)
  ));

  // D2 มังกรวาด — หน้า 3 ตัว
  cards.push(_mkFormulaCard(
    'D2 มังกรวาด — หน้า 3 ตัว','D. เจ้าพ่อ Claude',
    [`อ้างอิงงวดก่อน → prize1:${p6} ท้าย3:${bk1}/${bk2}`,
     `①3หน้า+ท้าย3 ②3ท้าย+วัน×เดือน ③ท้าย3×2+3บน ④กลับ3หน้า ⑤ท้าย3+วันเดือน ⑥3ท้าย+ท้าย2`,
     `เกณฑ์ถูก: เลขหน้า 3 ตัวออกตรงกับชุดนี้`],
    [],`<div style="font-size:.82rem;color:var(--text2);margin-bottom:2px">เลขหน้า 3 ตัวที่ทำนาย (${_D.d2.length} ชุด):</div>`+_numRow(_D.d2)
  ));

  // D3 หักล้างชะตา — ท้าย 3 ตัว
  cards.push(_mkFormulaCard(
    'D3 หักล้างชะตา — ท้าย 3 ตัว','D. เจ้าพ่อ Claude',
    [`อ้างอิงงวดก่อน → ท้าย3:${bk1}/${bk2} prize1:${p6}`,
     `①ท้าย3×2บวก ②3ท้าย+วัน ③กลับท้าย3ชุด1 ④ท้าย3ชุด2+เดือน×ปี ⑤ท้าย3+B2×10 ⑥3หน้า+ท้าย3ชุด2`,
     `เกณฑ์ถูก: เลขท้าย 3 ตัวออกตรงกับชุดนี้`],
    [],`<div style="font-size:.82rem;color:var(--text2);margin-bottom:2px">เลขท้าย 3 ตัวที่ทำนาย (${_D.d3.length} ชุด):</div>`+_numRow(_D.d3)
  ));

  // D4 วงจรชีวิต — รางวัลที่ 1
  cards.push(_mkFormulaCard(
    'D4 วงจรชีวิต — รางวัลที่ 1','D. เจ้าพ่อ Claude',
    [`อ้างอิงงวดก่อน → prize1:${p6}`,
     `เลข6หลัก: ①(รางวัล+ท้าย3คูณ) ②(รางวัล+วัน×เดือน×ปี) ③กลับเลขรางวัล`,
     `เกณฑ์ถูก (backtest): ท้าย 2 ตัวของรางวัลที่ 1 ออกตรง`],
    [],`<div style="font-size:.82rem;color:var(--text2);margin-bottom:2px">เลข 6 หลักเต็มที่ทำนาย:</div>`+_numRow(_D.d4full)+`<div style="margin-top:8px;font-size:.82rem;color:var(--text2)">ท้าย 2 ตัวรางวัลที่ 1 (${_D.d4two.length} ชุด):</div>`+_numRow(_D.d4two)
  ));

  // ══ E. สายมู/ความเชื่อ — อ้างอิงวันที่งวด + โหราศาสตร์ไทย ══
  const eCards=_computeBeliefCards(nextDay,nextMonth,nextYear2,predDateStr);
  const codexCards=_codexCards(_codexHistoryForTarget(predDateStr),predDateStr);
  const patternCards=_patternLinkCards({prize1,top3,bottom2,front3_1:front31,front3_2:front32,back3_1:back31,back3_2:back32},predDateStr);
  const thepCards=_maenKhanThepCards({p6:prize1,t3:top3,b2:bottom2,f31:front31,f32:front32,bk1:back31,bk2:back32});
  const misterCCards=_misterCCards({p6:prize1,t3:top3,b2:bottom2,f31:front31,bk1:back31,bk2:back32});
  const imperialPrevRow=_codexHistoryForTarget(predDateStr)[0]||null;
  const imperialCards=imperialPrevRow?_imperialCards(imperialPrevRow,nextDay,nextMonth,nextYear2):[];
  const tycoonCards=imperialPrevRow?_tycoonCards(imperialPrevRow,nextDay,nextMonth,nextYear2):[];
  const hermesCards=imperialPrevRow?_hermesCards(imperialPrevRow):[];

  // Fano is an isolated, read-only diversification hypothesis; it is not a consensus pick.
  let fanoCards=0;
  let fanoHtml='';
  let fanoResult=null;
  let fanoV5Result=null;
  try{
    setFormulaLoading('ขั้น 2/4 · ตรวจสูตรพื้นฐานแล้ว กำลังคำนวณระนาบฟาโน v4...');
    const response=await api(`fano/formula?date=${encodeURIComponent(predDateStr)}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(calculationId!==window._formulaCalculationRequestId)return false;
    const targetMatches=_formulaResponseTargetMatches(response,predDateStr);
    if(!response?.ok||!_formulaResponseHasValidCandidates(response)||!targetMatches){
      const message=response?.ok&&!targetMatches?'ผลระนาบฟาโนไม่ตรงกับงวดที่เลือก กรุณาคำนวณงวดนี้ใหม่':response?.detail||response?.error||'คำนวณระนาบฟาโนไม่สำเร็จ ตรวจสอบประวัติหรือการเชื่อมต่อแล้วลองใหม่';
      fanoHtml=_formulaEmptyStateHtml(message);
    }else{
      fanoResult=response;
      const settings=response.settings||{};
      const pairCoverage=(settings.position_pair_coverage||[]).map(item=>
        `${item.positions.join('–')}: ${item.covered_patterns}`
      ).join(' · ');
      const firstDate=settings.training_start_date||'ไม่ทราบ';
      const lastDate=settings.training_cutoff_date||'ไม่ทราบ';
      const note=`ทดลอง · ใช้ ${settings.valid_draws} งวด · ปรับทั้งพอร์ต 5 เลขด้วยน้ำหนักคู่ย้อนหลัง`;
      const card=_mkFormulaCard('ระนาบฟาโน v4 · Variable Neighborhood Cover','FANO. สูตรรางวัลที่ 1',[
        `งวดเป้าหมาย ${response.target_date} · ประวัติครอบคลุม ${firstDate} ถึง ${lastDate}`,
        `ใช้รางวัลที่ 1 ที่ถูกต้อง ${settings.valid_draws} งวด จากทุกงวดที่เข้าถึงได้ก่อนวันเป้าหมาย`,
        `คำนวณน้ำหนักจากคู่ตำแหน่งทั้ง 15 คู่ ใช้ครบทุกเลข 0–9 และ smoothing α=${settings.pair_smoothing_alpha}`,
        `เริ่มจากพอร์ต self-seed ที่สร้างเองแบบ greedy pair-cover (tie-break จาก fingerprint ประวัติ) ขัดเกลาด้วย coordinate ascent แล้วค้นหาซ้ำ ${settings.optimizer_restarts} รอบ · รอบละ ${settings.optimizer_proposals_per_restart} การลอง ทั้งเปลี่ยนบางหลัก/ทั้งเลข · รับการเปลี่ยนแปลงที่ดีขึ้นหรือบางครั้งยอมรับคะแนนลดเพื่อหนีจุดตัน`,
        `ขัดเกลาด้วย coordinate ascent หลังค้นหา · คะแนนฐาน seed ${Number(settings.optimizer_base_score||0).toFixed(4)} · คะแนนใหม่ ${Number(settings.weighted_pair_coverage_score||0).toFixed(4)} · เว้นระยะอย่างน้อย ${settings.minimum_pairwise_hamming_distance} หลัก`,
        `คู่น้ำหนักที่ครอบคลุมต่อคู่ตำแหน่ง: ${pairCoverage}`,
        `คะแนน weighted pair coverage รวม ${Number(settings.weighted_pair_coverage_score||0).toFixed(4)} · ผลดีที่สุดจาก ${settings.optimized_start||'—'}`,
        'นี่คือการประยุกต์หลักคิดการครอบคลุมคู่กับเลข 6 หลักแบบมีตำแหน่ง ไม่ใช่ชุดตั๋ว 27 ใบ UK Lotto'
      ],response.numbers,note,'ทดลอง');
      fanoHtml+=card;
      fanoCards++;
    }
  }catch(e){
    fanoHtml+=_formulaEmptyStateHtml('คำนวณระนาบฟาโน v4 ไม่สำเร็จ ตรวจสอบประวัติหรือการเชื่อมต่อแล้วลองใหม่');
  }
  try{
    setFormulaLoading('ขั้น 3/4 · ตรวจระนาบฟาโน v4 แล้ว กำลังคำนวณ v5...');
    const response=await api(`fano/formula?date=${encodeURIComponent(predDateStr)}&version=fano-v5-adaptive-rank-codebook`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(calculationId!==window._formulaCalculationRequestId)return false;
    const targetMatches=_formulaResponseTargetMatches(response,predDateStr);
    if(!response?.ok||!_formulaResponseHasValidCandidates(response)||!targetMatches){
      const message=response?.ok&&!targetMatches?'ผลระนาบฟาโน v5 ไม่ตรงกับงวดที่เลือก กรุณาคำนวณงวดนี้ใหม่':response?.detail||response?.error||'คำนวณระนาบฟาโน v5 ไม่สำเร็จ ตรวจสอบประวัติหรือการเชื่อมต่อแล้วลองใหม่';
      fanoHtml+=_formulaEmptyStateHtml(message);
    }else{
      fanoV5Result=response;
      const settings=response.settings||{};
      const choices=(settings.position_choices||[]).map(item=>
        `หลัก ${item.position}: ${item.signal} เลือกอันดับ ${item.rank_pair.join(' และ ')} (${item.digits.join('/')} )`
      ).join(' · ');
      const origin=settings.retrospective_selection||{};
      const firstDate=settings.training_start_date||'ไม่ทราบ';
      const lastDate=settings.training_cutoff_date||'ไม่ทราบ';
      const note='ทดลอง · config คัดแบบ post-hoc จากผล 759 งวดเดียวกัน ไม่ใช่ผลยืนยันอิสระ';
      const card=_mkFormulaCard('ระนาบฟาโน v5 · Adaptive Rank Codebook · post-hoc','FANO. สูตรรางวัลที่ 1',[ 
        `งวดเป้าหมาย ${response.target_date} · ประวัติครอบคลุม ${firstDate} ถึง ${lastDate}`,
        `ใช้รางวัลที่ 1 ที่ถูกต้อง ${settings.valid_draws} งวด จากทุกงวดที่เข้าถึงได้ก่อนวันเป้าหมาย`,
        `สัญญาณรายหลัก: ${choices}`,
        `สร้าง codebook จากระนาบฟาโน 7 จุด/7 เส้น · เว้นเส้น ${settings.punctured_line} · ตัดจุด ${settings.omitted_points?.join(' และ ')} · เหลือ ${settings.candidate_count} ชุด`,
        `การค้นหาต้นทางคัด 1 ใน ${Number(origin.selected_from_variants||0).toLocaleString()} แบบ จากผลย้อนหลัง ${origin.discovery_target_draws||0} งวด ได้ ${origin.discovery_hits||0} hit (${Number(origin.discovery_hit_rate_percent||0).toFixed(4)}%)`,
        'ผลย้อนหลังข้างต้นถูกใช้เลือก config เดียวกัน จึงเป็น post-hoc และไม่ใช่การทดสอบอิสระ · แสดงแยกจาก Picks',
        'Fano-inspired สำหรับเลขหกหลักไทย ไม่ใช่ชุดตั๋ว UK Lotto 27 ใบ'
      ],response.numbers,note,'ทดลอง');
      fanoHtml+=card;
      fanoCards++;
    }
  }catch(e){
    fanoHtml+=_formulaEmptyStateHtml('คำนวณระนาบฟาโน v5 ไม่สำเร็จ ตรวจสอบประวัติหรือการเชื่อมต่อแล้วลองใหม่');
  }
  // RLL: an isolated hypothesis with one live LLM call per draw. It renders beside the formula
  // families and never feeds Mix; the record is stored server-side and never recomputed.
  let rllCards=0;
  let rllHtml='';
  try{
    const response=await api(`rll/formula?date=${encodeURIComponent(predDateStr)}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    if(calculationId!==window._formulaCalculationRequestId)return false;
    const targetMatches=_formulaResponseTargetMatches(response,predDateStr);
    const numbersOk=Array.isArray(response?.numbers)&&response.numbers.length===5&&response.numbers.every(n=>/^[0-9]{6}$/.test(String(n)));
    if(!response?.ok||response.status==='unavailable'||!numbersOk||!targetMatches){
      const message=response?.status==='unavailable'
        ?'งวดนี้ไม่มีเลข (โมเดลไม่ตอบ) — ไม่มีการเติมเลขสำรอง'
        :response?.ok&&!targetMatches?'ผล RLL ไม่ตรงกับงวดที่เลือก กรุณาคำนวณงวดนี้ใหม่'
        :response?.detail||'คำนวณ RLL ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่';
      rllHtml=_formulaEmptyStateHtml(message);
    }else{
      const card=_rllCards(response);
      if(card){rllHtml+=card;rllCards++;}
    }
  }catch(e){
    rllHtml+=_formulaEmptyStateHtml('คำนวณ RLL ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }


  // กระจายการ์ดเข้า container ตามกลุ่ม
  const grouped=_groupFormulaCards(cards.concat(thepCards,misterCCards));
  const groupA=grouped.A.join('');
  const groupB=grouped.B.join('');
  const groupC=grouped.C.join('');
  const groupD=grouped.D.join('');
  const groupG=grouped.G.join('');
  const groupH=grouped.H.join('');
  const groupF=codexCards.concat(patternCards).join('');
  const groupI=imperialCards.join('');
  const groupJ=tycoonCards.join('');
  const groupHM=hermesCards.join('');
  const groupAll=cards.concat(codexCards,patternCards,thepCards,misterCCards,eCards,imperialCards,tycoonCards,hermesCards,fanoHtml,rllHtml).join('');
  setFormulaLoading('ขั้น 4/4 · คำนวณส่วนหลักแล้ว กำลังจัดทำผลรวมและข้อมูลอ้างอิง...');
  _renderFormulaSummary({grouped,codexCards,patternCards,eCards,imperialCards,tycoonCards,hermesCards,fanoCards,rllCards,targetDate:predDateStr});

  document.getElementById('formula-results-A').innerHTML=_formulaPanelHtml(groupA,'A');
  document.getElementById('formula-results-B').innerHTML=_formulaPanelHtml(groupB,'B');
  document.getElementById('formula-results-C').innerHTML=_formulaPanelHtml(groupC,'C');
  document.getElementById('formula-results-D').innerHTML=_formulaPanelHtml(groupD,'D');
  document.getElementById('formula-results-F').innerHTML=_formulaPanelHtml(groupF,'Rolling Stats');
  document.getElementById('formula-results-G').innerHTML=_formulaPanelHtml(groupG,'แม่นขั้นเทพ');
  document.getElementById('formula-results-H').innerHTML=_formulaPanelHtml(groupH,'มิสเตอร์ซี');
  document.getElementById('formula-results-E').innerHTML=_formulaPanelHtml(eCards.join(''),'สายมู');
  document.getElementById('formula-results-I').innerHTML=_formulaPanelHtml(groupI,'จักรพรรดิ');
  document.getElementById('formula-results-J').innerHTML=_formulaPanelHtml(groupJ,'เจ้าสัว');
  document.getElementById('formula-results-HM').innerHTML=_formulaPanelHtml(groupHM,'Hermes Pool 1-4');
  document.getElementById('formula-results-FANO').innerHTML=_formulaPanelHtml(fanoHtml,'ระนาบฟาโน');
  document.getElementById('formula-results-RLL').innerHTML=_formulaPanelHtml(rllHtml,'RLL');
  document.getElementById('formula-results-ALL').innerHTML=_formulaPanelHtml(groupAll,'สูตรคำนวณรวม');
  document.getElementById('formula-empty').style.display='none';
  if(typeof buildReportProvenance==='function'){
    const isFanoReport=LotteryUiState.formula.activeTab==='FANO'&&(fanoResult||fanoV5Result);
    const reportSettings=isFanoReport?{
      group:'FANO',
      formulas:[fanoResult,fanoV5Result].filter(Boolean).map(result=>({
        formula:result.formula,
        valid_draws:result.settings.valid_draws,
        training_start_date:result.settings.training_start_date,
        training_cutoff_date:result.settings.training_cutoff_date,
        construction:result.settings.construction,
        candidate_count:result.settings.candidate_count,
        position_pair_coverage:result.settings.position_pair_coverage,
        weighted_pair_coverage_score:result.settings.weighted_pair_coverage_score,
        optimizer_starts:result.settings.optimizer_starts,
        optimizer_restarts:result.settings.optimizer_restarts,
        optimizer_proposals_per_restart:result.settings.optimizer_proposals_per_restart,
        optimizer_valid_proposals:result.settings.optimizer_valid_proposals,
        optimizer_accepted_moves:result.settings.optimizer_accepted_moves,
        optimizer_base_version:result.settings.optimizer_base_version,
        optimizer_base_score:result.settings.optimizer_base_score,
        signal_by_position:result.settings.signal_by_position,
        rank_pairs_by_position:result.settings.rank_pairs_by_position,
        position_choices:result.settings.position_choices,
        punctured_line:result.settings.punctured_line,
        omitted_points:result.settings.omitted_points,
        retrospective_selection:result.settings.retrospective_selection,
      })),
    }:{group:LotteryUiState.formula.activeTab};
    const reportSource=isFanoReport?{
      source:'server_existing_cache',
      history_cutoff:(fanoV5Result||fanoResult).settings.training_cutoff_date,
      data_version:[
        fanoResult?.provenance?.history_sha256?`v4 ${fanoResult.provenance.history_sha256}`:'',
        fanoV5Result?.provenance?.history_sha256?`v5 ${fanoV5Result.provenance.history_sha256}`:'',
      ].filter(Boolean).join(' · '),
    }:{
      source:'loaded_or_manual_inputs',
      input_draw:{prize1,top3,bottom2,front31,front32,back31,back32,drawday,bday,bmon,byear},
      history_cutoff:LotteryReports.latestEligibleDate(LotteryServerData.formula.history,predDateStr),
    };
    window._formulaReportProvenance=buildReportProvenance('formula',predDateStr,reportSettings,reportSource);
    showReportDraft('formula',window._formulaReportProvenance);
  }
  LotteryUiState.formula.hasRun=true;
  _renderFormulaFinalPicks();
  _renderFormulaInsights();

  // เก็บ context ที่ผ่านการคำนวณแล้ว → ใช้เป็นฐานสร้างผลรางวัลของแต่ละหมวด
  switchFormulaTab(LotteryUiState.formula.activeTab);
  filterFormulaCards();
  if(calculationId===window._formulaCalculationRequestId)window._formulaCalculationPending=false;
  if(typeof window!=='undefined'&&typeof window.setPageStatus==='function')window.setPageStatus('formula-status','คำนวณสูตรเสร็จแล้ว');
  syncFormulaSnapshotButton();
}

