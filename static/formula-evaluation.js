// ─── Mix. "ไม่รู้ซื้อเหี้ยไรดี" — derived meta-formula ────────────────────────────
// ผสมเลข 6 หลักจากการโหวตรายหลักของผลลัพธ์ทุกกลุ่มสูตร A–J (ไม่รวมหน้าทำนาย/Predict)
// กติกา (ตกลงใน CONTEXT.md):
// - หนึ่งกลุ่ม = หนึ่งเสียงต่อหลัก (normalize มวลโหวตของแต่ละกลุ่มให้รวมเป็น 1 ต่อหลัก
//   ไม่ว่ากลุ่มนั้นผลิตกี่ตัวเลข) — ไม่ถ่วงน้ำหนักตาม Edge
// - หลัก 1–3 (index 0–2): ฟังเฉพาะ field 'front3' (กลุ่ม D, F) — เสียงเลขเต็ม 6 หลักของ
//   I/J2 ถูกกันออกจากครึ่งหน้า เพื่อไม่ให้ครึ่งหน้ากลายเป็น copy ของกลุ่ม I; ถ้างวดไหน
//   front3 ว่างทั้งหมด จึงค่อย fallback ไปใช้เสียง I/J2 (หน้านี้ต้องมีคำตอบเสมอ)
// - หลัก 4–6 (index 3–5): ฟังทุก field type ที่ map ลงท้ายเลขได้ + เลขเต็มของ I/J2
// - ผลลัพธ์ 10 ชุดผ่าน _imperialRoundRobin (K=8) เหมือนกลุ่ม I เพื่อเทียบ backtest แฟร์
// จงใจ "ไม่" อยู่ใน _computeFormulasBatch: Mix เป็นอนุพันธ์ของทุกกลุ่ม ถ้าไหลเข้า
// Picks/เลขแนะนำ จะ double-count สูตรแม่ของตัวเอง — ผู้บริโภคที่ต้องการ (backtest,
// หน้า ไม่รู้ซื้ออะไรดี) ต้องเรียก _computeMixRow/_mixCompute เพิ่มเองเท่านั้น
const MIX_FORMULA_NAME='ไม่รู้ซื้อเหี้ยไรดี · เลขเต็ม6หลัก';

function _mixGroupKey(name){
  const m=String(name||'').match(/^([A-Z])\d/);
  if(m)return m[1]==='X'?'F':m[1]; // X* = กลุ่ม F (Codex/Pattern Link)
  return 'E'; // แถวชื่อไทยล้วนมาจาก _beliefData (สายมู) เท่านั้น
}

function _mixCompute(formulaResults){
  // votes[pos] = Map(groupKey -> Map(digit -> rawCount)) · fallback = เสียง pool6 สำหรับหลัก 0-2
  const votes=Array.from({length:6},()=>new Map());
  const fallback=Array.from({length:3},()=>new Map());
  const addTo=(store,g,d)=>{
    if(!/^\d$/.test(d))return;
    if(!store.has(g))store.set(g,new Map());
    const m=store.get(g);
    m.set(d,(m.get(d)||0)+1);
  };
  const addVote=(g,pos,d)=>{if(pos>=0&&pos<6)addTo(votes[pos],g,d);};
  for(const fr of (formulaResults||[])){
    if(!fr||fr.mix)continue;
    const g=_mixGroupKey(fr.name);
    const preds=(fr.preds||[]).map(String);
    if(!preds.length)continue;
    switch(fr.field){
      case 'front3':
        preds.forEach(p=>{if(/^\d{3}$/.test(p))for(let i=0;i<3;i++)addVote(g,i,p[i]);});
        break;
      case 'pool6': // I/J2: หลักท้ายโหวตตรง, หลักหน้าเก็บไว้เป็น fallback เท่านั้น
        preds.forEach(p=>{if(/^\d{6}$/.test(p)){for(let i=3;i<6;i++)addVote(g,i,p[i]);for(let i=0;i<3;i++)addTo(fallback[i],g,p[i]);}});
        break;
      case 'top3':
      case 'back3exact':
        preds.forEach(p=>{if(/^\d{3}$/.test(p))for(let i=0;i<3;i++)addVote(g,3+i,p[i]);});
        break;
      case 'back3': // legacy mixed-width rows only; new formulas use back3exact/back3_suffix2
        preds.forEach(p=>{if(/^\d{2,3}$/.test(p))for(let i=0;i<p.length;i++)addVote(g,6-p.length+i,p[i]);});
        break;
      case 'back3_suffix2':
      case 'bottom2':
      case 'prize1_last2':
        preds.forEach(p=>{if(/^\d{2}$/.test(p)){addVote(g,4,p[0]);addVote(g,5,p[1]);}});
        break;
      case 'bottom2_unit':
      case 'prize1_unit':
        preds.forEach(p=>addVote(g,5,p));
        break;
      case 'prize1_last4_digits': // preds[i] ผูกตำแหน่ง 2+i ของ prize1 — ตัด pos 2 ทิ้ง (ครึ่งหน้าเป็นของ front3)
        preds.forEach((p,i)=>{if(2+i>=3)addVote(g,2+i,p);});
        break;
      default: break; // field อื่น (run_* ฯลฯ) ไม่เข้าโหวต
    }
  }
  let fallbackUsed=false;
  for(let pos=0;pos<3;pos++){
    if(votes[pos].size===0&&fallback[pos].size>0){votes[pos]=fallback[pos];fallbackUsed=true;}
  }
  // normalize รายกลุ่มต่อหลัก แล้วจัดอันดับ 0-9 ต่อหลัก
  const positions=votes.map(groupMaps=>{
    const score=new Array(10).fill(0);
    const votersByDigit=Array.from({length:10},()=>new Set());
    for(const [g,m] of groupMaps){
      let total=0;for(const c of m.values())total+=c;
      if(!total)continue;
      for(const [d,c] of m){score[Number(d)]+=c/total;votersByDigit[Number(d)].add(g);}
    }
    const ranked=score.map((s,d)=>({digit:String(d),score:s,groups:[...votersByDigit[d]].sort()}))
      .sort((a,b)=>b.score-a.score||Number(a.digit)-Number(b.digit));
    return {ranked,groupCount:groupMaps.size};
  });
  if(positions.some(p=>p.groupCount===0))return null; // มีหลักที่ไม่มีใครโหวตเลย → ผสมไม่ได้
  const preds=_imperialRoundRobin(positions.map(p=>p.ranked.map(e=>e.digit)),10,8);
  return {preds,positions,fallbackUsed};
}

