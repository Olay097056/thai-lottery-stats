var DecisionDomain = (() => {
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

function dcFormulaBaseP(field,n){
  const k=Math.max(1,Number(n)||1);
  if(field==='back3')return null; // legacy field mixes exact-3 and suffix-2; no comparable baseline
  if(field==='bottom2'||field==='prize1_last2')return k;
  if(['bottom2_unit','front3_unit','back3_unit','prize1_unit'].includes(field))return k*10;
  if(field==='top3')return k/1000*100;
  if(field==='front3'||field==='back3exact')return (1-Math.pow(1-Math.min(k,1000)/1000,2))*100;
  if(field==='back3_suffix2')return (1-Math.pow(1-Math.min(k,100)/100,2))*100;
  if(field==='prize1_last4_digits')return (1-Math.pow(.9,4))*100;
  if((field||'').startsWith('run_'))return (1-Math.pow((10-k)/10,2))*100;
  // Six-digit prize-1 and pool fields must share FORMULA_BT_FIELD_META's definition. Returning 0
  // made "no baseline" read as a 0% chance, so any observed hit became a positive edge and passed
  // the Picks gate (decision-center.js edge>0).
  if(field==='prize1_exact')return k/1e6*100;
  if(field==='pool6')return (1-Math.pow(1-168/1e6,k))*100;
  if(field==='pool6_14')return (1-Math.pow(1-66/1e6,k))*100;
  if(field==='pool_tail3'){const p1=1-Math.pow(0.999,168);return (1-Math.pow(1-p1,k))*100;}
  return null; // no comparable baseline: absence is not a 0% chance
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
    const frs=_formulaBacktestRowsForTargets(_computeFormulasBatch(prev,iso,rows.slice(i+2,i+202))||[]);
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
    const edge=Number.isFinite(baseP)?pct-baseP:null;
    const weight=edge==null?1:Math.max(.25,Math.min(1.8,1+edge/35));
    return {...s,pct,baseP,edge,weight};
  }).sort((a,b)=>b.edge-a.edge);
}


return Object.freeze({dcAddSource,dcBuildPredictFormulaMatches,dcSourceChips,dcFormulaMatchHtml,dcComputeFormulaResults,dcFormulaHit,dcFormulaBaseP,dcFormulaBacktestRows});
})();
Object.assign(window,DecisionDomain);
