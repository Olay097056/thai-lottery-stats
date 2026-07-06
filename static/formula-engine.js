// ─── Formula Calculators ──────────────────────────────────────────────────────
let _formulaFilled=false;
let _formulaActiveTab='A';
let _formulaHasRun=false;
let _formulaConsensusFilter='all';

let _formulaHistory=[];
let _btRowData=[],_btSortKey='edge',_btSortAsc=false,_btTested=0;
let _btFieldCheck=null;
const FORMULA_BT_WINDOWS=[50,100,200];

const FORMULA_REQUIRED_COLUMNS=[
  ['prize1',6],['top3',3],['top2',2],['bottom2',2],
  ['front3_1',3],['front3_2',3],['back3_1',3],['back3_2',3],
];

const FORMULA_BT_FIELD_META={
  bottom2:{typeLabel:'เต็ม 2หลัก',board:'2-digit exact',widths:[2],base:(k)=>({baseP:k,baseLabel:`${k}/100`})},
  prize1_last2:{typeLabel:'เต็ม 2หลัก',board:'2-digit exact',widths:[2],base:(k)=>({baseP:k,baseLabel:`${k}/100`})},
  bottom2_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  front3_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  back3_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  prize1_unit:{typeLabel:'หลักหน่วย',board:'Run / digit',widths:[1],base:(k)=>({baseP:k*10,baseLabel:`${k}/10 = ${k*10}%`})},
  back3:{typeLabel:'3หลัก(ต่อ)',board:'3-digit exact',widths:[2,3],base:(k)=>({baseP:k/10,baseLabel:`${k}/1000`})},
  top3:{typeLabel:'3ตัวบนตรง',board:'3-digit exact',widths:[3],base:(k)=>({baseP:k/1000*100,baseLabel:`${k}/1000`})},
  front3:{typeLabel:'เต็ม 3หลัก',board:'3-digit exact',widths:[3],base:(k)=>({baseP:k/1000*2*100,baseLabel:`${k}/1000×2`})},
  back3exact:{typeLabel:'เต็ม 3หลัก',board:'3-digit exact',widths:[3],base:(k)=>({baseP:k/1000*2*100,baseLabel:`${k}/1000×2`})},
  prize1_last4_digits:{typeLabel:'4หลักรางวัล',board:'Prize1 tail',widths:[1],base:()=>({baseP:(1-Math.pow(0.9,4))*100,baseLabel:'1-(0.9)^4≈34.4%'})},
  fable6:{typeLabel:'FABLE 6หลัก',board:'FABLE (pool 1-5)',widths:[6],base:(k)=>({baseP:(1-Math.pow(1-168/1e6,k))*100,baseLabel:`${k} vs pool168/10⁶`})},
  fable_pool3:{typeLabel:'FABLE ท้าย3',board:'FABLE (pool 1-5)',widths:[3],base:(k)=>{const p1=1000*(1-Math.pow(0.999,168))/1000;return {baseP:(1-Math.pow(1-p1,k))*100,baseLabel:`${k} vs ~155/1000`};}},
};

function _formulaBtFieldMeta(field){
  const f=String(field||'');
  if(f.startsWith('run_'))return {typeLabel:'วิ่ง',board:'Run / digit',widths:[1],base:(k,slots=2)=>({baseP:(1-Math.pow((10-k)/10,slots))*100,baseLabel:`วิ่ง${k}/${slots}slot`})};
  return FORMULA_BT_FIELD_META[f]||null;
}

function _formulaBaselineForField(field,predsN,slots=2){
  const meta=_formulaBtFieldMeta(field);
  if(!meta)return {baseP:0,baseLabel:'-',typeLabel:field||'-',board:'Other'};
  return {...meta.base(Math.max(1,Number(predsN)||1),slots),typeLabel:meta.typeLabel,board:meta.board};
}

function _formulaHitForField(fr,actual,pools={}){
  const preds=(fr?.preds||[]).map(String);
  if(!actual||!preds.length)return false;
  const p=(v,w)=>String(v||'').padStart(w,'0');
  if(fr.field==='bottom2')return preds.includes(p(actual.bottom2,2));
  if(fr.field==='bottom2_unit')return preds.includes(String(actual.bottom2||'').slice(-1));
  if(fr.field==='back3')return preds.includes(p(actual.back3_1,3))||preds.includes(p(actual.back3_2,3))||preds.includes(String(actual.back3_1||'').slice(-2))||preds.includes(String(actual.back3_2||'').slice(-2));
  if(fr.field==='prize1_last4_digits'){
    const tail=p(actual.prize1,6).slice(2);
    return preds.some((d,i)=>d===tail[i]);
  }
  if(fr.field==='front3_unit')return preds.includes(String(actual.front3_1||'').slice(-1))||preds.includes(String(actual.front3_2||'').slice(-1));
  if(fr.field==='back3_unit')return preds.includes(String(actual.back3_1||'').slice(-1))||preds.includes(String(actual.back3_2||'').slice(-1));
  if(fr.field==='prize1_unit')return preds.includes(String(actual.prize1||'').slice(-1));
  if(fr.field==='run_bottom2')return preds.some(d=>p(actual.bottom2,2).includes(d));
  if(fr.field==='run_front3')return preds.some(d=>(p(actual.front3_1,3)+p(actual.front3_2,3)).includes(d));
  if(fr.field==='run_back3')return preds.some(d=>(p(actual.back3_1,3)+p(actual.back3_2,3)).includes(d));
  if(fr.field==='run_prize1back3')return preds.some(d=>p(actual.prize1,6).slice(-3).includes(d));
  if(fr.field==='front3')return preds.includes(p(actual.front3_1,3))||preds.includes(p(actual.front3_2,3));
  if(fr.field==='top3')return preds.includes(p(actual.top3,3));
  if(fr.field==='back3exact')return preds.includes(p(actual.back3_1,3))||preds.includes(p(actual.back3_2,3));
  if(fr.field==='prize1_last2')return preds.includes(p(actual.prize1,6).slice(-2));
  if(fr.field==='fable6')return preds.some(n=>pools.fablePool?.has(n));
  if(fr.field==='fable_pool3')return preds.some(n=>pools.fablePoolT3?.has(n));
  return false;
}

function _formulaSecondaryHit(fr,secondary6,secTail2,secTail3){
  const preds=(fr?.preds||[]).map(String);
  if(!preds.length||!secondary6?.length)return false;
  const lens=[...new Set(preds.map(p=>p.length))];
  return lens.some(len=>{
    if(len===3)return preds.some(p=>secTail3.has(p));
    if(len===2)return preds.some(p=>secTail2.has(p));
    if(len===6)return preds.some(p=>secondary6.includes(p));
    return false;
  });
}

function _formulaFieldMappingCheck(rows=[]){
  const errors=[],warnings=[];
  const sample=(rows||[]).find(r=>r&&r.prize1)||{};
  for(const [col,width] of FORMULA_REQUIRED_COLUMNS){
    if(!(col in sample)){errors.push(`CSV ไม่มีคอลัมน์ ${col}`);continue;}
    const v=String(sample[col]||'');
    if(v&&v.length!==width)warnings.push(`${col} ควรเป็น ${width} หลัก แต่ตัวอย่างเป็น ${v.length} หลัก`);
  }
  const curr=rows?.[0]||{};
  const prev=rows?.find((r,i)=>i>0&&r?.prize1)||rows?.[1]||{};
  let iso='';
  if(curr.date){const[d,m,y]=String(curr.date).split('/').map(Number);if(d&&m&&y)iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
  let formulas=[];
  try{formulas=_computeFormulasBatch(prev,iso,rows.slice(2,202))||[];}catch(e){errors.push(`คำนวณ batch ไม่สำเร็จ: ${String(e)}`);}
  const groups=new Set();
  for(const fr of formulas){
    const code=String(fr.name||'').match(/^([A-Z]+\d+)/)?.[1]||'';
    const group=code[0]||String(fr.name||'').trim()[0]||'?';
    groups.add(group);
    const meta=_formulaBtFieldMeta(fr.field);
    if(!meta){errors.push(`${fr.name}: field "${fr.field}" ยังไม่มี mapping`);continue;}
    const allowed=new Set(meta.widths||[]);
    for(const pred of fr.preds||[]){
      if(typeof pred!=='string')errors.push(`${fr.name}: prediction ต้องเป็น string เพื่อรักษาเลข 0 นำหน้า`);
      const s=String(pred);
      if(!allowed.has(s.length))warnings.push(`${fr.name}: "${s}" ยาว ${s.length} หลัก ไม่ตรง field ${fr.field}`);
    }
  }
  ['A','B','C','D','E','G','H'].forEach(g=>{if(!groups.has(g))warnings.push(`ไม่พบสูตรกลุ่ม ${g} ใน batch check`);});
  if(!groups.has('X'))warnings.push('ไม่พบสูตรกลุ่ม F/Rolling (X*) ใน batch check');
  return {ok:errors.length===0,errors,warnings,checked:formulas.length,groups:[...groups].sort()};
}

function _formulaMappingBannerHtml(check){
  if(!check)return '';
  const cls=check.ok?'good':'bad';
  const msg=check.ok
    ? `Field mapping OK · ตรวจ ${check.checked} สูตร · กลุ่ม ${check.groups.join(', ')}`
    : `Field mapping มีปัญหา ${check.errors.length} จุด`;
  const details=[...(check.errors||[]),...(check.warnings||[]).slice(0,8)];
  return `<div class="bt-check ${cls}">
    <div><b>${_formulaEsc(msg)}</b>${check.warnings?.length?` <span>· warnings ${check.warnings.length}</span>`:''}</div>
    ${details.length?`<details><summary>ดูรายละเอียด check</summary><div>${details.map(x=>`<div>${_formulaEsc(x)}</div>`).join('')}</div></details>`:''}
  </div>`;
}
window.formulaFieldMappingCheck=_formulaFieldMappingCheck;

function _freqMap(arr){const m={};for(const v of arr)m[v]=(m[v]||0)+1;return m;}
function _topN(freq,n){return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k])=>k);}

const FORMULA_FIELD_RULES=[
  ['f-prize1',6,'รางวัลที่ 1'],
  ['f-top3',3,'3 ตัวบน'],
  ['f-bottom2',2,'ท้าย 2 ตัว'],
  ['f-front3-1',3,'หน้า 3 ตัว #1'],
  ['f-front3-2',3,'หน้า 3 ตัว #2'],
  ['f-back3-1',3,'ท้าย 3 ตัว #1'],
  ['f-back3-2',3,'ท้าย 3 ตัว #2'],
];

function _bindFormulaInputSanitizers(){
  for(const [id,len] of FORMULA_FIELD_RULES){
    const el=document.getElementById(id);
    if(!el||el.dataset.formulaSanitized)continue;
    el.dataset.formulaSanitized='1';
    el.addEventListener('input',()=>{
      const clean=(el.value||'').replace(/\D/g,'').slice(0,len);
      if(el.value!==clean)el.value=clean;
      if(el.classList.contains('formula-input-error'))_clearFormulaErrors();
    });
  }
}

function _clearFormulaErrors(){
  document.querySelectorAll('.formula-field-error').forEach(el=>el.remove());
  document.querySelectorAll('.formula-input-error').forEach(el=>el.classList.remove('formula-input-error'));
}

function _formulaError(id,msg){
  const el=document.getElementById(id);
  if(!el)return;
  el.classList.add('formula-input-error');
  const div=document.createElement('div');
  div.className='formula-field-error';
  div.textContent=msg;
  el.insertAdjacentElement('afterend',div);
}

function _validateFormulaInputs(){
  _clearFormulaErrors();
  let ok=true;
  for(const [id,len,label] of FORMULA_FIELD_RULES){
    const v=_fv(id);
    if(!new RegExp(`^\\d{${len}}$`).test(v)){
      _formulaError(id,`${label} ต้องเป็นเลข ${len} หลัก`);
      ok=false;
    }
  }
  const drawday=parseInt(_fv('f-drawday'),10);
  if(![1,16].includes(drawday)){
    _formulaError('f-drawday','เลือกได้เฉพาะวันที่ 1 หรือ 16');
    ok=false;
  }
  const bd=_fv('f-bday'),bm=_fv('f-bmon'),by=_fv('f-byear');
  const anyBirth=bd||bm||by;
  if(anyBirth){
    const bdi=parseInt(bd,10),bmi=parseInt(bm,10),byi=parseInt(by,10);
    if(!(bdi>=1&&bdi<=31)){_formulaError('f-bday','วัน 1-31');ok=false;}
    if(!(bmi>=1&&bmi<=12)){_formulaError('f-bmon','เดือน 1-12');ok=false;}
    if(!(byi>=2480&&byi<=2580)){_formulaError('f-byear','ใช้ปี พ.ศ. 2480-2580');ok=false;}
  }
  if(!ok)toast('ตรวจข้อมูลในช่องที่เป็นสีแดง','error');
  return ok;
}

function _clearFormulaResults(msg=''){
  ['A','B','C','D','F','G','H','E','ALL'].forEach(k=>{
    const el=document.getElementById('formula-results-'+k);
    if(el)el.innerHTML='';
  });
  const empty=document.getElementById('formula-empty');
  if(empty){empty.style.display='block';if(msg)empty.textContent=msg;}
  const sum=document.getElementById('formula-summary');
  if(sum){sum.classList.remove('active');sum.innerHTML='';}
  const insights=document.getElementById('formula-insights');
  if(insights){insights.classList.remove('active');insights.innerHTML='';}
  const final=document.getElementById('formula-final');
  if(final){final.classList.remove('active');final.innerHTML='';}
  const tools=document.getElementById('formula-tools');
  if(tools)tools.classList.remove('active');
  const count=document.getElementById('formula-filter-count');
  if(count)count.textContent='';
  _formulaHasRun=false;
}

function setFormulaLoading(msg='กำลังโหลดข้อมูลสูตร...'){
  const empty=document.getElementById('formula-empty');
  if(empty){empty.style.display='block';empty.textContent=msg;}
  ['formula-summary','formula-insights','formula-final'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.classList.remove('active');el.innerHTML='';}
  });
}