// แถวสำหรับตาราง Backtest — field pool6 เหมือน I1/I2/J2 (baseline ต่อ candidate เท่ากัน)
function _computeMixRow(formulaResults){
  try{
    const mix=_mixCompute(formulaResults);
    if(!mix||!mix.preds.length)return null;
    return {name:MIX_FORMULA_NAME,preds:mix.preds,field:'pool6',baseline:mix.preds.length,mix:true};
  }catch(e){return null;}
}

// ─── Formula Backtest ──────────────────────────────────────────────────────────
// คำนวณสูตรแต่ละตัวในโหมด batch (ไม่ยุ่งกับ DOM) และ return {predictions[], compareField}
function _computeFormulasBatch(prev, nextDateStr, historyCtx=[], extraRows=[]){
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
    // ค่า coefficient presets สำหรับเทียบ edge ใน backtest เท่านั้น (ทำนายจริงใช้ baseline เสมอ)
    for(const preset of CODEX_COEFF_PRESETS){
      if(preset.key==='baseline')continue; // ซ้ำกับ X1 Codex Sharp
      const presetPool=_codexPool(codexRows,'bottom2',2,nextDateStr,10,preset.coeffs);
      results.push({name:`${preset.label} · ท้ายคม`,preds:presetPool,field:'bottom2',baseline:presetPool.length});
    }
  }catch(e){}

  // ══ I. จักรพรรดิ — digit-position frequency across near1+prize2-5 pool ══
  // ข้าม push ผลลัพธ์ทั้งหมดถ้า preds ว่าง (งวดก่อนหน้าไม่มีข้อมูล Sanook) แทนที่จะ push
  // ชุดว่างเข้า backtest — งวดที่ไม่มีข้อมูลไม่ควรถูกนับเข้า total เพราะทายไม่ได้ตั้งแต่แรก
  // (ไม่ใช่ "ทายแล้วพลาด") ไม่งั้น total จะถูกเจือจางด้วยงวดที่ไม่มีทางถูกได้เลย
  try{
    const _I=_imperialFormula(prev,10);
    if(_I.length)results.push({name:'I1 จักรพรรดิ · เลขเต็ม6หลัก',preds:_I,field:'pool6',baseline:_I.length});
  }catch(e){}

  // ══ J. เจ้าสัว — bottom2 leg (ISSUE-13): search finalist, failed holdout gate, ships ทดลอง ══
  try{
    const _J1=_tycoonBottom2Formula(prev,nextDay,nextMonth,nextYear2);
    if(_J1.length)results.push({name:'J1 เจ้าสัว · ท้าย2',preds:_J1,field:'bottom2',baseline:_J1.length,trust:'ทดลอง'});
  }catch(e){}

  // ══ HM. Hermes Pool 1-4 — value-weighted digit freq เป้า pool รางวัล 1-4 (PRD-hermes-pool-1-4.md) ══
  // ทดลองถาวร per ADR-0003 (66/1e6 × 458 งวด ≈ 0.30 expected chance hits — no gate possible);
  // group:'HM' explicit เพื่อไม่ให้ 'H' ปน experimentalGroups ของ dcRecommendedNumbers (มิสเตอร์ซี)
  try{
    const _HM=_hermesPool14Formula(prev,10);
    if(_HM.length)results.push({name:'HM · Hermes Pool 1-4',group:'HM',preds:_HM,field:'pool6_14',baseline:_HM.length,trust:'ทดลอง'});
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

  // Only live call sites pass extraRows (the RLL forecast). The rolling backtest loops never do,
  // so a stored forecast can never be replayed into a historical draw.
  for(const row of (extraRows||[]))results.push(row);

  return results;
}

// Normalize the legacy mixed-width `back3` output for evaluation only. Live formula
// results, Decision Center recommendations, and Mix continue to receive their original rows.
function _formulaBacktestRowsForTargets(formulaResults=[]){
  return (formulaResults||[]).flatMap(fr=>{
    if(fr?.field!=='back3')return [fr];
    const byWidth=new Map();
    for(const pred of fr.preds||[]){
      const value=String(pred);
      if(!/^\d{2,3}$/.test(value))continue;
      if(!byWidth.has(value.length))byWidth.set(value.length,[]);
      byWidth.get(value.length).push(value);
    }
    const widths=[...byWidth.keys()].sort((a,b)=>b-a);
    return widths.map(width=>{
      const exact3=width===3;
      return {
        ...fr,
        name:widths.length>1?`${fr.name} · ${exact3?'ท้าย 3 ตรง':'2 หลักท้าย 3 ทางการ'}`:fr.name,
        field:exact3?'back3exact':'back3_suffix2',
        preds:byWidth.get(width),
        baseline:byWidth.get(width).length,
      };
    });
  });
}

const FormulaBtProgress=(()=>{
  const steps=[
    {key:'history',label:'ข้อมูลย้อนหลัง'},
    {key:'fano-v4',label:'ระนาบฟาโน v4'},
    {key:'fano-v5',label:'ระนาบฟาโน v5'},
    {key:'assemble',label:'สรุปผล'},
  ];
  const labels={pending:'รอ',active:'กำลังทำ',complete:'เสร็จ',failed:'ไม่สำเร็จ',skipped:'ข้าม'};
  let startedAt=0,elapsedTimer=null,activeStage='';
  const formatElapsed=ms=>{
    const total=Math.max(0,Math.floor(ms/1000));
    return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
  };
  function setStepState(key,state){
    const step=document.getElementById(`formula-bt-step-${key}`);
    const label=document.getElementById(`formula-bt-step-${key}-state`);
    if(step){
      if(step.dataset)step.dataset.state=state;
      if(typeof step.setAttribute==='function')step.setAttribute('data-state',state);
      if(state==='active'&&typeof step.setAttribute==='function')step.setAttribute('aria-current','step');
      else if(typeof step.removeAttribute==='function')step.removeAttribute('aria-current');
    }
    if(label)label.textContent=labels[state]||labels.pending;
  }
  function begin(){
    startedAt=Date.now();activeStage='';
    const panel=document.getElementById('formula-bt-loading');
    if(panel){panel.style.display='block';if(typeof panel.setAttribute==='function')panel.setAttribute('aria-busy','true');}
    const retry=document.getElementById('formula-bt-retry');
    if(retry)retry.style.display='none';
    steps.forEach(step=>setStepState(step.key,'pending'));
    const elapsed=document.getElementById('formula-bt-elapsed');
    if(elapsed)elapsed.textContent='0:00';
    if(elapsedTimer&&typeof window!=='undefined'&&typeof window.clearInterval==='function')window.clearInterval(elapsedTimer);
    if(typeof window!=='undefined'&&typeof window.setInterval==='function'){
      elapsedTimer=window.setInterval(()=>{
        const target=document.getElementById('formula-bt-elapsed');
        if(target)target.textContent=formatElapsed(Date.now()-startedAt);
      },1000);
    }
  }
  function setStage(key,detail=''){
    const index=steps.findIndex(step=>step.key===key);
    if(index<0)return;
    if(activeStage&&activeStage!==key){
      const previous=document.getElementById(`formula-bt-step-${activeStage}`);
      if(previous?.dataset?.state==='active')setStepState(activeStage,'complete');
    }
    for(let i=0;i<index;i++){
      const earlier=steps[i];
      const node=document.getElementById(`formula-bt-step-${earlier.key}`);
      if(node?.dataset?.state==='pending'||node?.dataset?.state==='active')setStepState(earlier.key,'complete');
    }
    activeStage=key;
    setStepState(key,'active');
    const title=`ขั้น ${index+1}/${steps.length} · ${steps[index].label}`;
    if(typeof window!=='undefined'&&typeof window.setPageStatus==='function')window.setPageStatus('formula-bt-status',title);
    const detailEl=document.getElementById('formula-bt-progress-detail');
    if(detailEl)detailEl.textContent=detail;
  }
  function finish(kind,message,detail='',retryable=false){
    const panel=document.getElementById('formula-bt-loading');
    if(panel&&typeof panel.setAttribute==='function')panel.setAttribute('aria-busy','false');
    const status=document.getElementById('formula-bt-status');
    if(status)status.textContent=message;
    const detailEl=document.getElementById('formula-bt-progress-detail');
    if(detailEl)detailEl.textContent=detail;
    const elapsed=document.getElementById('formula-bt-elapsed');
    if(elapsed)elapsed.textContent=formatElapsed(Date.now()-startedAt);
    const retry=document.getElementById('formula-bt-retry');
    if(retry)retry.style.display=retryable?'inline-flex':'none';
    if(kind==='success'||kind==='partial'){
      steps.forEach(step=>{
        const node=document.getElementById(`formula-bt-step-${step.key}`);
        if(node?.dataset?.state==='pending'||node?.dataset?.state==='active')setStepState(step.key,'complete');
      });
    }else if(kind==='empty'||kind==='error'){
      steps.forEach(step=>{
        const node=document.getElementById(`formula-bt-step-${step.key}`);
        if(node?.dataset?.state==='pending'||node?.dataset?.state==='active')setStepState(step.key,'skipped');
      });
    }
    activeStage='';
    if(elapsedTimer&&typeof window!=='undefined'&&typeof window.clearInterval==='function')window.clearInterval(elapsedTimer);
    elapsedTimer=null;
  }
  return Object.freeze({begin,setStage,setStepState,finish,formatElapsed,elapsed:()=>Date.now()-startedAt,activeStage:()=>activeStage});
})();

function _formulaBtFormatElapsed(ms){return FormulaBtProgress.formatElapsed(ms);}
function _formulaBtSetStepState(key,state){FormulaBtProgress.setStepState(key,state);}
function _formulaBtBegin(){FormulaBtProgress.begin();}
function _formulaBtSetStage(key,detail=''){FormulaBtProgress.setStage(key,detail);}

function _formulaBtForecastPayloadIsComplete(payload,targets,validForecasts){
  if(payload?.ok!==true||!Array.isArray(payload.forecasts)||!Array.isArray(payload.skipped_targets))return false;
  if(validForecasts.length!==payload.forecasts.length)return false;
  const requested=new Set(targets);
  const forecastDates=new Set(validForecasts.map(f=>f.target_date));
  const skippedDates=new Set(payload.skipped_targets);
  if(forecastDates.size!==validForecasts.length||skippedDates.size!==payload.skipped_targets.length)return false;
  if([...forecastDates,...skippedDates].some(date=>typeof date!=='string'||!requested.has(date)))return false;
  if([...forecastDates].some(date=>skippedDates.has(date)))return false;
  return forecastDates.size+skippedDates.size===requested.size;
}