async function initFormulaPage(){
  _bindFormulaInputSanitizers();
  // populate f-target-date from history
  const sel=document.getElementById('f-target-date');
  if(!sel)return;
  if(!sel.options.length){
    setFormulaLoading('กำลังเตรียมรายการงวดสำหรับสูตร...');
    try{
      const h=await api('history?n=500');
      const rows=Array.isArray(h.data)?h.data:[];
      // build future/upcoming dates from pred-date select if available, else show last draws
      const predSel=document.getElementById('pred-date');
      let opts=[];
      if(predSel && predSel.options.length){
        for(const o of predSel.options){
          const opt=document.createElement('option');
          opt.value=o.value; opt.textContent=o.textContent;
          opts.push(opt);
        }
      }
      // also add recent past draws as reference targets (past 6)
      const recent=rows.slice(0,6);
      for(const r of recent){
        if(!r.date) continue;
        const [d,m,y]=r.date.split('/').map(Number);
        const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const opt=document.createElement('option');
        opt.value=iso; opt.textContent=r.date;
        opts.push(opt);
      }
      if(opts.length)opts.forEach(o=>sel.appendChild(o));
      else _clearFormulaResults('ยังโหลดรายการงวดไม่ได้ ลองกดรีเฟรชข้อมูลหรือกรอกเลขเอง');
    }catch(e){
      _clearFormulaResults('โหลดข้อมูลงวดไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }
  if(!_formulaFilled && sel.value){
    await autoFillFormula();
    _formulaFilled=true;
  }
  switchFormulaTab(_formulaActiveTab);
}

function switchFormulaTab(tab){
  _formulaActiveTab=tab;
  document.querySelectorAll('.ftab-btn').forEach(btn=>{
    const on=btn.dataset.ftab===tab;
    btn.classList.toggle('active',on);
    btn.setAttribute('aria-selected',on?'true':'false');
  });
  // sync dropdown กลุ่มสูตร: เลือกกลุ่ม → โชว์ค่านั้น + ไฮไลต์, เลือก ALL/FB/BT → กลับ placeholder
  const groupSel=document.getElementById('ftab-group-select');
  if(groupSel){
    const isGroup=['A','B','C','D','F','G','H','E'].includes(tab);
    groupSel.value=isGroup?tab:'';
    groupSel.classList.toggle('ftab-select-active',isGroup);
  }
  document.querySelectorAll('.ftab-info').forEach(el=>el.classList.add('hidden'));
  const desc=document.getElementById('ftab-desc-'+tab);
  if(desc)desc.classList.remove('hidden');
  document.querySelectorAll('.formula-results-panel').forEach(el=>el.classList.remove('active'));
  const panel=document.getElementById('formula-results-'+tab);
  if(panel){
    if(tab!=='BT'&&!panel.innerHTML.trim()){
      panel.innerHTML=`<div class="formula-tab-empty" style="display:block;grid-column:1/-1">กดคำนวณทุกสูตรเพื่อดูผลในหมวดนี้</div>`;
    }
    panel.classList.add('active');
  }
  const tools=document.getElementById('formula-tools');
  if(tools)tools.classList.toggle('active',_formulaHasRun&&tab!=='BT'&&tab!=='FB');
  if(tab==='FB'){
    if(typeof renderFableSnapshots==='function')renderFableSnapshots();
    if(!document.getElementById('fable-results').innerHTML.trim())loadFable();
  }
  if(tab!=='BT'&&tab!=='FB')filterFormulaCards();
}

// ลูกศรซ้าย/ขวา เลื่อน tab (WAI-ARIA tablist pattern)
function ftabKeyNav(e){
  if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft'&&e.key!=='Home'&&e.key!=='End')return;
  e.preventDefault();
  const btns=[...document.querySelectorAll('.ftab-btn')];
  let i=btns.findIndex(b=>b.dataset.ftab===_formulaActiveTab);
  if(e.key==='Home')i=0;
  else if(e.key==='End')i=btns.length-1;
  else if(e.key==='ArrowRight')i=(i+1)%btns.length;
  else i=(i-1+btns.length)%btns.length;
  const next=btns[i];
  if(next){switchFormulaTab(next.dataset.ftab);next.focus();}
}

// แปลง dd/mm/yyyy → Date object
function _parseThai(dateStr){
  const [d,m,y]=dateStr.split('/').map(Number);
  return new Date(y,m-1,d);
}

async function autoFillFormula(){
  const targetDateStr=document.getElementById('f-target-date')?.value||''; // YYYY-MM-DD
  let rows=[];
  setFormulaLoading('กำลังโหลดข้อมูลงวดก่อน...');
  try{
    const h=await api('history?n=500');
    rows=Array.isArray(h.data)?h.data:[];
  }catch(e){
    _clearFormulaResults('โหลดข้อมูลงวดไม่สำเร็จ ลองใหม่อีกครั้ง');
    return;
  }
  if(!rows.length){
    _clearFormulaResults('ยังไม่มีประวัติงวดให้เติมอัตโนมัติ สามารถกรอกเลขเองแล้วคำนวณได้');
    return;
  }
  _formulaHistory=rows; // cache for Claude formulas

  let prev=null;
  if(targetDateStr){
    const target=new Date(targetDateStr);
    for(const r of rows){
      if(!r.date) continue;
      const rd=_parseThai(r.date);
      if(rd<target){prev=r;break;}
    }
  }
  if(!prev) prev=rows[0];
  if(!prev) return;

  const setVal=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||'';};
  setVal('f-prize1',prev.prize1);
  setVal('f-top3',prev.top3);
  setVal('f-bottom2',prev.bottom2);
  setVal('f-front3-1',prev.front3_1);
  setVal('f-front3-2',prev.front3_2);
  setVal('f-back3-1',prev.back3_1);
  setVal('f-back3-2',prev.back3_2);
  let drawDay=1;
  if(targetDateStr){
    const parts=targetDateStr.split('-').map(Number);
    drawDay=parts[2]||1;
  }else{
    drawDay=parseInt((prev.date||'1').split('/')[0]||'1');
  }
  setVal('f-drawday',(drawDay===16)?16:1);

  const info=document.getElementById('f-prev-info');
  if(info) info.textContent=`งวด: ${prev.date||''} | รางวัลที่1: ${prev.prize1||''}`;
  if(_formulaHasRun){
    if(document.getElementById('f-auto-run')?.checked)runAllFormulas();
    else _clearFormulaResults('เปลี่ยนงวดเป้าหมายแล้ว กดคำนวณอีกครั้งเพื่ออัปเดตผล');
  }else{
    const empty=document.getElementById('formula-empty');
    if(empty){empty.style.display='block';empty.textContent='ตรวจข้อมูลงวดก่อนแล้ว กด ⚡ คำนวณทุกสูตร';}
  }
  if(_formulaActiveTab==='FB')loadFable({reason:'target-change'});
}

function _fv(id){return (document.getElementById(id)?.value||'').trim();}
function _pad(n,len){return String(n).padStart(len,'0');}
function _digits(s){return s.split('').map(Number);}
function _sumDigits(s){return _digits(s).reduce((a,b)=>a+b,0);}
function _modAdd(a,b){return (parseInt(a)+parseInt(b))%10;}

// บวกไม่ทด = digit-wise add mod 10
function _addNoCarry(a,b){
  const la=String(a).split('').map(Number);
  const lb=String(b).split('').map(Number);
  while(la.length<lb.length) la.unshift(0);
  while(lb.length<la.length) lb.unshift(0);
  return la.map((d,i)=>(d+lb[i])%10).join('');
}
// ลบไม่ยืม = digit-wise subtract absolute mod 10
function _subNoCarry(a,b){
  const la=String(a).split('').map(Number);
  const lb=String(b).split('').map(Number);
  while(la.length<lb.length) la.unshift(0);
  while(lb.length<la.length) lb.unshift(0);
  return la.map((d,i)=>Math.abs(d-lb[i])%10).join('');
}

function _mktDigit(v){
  const n=parseInt(v,10);
  return Number.isFinite(n)?((n%10)+10)%10:0;
}

function _mktGarland(...vals){
  return vals.flatMap(v=>String(Math.abs(parseInt(v,10)||0)).split('').map(Number))
    .reduce((a,b)=>a+b,0)%10;
}

function _mktSeq(start,count,step=1){
  return Array.from({length:count},(_,i)=>String((_mktDigit(start)+i*step)%10));
}

function _mktNearest(pool,target){
  const t=_mktDigit(target);
  const nums=(pool||[]).map(_mktDigit);
  if(nums.includes(t))return String(t);
  nums.sort((a,b)=>Math.min((a-t+10)%10,(t-a+10)%10)-Math.min((b-t+10)%10,(t-b+10)%10));
  return String(nums[0]??t);
}

function _mktJoin3(hundreds,tens,units){
  const out=[];
  for(const h of hundreds)for(const t of tens)for(const u of units)out.push(`${h}${t}${u}`);
  return [...new Set(out)];
}

function _maenKhanThep(ctx){
  const p=String(ctx.p6||'').padStart(6,'0').split('').map(Number);
  const b2=String(ctx.b2||'').padStart(2,'0').split('').map(Number);
  const f1=String(ctx.f31||'').padStart(3,'0').split('').map(Number);
  const f2=String(ctx.f32||'').padStart(3,'0').split('').map(Number);
  const bk1=String(ctx.bk1||'').padStart(3,'0').split('').map(Number);
  const bk2=String(ctx.bk2||'').padStart(3,'0').split('').map(Number);

  const g1H=_mktGarland(p[0]+p[5], b2[1]+f2[2], 5);
  const g1T0=_mktGarland(bk1[2]+bk2[1], 9);
  const g1T=_mktSeq(g1T0,3,3);
  const g1U=_mktGarland(f2[1]+f2[2],5);
  const g1=_mktJoin3([String(g1H)],g1T,[String(g1U)]);

  const g2H=(_mktGarland(p[1]+p[5], f1[0], bk1[2])+4)%10;
  const g2T0=(_mktGarland(p[2], b2[1], bk1[0])+6)%10;
  const g2T=_mktSeq(g2T0,3,1);
  const g2U=_mktGarland(p[1]+p[2]+bk2[1],5);
  const g2=_mktJoin3([String(g2H)],g2T,[String(g2U)]);

  const g3H0=(f1[2]+bk2[0]+bk2[1]+bk2[2]+3)%10;
  const g3H=_mktSeq(g3H0,3,2);
  const g3TPool=_mktSeq(_mktGarland(p[3],f1[1],bk1[1]),5,1);
  const g3UPool=_mktSeq(_mktGarland(p[4],f2[2],bk2[2]),5,1);
  const g3TCut=(_mktGarland(p[0],f1[1],bk2[1])+5)%10;
  const g3UCut=(_mktGarland(p[5],f2[2],bk2[2])+5)%10;
  const g3T=_mktNearest(g3TPool,g3TCut);
  const g3U=_mktNearest(g3UPool,g3UCut);
  const g3=_mktJoin3(g3H,[g3T],[g3U]);

  const g4TStart=(p[0]+p[2]+p[4]+1)%10;
  const g4T=_mktSeq(g4TStart,3,1);
  const g4UPool=_mktSeq(_mktGarland(p[1],f1[0],f2[1]),5,1);
  const g4UCut=(_mktGarland(bk2[0],bk2[2],7)+5)%10;
  const g4U=_mktNearest(g4UPool,g4UCut);
  const g4=g4T.map(t=>`${t}${g4U}`);

  return {
    top3Type1:g1, top3Type2:g2, top3Type3:g3, bottom2:g4,
    meta:{g1H,g1T0,g1T,g1U,g2H,g2T0,g2T,g2U,g3H,g3TPool,g3UPool,g3TCut,g3UCut,g3T,g3U,g4T,g4UPool,g4UCut,g4U}
  };
}

function _maenKhanThepCards(ctx){
  const M=_maenKhanThep(ctx);
  const m=M.meta;
  return [
    _mkFormulaCard('แม่นขั้นเทพ 1 · 3 ตัวบน ร้อยมาลัย 5-9-5','G. แม่นขั้นเทพ',
      [`หลักร้อย: (แสนรางวัลที่1+หน่วยรางวัลที่1) และ (หน่วยล่าง+หน่วยเลขหน้า#2) บวกมาลัยกับ 5 = ${m.g1H}`,
       `หลักสิบ: (หน่วยท้าย#1+สิบท้าย#2) บวกมาลัยกับ 9 = ${m.g1T0}, เพิ่มทีละ 3 ได้ ${m.g1T.join(', ')}`,
       `หลักหน่วย: (สิบ+หน่วยเลขหน้า#2) บวกมาลัยกับ 5 = ${m.g1U}`],
      M.top3Type1),
    _mkFormulaCard('แม่นขั้นเทพ 2 · 3 ตัวบน ขนาบหน้า-หลัง 4/6','G. แม่นขั้นเทพ',
      [`หลักร้อย: หมื่นรางวัลที่1 + หน่วยรางวัลที่1 ขนาบฐานหน้า#1 และหน่วยท้าย#1 แล้วบวก 4 = ${m.g2H}`,
       `หลักสิบ: พันรางวัลที่1 + หน่วยล่าง + ร้อยท้าย#1 แล้วบวก 6 = ${m.g2T0}, นับต่อ 3 ตัว = ${m.g2T.join(', ')}`,
       `หลักหน่วย: หมื่น+พันรางวัลที่1 + สิบท้าย#2 รวมฐาน 5 = ${m.g2U}`],
      M.top3Type2),
    _mkFormulaCard('แม่นขั้นเทพ 3 · 3 ตัวบน โครง 25 คู่แล้วตัด','G. แม่นขั้นเทพ',
      [`หลักร้อย: หน่วยเลขหน้า#1 + ท้าย#2 ทั้ง 3 หลัก + 3 = ${m.g3H[0]}, เพิ่มทีละ 2 ได้ ${m.g3H.join(', ')}`,
       `โครงหลักสิบ 5 ตัว: ${m.g3TPool.join(', ')} | ตัวตัด +5 = ${m.g3TCut} → เลือก ${m.g3T}`,
       `โครงหลักหน่วย 5 ตัว: ${m.g3UPool.join(', ')} | ตัวตัด +5 = ${m.g3UCut} → เลือก ${m.g3U}`],
      M.top3Type3),
    _mkFormulaCard('แม่นขั้นเทพ 4 · เลขท้าย 2 ตัวล่าง เด่น 3 ชุดตรง','G. แม่นขั้นเทพ',
      [`หลักสิบ: แสน+พัน+สิบรางวัลที่1 ได้เลขท้าย แล้วเริ่มตัวถัดไป = ${m.g4T[0]}, นับครบ 3 ตัว ${m.g4T.join(', ')}`,
       `หลักหน่วยตั้งต้น 5 ตัวจาก หมื่นรางวัลที่1 + ร้อยหน้า#1 + สิบหน้า#2 = ${m.g4UPool.join(', ')}`,
       `ตัวตัด: ร้อยท้าย#2 + หน่วยท้าย#2 + 7 แล้วบวกเพิ่ม 5 = ${m.g4UCut} → เลือก ${m.g4U}`],
      M.bottom2),
  ];
}

function _misterC(ctx){
  const p=String(ctx.p6||'').padStart(6,'0').split('').map(Number);
  const t3=String(ctx.t3||'').padStart(3,'0').split('').map(Number);
  const b2=String(ctx.b2||'').padStart(2,'0').split('').map(Number);
  const f1=String(ctx.f31||'').padStart(3,'0').split('').map(Number);
  const bk1=String(ctx.bk1||'').padStart(3,'0').split('').map(Number);
  const bk2=String(ctx.bk2||'').padStart(3,'0').split('').map(Number);

  const f1H=_mktDigit(p[0]*3 + p[1]*2 + bk1[0]*3 - 2);
  const f1T=_mktDigit(p[0] + b2[0] + f1[0] + bk1[0]*3 + 4);
  const f1U=_mktDigit(p[0] + p[3]*2 + p[4] + bk2[0]*2 - 1);
  const formula1=`${f1H}${f1T}${f1U}`;

  const f2H=_mktDigit(p[0] + p[3]*2 + p[5] + b2[0]*4 + 8);
  const f2T=_mktDigit(p[0]*2 + p[1]*3 + b2[0]*3 + 8);
  const f2U=_mktDigit(p[0]*3 + p[1] + p[4]*2 + b2[0] + 1);
  const formula2=`${f2H}${f2T}${f2U}`;

  const combo=_mktJoin3(
    [...new Set([String(f1H),String(f2H)])],
    [...new Set([String(f1T),String(f2T)])],
    [...new Set([String(f1U),String(f2U)])]
  );

  return {
    formula1:[formula1],
    formula2:[formula2],
    combo,
    meta:{f1H,f1T,f1U,f2H,f2T,f2U}
  };
}

function _misterCCards(ctx){
  const M=_misterC(ctx);
  const m=M.meta;
  return [
    _mkFormulaCard('มิสเตอร์ซี 1 · 3 ตัวบนตรงชุดเดียว','H. มิสเตอร์ซี',
      [`หลักร้อย: แสนรางวัลที่ 1×3 + หมื่นรางวัลที่ 1×2 + ร้อยท้าย#1×3 - 2 = ${m.f1H}`,
       `หลักสิบ: แสนรางวัลที่ 1 + สิบล่าง + ร้อยหน้า#1 + ร้อยท้าย#1×3 + 4 = ${m.f1T}`,
       `หลักหน่วย: แสนรางวัลที่ 1 + ร้อยรางวัลที่ 1×2 + สิบรางวัลที่ 1 + ร้อยท้าย#2×2 - 1 = ${m.f1U}`],
      M.formula1,'แกะจากคลิป pZI5wD5WzzE: ใช้รางวัลที่ 1, 3 ตัวบน, 2 ตัวล่าง, หน้า 3 และท้าย 3')
    ,
    _mkFormulaCard('มิสเตอร์ซี 2 · สูตรเสริมรางวัลที่ 1 + ล่าง','H. มิสเตอร์ซี',
      [`หลักร้อย: แสน + ร้อย×2 + หน่วย + สิบล่าง×4 + 8 = ${m.f2H}`,
       `หลักสิบ: แสน×2 + หมื่น×3 + สิบล่าง×3 + 8 = ${m.f2T}`,
       `หลักหน่วย: แสน×3 + หมื่น + สิบ×2 + สิบล่าง + 1 = ${m.f2U}`],
      M.formula2,'สูตรเสริมในคลิป ใช้เฉพาะรางวัลที่ 1 และเลขท้าย 2 ตัวล่าง')
    ,
    _mkFormulaCard('มิสเตอร์ซี 3 · จับคู่สองสูตรสูงสุด 8 ชุด','H. มิสเตอร์ซี',
      [`หลักร้อยจากสองสูตร: ${m.f1H}, ${m.f2H}`,
       `หลักสิบจากสองสูตร: ${m.f1T}, ${m.f2T}`,
       `หลักหน่วยจากสองสูตร: ${m.f1U}, ${m.f2U}`,
       `จับทุกความเป็นไปได้แบบไม่ซ้ำ ได้ ${M.combo.length} ชุด`],
      M.combo,'ใช้เมื่ออยากขยายจากชุดเดียวเป็นกรอบ 3 ตัวบนตรง สูงสุด 8 ชุดเมื่อแต่ละหลักไม่ซ้ำกัน')
  ];
}

function _mkFormulaCard(title, source, steps, highlights, note=''){
  const group=_formulaGroupKey(source,title);
  const badges=highlights.map(h=>`<span class="num-badge">${h}</span>`).join('');
  const resultHtml=badges||note||'<span style="font-size:.78rem;color:var(--text3)">ผลลัพธ์อยู่ในรายละเอียดสูตร</span>';
  const stepHtml=steps.map(s=>`<div class="formula-step">${s}</div>`).join('');
  const target=_formulaTargetLabel(title,source,highlights);
  const count=highlights.length?`${highlights.length} ชุด`:'ชุดคำนวณเฉพาะ';
  const quality=_formulaQualityBadges(title,source,highlights);
  const noteHtml=(badges&&note)?`<div style="font-size:.72rem;color:var(--text3);font-style:italic;margin-top:6px">${note}</div>`:'';
  return `<div class="card formula-card" data-group="${group}">
    <div class="card-title">${title}</div>
    <div style="font-size:.7rem;color:var(--text3);margin-top:3px">${source}</div>
    <div class="formula-meta"><span class="formula-chip target">${target}</span><span class="formula-chip">${count}</span>${quality}</div>
    <div class="formula-result-row">${resultHtml}</div>
    ${noteHtml}
    <details class="formula-steps">
      <summary>ดูวิธีคำนวณ</summary>
      <div style="margin-top:7px">${stepHtml||'<div class="formula-step">ไม่มีขั้นตอนเพิ่มเติม</div>'}</div>
    </details>
  </div>`;
}

function _formulaQualityBadges(title,source,highlights=[]){
  const n=highlights.length;
  const out=[];
  if(n===1)out.push(['single','สูตรชุดเดียว']);
  else if(n>12)out.push(['wide','ชุดใหญ่']);
  else if(n>0&&n<=5)out.push(['good','โฟกัส']);
  const bt=_formulaBacktestProfileForTitle(title,source);
  if(bt?.degraded)out.push(['bad','ต่ำกว่าสุ่ม']);
  else if(bt?.edge200!=null)out.push(['bt',`200งวด ${bt.edge200>=0?'+':''}${bt.edge200.toFixed(1)}%`]);
  else if(source.startsWith('G.')||source.startsWith('H.')||title.startsWith('X'))out.push(['bt','Backtest']);
  return out.map(([cls,label])=>`<span class="formula-quality ${cls}">${label}</span>`).join('');
}

function _formulaGroupKey(source,title=''){
  const s=String(source||title||'').trim();
  if(s.startsWith('A.'))return 'A';
  if(s.startsWith('B.'))return 'B';
  if(s.startsWith('C.'))return 'C';
  if(s.startsWith('D.'))return 'D';
  if(s.startsWith('E.'))return 'E';
  if(s.startsWith('F.'))return 'F';
  if(s.startsWith('G.'))return 'G';
  if(s.startsWith('H.'))return 'H';
  if(title.startsWith('X'))return 'F';
  return 'A';
}

function _formulaTargetLabel(title,source,highlights=[]){
  if(title.startsWith('D2')||title.startsWith('X2'))return 'Target: front 3';
  if(title.startsWith('D3')||title.startsWith('X3')||title.startsWith('C3'))return 'Target: back 3';
  if(title.startsWith('D4')||title.startsWith('X4')||title.includes('2530'))return 'Target: prize1 tail';
  if(highlights.some(h=>String(h).length===1))return 'Target: digit/run';
  if(highlights.some(h=>String(h).length===3))return 'Target: 3-digit';
  if(highlights.some(h=>String(h).length>=4))return 'Target: prize1';
  return 'Target: bottom 2 / mixed';
}

function _groupFormulaCards(cards){
  const groups={A:[],B:[],C:[],D:[],G:[],H:[]};
  for(const html of cards){
    if(html.includes('data-group="A"'))groups.A.push(html);
    else if(html.includes('data-group="B"'))groups.B.push(html);
    else if(html.includes('data-group="C"'))groups.C.push(html);
    else if(html.includes('data-group="D"'))groups.D.push(html);
    else if(html.includes('data-group="G"'))groups.G.push(html);
    else if(html.includes('data-group="H"'))groups.H.push(html);
  }
  return groups;
}

function _renderFormulaSummary({grouped,codexCards,eCards,targetDate}){
  const el=document.getElementById('formula-summary');
  if(!el)return;
  const counts={
    A:grouped.A.length,
    B:grouped.B.length,
    C:grouped.C.length,
    D:grouped.D.length,
    G:grouped.G.length,
    H:grouped.H.length,
    F:codexCards.length,
    E:eCards.length,
  };
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const targetLabel=targetDate?(()=>{
    const [y,m,d]=targetDate.split('-').map(Number);
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y+543}`;
  })():'-';
  el.innerHTML=[
    ['งวดเป้าหมาย',targetLabel,'อ้างอิงจากงวดก่อนหน้า'],
    ['สูตรทั้งหมด',total,'รวมทุกหมวดที่คำนวณแล้ว'],
    ['สูตร 2 ตัว',counts.A+counts.B+counts.E,'พื้นบ้าน · Lottery+ · สายมู'],
    ['สูตร 3 ตัว/รางวัล',counts.C+counts.D+counts.F+counts.G+counts.H,'พิชิตโชค · Arithmetic · Rolling · แม่นขั้นเทพ · มิสเตอร์ซี'],
  ].map(([label,value,sub])=>`<div class="formula-summary-item"><div class="formula-summary-label">${label}</div><div class="formula-summary-value">${value}</div><div class="formula-summary-sub">${sub}</div></div>`).join('');
  el.classList.add('active');
}

function _formulaPanelHtml(html,tabName){
  return html&&html.trim()?html:`<div class="formula-tab-empty" style="display:block;grid-column:1/-1">ยังไม่มีผลในหมวด ${tabName}</div>`;
}

// ─── E. สายมู/ความเชื่อ (อ้างอิงวันที่งวด + โหราศาสตร์ไทย) ───────────────────────
// คืน array ของ object สูตรความเชื่อ ใช้ร่วมกันทั้งหน้าคำนวณและ backtest
function _formulaEsc(v){
  return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function _formulaGroupLabel(group){
  return ({
    A:'A · พื้นบ้าน',B:'B · ล็อตเตอรี่พลัส',C:'C · พิชิตโชค',D:'D · Arithmetic',
    E:'E · สายมู',F:'F · Rolling',G:'G · แม่นขั้นเทพ',H:'H · มิสเตอร์ซี'
  })[group]||group||'-';
}

function _formulaConsensusType(num,target){
  const n=String(num);
  const t=String(target||'').toLowerCase();
  if(n.length===1)return {key:'digit',label:'เลขวิ่ง'};
  if(t.includes('front'))return {key:'front3',label:'หน้า 3'};
  if(t.includes('back'))return {key:'back3',label:'ท้าย 3'};
  if(t.includes('prize1'))return {key:'prize1',label:'รางวัลที่ 1'};
  if(n.length===3)return {key:'top3',label:'3 ตัวบน'};
  if(n.length===2)return {key:'bottom2',label:'2 ตัว'};
  return {key:'other',label:'อื่น ๆ'};
}

function _formulaBacktestEdgeByName(){
  const map=new Map();
  for(const row of _btRowData||[]){
    const clean=String(row.name||'').replace(/\s+/g,' ').trim();
    if(clean)map.set(clean,row.edge||0);
    const code=clean.match(/^([A-Z]\d+)/)?.[1];
    if(code)map.set(code,row.edge||0);
  }
  return map;
}

function _formulaBacktestRowsByName(){
  const map=new Map();
  for(const row of _btRowData||[]){
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
  const bestFormula=(_btRowData||[]).slice().sort((a,b)=>b.edge-a.edge)[0];
  const btHtml=bestFormula
    ? `<div class="formula-final-block"><div class="formula-final-label">สูตร Backtest เด่น</div><div class="formula-final-row"><span class="formula-quality bt">${_formulaEsc(bestFormula.edge>=0?'+':'')}${bestFormula.edge.toFixed(1)}%</span><span class="formula-insight-empty">${_formulaEsc(bestFormula.name)}</span></div></div>`
    : `<div class="formula-final-block"><div class="formula-final-label">สูตร Backtest เด่น</div><div class="formula-final-row"><span class="formula-insight-empty">รัน Backtest เพื่อจัดอันดับสูตร</span></div></div>`;
  el.innerHTML=`<div class="formula-final-card">
    <div class="formula-final-head">
      <div class="formula-final-title">Formula Final Picks</div>
      <div class="formula-final-actions">
        <button class="dash-link" onclick="_formulaFinalCopy('top3')">copy 3 ตัวบน</button>
        <button class="dash-link" onclick="_formulaFinalCopy('bottom2')">copy 2 ตัว</button>
        <button class="dash-link" onclick="_formulaFinalCopy('all')">copy ชุดรวม</button>
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
  _formulaConsensusFilter=type||'all';
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
  const filtered=allItems.filter(x=>x.formulaCount>1&&(_formulaConsensusFilter==='all'||x.typeKey===_formulaConsensusFilter));
  const topPicks=[
    ['3 ตัวบนเด่น',allItems.filter(x=>x.typeKey==='top3'&&x.formulaCount>1).slice(0,5)],
    ['2 ตัวเด่น',allItems.filter(x=>x.typeKey==='bottom2'&&x.formulaCount>1).slice(0,5)],
    ['เลขวิ่งเด่น',allItems.filter(x=>x.typeKey==='digit'&&x.formulaCount>1).slice(0,5)],
  ];
  const filters=[
    ['all','ทั้งหมด'],['digit','เลขวิ่ง'],['bottom2','2 ตัว'],['top3','3 ตัวบน'],['front3','หน้า 3'],['back3','ท้าย 3'],['prize1','รางวัลที่ 1']
  ];
  const filterHtml=filters.map(([key,label])=>`<button class="consensus-filter ${_formulaConsensusFilter===key?'active':''}" onclick="setFormulaConsensusFilter('${key}')">${label}</button>`).join('');
  const topHtml=topPicks.map(([title,items])=>`<div class="consensus-pick-card">
    <div class="formula-insight-title">${title}</div>
    <div class="consensus-chip-row">${items.length?items.map(_formulaConsensusChip).join(''):'<span class="formula-insight-empty">ยังไม่มีเลขซ้ำเด่น</span>'}</div>
  </div>`).join('');
  const listHtml=filtered.length
    ? filtered.slice(0,24).map(_formulaConsensusChip).join('')
    : '<div class="formula-tab-empty" style="display:block;grid-column:1/-1">ยังไม่มีเลขซ้ำในกลุ่มนี้</div>';
  const showListOpen=_formulaConsensusFilter!=='all';
  el.innerHTML=`<div class="consensus-board">
    <div class="consensus-head">
      <div>
        <div class="consensus-title">Consensus Board</div>
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
  if(!active||_formulaActiveTab==='BT'||!_formulaHasRun){
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
    const numHtml=`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${f.nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:1rem;background:rgba(236,72,153,.12);border:1px solid #ec489966;color:#ec4899;padding:4px 11px;border-radius:7px;font-weight:700">${n}</span>`).join('')}</div>`;
    const runHtml=`<div style="margin-top:8px;font-size:.82rem;color:var(--text2)">เลขวิ่ง: <b style="color:#ec4899;font-family:'IBM Plex Mono',monospace">${f.digits.join(' ')}</b></div>`;
    return _mkFormulaCard(`${f.icon} ${f.name}`,'E. สายมู/ความเชื่อ',f.lines,[],numHtml+runHtml);
  });
}


// ─── สูตรเจ้าพ่อ Claude (หมวด D) — คำนวณเลขเต็มตรงๆ จากงวดก่อน ไม่ใช่พูลเลขเดี่ยว ───
// ใช้ร่วมกันทั้งการ์ดและ backtest เพื่อให้ตรงกันเป๊ะ
function _claudeFormulas(ctx){
  const {p6,t3,b2,bk1,bk2,drawday,nextDay,nextMonth,nextYear2}=ctx;
  const P=parseInt(p6)||0,B2=parseInt(b2)||0,BK1=parseInt(bk1)||0,BK2=parseInt(bk2)||0,T3=parseInt(t3)||0;
  const pad2=n=>String(((Math.round(n)%100)+100)%100).padStart(2,'0');
  const pad3=n=>String(((Math.round(n)%1000)+1000)%1000).padStart(3,'0');
  const pad6=n=>String(((Math.round(n)%1000000)+1000000)%1000000).padStart(6,'0');
  const rev=s=>s.split('').reverse().join('');
  const uniq=a=>[...new Set(a)];
  const DSUM=nextDay+nextMonth+nextYear2;
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
  if(!_formulaHistory.length) return [];
  if(!targetIso) return _formulaHistory.slice();
  const target=new Date(targetIso);
  return _formulaHistory.filter(r=>{
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
  const numRow=nums=>`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:rgba(132,204,22,.10);border:1px solid #84cc1666;color:#a3e635;padding:3px 9px;border-radius:6px;font-weight:700">${n}</span>`).join('')}</div>`;
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

function runAllFormulas(){
  if(!_validateFormulaInputs())return;
  setFormulaLoading('กำลังคำนวณทุกสูตร...');
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
        g2.map(b=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.82rem;background:var(--surface2);border:1px solid var(--border2);color:var(--text1);padding:2px 5px;border-radius:4px;min-width:26px;text-align:center">${a}${b}</span>`).join('')+
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
  function _chip(txt,hl){return `<span style="font-family:'IBM Plex Mono',monospace;font-size:1rem;background:${hl?'rgba(34,211,238,.14)':'var(--surface2)'};border:1px solid ${hl?'#22d3ee66':'var(--border2)'};color:${hl?'#22d3ee':'var(--text1)'};padding:4px 11px;border-radius:7px;font-weight:700">${txt}</span>`;}
  function _numRow(nums){return `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${nums.map(n=>`<span style="font-family:'IBM Plex Mono',monospace;font-size:.92rem;background:var(--surface2);border:1px solid var(--border2);color:var(--text1);padding:3px 9px;border-radius:6px">${n}</span>`).join('')}</div>`;}
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

  // กระจายการ์ดเข้า container ตามกลุ่ม
  const grouped=_groupFormulaCards(cards.concat(thepCards,misterCCards));
  const groupA=grouped.A.join('');
  const groupB=grouped.B.join('');
  const groupC=grouped.C.join('');
  const groupD=grouped.D.join('');
  const groupG=grouped.G.join('');
  const groupH=grouped.H.join('');
  const groupF=codexCards.concat(patternCards).join('');
  const groupAll=cards.concat(codexCards,patternCards,thepCards,misterCCards,eCards).join('');
  _renderFormulaSummary({grouped,codexCards,eCards,targetDate:predDateStr});

  document.getElementById('formula-results-A').innerHTML=_formulaPanelHtml(groupA,'A');
  document.getElementById('formula-results-B').innerHTML=_formulaPanelHtml(groupB,'B');
  document.getElementById('formula-results-C').innerHTML=_formulaPanelHtml(groupC,'C');
  document.getElementById('formula-results-D').innerHTML=_formulaPanelHtml(groupD,'D');
  document.getElementById('formula-results-F').innerHTML=_formulaPanelHtml(groupF,'Rolling Stats');
  document.getElementById('formula-results-G').innerHTML=_formulaPanelHtml(groupG,'แม่นขั้นเทพ');
  document.getElementById('formula-results-H').innerHTML=_formulaPanelHtml(groupH,'มิสเตอร์ซี');
  document.getElementById('formula-results-E').innerHTML=_formulaPanelHtml(eCards.join(''),'สายมู');
  document.getElementById('formula-results-ALL').innerHTML=_formulaPanelHtml(groupAll,'รวมทุกสูตร');
  document.getElementById('formula-empty').style.display='none';
  _formulaHasRun=true;
  _renderFormulaFinalPicks();
  _renderFormulaInsights();

  // FABLE — sync กับงวดเป้าหมายเดียวกับสูตรอื่น แล้ว append เข้า "รวมทุกสูตร"
  api(`fable?${_fableQueryString()}`).then(r=>{
    if(!r||!r.six)return;
    _renderFablePrediction(r);
    const card=_mkFormulaCard(
      'FABLE · เลข 6 หลัก','FB. FABLE (ทดลอง)',
      [`งวดเป้าหมาย ${_fableTargetLabel()} · ใช้ข้อมูลก่อนงวดนี้เท่านั้น`,
       `คำนวณจาก pool รางวัลที่ 1-5 (~168 เลข/งวด) ย้อนหลัง ${r.n_history} งวด`,
       'หน้า 3 หลักเด่น × ท้าย 3 หลักเด่น (recency-weighted freq + digit position)',
       'เกณฑ์ถูก (backtest): เลขตรงรางวัลใดก็ได้ใน 1-5'],
      r.six.map(x=>x.number),
      '🧪 สูตรทดลอง — backtest ยังไม่ชนะสุ่ม ใช้ประกอบการตัดสินใจ'
    );
    const all=document.getElementById('formula-results-ALL');
    if(all&&!all.querySelector('[data-fable-card]')){
      all.insertAdjacentHTML('beforeend',`<div data-fable-card>${card}</div>`);
    }
  }).catch(()=>{});

  // เก็บ context ที่ผ่านการคำนวณแล้ว → ใช้เป็นฐานสร้างผลรางวัลของแต่ละหมวด
  switchFormulaTab(_formulaActiveTab);
  filterFormulaCards();
}

// ─── Formula Backtest ──────────────────────────────────────────────────────────
// คำนวณสูตรแต่ละตัวในโหมด batch (ไม่ยุ่งกับ DOM) และ return {predictions[], compareField}
function _computeFormulasBatch(prev, nextDateStr, historyCtx=[]){
  const p6=(prev.prize1||'').padStart(6,'0');
  const t3=(prev.top3||'').padStart(3,'0');
  const b2=(prev.bottom2||'').padStart(2,'0');
  const f31=(prev.front3_1||'').padStart(3,'0');
  const f32=(prev.front3_2||'').padStart(3,'0');
  const bk1=(prev.back3_1||'').padStart(3,'0');
  const bk2=(prev.back3_2||'').padStart(3,'0');
  let nextDay=1,nextMonth=1,nextYear2=68;
  if(nextDateStr){const[y,m,d]=nextDateStr.split('-').map(Number);nextDay=d;nextMonth=m;nextYear2=(y+543)%100;}
  const drawday=nextDay===16?16:1;

  const results=[];

  // A1 บวกเลขบนล่าง → ทาย digit (หลักหน่วย bottom2)
  try{
    const digits=[...t3,...b2].map(Number);
    const total=digits.reduce((a,b)=>a+b,0);
    results.push({name:'A1 บวกเลขบนล่าง',preds:[String(total%10),String(Math.floor(total/10)%10)],field:'bottom2_unit',baseline:1});
  }catch(e){results.push({name:'A1 บวกเลขบนล่าง',preds:[],field:'bottom2_unit',baseline:1});}

  // A2 คี่คู่ → ทาย digit หลักหน่วย bottom2
  try{
    const allN=[...p6,...t3,...b2,...bk1,...bk2].map(Number);
    const odd=allN.filter(d=>d%2!==0).length;
    const hint=odd>allN.length/2?['0','2','4','6','8']:['1','3','5','7','9'];
    results.push({name:'A2 คี่คู่',preds:hint,field:'bottom2_unit',baseline:5});
  }catch(e){results.push({name:'A2 คี่คู่',preds:[],field:'bottom2_unit',baseline:5});}

  // A3 คูณหลักร้อย×หลักสิบ → ทาย digit หลักหน่วย bottom2
  try{
    const d1=parseInt(p6[3]||'0'),d2=parseInt(p6[4]||'0');
    results.push({name:'A3 คูณหลักร้อย×หลักสิบ',preds:[String((d1*d2)%10)],field:'bottom2_unit',baseline:1});
  }catch(e){results.push({name:'A3 คูณหลักร้อย×หลักสิบ',preds:[],field:'bottom2_unit',baseline:1});}

  // A4 วันหวยออก → ทาย digit หลักหน่วย bottom2
  try{
    const nums=drawday===16?['1','2','4','5','7','8','9']:['0','1','2','3','4','5','6','7'];
    results.push({name:`A4 วันหวยออก(${drawday})`,preds:nums,field:'bottom2_unit',baseline:nums.length});
  }catch(e){results.push({name:'A4 วันหวยออก',preds:[],field:'bottom2_unit',baseline:7});}

  // A5 สูตรอมตะ → ทาย bottom2 (36 คู่)
  try{
    const X=(parseInt(p6[2])+parseInt(p6[4]))%10;
    const g1=[X,(X+1)%10,(X+2)%10,(X+3)%10,(X+4)%10,(X+6)%10];
    const g2s=(g1[5]+1)%10;
    const g2=[g2s,(g2s+1)%10,(g2s+2)%10,(g2s+3)%10,(g2s+4)%10,(g2s+5)%10];
    const pairs=[];for(const a of g1)for(const b of g2)pairs.push(`${a}${b}`);
    results.push({name:'A5 สูตรอมตะ (36 คู่)',preds:pairs,field:'bottom2',baseline:36});
  }catch(e){results.push({name:'A5 สูตรอมตะ',preds:[],field:'bottom2',baseline:36});}

  // B1 สูตรสองตัวล่าง → ทาย bottom2
  try{
    const unit2=parseInt(b2[1]||'0');
    let sum=nextDay+nextMonth+nextYear2+unit2;
    if(sum>99)sum-=100;
    const r=String(sum).padStart(2,'0');
    results.push({name:'B1 สูตรสองตัวล่าง',preds:[r,r[1]+r[0]],field:'bottom2',baseline:2});
  }catch(e){results.push({name:'B1 สูตรสองตัวล่าง',preds:[],field:'bottom2',baseline:2});}

  // C1 ผันผวนเป็นตัวเงิน → ทาย bottom2
  try{
    const h=parseInt(bk1[0]),tt=parseInt(bk1[1]),u=parseInt(bk1[2]);
    const s1h=(h+u)%10,s1t=(tt+u)%10;
    const s2=(s1h+s1t)%10;
    const rh=Math.abs(s1h-s2)%10,rt=Math.abs(s1t-s2)%10;
    const r=`${rh}${rt}`;
    results.push({name:'C1 ผันผวนเป็นตัวเงิน',preds:[r,r[1]+r[0]],field:'bottom2',baseline:2});
  }catch(e){results.push({name:'C1 ผันผวนเป็นตัวเงิน',preds:[],field:'bottom2',baseline:2});}

  // C2 2530 ปีทอง → ทาย 4 digit ของ prize1 หลักพัน-หน่วย (เทียบ digit-wise)
  try{
    const p4=p6.slice(2);
    const r=p4.split('').map((d,i)=>(parseInt(d)+parseInt('2530'[i]))%10).join('');
    results.push({name:'C2 สูตร2530ปีทอง',preds:r.split(''),field:'prize1_last4_digits',baseline:4});
  }catch(e){results.push({name:'C2 สูตร2530ปีทอง',preds:[],field:'prize1_last4_digits',baseline:4});}

  // C3 หงส์ฟ้า → ทาย back3_1 หรือ back3_2
  try{
    const rows=[[parseInt(p6[0]),parseInt(p6[1])],[parseInt(p6[2]),parseInt(p6[3])],[parseInt(p6[4]),parseInt(p6[5])],[parseInt(b2[0]||0),parseInt(b2[1]||0)]];
    const cA=rows[0][0]+rows[1][0]+rows[2][0]+rows[3][0];
    const cB=rows[0][1]+rows[1][1]+rows[2][1]+rows[3][1];
    const carry=Math.floor(cB/10);
    const st=`${(cA+carry)%10}${cB%10}`;
    const bk2p=bk2.padStart(3,'0');
    const sp=st.padStart(3,'0');
    const raw=sp.split('').map((d,i)=>parseInt(d)+parseInt(bk2p[i]));
    let c2=0,res3=[];for(let i=2;i>=0;i--){const s=raw[i]+c2;res3.unshift(s%10);c2=Math.floor(s/10);}
    const r3=res3.join('');
    results.push({name:'C3 หงส์ฟ้าถล่มปฐพี',preds:[r3,r3.slice(1)],field:'back3',baseline:2});
  }catch(e){results.push({name:'C3 หงส์ฟ้าถล่มปฐพี',preds:[],field:'back3',baseline:2});}

  // ══ D. เจ้าพ่อ Claude — เลขเต็มจากสูตรย่อย (backtest = ออกตรงเป๊ะ) ══
  try{
    const _D=_claudeFormulas({p6,t3,b2,bk1,bk2,drawday,nextDay,nextMonth,nextYear2});
    results.push({name:'D1 สายธาร · ท้าย2',preds:_D.d1,field:'bottom2',baseline:_D.d1.length});
    results.push({name:'D2 มังกรวาด · หน้า3',preds:_D.d2,field:'front3',baseline:_D.d2.length});
    results.push({name:'D3 หักล้าง · ท้าย3',preds:_D.d3,field:'back3exact',baseline:_D.d3.length});
    results.push({name:'D4 วงจรชีวิต · ท้าย2รางวัลที่1',preds:_D.d4two,field:'prize1_last2',baseline:_D.d4two.length});
  }catch(e){}

  // ══ G. แม่นขั้นเทพ — ร้อยมาลัย 3 ตัวบน + 2 ตัวล่าง ══
  try{
    const _G=_maenKhanThep({p6,t3,b2,f31,f32,bk1,bk2});
    results.push({name:'G1 แม่นขั้นเทพ · 3ตัวบน 5-9-5',preds:_G.top3Type1,field:'top3',baseline:_G.top3Type1.length});
    results.push({name:'G2 แม่นขั้นเทพ · 3ตัวบน ขนาบ 4/6',preds:_G.top3Type2,field:'top3',baseline:_G.top3Type2.length});
    results.push({name:'G3 แม่นขั้นเทพ · 3ตัวบน โครง25ตัด',preds:_G.top3Type3,field:'top3',baseline:_G.top3Type3.length});
    results.push({name:'G4 แม่นขั้นเทพ · 2ตัวล่าง',preds:_G.bottom2,field:'bottom2',baseline:_G.bottom2.length});
  }catch(e){}

  // ══ H. มิสเตอร์ซี — สูตรจากคลิป pZI5wD5WzzE สำหรับ 3 ตัวบนตรง ══
  try{
    const _H=_misterC({p6,t3,b2,f31,bk1,bk2});
    results.push({name:'H1 มิสเตอร์ซี · 3ตัวบนตรงชุดเดียว',preds:_H.formula1,field:'top3',baseline:_H.formula1.length});
    results.push({name:'H2 มิสเตอร์ซี · สูตรเสริมชุดเดียว',preds:_H.formula2,field:'top3',baseline:_H.formula2.length});
    results.push({name:'H3 มิสเตอร์ซี · จับคู่สองสูตร',preds:_H.combo,field:'top3',baseline:_H.combo.length});
  }catch(e){}

  // ══ F. เจ้าพ่อ Codex — rolling history scorer (ไม่มองอนาคต) ══
  try{
    const codexRows=[{
      date:prev.date, prize1:p6, top3:t3, top2:p6.slice(-2), bottom2:b2,
      front3_1:prev.front3_1, front3_2:prev.front3_2,
      back3_1:bk1, back3_2:bk2,
    }, ...historyCtx];
    const _C=_codexFormulas(codexRows,nextDateStr);
    results.push({name:'X1 Codex Sharp · ท้าย2',preds:_C.bottomSharp,field:'bottom2',baseline:_C.bottomSharp.length});
    results.push({name:'X2 Codex Front · หน้า3',preds:_C.front3,field:'front3',baseline:_C.front3.length});
    results.push({name:'X3 Codex Back · ท้าย3',preds:_C.back3,field:'back3exact',baseline:_C.back3.length});
    results.push({name:'X4 Codex Prize Tail · ท้าย2รางวัลที่1',preds:_C.prize1Last2,field:'prize1_last2',baseline:_C.prize1Last2.length});
  }catch(e){}

  // ══ F. Pattern Link — train/test derived transition links (ไม่มองอนาคต) ══
  try{
    const _P=_patternLinkFormulas({date:prev.date,prize1:p6,top3:t3,bottom2:b2,front3_1:f31,front3_2:f32,back3_1:bk1,back3_2:bk2},nextDateStr);
    results.push({name:'X5 Pattern Link · 2ตัวคัดเข้ม',preds:_P.bottom2Tight,field:'bottom2',baseline:_P.bottom2Tight.length});
    results.push({name:'X6 Pattern Link · 2ตัวครอบคลุม',preds:_P.bottom2Wide,field:'bottom2',baseline:_P.bottom2Wide.length});
    results.push({name:'X7 Pattern Link · 3หลักหน้า',preds:_P.any3,field:'front3',baseline:_P.any3.length});
    results.push({name:'X8 Pattern Link · 3หลักท้าย',preds:_P.any3,field:'back3exact',baseline:_P.any3.length});
    results.push({name:'X9 Pattern Link · 3ตัวบน',preds:_P.any3,field:'top3',baseline:_P.any3.length});
  }catch(e){}

  // ══ E. สายมู/ความเชื่อ — เทียบ 2 ตัวล่าง (exact = เลขเด่น 2 หลักออกตรง) ══
  try{
    for(const f of _beliefData(nextDay,nextMonth,nextYear2,nextDateStr)){
      results.push({name:f.name+' (เด่น2ตัว)',preds:f.nums,field:'bottom2',baseline:f.nums.length});
    }
  }catch(e){}

  // ══ FB. FABLE — เลข 6 หลัก / เลขท้าย 3 จาก pool รางวัล 1-5 (ต้องมี Sanook data ใน history) ══
  try{
    const fb=_fableFromHistory(historyCtx);
    if(fb){
      results.push({name:'FB1 FABLE · เลข 6 หลัก',preds:fb.six,field:'fable6',baseline:fb.six.length});
      results.push({name:'FB2 FABLE · ท้าย 3 (pool 1-5)',preds:fb.tail3,field:'fable_pool3',baseline:fb.tail3.length});
    }
  }catch(e){}

  return results;
}

// ─── FABLE core (JS sync — ใช้ historyCtx จาก prize-history) ────────────────────
function _fableDrawPool(row){
  const nums=[];
  const singles=['prize1','near1_1','near1_2','prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
    'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10'];
  for(const c of singles){
    const v=String(row[c]||'').trim();
    if(/^\d{6}$/.test(v))nums.push(v);
  }
  for(const c of ['prize4','prize5']){
    for(const tok of String(row[c]||'').trim().split(/\s+/)){
      if(/^\d{6}$/.test(tok))nums.push(tok);
    }
  }
  return nums;
}
function _fableAllSlices(width){
  return Array.from({length:10**width},(_,i)=>String(i).padStart(width,'0'));
}
function _fableRecency(i,n){
  return .3+.7*(i/Math.max(n-1,1));
}
function _fableSlice(num,width,head){
  return head?String(num).slice(0,width):String(num).slice(-width);
}
function _fableAdd(map,key,val){
  map.set(key,(map.get(key)||0)+val);
}
function _fableNormalizeMap(map,keys){
  let max=0;for(const v of map.values())if(v>max)max=v;
  const out=new Map();
  keys.forEach(k=>out.set(k,max>0?(map.get(k)||0)/max:0));
  return out;
}
function _fableNeighborSlices(value){
  const width=value.length,n=Number(value),out=[];
  [-1,1].forEach(d=>{
    const x=n+d;
    if(x>=0&&x<10**width)out.push(String(x).padStart(width,'0'));
  });
  return out;
}
function _fableNearFeature(pools,width,head){
  const keys=_fableAllSlices(width),score=new Map(),n=pools.length;
  pools.forEach((pool,i)=>{
    const w=_fableRecency(i,n),cnt=new Map();
    for(const num of pool){
      const t=_fableSlice(num,width,head);
      cnt.set(t,(cnt.get(t)||0)+1);
    }
    for(const [t,c] of cnt.entries()){
      if(c>1)_fableAdd(score,t,w*Math.min(c-1,5)*.45);
      _fableNeighborSlices(t).forEach(nb=>_fableAdd(score,nb,w*Math.min(c,5)));
    }
  });
  return _fableNormalizeMap(score,keys);
}
function _fableTransitionSource(num,width,head){
  if(head)return String(num).slice(-3);
  return width===3?String(num).slice(0,3):String(num).slice(-3);
}
function _fableTransitionFeature(pools,width,head){
  const keys=_fableAllSlices(width);
  if(pools.length<3)return new Map(keys.map(k=>[k,0]));
  const latest=new Set(pools[pools.length-1].map(n=>_fableTransitionSource(n,width,head)));
  const score=new Map(),nPairs=pools.length-1;
  for(let i=0;i<nPairs;i++){
    const prev=new Set(pools[i].map(n=>_fableTransitionSource(n,width,head)));
    let overlap=0;for(const x of latest)if(prev.has(x))overlap++;
    if(!overlap)continue;
    const sim=overlap/Math.max(latest.size,1),w=_fableRecency(i,nPairs),targets=new Map();
    for(const num of pools[i+1]){
      const t=_fableSlice(num,width,head);
      targets.set(t,(targets.get(t)||0)+1);
    }
    for(const [t,c] of targets.entries())_fableAdd(score,t,w*sim*Math.min(c,5));
  }
  return _fableNormalizeMap(score,keys);
}
function _fableSimilarity(a,b){
  if(!a||!b||a.length!==b.length)return 0;
  let pos=0;for(let i=0;i<a.length;i++)if(a[i]===b[i])pos++;
  const prefix=a.length>1&&a.slice(0,-1)===b.slice(0,-1)?1:0;
  const suffix=a.length>1&&a.slice(1)===b.slice(1)?1:0;
  const sum=s=>[...s].reduce((x,d)=>x+Number(d),0)%10;
  const ds=sum(a)===sum(b)?1:0;
  return Math.min(1,.45*(pos/a.length)+.25*prefix+.25*suffix+.05*ds);
}
function _fableDiversePick(scored,k,penalty){
  const sorted=[...scored].sort((a,b)=>b[1]-a[1]);
  if(!penalty||k<=1)return sorted.slice(0,k);
  const remaining=sorted.slice(0,Math.max(k*10,60)),selected=[];
  while(remaining.length&&selected.length<k){
    let bestIdx=0,best=-Infinity;
    for(let i=0;i<remaining.length;i++){
      const row=remaining[i];
      const sim=Math.max(0,...selected.map(s=>_fableSimilarity(row[0],s[0])));
      const adj=row[1]*(1-penalty*sim);
      if(adj>best){best=adj;bestIdx=i;}
    }
    selected.push(remaining.splice(bestIdx,1)[0]);
  }
  return selected;
}
function _fableScoreSlices(pools,head,k=15,cfg=null){
  const width=3,n=pools.length,sl=s=>_fableSlice(s,width,head),keys=_fableAllSlices(width);
  const v=cfg||((typeof _fableConfigValues==='function')?_fableConfigValues():FABLE_CONFIG_DEFAULTS);
  const crossW=Number(v.cross_w??.45),digitW=Number(v.digit_w??.20),momW=Number(v.momentum_w??.20);
  const lagPenalty=Math.max(0,Math.min(.95,Number(v.lag_penalty??.25)));
  const nearW=Math.max(0,Number(v.near_w??0)),transitionW=Math.max(0,Number(v.transition_w??0));
  const diversity=Math.max(0,Math.min(.95,Number(v.diversity_penalty??0)));
  const cross=new Map(),posCnt=[{},{},{}];let totalNums=0;
  pools.forEach((pool,i)=>{
    const w=_fableRecency(i,n);
    for(const num of pool){
      const t=sl(num);
      _fableAdd(cross,t,w);
      for(let p=0;p<width;p++)posCnt[p][t[p]]=(posCnt[p][t[p]]||0)+1;
      totalNums++;
    }
  });
  let maxCross=0;for(const v of cross.values())if(v>maxCross)maxCross=v;
  const dpRaw=t=>{let s=1;for(let p=0;p<width;p++)s*=(posCnt[p][t[p]]||0)/Math.max(totalNums,1);return s;};
  let maxDp=0;keys.forEach(t=>{const d=dpRaw(t);if(d>maxDp)maxDp=d;});
  const recent=new Map(),year=new Map();
  pools.slice(-6).forEach(pool=>pool.forEach(num=>_fableAdd(recent,sl(num),1)));
  pools.slice(-24).forEach(pool=>pool.forEach(num=>_fableAdd(year,sl(num),1)));
  const last=new Set((pools[pools.length-1]||[]).map(sl));
  const near=nearW>0?_fableNearFeature(pools,width,head):new Map();
  const transition=transitionW>0?_fableTransitionFeature(pools,width,head):new Map();
  const scored=keys.map(t=>{
    const r6=recent.get(t)||0,r24=year.get(t)||0;
    const mom=r24?(r6/6)/((r24/24)+1e-9):(r6?1.5:1);
    let score=crossW*((cross.get(t)||0)/(maxCross||1))+digitW*(dpRaw(t)/(maxDp||1))+momW*Math.min(mom/3,1)+nearW*(near.get(t)||0)+transitionW*(transition.get(t)||0);
    if(last.has(t))score*=1-lagPenalty;
    return [t,score];
  });
  return _fableDiversePick(scored,k,diversity);
}
function _fableFromHistory(historyCtx){
  if(!Array.isArray(historyCtx)||historyCtx.length<20)return null;
  // historyCtx เรียงใหม่→เก่า (จาก prize-history) → กลับเป็นเก่า→ใหม่ แล้วเอาเฉพาะงวดที่มี Sanook data
  const rows=[...historyCtx].reverse();
  const pools=rows.map(_fableDrawPool).filter(p=>p.length>0);
  if(pools.length<20)return null;
  const cfg=(typeof _fableConfigValues==='function')?_fableConfigValues():FABLE_CONFIG_DEFAULTS;
  const heads=_fableScoreSlices(pools,true,8,cfg).slice(0,5);
  const tails=_fableScoreSlices(pools,false,15,cfg).slice(0,5);
  const six=[];
  for(const [h,hs] of heads)for(const [t,ts] of tails)six.push([h+t,hs*ts]);
  six.sort((a,b)=>b[1]-a[1]);
  return {
    six:six.slice(0,10).map(x=>x[0]),
    tail3:_fableScoreSlices(pools,false,15,cfg).slice(0,15).map(x=>x[0]),
  };
}

let _btRunning=false;
async function runFormulaBacktest(){
  if(_btRunning)return;
  _btRunning=true;
  const _btBtn=document.querySelector('#formula-results-BT button.btn-primary');
  if(_btBtn){_btBtn.disabled=true;_btBtn.textContent='กำลังรัน...';}
  const n=parseInt(document.getElementById('bt-formula-n').value)||50;
  const targetTest=Math.max(n,...FORMULA_BT_WINDOWS);
  document.getElementById('formula-bt-loading').style.display='block';
  document.getElementById('formula-bt-table').innerHTML='';
  switchFormulaTab('BT');
  try{

  const h=await api(`prize-history?n=${Math.min(600,targetTest+201)}`);
  const rows=Array.isArray(h.data)?h.data:[];
  _btFieldCheck=_formulaFieldMappingCheck(rows);
  if(rows.length<2){
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" style="display:block">ยังไม่มีข้อมูลย้อนหลังเพียงพอสำหรับ Backtest</div>';
    return;
  }

  // rows เรียงใหม่สุดก่อน → rows[i] = current, rows[i+1] = prev
  const stats={};
  let tested=0;
  let selectedTested=0;

  for(let i=0;i<rows.length-1&&tested<targetTest;i++){
    const curr=rows[i];
    const prev=rows[i+1];
    if(!prev.prize1||!curr.prize1) continue;
    tested++;
    // สร้าง ISO date ของงวดปัจจุบัน
    let isoDate='';
    if(curr.date){const[d,m,y]=curr.date.split('/').map(Number);isoDate=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}

    const historyCtx=rows.slice(i+2,i+202); // งวดก่อนหน้า prev สำหรับ rolling scorer (ไม่รวม curr)
    // pool เลขท้ายรางวัลรอง (near1 + prize2 + prize3) ของงวดปัจจุบัน — ใช้เช็ก "ถูกรอง" แยกจาก hit หลัก
    const secondary6=[];
    ['near1_1','near1_2','prize2_1','prize2_2','prize2_3','prize2_4','prize2_5',
     'prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10'
    ].forEach(k=>{const v=(curr[k]||'').padStart(6,'0');if(v.length===6&&/^\d{6}$/.test(v))secondary6.push(v);});
    ['prize4','prize5'].forEach(k=>{
      for(const tok of String(curr[k]||'').trim().split(/\s+/)){
        if(/^\d{6}$/.test(tok))secondary6.push(tok);
      }
    });
    const secTail3=new Set(secondary6.map(v=>v.slice(-3)));
    const secTail2=new Set(secondary6.map(v=>v.slice(-2)));
    const hasSecondary=secondary6.length>0;
    // pool รวมสำหรับ FABLE (รางวัล 1-5): prize1 + ทุกรางวัลรอง
    const fablePool=new Set(secondary6);
    if(/^\d{6}$/.test(curr.prize1||''))fablePool.add(curr.prize1);
    const fablePoolT3=new Set([...fablePool].map(v=>v.slice(-3)));
    const formulaResults=_computeFormulasBatch(prev,isoDate,historyCtx);
    for(const fr of formulaResults){
      if(!stats[fr.name]){
        stats[fr.name]={hits:0,total:0,preds_n:fr.baseline,field:fr.field,subHits:0,subTotal:0,slots:fr.slots||2,windows:{}};
        FORMULA_BT_WINDOWS.forEach(w=>{stats[fr.name].windows[w]={hits:0,total:0};});
      }
      const s=stats[fr.name];
      const hit=_formulaHitForField(fr,curr,{fablePool,fablePoolT3});
      const subHit=hasSecondary?_formulaSecondaryHit(fr,secondary6,secTail2,secTail3):false;
      if(tested<=n){
        s.total++;
        if(hit)s.hits++;
        if(fr.slots)s.slots=fr.slots;
        if(hasSecondary){
          s.subTotal++;
          if(subHit)s.subHits++;
        }
      }
      FORMULA_BT_WINDOWS.forEach(w=>{
        if(tested>w)return;
        const ws=s.windows[w]||(s.windows[w]={hits:0,total:0});
        ws.total++;
        if(hit)ws.hits++;
      });
    }
  }

  // build row data (fair baseline per field type)
  selectedTested=Math.min(tested,n);
  _btTested=selectedTested;
  _btRowData=Object.entries(stats).map(([name,s])=>{
    const pct=s.total?s.hits/s.total*100:0;
    const {baseP,baseLabel,typeLabel,board}= _formulaBaselineForField(s.field,s.preds_n,s.slots||2);
    const edge=pct-baseP;
    const p=s.hits/Math.max(s.total,1);
    const se=Math.sqrt(Math.max(p*(1-p),0)/Math.max(s.total,1))*100;
    const ciLow=Math.max(0,pct-1.96*se);
    const ciHigh=Math.min(100,pct+1.96*se);
    const rolling={};
    FORMULA_BT_WINDOWS.forEach(w=>{
      const ws=s.windows?.[w]||{hits:0,total:0};
      const wpct=ws.total?ws.hits/ws.total*100:null;
      rolling[w]={hits:ws.hits,total:ws.total,pct:wpct,edge:wpct==null?null:wpct-baseP};
    });
    const _GRP={'A':['A · กูชอบ','var(--gold)'],'B':['B · ลอตโตพลัส','#4d9de0'],'C':['C · พิชิตโชค','#a855f7'],'D':['D · Claude','#22d3ee'],'X':['F · Codex','#a3e635'],'G':['G · แม่นขั้นเทพ','#f05454'],'H':['H · มิสเตอร์ซี','#f59e0b'],'E':['E · สายมู','#ec4899']};
    const [group,groupColor]=name.startsWith('FB')?['FB · FABLE','var(--gold2)']:(_GRP[name[0]]||[name[0],'var(--text3)']);
    const subPct=s.subTotal>0?s.subHits/s.subTotal*100:null;
    const edge50=rolling[50]?.edge??null,edge100=rolling[100]?.edge??null,edge200=rolling[200]?.edge??null;
    const degraded=rolling[200]?.total>=180&&edge200!=null&&edge200<-5;
    return {name,group,groupColor,field:s.field,typeLabel,board,total:s.total,hits:s.hits,pct,baseP,baseLabel,edge,ciLow,ciHigh,subHits:s.subHits||0,subTotal:s.subTotal||0,subPct,rolling,edge50,edge100,edge200,degraded};
  });
  _btSortKey='edge';_btSortAsc=false;
  _renderBtTable();
  if(_formulaHasRun){
    try{runAllFormulas();}catch(e){
      _renderFormulaFinalPicks();
      _renderFormulaInsights();
    }
  }
  }catch(e){
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" style="display:block">รัน Backtest ไม่สำเร็จ ลองใหม่อีกครั้ง</div>';
    if(typeof toast==='function')toast('รัน Backtest ไม่สำเร็จ','error');
  }finally{
    document.getElementById('formula-bt-loading').style.display='none';
    _btRunning=false;
    if(_btBtn){_btBtn.disabled=false;_btBtn.textContent='▶ รัน Backtest';}
  }
}

function btSort(key){
  if(_btSortKey===key)_btSortAsc=!_btSortAsc;
  else{_btSortKey=key;_btSortAsc=false;}
  _renderBtTable();
}

function _formulaBtSummaryHtml(rows){
  if(!rows.length)return '';
  const bestEdge=[...rows].sort((a,b)=>b.edge-a.edge)[0];
  const bestHit=[...rows].sort((a,b)=>b.pct-a.pct)[0];
  const focused=[...rows].filter(r=>(r.baseP||0)<=2).sort((a,b)=>b.edge-a.edge)[0]||bestEdge;
  const risky=[...rows].filter(r=>r.edge<0).sort((a,b)=>a.edge-b.edge)[0]||rows[rows.length-1];
  const card=(label,value,sub,cls='')=>`<div class="bt-summary-card"><div class="bt-summary-label">${label}</div><div class="bt-summary-value ${cls}">${value}</div><div class="bt-summary-sub" title="${_formulaEsc(sub||'')}">${_formulaEsc(sub||'-')}</div></div>`;
  return `<div class="bt-summary-board">
    ${card('Best edge',`${bestEdge.edge>=0?'+':''}${bestEdge.edge.toFixed(1)}%`,bestEdge.name,bestEdge.edge>0?'pos':'')}
    ${card('Best hit rate',`${bestHit.pct.toFixed(1)}%`,bestHit.name)}
    ${card('ชุดน้อยแต่น่าสนใจ',`${focused.edge>=0?'+':''}${focused.edge.toFixed(1)}%`,focused.name,focused.edge>0?'pos':'')}
    ${card('ควรระวัง',`${risky.edge>=0?'+':''}${risky.edge.toFixed(1)}%`,risky.name,'neg')}
  </div>`;
}

function _renderBtTableLegacy(){
  if(!_btRowData.length)return;
  const sorted=[..._btRowData].sort((a,b)=>{
    const av=a[_btSortKey],bv=b[_btSortKey];
    if(typeof av==='string')return _btSortAsc?av.localeCompare(bv):bv.localeCompare(av);
    return _btSortAsc?av-bv:bv-av;
  });
  const arr=k=>k===_btSortKey?(_btSortAsc?' ▲':' ▼'):' ⇅';
  const th=(label,key,align)=>`<th style="cursor:pointer;user-select:none;white-space:nowrap${align?';text-align:'+align:''}" onclick="btSort('${key}')">${label}${arr(key)}</th>`;
  const typeColor=t=>t==='หลักหน่วย'?'rgba(240,84,84,.18);color:var(--red)':t==='วิ่ง'?'rgba(168,85,247,.18);color:var(--purple)':'var(--surface2);color:var(--text2)';
  const rows=sorted.map(r=>{
    const ec=r.edge>3?'var(--green)':r.edge<-3?'var(--red)':'var(--text2)';
    const pc=r.edge>3?'var(--green)':r.edge<-3?'var(--red)':'var(--text1)';
    const badge=r.edge>5?'⭐':r.edge>0?'✓':r.edge<-5?'✗':'~';
    const bc=r.edge>0?'var(--green)':r.edge<-5?'var(--red)':'var(--text3)';
    const tc=typeColor(r.typeLabel);
    return `<tr>
      <td><span style="background:${r.groupColor}22;color:${r.groupColor};padding:1px 7px;border-radius:4px;font-size:.7rem;white-space:nowrap;font-weight:600;margin-right:5px">${r.group}</span>${r.name}</td>
      <td><span style="background:${tc};padding:1px 6px;border-radius:3px;font-size:.7rem;white-space:nowrap">${r.typeLabel}</span></td>
      <td style="text-align:right">${r.total}</td>
      <td style="text-align:right;font-weight:700;color:${pc}">${r.hits}</td>
      <td style="text-align:right;font-weight:700;color:${pc}">${r.pct.toFixed(1)}%</td>
      <td style="text-align:right;font-size:.72rem;color:var(--text3)">${r.baseLabel} = ${r.baseP.toFixed(1)}%</td>
      <td style="text-align:right;font-weight:700;color:${ec}">${r.edge>=0?'+':''}${r.edge.toFixed(1)}%</td>
      <td style="text-align:center;font-weight:700;color:${bc}">${badge}</td>
    </tr>`;
  });
  const thead=`<thead><tr>${th('สูตร','name')}${th('ประเภท','typeLabel')}${th('งวด','total','right')}${th('ถูก','hits','right')}${th('%แม่น','pct','right')}${th('Baseline(สุ่ม)','baseP','right')}${th('Edge','edge','right')}<th style="text-align:center">ผล</th></tr></thead>`;
  document.getElementById('formula-bt-table').innerHTML=`
    ${_formulaBtSummaryHtml(sorted)}
    <div class="card">
      <div class="card-title" style="margin-bottom:6px">ผล Backtest ${_btTested} งวดย้อนหลัง — คลิกหัวตารางเพื่อเรียงลำดับ</div>
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap">
        <span><b>Edge</b> = %แม่นจริง − Baseline สุ่ม (เปรียบเทียบ fair ข้ามประเภท)</span>
        <span style="color:var(--green)">⭐ Edge&gt;5%</span>
        <span style="color:var(--green)">✓ Edge&gt;0%</span>
        <span style="color:var(--text3)">~ ≈สุ่ม</span>
        <span style="color:var(--red)">✗ ต่ำกว่าสุ่ม</span>
        <span style="background:rgba(240,84,84,.18);color:var(--red);padding:0 5px;border-radius:3px">หลักหน่วย</span> baseline สูง → edge มักต่ำ
      </div>
      <div class="tbl-wrap"><table>${thead}<tbody>${rows.join('')}</tbody></table></div>
    </div>`;
}

// ─── FABLE ────────────────────────────────────────────────────────────────────
let _fablePassed=null; // null=ยังไม่รู้, true/false จาก backtest
let _fableLastBacktest=null;
let _fableLastConfigKey='';
let _fableBtRunning=false;
let _fableGridRunning=false;
let _fableLastGridResults=[];
let _fableLastGridReport=null;
let _fableHoldoutRunning=false;
let _fableLastHoldout=null;
let _fableLastHoldoutResults=[];
let _fableLastPrediction=null;
const FABLE_CONFIG_DEFAULTS={window:100,cross_w:.45,digit_w:.20,momentum_w:.20,lag_penalty:.25,near_w:0,transition_w:0,diversity_penalty:0,drawday_w:.25};
function _fableBadgeHtml(){
  if(_fablePassed===true) return '<span style="background:rgba(61,214,140,.15);color:var(--green);padding:3px 10px;border-radius:5px;font-size:.75rem;font-weight:600">✓ ผ่าน FABLE Lab</span>';
  return '<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:3px 10px;border-radius:5px;font-size:.75rem;font-weight:600">🧪 สูตรทดลอง</span>';
}
function _fableNum(id,def,min,max){
  const el=document.getElementById(id);
  const n=Number(el?.value);
  if(!Number.isFinite(n))return def;
  return Math.max(min,Math.min(max,n));
}
function _fableConfigValues(){
  return {
    window:_fableNum('fable-window',FABLE_CONFIG_DEFAULTS.window,30,200),
    cross_w:_fableNum('fable-cross-w',FABLE_CONFIG_DEFAULTS.cross_w,0,2),
    digit_w:_fableNum('fable-digit-w',FABLE_CONFIG_DEFAULTS.digit_w,0,2),
    momentum_w:_fableNum('fable-momentum-w',FABLE_CONFIG_DEFAULTS.momentum_w,0,2),
    lag_penalty:_fableNum('fable-lag-penalty',FABLE_CONFIG_DEFAULTS.lag_penalty,0,.95),
    near_w:_fableNum('fable-near-w',FABLE_CONFIG_DEFAULTS.near_w,0,2),
    transition_w:_fableNum('fable-transition-w',FABLE_CONFIG_DEFAULTS.transition_w,0,2),
    diversity_penalty:_fableNum('fable-diversity-penalty',FABLE_CONFIG_DEFAULTS.diversity_penalty,0,.95),
    drawday_w:_fableNum('fable-drawday-w',FABLE_CONFIG_DEFAULTS.drawday_w,0,2),
  };
}
function _fableLocalConfig(){
  const v=_fableConfigValues();
  return {
    pool_label:'รางวัล 1-5 (~168 เลข/งวด)',
    target_date:_fableTargetDate(),
    window:v.window,
    n_six:10,
    top2:10,
    top3:15,
    weights:{cross_freq:v.cross_w,digit_position:v.digit_w,momentum:v.momentum_w,anti_lag_penalty:v.lag_penalty,near_miss:v.near_w,slice_transition:v.transition_w,diversity_penalty:v.diversity_penalty,draw_day:v.drawday_w},
  };
}
function _fableConfigKey(){
  const v=_fableConfigValues();
  return ['window','cross_w','digit_w','momentum_w','lag_penalty','near_w','transition_w','diversity_penalty','drawday_w'].map(k=>`${k}:${Number(v[k]).toFixed(3)}`).join('|');
}
function _fableTargetDate(){
  return document.getElementById('f-target-date')?.value||document.getElementById('shared-draw-date')?.value||'';
}
function _fableTargetLabel(){
  const iso=_fableTargetDate();
  if(!iso)return '-';
  const [y,m,d]=iso.split('-').map(Number);
  if(!y||!m||!d)return iso;
  return `${d}/${m}/${y+543}`;
}
function _updateFableTargetLabel(data={}){
  const el=document.getElementById('fable-target-label');
  if(!el)return;
  const ref=data.reference_draw?.date||data.history_range?.to||'';
  el.textContent=`งวดเป้าหมาย ${_fableTargetLabel()}${ref?` · อ้างอิงถึง ${ref}`:''}`;
}
function _fableQueryString(opts={}){
  const v=_fableConfigValues();
  const q=new URLSearchParams();
  if(opts.includeDate!==false){
    const date=_fableTargetDate();
    if(date)q.set('date',date);
  }
  q.set('window',String(v.window));
  q.set('cross_w',String(v.cross_w));
  q.set('digit_w',String(v.digit_w));
  q.set('momentum_w',String(v.momentum_w));
  q.set('lag_penalty',String(v.lag_penalty));
  q.set('near_w',String(v.near_w));
  q.set('transition_w',String(v.transition_w));
  q.set('diversity_penalty',String(v.diversity_penalty));
  q.set('drawday_w',String(v.drawday_w));
  return q.toString();
}
function _setFableConfigFromObject(config){
  const weights=config?.weights||{};
  const set=(id,val)=>{
    const el=document.getElementById(id);
    if(el&&val!=null)el.value=String(val);
  };
  set('fable-window',config?.window);
  set('fable-cross-w',weights.cross_freq);
  set('fable-digit-w',weights.digit_position);
  set('fable-momentum-w',weights.momentum);
  set('fable-lag-penalty',weights.anti_lag_penalty);
  set('fable-near-w',weights.near_miss);
  set('fable-transition-w',weights.slice_transition);
  set('fable-diversity-penalty',weights.diversity_penalty);
  set('fable-drawday-w',weights.draw_day);
}
function _fableResetBacktestIfConfigChanged(){
  const key=_fableConfigKey();
  if(_fableLastConfigKey&&_fableLastConfigKey!==key){
    _fableLastBacktest=null;
    _fablePassed=null;
    const bt=document.getElementById('fable-bt-results');
    if(bt)bt.innerHTML='';
    document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
  }
  return key;
}
function resetFableConfig(){
  Object.entries(FABLE_CONFIG_DEFAULTS).forEach(([k,v])=>{
    const id={window:'fable-window',cross_w:'fable-cross-w',digit_w:'fable-digit-w',momentum_w:'fable-momentum-w',lag_penalty:'fable-lag-penalty',near_w:'fable-near-w',transition_w:'fable-transition-w',diversity_penalty:'fable-diversity-penalty',drawday_w:'fable-drawday-w'}[k];
    const el=document.getElementById(id);
    if(el)el.value=String(v);
  });
  _fableLastBacktest=null;
  _fableLastConfigKey='';
  _fablePassed=null;
  document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
  _updateFableTargetLabel();
  _fableRenderLab({config:_fableLocalConfig()},false);
}
function _fableSelectNum(id,def){
  const n=Number(document.getElementById(id)?.value);
  return Number.isFinite(n)?n:def;
}
// กดที่เลขเพื่อดูเหตุผล (แทน title tooltip ที่ใช้ได้แค่ hover — keyboard/touch เข้าถึงไม่ได้)
function _fableReason(btn){
  const card=btn.closest('.card')||btn.parentElement;
  let box=card.querySelector('.fable-reason-line');
  card.querySelectorAll('[data-fable-chip]').forEach(b=>b.setAttribute('aria-pressed','false'));
  if(box&&box.dataset.num===btn.dataset.num){box.remove();return;}
  if(!box){
    box=document.createElement('div');
    box.className='fable-reason-line';
    box.style.cssText='margin-top:10px;font-size:.78rem;color:var(--text2);background:rgba(255,255,255,.04);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;line-height:1.5';
    card.appendChild(box);
  }
  box.dataset.num=btn.dataset.num;
  btn.setAttribute('aria-pressed','true');
  box.innerHTML=`<b style="font-family:var(--mac-mono,monospace);color:var(--gold2)">${btn.dataset.num}</b> — ${btn.dataset.reason||'ไม่มีคำอธิบาย'}`;
}
window._fableReason=_fableReason;
function _fableChip(x,color){
  return `<button type="button" data-fable-chip data-num="${x.number}" data-reason="${_formulaEsc(x.reason||'')}" aria-pressed="false" onclick="_fableReason(this)" style="display:inline-flex;flex-direction:column;align-items:center;background:var(--surface2);border:1px solid ${color}44;border-radius:8px;padding:6px 12px;min-width:52px;cursor:pointer;font-family:inherit">
    <b style="font-family:'IBM Plex Mono',monospace;font-size:1.05rem;color:${color}">${x.number}</b>
    <span style="font-size:.62rem;color:var(--text3)">${(x.score*100).toFixed(0)}</span>
  </button>`;
}
function _fableEdgeHtml(v){
  if(v==null||Number.isNaN(Number(v)))return '<span style="color:var(--text3)">-</span>';
  const n=Number(v);
  return `<span class="${n>=0?'fable-edge-pos':'fable-edge-neg'}">${n>=0?'+':''}${n.toFixed(3)}</span>`;
}
function _fableRenderLab(data={},loading=false){
  const el=document.getElementById('fable-lab');
  if(!el)return;
  const cfg=data.config||{};
  const weights=cfg.weights||{};
  const rolling=data.rolling||{};
  const criteria=data.criteria||{};
  const status=data.passed===true
    ? '<span class="fable-pill fable-pass">ผ่านเกณฑ์</span>'
    : '<span class="fable-pill fable-fail">ยังเป็นสูตรทดลอง</span>';
  const fmtWeight=v=>v==null?'-':`${(Number(v)*100).toFixed(0)}%`;
  const rollRow=(label,key)=>{
    const row=rolling[key]||{};
    return `<tr>
      <td>${label}<div style="font-size:.66rem;color:var(--text3)">n=${row.tail2?.n??row.tail3?.n??'-'}</div></td>
      <td style="text-align:right">${_fableEdgeHtml(row.tail2?.edge)}</td>
      <td style="text-align:right">${_fableEdgeHtml(row.tail3?.edge)}</td>
      <td style="text-align:right">${_fableEdgeHtml(row.six?.edge)}</td>
    </tr>`;
  };
  const criterion = (ok,label,detail) => `<div class="fable-criterion ${ok?'ok':'no'}">
    <b style="color:${ok?'var(--green)':'#f59e0b'}">${ok?'ผ่าน':'รอดู'}</b> ${label}
    <div style="font-size:.68rem;color:var(--text3);margin-top:3px">${detail}</div>
  </div>`;
  el.innerHTML=`<div class="fable-lab">
    <div class="fable-lab-card">
      <div class="fable-lab-title">FABLE Lab Status ${loading?'<span class="fable-pill">กำลังรัน...</span>':status}</div>
      <div class="fable-kv">
        <b>Pool เป้าหมาย</b><span>${_formulaEsc(cfg.pool_label||'รางวัล 1-5 (~168 เลข/งวด)')}</span>
        <b>History window</b><span>${cfg.window??100} งวด</span>
        <b>จำนวนเลข</b><span>6 หลัก ${cfg.n_six??10} · ท้าย2 ${cfg.top2??10} · ท้าย3 ${cfg.top3??15}</span>
        <b>สถานะ</b><span>${loading?'กำลังประเมิน rolling backtest':(data.tested?`ทดสอบ ${data.tested} งวดล่าสุด`:'ยังไม่ได้รัน backtest')}</span>
      </div>
    </div>
    <div class="fable-lab-card">
      <div class="fable-lab-title">Current Config</div>
      <div class="fable-kv">
        <b>cross_freq</b><span>${fmtWeight(weights.cross_freq)} · ความถี่แบบถ่วงน้ำหนักงวดล่าสุด</span>
        <b>digit_position</b><span>${fmtWeight(weights.digit_position)} · โครงสร้างหลักเลข</span>
        <b>momentum</b><span>${fmtWeight(weights.momentum)} · 6 งวดเทียบ 24 งวด</span>
        <b>anti_lag</b><span>${fmtWeight(weights.anti_lag_penalty)} penalty · หักเลขที่เพิ่งโผล่</span>
        <b>near_miss</b><span>${fmtWeight(weights.near_miss)} · เลขใกล้ ±1 และเลขซ้ำใน pool</span>
        <b>transition</b><span>${fmtWeight(weights.slice_transition)} · pattern ข้ามงวด</span>
        <b>diversity</b><span>${fmtWeight(weights.diversity_penalty)} penalty · กระจายชุดเลขไม่ให้กระจุก</span>
        <b>draw_day</b><span>${fmtWeight(weights.draw_day)} · เลขเด่นตามวันงวด (1/16) และเดือนเดียวกัน</span>
      </div>
    </div>
    <div class="fable-lab-card wide">
      <div class="fable-lab-title">Rolling Edge <span class="fable-pill">Hit เฉลี่ย/งวด − สุ่ม</span></div>
      ${Object.keys(rolling).length?`<div class="tbl-wrap"><table>
        <thead><tr><th>Window</th><th style="text-align:right">ท้าย 2</th><th style="text-align:right">ท้าย 3</th><th style="text-align:right">6 หลัก</th></tr></thead>
        <tbody>${rollRow('W50','W50')}${rollRow('W100','W100')}${rollRow('W200','W200')}</tbody>
      </table></div>`:'<div class="formula-tab-empty" style="display:block">ยังไม่มี rolling report</div>'}
    </div>
    <div class="fable-lab-card wide">
      <div class="fable-lab-title">Promotion Gate (hardened) <span class="fable-pill">ก่อนเข้า Decision Center</span></div>
      <div class="fable-criteria">
        ${criterion(!!criteria.tail2_positive_all_windows,'ท้าย 2 edge บวกทุก window','W50/W100/W200 ต้องมากกว่า 0')}
        ${criterion(!!criteria.tail2_w200_at_least_2,'ท้าย 2 W200 ≥ +2.0','ต้องชนะสุ่มชัดพอ ไม่ใช่แค่เสมอ')}
        ${criterion(!!criteria.tail3_not_negative_all_windows,'ท้าย 3 ไม่ติดลบทุก window','W50/W100/W200 ต้องไม่ต่ำกว่าสุ่ม')}
        ${criterion(!!criteria.tail3_w200_at_least_0_5,'ท้าย 3 W200 ≥ +0.5','ลดโอกาสชนะช่วงสั้นแบบฟลุค')}
        ${criterion(!!criteria.min_sample_200,'sample ≥ 200 งวด','กันผลแกว่งจากข้อมูลน้อย')}
        ${'validation_tail2_positive' in criteria?criterion(!!criteria.validation_tail2_positive,'ท้าย 2 บวกใน validation','ช่วงเก่ากว่า rolling window ไม่ทับกัน — กัน overfit ช่วงล่าสุด'):''}
        ${'validation_tail3_not_negative' in criteria?criterion(!!criteria.validation_tail3_not_negative,'ท้าย 3 ไม่ติดลบใน validation','ช่วงเก่ากว่า rolling window ไม่ทับกัน'):''}
        ${'live_tail2_positive' in criteria?criterion(!!criteria.live_tail2_positive,'ท้าย 2 บวกใน live','ช่วง audit สุดท้าย ไม่ถูกใช้เลือก config'):''}
        ${'live_tail3_not_negative' in criteria?criterion(!!criteria.live_tail3_not_negative,'ท้าย 3 ไม่ติดลบใน live','ช่วง audit สุดท้าย ไม่ถูกใช้เลือก config'):''}
      </div>
    </div>
  </div>`;
}
function _renderFablePrediction(r){
  const el=document.getElementById('fable-results');
  if(!el||!r||r.error)return;
  _fableLastPrediction=r;
  _updateFableTargetLabel(r);
  document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
  _fableRenderLab(_fableLastBacktest||{config:r.config});
  const warn=document.getElementById('fable-warning');
  warn.style.display='block';
  warn.innerHTML='⚠ FABLE เป็น<b>สูตรทดลอง</b> — คำนวณตาม<b>งวดเป้าหมาย '+_fableTargetLabel()+'</b> โดยใช้ข้อมูลก่อนงวดนั้นเท่านั้น ย้อนหลัง '+r.n_history+' งวด ผล backtest ยัง<b>ไม่ชนะการสุ่ม</b>อย่างมีนัย ใช้ประกอบการตัดสินใจเท่านั้น';
  const maxS=(r.six&&r.six[0]&&r.six[0].score)||1;
  const sixChip=x=>`<button type="button" data-fable-chip data-num="${x.number}" data-reason="${_formulaEsc(x.reason||'')}" aria-pressed="false" onclick="_fableReason(this)" style="display:inline-flex;flex-direction:column;align-items:center;background:linear-gradient(135deg,var(--surface2),var(--surface3,var(--surface2)));border:1px solid var(--gold)66;border-radius:10px;padding:8px 14px;cursor:pointer;font-family:inherit">
    <b style="font-family:'IBM Plex Mono',monospace;font-size:1.25rem;letter-spacing:2px;color:var(--gold2)">${x.number}</b>
    <span style="font-size:.62rem;color:var(--text3)">คะแนน ${(x.score/maxS*100).toFixed(0)}</span>
  </button>`;
  el.innerHTML=`
    <div class="card" style="border:1px solid var(--gold);margin-bottom:12px">
      <div class="card-title" style="color:var(--gold2)">🎯 เลข 6 หลัก FABLE (เป้า: ตรงรางวัลใดก็ได้ใน 1-5)</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${(r.six||[]).map(sixChip).join('')}</div>
      <div style="font-size:.7rem;color:var(--text3);margin-top:8px">สร้างจาก หน้า 3 หลักเด่น × ท้าย 3 หลักเด่น ของ pool รางวัล 1-5 · กดที่เลขเพื่อดูเหตุผล</div>
    </div>
    <div class="predict-grid-2">
      <div class="card" style="border:1px solid #a855f744">
        <div class="card-title" style="color:#a855f7">เลขท้าย 3 ตัวเด่น</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${(r.tail3||[]).map(x=>_fableChip(x,'#a855f7')).join('')}</div>
      </div>
      <div class="card" style="border:1px solid #4d9de044">
        <div class="card-title" style="color:#4d9de0">เลขท้าย 2 ตัวเด่น</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${(r.tail2||[]).map(x=>_fableChip(x,'#4d9de0')).join('')}</div>
      </div>
    </div>`;
}
async function loadFable(opts={}){
  const el=document.getElementById('fable-results');
  if(el&&!opts.silent)el.innerHTML='<div style="text-align:center;padding:20px;color:var(--text3)">กำลังคำนวณตามงวดที่เลือก...</div>';
  _updateFableTargetLabel();
  _fableResetBacktestIfConfigChanged();
  const r=await api(`fable?${_fableQueryString()}`);
  if(r.error){if(el)el.innerHTML=`<div class="formula-tab-empty" style="display:block">${r.error}</div>`;return null;}
  _renderFablePrediction(r);
  return r;
}
async function loadFableBacktest(opts={}){
  if(_fableBtRunning)return;
  _fableBtRunning=true;
  const cfgKey=opts.configKey||_fableResetBacktestIfConfigChanged();
  const btn=document.getElementById('fable-bt-btn');
  if(btn){btn.disabled=true;btn.textContent='กำลังรัน FABLE Lab...';}
  const el=document.getElementById('fable-bt-results');
  if(el&&!opts.silent)el.innerHTML='<div style="text-align:center;padding:20px;color:var(--text3)">กำลังรัน backtest (~1 นาที)...</div>';
  _fableRenderLab(_fableLastBacktest||{config:_fableLocalConfig()},true);
  try{
    const r=await api(`fable-backtest?n_draws=200&gate=true&validation_draws=40&live_draws=40&${_fableQueryString({includeDate:false})}`);
    if(r.error){if(el)el.innerHTML=`<div class="formula-tab-empty" style="display:block">${r.error}</div>`;return;}
    _fableLastBacktest=r;
    _fableLastConfigKey=cfgKey;
    _fablePassed=!!r.passed;
    document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
    _fableRenderLab(r,false);
    const row=(label,d)=>{
      const ec=d.edge>0?'var(--green)':d.edge<0?'var(--red)':'var(--text2)';
      return `<tr><td>${label}</td>
        <td style="text-align:right;font-weight:700">${d.avg_hits}</td>
        <td style="text-align:right;color:var(--text3)">${d.baseline_avg_hits}</td>
        <td style="text-align:right;font-weight:700;color:${ec}">${d.edge>=0?'+':''}${d.edge}</td>
        <td style="text-align:right">${d.any_hit_pct}%</td></tr>`;
    };
    if(el)el.innerHTML=`
      <div class="card" style="border-top:2px solid #f59e0b">
        <div class="card-title">ผล Backtest FABLE — ${r.tested} งวดย้อนหลัง</div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>ประเภท</th><th style="text-align:right">Hit เฉลี่ย/งวด</th><th style="text-align:right">สุ่ม (baseline)</th><th style="text-align:right">Edge</th><th style="text-align:right">ถูก≥1 ตัว</th></tr></thead>
          <tbody>${r.six?row('เลข 6 หลักตรงตัว (10 เลข)',r.six):''}${row('เลขท้าย 2 ตัว (10 เลข)',r.tail2)}${row('เลขท้าย 3 ตัว (15 เลข)',r.tail3)}</tbody>
        </table></div>
        <div style="font-size:.72rem;color:var(--text3);margin-top:10px">
          <b>Hit เฉลี่ย/งวด</b> = จำนวนเลขทายที่ตรงเลขท้ายใน pool รางวัล 1-5 · Edge > 0 = ดีกว่าสุ่ม
          ${r.passed?' · <span style="color:var(--green)">ผ่านเกณฑ์ FABLE Lab (rolling + validation/live)</span>':' · <span style="color:#f59e0b">ยังไม่ผ่านเกณฑ์ — ติดสถานะสูตรทดลอง</span>'}
        </div>
        ${r.validation?`<div style="font-size:.72rem;color:var(--text3);margin-top:6px">
          <b>Validation/Live (ช่วงเก่ากว่า ไม่ทับ rolling window)</b> —
          validation ${r.ranges?.validation?.from||'-'}→${r.ranges?.validation?.to||'-'} (n=${r.tested_validation}):
          ท้าย2 ${_fableEdgeHtml(r.validation.tail2.edge)} · ท้าย3 ${_fableEdgeHtml(r.validation.tail3.edge)}
          · live ${r.ranges?.live?.from||'-'}→${r.ranges?.live?.to||'-'} (n=${r.tested_live}):
          ท้าย2 ${_fableEdgeHtml(r.live.tail2.edge)} · ท้าย3 ${_fableEdgeHtml(r.live.tail3.edge)}
        </div>`:''}
      </div>`;
  }finally{
    _fableBtRunning=false;
    if(btn){btn.disabled=false;btn.textContent='⚗ FABLE Lab / Backtest';}
  }
}
function _fableMetricMini(m){
  if(!m)return '-';
  return `T2 ${_fableEdgeHtml(m.tail2?.edge)} · T3 ${_fableEdgeHtml(m.tail3?.edge)}`;
}
function _fableExperimentRowsHtml(rows){
  return rows.map((r,i)=>{
    const cfg=r.config||{},w=cfg.weights||{};
    const stable=r.stable?'<span class="fable-pill fable-pass">holdout stable</span>':'<span class="fable-pill fable-fail">รอดู</span>';
    return `<tr>
      <td><div class="fable-exp-name">${r.rank||i+1}. ${_formulaEsc(r.name)}</div><div style="font-size:.68rem;color:var(--text3)">W${cfg.window} · c${Number(w.cross_freq??0).toFixed(2)} d${Number(w.digit_position??0).toFixed(2)} m${Number(w.momentum??0).toFixed(2)} lag${Number(w.anti_lag_penalty??0).toFixed(2)} near${Number(w.near_miss??0).toFixed(2)} tr${Number(w.slice_transition??0).toFixed(2)} div${Number(w.diversity_penalty??0).toFixed(2)} day${Number(w.draw_day??0).toFixed(2)}</div></td>
      <td>${_fableMetricMini(r.train)}</td>
      <td>${_fableMetricMini(r.holdout)}</td>
      <td style="text-align:right">${_fableEdgeHtml(r.train?.score)}</td>
      <td style="text-align:right">${_fableEdgeHtml(r.holdout?.score)}</td>
      <td style="text-align:right">${_fableEdgeHtml(r.overfit_gap)}</td>
      <td>${stable}</td>
      <td style="text-align:right"><button class="dc-mini-btn" onclick="applyFableExperimentConfig(${i})">ใช้ config นี้</button></td>
    </tr>`;
  }).join('');
}
async function loadFableExperiments(){
  if(_fableGridRunning)return;
  _fableGridRunning=true;
  const btn=document.getElementById('fable-grid-btn');
  const root=document.getElementById('fable-exp-results');
  const n=_fableSelectNum('fable-grid-n',80);
  const holdout=_fableSelectNum('fable-grid-holdout',30);
  const maxConfigs=_fableSelectNum('fable-grid-max',6);
  if(btn){btn.disabled=true;btn.textContent='กำลัง Grid Search...';}
  if(root)root.innerHTML='<div class="card"><div class="card-title">FABLE Grid Search</div><div style="color:var(--text3);font-size:.8rem;padding:8px 0">กำลังทดสอบ config หลายชุด...</div></div>';
  try{
    const r=await api(`fable-grid-search?n_draws=${n}&holdout_draws=${holdout}&max_configs=${maxConfigs}`);
    if(r.error){if(root)root.innerHTML=`<div class="formula-tab-empty" style="display:block">${_formulaEsc(r.error)}</div>`;return;}
    _fableLastGridReport=r;
    _fableLastGridResults=r.results||[];
    const best=r.best_train||{};
    if(root)root.innerHTML=`<div class="card" style="border-top:2px solid var(--gold)">
      <div class="card-title">FABLE Grid Search · ${r.configs_tested} configs</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span class="fable-pill">train ${r.train_draws} งวด</span>
        <span class="fable-pill">holdout ${r.holdout_draws} งวด</span>
        <span class="fable-pill">${_formulaEsc(r.score_formula||'tail2_edge + 2*tail3_edge')}</span>
        <span class="fable-pill">best train: ${_formulaEsc(best.name||'-')}</span>
      </div>
      <div class="tbl-wrap"><table class="fable-exp-table">
        <thead><tr><th>Config</th><th>Train edge</th><th>Holdout edge</th><th style="text-align:right">Train score</th><th style="text-align:right">Holdout score</th><th style="text-align:right">Gap</th><th>State</th><th></th></tr></thead>
        <tbody>${_fableExperimentRowsHtml(_fableLastGridResults)}</tbody>
      </table></div>
    </div>`;
  }finally{
    _fableGridRunning=false;
    if(btn){btn.disabled=false;btn.textContent='Grid Search';}
  }
}
function _fableHoldoutRowsHtml(rows){
  return rows.map((r,i)=>{
    const cfg=r.config||{},w=cfg.weights||{};
    const stable=r.recommendable
      ? '<span class="fable-pill fable-pass">พร้อมพิจารณา</span>'
      : (r.stable?'<span class="fable-pill fable-pass">stable</span>':'<span class="fable-pill fable-fail">ยังไม่ผ่าน</span>');
    return `<tr>
      <td><div class="fable-exp-name">${r.rank||i+1}. ${_formulaEsc(r.name)}</div><div style="font-size:.68rem;color:var(--text3)">W${cfg.window} · c${Number(w.cross_freq??0).toFixed(2)} d${Number(w.digit_position??0).toFixed(2)} m${Number(w.momentum??0).toFixed(2)} lag${Number(w.anti_lag_penalty??0).toFixed(2)} near${Number(w.near_miss??0).toFixed(2)} tr${Number(w.slice_transition??0).toFixed(2)} div${Number(w.diversity_penalty??0).toFixed(2)} day${Number(w.draw_day??0).toFixed(2)}</div></td>
      <td>${_fableMetricMini(r.train)}</td>
      <td>${_fableMetricMini(r.validation)}</td>
      <td>${_fableMetricMini(r.live)}</td>
      <td style="text-align:right">${_fableEdgeHtml(r.validation?.score)}</td>
      <td style="text-align:right">${_fableEdgeHtml(r.live?.score)}</td>
      <td style="text-align:right">${_fableEdgeHtml(r.validation_live_gap)}</td>
      <td>${stable}</td>
      <td style="text-align:right"><button class="dc-mini-btn" onclick="applyFableHoldoutConfig(${i})">ใช้ config นี้</button></td>
    </tr>`;
  }).join('');
}
async function loadFableHoldoutReport(){
  if(_fableHoldoutRunning)return;
  _fableHoldoutRunning=true;
  const btn=document.getElementById('fable-holdout-btn');
  const root=document.getElementById('fable-holdout-results');
  const n=Math.max(80,_fableSelectNum('fable-grid-n',120));
  const live=Math.max(20,Math.min(50,_fableSelectNum('fable-grid-holdout',30)));
  const maxConfigs=_fableSelectNum('fable-grid-max',6);
  if(btn){btn.disabled=true;btn.textContent='กำลัง Holdout...';}
  if(root)root.innerHTML='<div class="card"><div class="card-title">FABLE Holdout / Live</div><div style="color:var(--text3);font-size:.8rem;padding:8px 0">กำลังแยก train / validation / live...</div></div>';
  try{
    const r=await api(`fable-holdout-report?n_draws=${n}&validation_draws=${live}&live_draws=${live}&max_configs=${maxConfigs}`);
    if(r.error){if(root)root.innerHTML=`<div class="formula-tab-empty" style="display:block">${_formulaEsc(r.error)}</div>`;return;}
    _fableLastHoldout=r;
    _fableLastHoldoutResults=r.results||[];
    const bestVal=r.best_validation||{},bestLive=r.best_live||{},stable=r.best_stable||null;
    if(root)root.innerHTML=`<div class="card" style="border-top:2px solid #4d9de0">
      <div class="card-title">FABLE Holdout / Live · ${r.configs_tested} configs</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span class="fable-pill">train ${r.train_draws} งวด</span>
        <span class="fable-pill">validation ${r.validation_draws} งวด</span>
        <span class="fable-pill">live ${r.live_draws} งวดล่าสุด</span>
        <span class="fable-pill">best validation: ${_formulaEsc(bestVal.name||'-')}</span>
        <span class="fable-pill">best live: ${_formulaEsc(bestLive.name||'-')}</span>
        <span class="fable-pill ${stable?'fable-pass':'fable-fail'}">${stable?'มี stable config':'ยังไม่มี stable config'}</span>
      </div>
      <div class="tbl-wrap"><table class="fable-exp-table">
        <thead><tr><th>Config</th><th>Train edge</th><th>Validation edge</th><th>Live edge</th><th style="text-align:right">Val score</th><th style="text-align:right">Live score</th><th style="text-align:right">Val-Live gap</th><th>State</th><th></th></tr></thead>
        <tbody>${_fableHoldoutRowsHtml(_fableLastHoldoutResults)}</tbody>
      </table></div>
      <div style="font-size:.72rem;color:var(--text3);margin-top:10px">เลือก config จาก validation เท่านั้น แล้วดู live เป็นช่วงตรวจสอบล่าสุดที่ไม่ควรใช้จูนสูตร ถ้า live แย่กว่า validation มากให้ถือว่าเสี่ยง overfit</div>
    </div>`;
  }finally{
    _fableHoldoutRunning=false;
    if(btn){btn.disabled=false;btn.textContent='Holdout / Live';}
  }
}
function applyFableHoldoutConfig(index){
  const row=_fableLastHoldoutResults[index];
  if(!row)return;
  _setFableConfigFromObject(row.config);
  _fableLastBacktest=null;
  _fableLastConfigKey='';
  _fablePassed=null;
  const bt=document.getElementById('fable-bt-results');
  if(bt)bt.innerHTML='';
  document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
  _fableRenderLab({config:_fableLocalConfig()},false);
  loadFable();
}
function fableSnapshots(){
  try{return JSON.parse(localStorage.getItem('lottery_fable_snapshots')||'[]')||[];}catch(e){return [];}
}
function _fableSnapshotSummary(s){
  const bt=s.backtest;
  const hold=s.holdout;
  const grid=s.grid;
  const bits=[];
  if(bt)bits.push(`BT T2 ${bt.tail2_edge??'-'} · T3 ${bt.tail3_edge??'-'}`);
  if(hold)bits.push(`Live best ${hold.best_live||'-'} · stable ${hold.best_stable||'-'}`);
  if(grid)bits.push(`Grid best ${grid.best_train||'-'} / ${grid.best_holdout||'-'}`);
  return bits.join(' | ')||'config snapshot';
}
function renderFableSnapshots(){
  const root=document.getElementById('fable-snapshot-results');
  if(!root)return;
  const list=fableSnapshots();
  if(!list.length){
    root.innerHTML='<div class="card"><div class="card-title">FABLE Snapshots</div><div class="dash-empty">ยังไม่มี Snapshot</div></div>';
    return;
  }
  root.innerHTML=`<div class="card">
    <div class="card-title">FABLE Snapshots</div>
    <div class="fable-snapshot-list">${list.map(s=>`<div class="fable-snapshot-item">
      <div>
        <div class="fable-exp-name">${_formulaEsc(s.label||s.savedAt||'-')}</div>
        <div class="fable-snapshot-meta">${_formulaEsc(_fableSnapshotSummary(s))}</div>
        <div class="fable-snapshot-meta">${_formulaEsc((s.numbers?.tail2||[]).slice(0,10).join(' ')||'-')}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="dc-mini-btn" onclick="loadFableSnapshot('${_formulaEsc(s.id)}')">โหลด</button>
        <button class="dc-mini-btn" onclick="deleteFableSnapshot('${_formulaEsc(s.id)}')">ลบ</button>
      </div>
    </div>`).join('')}</div>
  </div>`;
}
function saveFableSnapshot(){
  const now=new Date();
  const pred=_fableLastPrediction||{};
  const snap={
    id:now.toISOString(),
    label:now.toLocaleString('th-TH'),
    savedAt:now.toISOString(),
    config:_fableLocalConfig(),
    configKey:_fableConfigKey(),
    numbers:{
      six:(pred.six||[]).map(x=>x.number),
      tail3:(pred.tail3||[]).map(x=>x.number),
      tail2:(pred.tail2||[]).map(x=>x.number),
    },
    backtest:_fableLastBacktest?{
      tested:_fableLastBacktest.tested,
      passed:!!_fableLastBacktest.passed,
      tail2_edge:_fableLastBacktest.tail2?.edge,
      tail3_edge:_fableLastBacktest.tail3?.edge,
      six_edge:_fableLastBacktest.six?.edge,
      validation_tail2_edge:_fableLastBacktest.validation?.tail2?.edge,
      validation_tail3_edge:_fableLastBacktest.validation?.tail3?.edge,
      live_tail2_edge:_fableLastBacktest.live?.tail2?.edge,
      live_tail3_edge:_fableLastBacktest.live?.tail3?.edge,
    }:null,
    grid:_fableLastGridReport?{
      n_draws:_fableLastGridReport.n_draws,
      best_train:_fableLastGridReport.best_train?.name,
      best_holdout:_fableLastGridReport.best_holdout?.name,
      best_holdout_score:_fableLastGridReport.best_holdout?.holdout?.score,
    }:null,
    holdout:_fableLastHoldout?{
      n_draws:_fableLastHoldout.n_draws,
      best_validation:_fableLastHoldout.best_validation?.name,
      best_live:_fableLastHoldout.best_live?.name,
      best_stable:_fableLastHoldout.best_stable?.name,
      passed_for_decision_center:!!_fableLastHoldout.passed_for_decision_center,
    }:null,
  };
  const list=fableSnapshots().filter(x=>x.configKey!==snap.configKey||x.label!==snap.label);
  list.unshift(snap);
  localStorage.setItem('lottery_fable_snapshots',JSON.stringify(list.slice(0,30)));
  renderFableSnapshots();
  if(typeof toast==='function')toast('บันทึก FABLE Snapshot แล้ว','success');
}
function loadFableSnapshot(id){
  const snap=fableSnapshots().find(x=>x.id===id);
  if(!snap)return;
  _setFableConfigFromObject(snap.config);
  _fableLastBacktest=null;
  _fablePassed=null;
  document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
  _fableRenderLab({config:_fableLocalConfig()},false);
  loadFable();
}
function deleteFableSnapshot(id){
  if(!confirm('ลบ Snapshot นี้ถาวร? กู้คืนไม่ได้'))return;
  localStorage.setItem('lottery_fable_snapshots',JSON.stringify(fableSnapshots().filter(x=>x.id!==id)));
  renderFableSnapshots();
  if(typeof toast==='function')toast('ลบ FABLE Snapshot แล้ว','success');
}
function _downloadFableFile(name,mime,text){
  const blob=new Blob([text],{type:mime});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
}
function exportFableSnapshots(format='json'){
  const list=fableSnapshots();
  if(!list.length){if(typeof toast==='function')toast('ยังไม่มี FABLE Snapshot ให้ export','error');return;}
  if(format==='csv'){
    const header=['savedAt','window','cross','digit','momentum','lag','near','transition','diversity','drawday','tail2','tail3','bt_tail2_edge','bt_tail3_edge','holdout_best_live','holdout_passed'];
    const rows=list.map(s=>{
      const w=s.config?.weights||{};
      const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
      return [
        s.savedAt,s.config?.window,w.cross_freq,w.digit_position,w.momentum,w.anti_lag_penalty,w.near_miss,w.slice_transition,w.diversity_penalty,w.draw_day,
        (s.numbers?.tail2||[]).join(' '),(s.numbers?.tail3||[]).join(' '),s.backtest?.tail2_edge,s.backtest?.tail3_edge,s.holdout?.best_live,s.holdout?.passed_for_decision_center
      ].map(esc).join(',');
    });
    _downloadFableFile('fable-snapshots.csv','text/csv;charset=utf-8',[header.join(','),...rows].join('\n'));
  }else{
    _downloadFableFile('fable-snapshots.json','application/json;charset=utf-8',JSON.stringify(list,null,2));
  }
}
function applyFableExperimentConfig(index){
  const row=_fableLastGridResults[index];
  if(!row)return;
  _setFableConfigFromObject(row.config);
  _fableLastBacktest=null;
  _fableLastConfigKey='';
  _fablePassed=null;
  const bt=document.getElementById('fable-bt-results');
  if(bt)bt.innerHTML='';
  document.getElementById('fable-status-badge').innerHTML=_fableBadgeHtml();
  _fableRenderLab({config:_fableLocalConfig()},false);
  loadFable();
}
window.loadFable=loadFable;
window.loadFableBacktest=loadFableBacktest;
window.resetFableConfig=resetFableConfig;
window.loadFableExperiments=loadFableExperiments;
window.applyFableExperimentConfig=applyFableExperimentConfig;
window.loadFableHoldoutReport=loadFableHoldoutReport;
window.applyFableHoldoutConfig=applyFableHoldoutConfig;
window.renderFableSnapshots=renderFableSnapshots;
window.saveFableSnapshot=saveFableSnapshot;
window.loadFableSnapshot=loadFableSnapshot;
window.deleteFableSnapshot=deleteFableSnapshot;
window.exportFableSnapshots=exportFableSnapshots;