function _formulaBtFinish(kind,message,detail='',retryable=false){FormulaBtProgress.finish(kind,message,detail,retryable);}

async function runFormulaBacktest(){
  if(LotteryUiState.formula.running)return;
  LotteryUiState.formula.running=true;
  const _btBtn=document.querySelector('#formula-results-BT button.btn-primary');
  if(_btBtn){_btBtn.disabled=true;_btBtn.textContent='กำลังรัน...';}
  const n=parseInt(document.getElementById('bt-formula-n').value)||50;
  const targetTest=Math.max(n,...FORMULA_BT_WINDOWS);
  _formulaBtBegin();
  _formulaBtSetStage('history','กำลังอ่านผลย้อนหลังเพื่อกำหนดชุดงวดทดสอบ');
  document.getElementById('formula-bt-table').innerHTML='';
  LotteryServerData.formula.backtestNotice='';
  LotteryServerData.formula.backtestPartial=false;
  LotteryServerData.formula.backtestRetryable=false;
  switchFormulaTab('BT');
  try{

  const h=await api(`prize-history?n=${Math.min(600,targetTest+201)}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
  const rows=Array.isArray(h?.data)?h.data:[];
  LotteryServerData.formula.backtestFieldCheck=_formulaFieldMappingCheck(rows);
  if(h?.error||h?.detail||!Array.isArray(h?.data)){
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" role="alert" style="display:block">อ่านข้อมูลย้อนหลังไม่สำเร็จ · ตรวจการเชื่อมต่อแล้วลองอีกครั้ง</div>';
    _formulaBtSetStepState('history','failed');
    _formulaBtFinish('error','อ่านข้อมูลย้อนหลังไม่สำเร็จ','ระบบยังไม่ได้สร้างผล Backtest จากข้อมูลไม่ครบ',h?.retryable!==false);
    return;
  }
  if(rows.length<2){
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" role="status" style="display:block">ยังไม่มีข้อมูลย้อนหลังเพียงพอสำหรับ Backtest</div>';
    _formulaBtSetStepState('history','complete');
    _formulaBtFinish('empty','ข้อมูลย้อนหลังไม่พอสำหรับ Backtest','ต้องมีผลรางวัลอย่างน้อย 2 งวด');
    return;
  }

  // rows เรียงใหม่สุดก่อน → rows[i] = current, rows[i+1] = prev
  const stats={};
  let tested=0;
  let selectedTested=0;

  // Build the forecast target list once; each method's candidates come only
  // from draws strictly before its target.
  const forecastTargetDates=[];
  for(let i=0;i<rows.length-1&&forecastTargetDates.length<targetTest;i++){
    if(!_formulaActualDigits(rows[i],'prize1',6,true)||!_formulaActualDigits(rows[i+1],'prize1',6,true))continue;
    const rawDate=String(rows[i]?.date||'');
    const[d,m,y]=rawDate.split('/').map(Number);
    if(d&&m&&y)forecastTargetDates.push(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }
  const forecastTargets=[...new Set(forecastTargetDates)];
  const forecastScopeDetail=`คำทำนาย ${forecastTargets.length} งวด · รวมช่วง Rolling edge สูงสุด ${Math.max(...FORMULA_BT_WINDOWS)} งวด · ตัวเลือกหลัก ${n} งวด`;
  const failedStages=[];
  let anyStageRetryable=false;
  let fanoForecastsByDate=new Map();
  let fanoNotice='';
  let fanoV5ForecastsByDate=new Map();
  let fanoV5Notice='';
  if(forecastTargets.length){
    _formulaBtSetStage('fano-v4',forecastScopeDetail);
    const fanoResponse=await api(`fano/backtest?targets=${encodeURIComponent(forecastTargets.join(','))}`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    const validFanoForecasts=(Array.isArray(fanoResponse?.forecasts)?fanoResponse.forecasts:[]).filter(f=>
      typeof f?.target_date==='string'&&Array.isArray(f.numbers)&&f.numbers.length===5&&
      f.numbers.every(n=>/^\d{6}$/.test(String(n)))&&new Set(f.numbers.map(String)).size===5
    );
    if(_formulaBtForecastPayloadIsComplete(fanoResponse,forecastTargets,validFanoForecasts)){
      fanoForecastsByDate=new Map(validFanoForecasts.map(f=>[f.target_date,f]));
      const selectedTargets=forecastTargets.slice(0,n);
      const selectedAvailable=selectedTargets.filter(date=>fanoForecastsByDate.has(date)).length;
      const selectedMissing=selectedTargets.length-selectedAvailable;
      const expectedHits=selectedAvailable*5/1e6;
      fanoNotice=`ระนาบฟาโน v4 · Variable Neighborhood Cover: รางวัลที่ 1 ตรง 6 หลัก · ปรับพอร์ต 5 เลขจากประวัติก่อนวันเป้าหมาย · ${selectedAvailable} งวด${selectedMissing?` · ข้าม ${selectedMissing} งวดที่ประวัติน้อยกว่า 20 งวด`:''}`;
      _formulaBtSetStepState('fano-v4','complete');
    }else{
      fanoNotice='ระนาบฟาโน v4: โหลดคำทำนายสำหรับ Backtest ไม่สำเร็จ จึงไม่รวมแถวนี้ในการคำนวณรอบนี้';
      failedStages.push('ระนาบฟาโน v4');
      anyStageRetryable=anyStageRetryable||fanoResponse?.retryable!==false;
      _formulaBtSetStepState('fano-v4','failed');
    }
  }else{
    fanoNotice='ระนาบฟาโน v4: ไม่มีวันเป้าหมายที่มีข้อมูลรางวัลที่ 1 ครบสำหรับ Backtest';
    _formulaBtSetStepState('fano-v4','skipped');
  }
  if(forecastTargets.length){
    _formulaBtSetStage('fano-v5',forecastScopeDetail);
    const fanoV5Response=await api(`fano/backtest?targets=${encodeURIComponent(forecastTargets.join(','))}&version=fano-v5-adaptive-rank-codebook`,{suppressNetworkToast:true,suppressSpinnerAnnouncement:true});
    const validV5Forecasts=(Array.isArray(fanoV5Response?.forecasts)?fanoV5Response.forecasts:[]).filter(f=>
      typeof f?.target_date==='string'&&Array.isArray(f.numbers)&&f.numbers.length===5&&
      f.numbers.every(n=>/^\d{6}$/.test(String(n)))&&new Set(f.numbers.map(String)).size===5
    );
    if(_formulaBtForecastPayloadIsComplete(fanoV5Response,forecastTargets,validV5Forecasts)){
      fanoV5ForecastsByDate=new Map(validV5Forecasts.map(f=>[f.target_date,f]));
      const selectedTargets=forecastTargets.slice(0,n);
      const selectedAvailable=selectedTargets.filter(date=>fanoV5ForecastsByDate.has(date)).length;
      const selectedMissing=selectedTargets.length-selectedAvailable;
      fanoV5Notice=`ระนาบฟาโน v5 · Adaptive Rank Codebook: สำรวจย้อนหลัง ${selectedAvailable} งวด · config ถูกเลือกแบบ post-hoc จากการค้นหา 1,000,000 แบบบนชุด 759 งวดเดียวกัน จึงไม่ใช่ค่าประเมินอิสระ${selectedMissing?` · ข้าม ${selectedMissing} งวดที่มีประวัติน้อยกว่า 20 งวด`:''}`;
      _formulaBtSetStepState('fano-v5','complete');
    }else{
      fanoV5Notice='ระนาบฟาโน v5: โหลดคำทำนายสำหรับ Backtest ไม่สำเร็จ จึงไม่รวมแถวนี้ในการคำนวณรอบนี้';
      failedStages.push('ระนาบฟาโน v5');
      anyStageRetryable=anyStageRetryable||fanoV5Response?.retryable!==false;
      _formulaBtSetStepState('fano-v5','failed');
    }
  }else{
    fanoV5Notice='ระนาบฟาโน v5: ไม่มีวันเป้าหมายที่มีข้อมูลรางวัลที่ 1 ครบสำหรับ Backtest';
    _formulaBtSetStepState('fano-v5','skipped');
  }
  LotteryServerData.formula.backtestNotice=[fanoNotice,fanoV5Notice].filter(Boolean).join(' · ');
  LotteryServerData.formula.backtestPartial=failedStages.length>0;
  LotteryServerData.formula.backtestRetryable=anyStageRetryable;

  _formulaBtSetStage('assemble','กำลังสรุปสูตรและจัดตารางผล');
  for(let i=0;i<rows.length-1&&tested<targetTest;i++){
    const curr=rows[i];
    const prev=rows[i+1];
    if(!_formulaActualDigits(prev,'prize1',6,true)||!_formulaActualDigits(curr,'prize1',6,true))continue;
    tested++;
    // สร้าง ISO date ของงวดปัจจุบัน
    let isoDate='';
    if(curr.date){const[d,m,y]=curr.date.split('/').map(Number);isoDate=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}

    const historyCtx=rows.slice(i+2,i+202); // งวดก่อนหน้า prev สำหรับ rolling scorer (ไม่รวม curr)
    // Secondary-hit sample is complete only with near1 + all prize2/prize3 values.
    const near1=_formulaDrawValues(curr,['near1_1','near1_2']);
    const prize2=_formulaDrawValues(curr,['prize2_1','prize2_2','prize2_3','prize2_4','prize2_5']);
    const prize3=_formulaDrawValues(curr,['prize3_1','prize3_2','prize3_3','prize3_4','prize3_5','prize3_6','prize3_7','prize3_8','prize3_9','prize3_10']);
    const hasSecondary=!!(near1&&prize2&&prize3);
    const secondary6=hasSecondary?[...near1,...prize2,...prize3]:[];
    const prize4=_formulaPrizeValues(curr,'prize4',50);
    const prize5=_formulaPrizeValues(curr,'prize5',100);
    const secTail3=new Set(secondary6.map(v=>v.slice(-3)));
    const secTail2=new Set(secondary6.map(v=>v.slice(-2)));
    // pool รวมสำหรับสูตรที่อ้างอิงรางวัล 1-5 ทั้งหมด: prize1 + ทุกรางวัลรอง
    const pool6Complete=!!(hasSecondary&&prize4&&prize5);
    const pool6Set=pool6Complete?new Set([curr.prize1,...secondary6,...prize4,...prize5]):null;
    const poolTail3Set=pool6Set?new Set([...pool6Set].map(v=>v.slice(-3))):null;
    // pool 1-4 (HM · Hermes Pool 1-4, PRD-hermes-pool-1-4.md): prize1 + prize2×5 + prize3×10 +
    // prize4×50 = 66 เลข — ไม่รวม near1/prize5 (board แยกตามกติกาคงที่ข้อ 1)
    const pool14Complete=!!(prize2&&prize3&&prize4);
    const pool14Set=pool14Complete?new Set([curr.prize1,...prize2,...prize3,...prize4]):null;
    const formulaResults=_computeFormulasBatch(prev,isoDate,historyCtx);
    const backtestResults=_formulaBacktestRowsForTargets(formulaResults);
    // Mix เข้าตาราง backtest เฉพาะงวดที่มี pool6 producer (I/J มีข้อมูล Sanook) — เงื่อนไข
    // เดียวกับที่ I1/I2/J2 ข้ามงวดไร้ pool เพื่อให้ baseline pool6 เทียบกันแฟร์
    if(formulaResults.some(fr=>fr.field==='pool6')){
      const mixRow=_computeMixRow(formulaResults);
      if(mixRow)backtestResults.push(mixRow);
    }
    const fanoForecast=fanoForecastsByDate.get(isoDate);
    if(fanoForecast){
      backtestResults.push({
        name:'ระนาบฟาโน v4 · Variable Neighborhood Cover',group:'FANO',preds:fanoForecast.numbers,
        field:'prize1_exact',baseline:5,trust:'ทดลอง',
      });
    }
    const fanoV5Forecast=fanoV5ForecastsByDate.get(isoDate);
    if(fanoV5Forecast){
      backtestResults.push({
        name:'ระนาบฟาโน v5 · Adaptive Rank Codebook · post-hoc',group:'FANO',preds:fanoV5Forecast.numbers,
        field:'prize1_exact',baseline:5,trust:'ทดลอง',
      });
    }
    for(const fr of backtestResults){
      if(!stats[fr.name]){
        stats[fr.name]={hits:0,total:0,preds_n:fr.baseline,field:fr.field,trust:fr.trust||null,mix:fr.mix||false,group:fr.group||null,subHits:0,subTotal:0,slots:fr.slots||2,pool14:{hits:0,total:0},windows:{}};
        FORMULA_BT_WINDOWS.forEach(w=>{stats[fr.name].windows[w]={hits:0,total:0};});
      }
      const s=stats[fr.name];
      const hit=_formulaHitForField(fr,curr,{pool6Set,poolTail3Set,pool14Set});
      const primaryPrizeOnly=fr.field==='prize1_exact';
      const subHit=hasSecondary&&!primaryPrizeOnly?_formulaSecondaryHit(fr,secondary6,secTail2,secTail3):false;
      if(tested<=n){
        if(hit!==null){
          s.total++;
          if(hit)s.hits++;
        }
        if(fr.slots)s.slots=fr.slots;
        if(hasSecondary&&!primaryPrizeOnly&&Array.isArray(fr.preds)&&fr.preds.length){
          s.subTotal++;
          if(subHit)s.subHits++;
        }
        // Board Pool 1-4 (เปรียบเทียบทุก pool6 producer ด้วยเกณฑ์เดียวกัน — กติกาคงที่ข้อ 1);
        // guard length===6 — preds 3 หลัก (HM2/HM3/C3) เทียบกับ hit-set 66 เลขเต็ม 6 หลักไม่ได้
        // (จะโชว์ 0/457 หลอกตา) → ข้าม
        const pool14Preds=Array.isArray(fr.preds)?fr.preds.map(String).filter(p=>/^[0-9]{6}$/.test(p)):[];
        if((fr.field==='pool6'||fr.field==='pool6_14')&&pool14Set?.size&&pool14Preds.length){
          s.pool14.total++;
          if(pool14Preds.some(p=>pool14Set.has(p)))s.pool14.hits++;
        }
      }
      FORMULA_BT_WINDOWS.forEach(w=>{
        if(tested>w||hit===null)return;
        const ws=s.windows[w]||(s.windows[w]={hits:0,total:0});
        ws.total++;
        if(hit)ws.hits++;
      });
    }
  }

  // build row data (fair baseline per field type)
  selectedTested=Math.min(tested,n);
  LotteryServerData.formula.testedDraws=selectedTested;
  LotteryServerData.formula.backtestRows=Object.entries(stats).map(([name,s])=>{
    const hasSample=s.total>0;
    const pct=hasSample?s.hits/s.total*100:null;
    const baseline=_formulaBaselineForField(s.field,s.preds_n,s.slots||2);
    const baseP=hasSample&&Number.isFinite(baseline.baseP)?baseline.baseP:null;
    const rollingBaselineP=Number.isFinite(baseline.baseP)?baseline.baseP:null;
    const baseLabel=hasSample?baseline.baseLabel:'—';
    const {typeLabel,board}=baseline;
    const edge=baseP==null?null:pct-baseP;
    const p=hasSample?s.hits/s.total:null;
    const se=hasSample?Math.sqrt(Math.max(p*(1-p),0)/s.total)*100:null;
    let ciLow=se==null?null:Math.max(0,pct-1.96*se);
    let ciHigh=se==null?null:Math.min(100,pct+1.96*se);
    if(s.field==='prize1_exact'&&hasSample){
      // Wilson score interval stays informative when a 1-in-200,000 event has
      // zero observed hits; the Wald interval would incorrectly collapse to 0.
      const z=1.96,z2=z*z,denom=1+z2/s.total;
      const center=(p+z2/(2*s.total))/denom;
      const half=z*Math.sqrt((p*(1-p)/s.total)+(z2/(4*s.total*s.total)))/denom;
      ciLow=Math.max(0,(center-half)*100);
      ciHigh=Math.min(100,(center+half)*100);
    }
    const rolling={};
    FORMULA_BT_WINDOWS.forEach(w=>{
      const ws=s.windows?.[w]||{hits:0,total:0};
      const wpct=ws.total?ws.hits/ws.total*100:null;
      rolling[w]={hits:ws.hits,total:ws.total,pct:wpct,edge:wpct==null||rollingBaselineP==null?null:wpct-rollingBaselineP};
    });
    const _GRP={'A':['A · กูชอบ','var(--gold)'],'B':['B · ลอตโตพลัส','#4d9de0'],'C':['C · พิชิตโชค','#a855f7'],'D':['D · Claude','#22d3ee'],'X':['F · Codex','#a3e635'],'G':['G · แม่นขั้นเทพ','#f05454'],'H':['H · มิสเตอร์ซี','#f59e0b'],'E':['E · สายมู','#ec4899'],'I':['I · จักรพรรดิ','#c084fc'],'J':['J · เจ้าสัว','#10b981'],'HM':['HM · Hermes Pool 1-4','#2dd4bf'],'FANO':['ระนาบฟาโน · รางวัลที่ 1','#67e8f9'],'RLL':['RLL · Reinforcement Learn LLM','#f472b6']};
    const gKey=s.group||name[0];
    const [group,groupColor]=s.mix?['MIX · รวมทุกสูตร','#f2ca73']:(_GRP[gKey]||[gKey,'var(--text3)']);
    const subPct=s.subTotal>0?s.subHits/s.subTotal*100:null;
    const edge50=rolling[50]?.edge??null,edge100=rolling[100]?.edge??null,edge200=rolling[200]?.edge??null;
    const degraded=rolling[200]?.total>=180&&edge200!=null&&edge200<-5;
    return {name,group,groupColor,field:s.field,typeLabel,board,total:s.total,hits:s.hits,pct,baseP,baseLabel,edge,ciLow,ciHigh,subHits:s.subHits||0,subTotal:s.subTotal||0,subPct,rolling,edge50,edge100,edge200,degraded,trust:s.trust||null,preds_n:s.preds_n,pool14Hits:s.pool14?.hits||0,pool14Total:s.pool14?.total||0};
  });
  // RLL has no historical row by construction: one live call per draw, so its evidence is
  // prospective only. It ships as a shaped row with no sample ("—"), never a fabricated history.
  const RLL_SHIP_DATE='2026-11-16';
  const rllDraws=(rows||[]).filter(r=>{
    const [d,m,y]=String(r.date||'').split('/').map(Number);
    if(!d||!m||!y)return false;
    const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return iso>RLL_SHIP_DATE&&/^[0-9]{6}$/.test(String(r.prize1||''));
  }).length;
  if(selectedTested>0)LotteryServerData.formula.backtestRows.push({
    name:'RLL · Reinforcement Learn LLM',group:'RLL · Reinforcement Learn LLM',groupColor:'#f472b6',
    field:'prize1_exact',typeLabel:'รางวัลที่ 1 ตรง 6 หลัก',board:'รางวัลที่ 1 · ตรง 6 หลัก',
    total:0,hits:0,pct:null,baseP:null,baseLabel:'—',edge:null,ciLow:null,ciHigh:null,
    subHits:0,subTotal:0,subPct:null,rolling:{},edge50:null,edge100:null,edge200:null,degraded:false,
    trust:'ทดลอง',preds_n:5,pool14Hits:0,pool14Total:0,
    prospective:{since:RLL_SHIP_DATE,draws:rllDraws,expectedHits:rllDraws*5/1e6}});
  LotteryUiState.formula.sortKey='edge';LotteryUiState.formula.sortAsc=false;
  _renderBtTable();
  const partial=failedStages.length>0;
  _formulaBtFinish(partial?'partial':'success',partial?`ได้ผลบางส่วน · ${selectedTested} งวด`:`Backtest เสร็จแล้ว · ${selectedTested} งวด`,partial?`โหลดไม่สำเร็จ: ${failedStages.join(', ')} · ตารางที่แสดงอาจขาดสูตรเหล่านี้`:LotteryServerData.formula.backtestRetryable?'บางสูตรมีข้อผิดพลาด · ใช้ปุ่มลองอีกครั้งเพื่อคำนวณใหม่':`ใช้เวลา ${_formulaBtFormatElapsed(FormulaBtProgress.elapsed())}`,anyStageRetryable);
  if(LotteryUiState.formula.hasRun){
    try{runAllFormulas();}catch(e){
      _renderFormulaFinalPicks();
      _renderFormulaInsights();
    }
  }
  }catch(e){
    if(FormulaBtProgress.activeStage())_formulaBtSetStepState(FormulaBtProgress.activeStage(),'failed');
    document.getElementById('formula-bt-table').innerHTML='<div class="formula-tab-empty" role="alert" style="display:block">Backtest หยุดก่อนสรุปผล · ตรวจการเชื่อมต่อแล้วลองใหม่ได้จากปุ่มด้านบน</div>';
    _formulaBtFinish('error','Backtest ไม่สำเร็จ','ผลบางส่วนจะไม่แสดงเป็นรายงานฉบับสมบูรณ์',true);
    if(typeof toast==='function')toast('รัน Backtest ไม่สำเร็จ','error',{announce:false});
  }finally{
    document.getElementById('formula-bt-loading').style.display='none';
    LotteryUiState.formula.running=false;
    if(_btBtn){_btBtn.disabled=false;_btBtn.textContent='▶ รัน Backtest';}
  }
}

function btSort(key){
  if(LotteryUiState.formula.sortKey===key)LotteryUiState.formula.sortAsc=!LotteryUiState.formula.sortAsc;
  else{LotteryUiState.formula.sortKey=key;LotteryUiState.formula.sortAsc=false;}
  _renderBtTable();
}

function _formulaBtSummaryHtml(rows){
  if(!rows.length)return '';
  const scored=rows.filter(r=>Number.isFinite(r.edge)&&Number.isFinite(r.pct));
  if(!scored.length)return '<div class="formula-tab-empty" style="display:block">ยังไม่มีผลที่มีข้อมูลครบสำหรับคำนวณ Hit rate / Edge —</div>';
  const bestEdge=[...scored].sort((a,b)=>b.edge-a.edge)[0];
  const bestHit=[...scored].sort((a,b)=>b.pct-a.pct)[0];
  const focused=[...scored].filter(r=>r.baseP<=2).sort((a,b)=>b.edge-a.edge)[0]||bestEdge;
  const risky=[...scored].filter(r=>r.edge<0).sort((a,b)=>a.edge-b.edge)[0]||scored[scored.length-1];
  const card=(label,value,sub,cls='')=>`<div class="bt-summary-card"><div class="bt-summary-label">${label}</div><div class="bt-summary-value ${cls}">${value}</div><div class="bt-summary-sub" title="${_formulaEsc(sub||'')}">${_formulaEsc(sub||'-')}</div></div>`;
  return `<div class="bt-summary-board">
    ${card('Best edge',`${bestEdge.edge>=0?'+':''}${bestEdge.edge.toFixed(1)}%`,bestEdge.name,bestEdge.edge>0?'pos':'')}
    ${card('Best hit rate',`${bestHit.pct.toFixed(1)}%`,bestHit.name)}
    ${card('ชุดน้อยแต่น่าสนใจ',`${focused.edge>=0?'+':''}${focused.edge.toFixed(1)}%`,focused.name,focused.edge>0?'pos':'')}
    ${card('ควรระวัง',`${risky.edge>=0?'+':''}${risky.edge.toFixed(1)}%`,risky.name,'neg')}
  </div>`;
}

// ตารางเปรียบเทียบ Board Pool 1-4 (PRD-hermes-pool-1-4.md) — ทุกสูตรที่ทายเลขเต็ม 6 หลัก
// (I1/I2/J2/Mix/Hermes) ถูกวัดซ้ำกับ hit-set รางวัลที่ 1/2/3/4 (66 เลข) ด้วยเกณฑ์เดียวกัน
// 10 ชุด/งวด — พื้นที่พิสูจน์ "เหนือกว่าทุกสูตร" แบบตรงไปตรงมา (กติกาคงที่ข้อ 1: board แยก)
function _renderPool14Comparison(rows){
  const cands=rows.filter(r=>(r.field==='pool6'||r.field==='pool6_14')&&r.pool14Total>0);
  if(!cands.length)return '';
  const sorted=[...cands].sort((a,b)=>b.pool14Hits-a.pool14Hits||b.pool14Total-a.pool14Total);
  const k=Math.max(...cands.map(r=>r.preds_n||10)); // ทุก pool6 producer ปล่อย 10 ชุด (Hermes/I/J/Mix)
  const baseP=(1-Math.pow(1-66/1e6,k))*100;
  const tested14=Math.max(...sorted.map(r=>r.pool14Total));
  const tr=r=>{
    const pct=r.pool14Total?r.pool14Hits/r.pool14Total*100:0;
    const edge=pct-baseP;
    const ec=edge>0?'var(--green)':edge<0?'var(--red)':'var(--text2)';
    return `<tr>
      <td><span class="formula-group-chip" style="--formula-group-color:${r.groupColor}">${r.group}</span>${r.name}${r.trust?` <span class="trust-badge">${r.trust}</span>`:''}</td>
      <td style="text-align:right;font-weight:700;color:${ec}">${r.pool14Hits}</td>
      <td style="text-align:right">${r.pool14Total}</td>
      <td style="text-align:right;font-weight:700;color:${ec}">${pct.toFixed(3)}%</td>
      <td style="text-align:right;font-size:.72rem;color:var(--text3)">${baseP.toFixed(3)}%</td>
      <td style="text-align:right;font-weight:700;color:${ec}">${edge>=0?'+':''}${edge.toFixed(3)}%</td>
    </tr>`;
  };
  return `<div class="card" style="margin-top:12px">
    <h2 class="card-title">🏆 ตารางเปรียบเทียบ Board Pool 1-4 (รางวัลที่ 1/2/3/4 · 66 เลข)</h2>
    <div style="font-size:.72rem;color:var(--text3);margin-bottom:10px">
      ทุกสูตรที่ทายเลขเต็ม 6 หลักวัดซ้ำด้วยเกณฑ์เดียวกัน — ถูก = เลขตรงตัวใดตัวหนึ่งใน pool รางวัล 1–4 ของงวดนั้น ·
      baseline สุ่ม ${k} ชุด = ${baseP.toFixed(3)}%/งวด (66/1,000,000) · ${tested14} งวดที่วัดได้ ≈ คาดถูกโดยบังเอิญ ${(tested14*k*66/1e6).toFixed(2)} ครั้งตลอด —
      ผล "0 hit ทุกสูตร / เทียบไม่ได้" คือผลที่คาดไว้ตาม PRD ไม่ใช่ความล้มเหลว
    </div>
    <div class="tbl-wrap" tabindex="0" role="region" aria-label="ตารางเปรียบเทียบ Backtest Pool 1-4 เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม"><table>
      <caption class="sr-only">เปรียบเทียบผล Backtest ของสูตร Pool 1-4</caption>
      <thead><tr><th>สูตร</th><th style="text-align:right">ถูก</th><th style="text-align:right">งวด</th><th style="text-align:right">%แม่น</th><th style="text-align:right">Baseline</th><th style="text-align:right">Edge</th></tr></thead>
      <tbody>${sorted.map(tr).join('')}</tbody>
    </table></div>
  </div>`;
}
