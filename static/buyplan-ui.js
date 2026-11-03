// ─── จัดชุดซื้อ (Buy Plan) ──────────────────────────────────────────────────────
// A new top-level page turning Picks/เลขแนะนำ into an actual spending plan (ADR-0004).
// ISSUE-17 ships แทงรายเลข mode end-to-end. The whole allocation contract lives behind the
// pure seam bpBuildPlan(input) → plan; EV คู่ behind bpComputeEv. Both are unit-tested by
// scripts/test_buyplan_build.js (vm-extracted, fixture-driven) — no DOM/network needed.
const BP_DEFAULT_CONFIG={pay2:95,pay3:950,minStake:20,roundUnit:10,tierCap:10,ticketPrice:80};
const BP_EDGE_BACKTEST_WINDOW=80;
// Risk preset → fraction of the budget assigned to 2-digit money (bottom2+prize1_last2);
// the rest goes to 3-digit money (back3). Risk ONLY moves this split — never which numbers
// are chosen (ADR-0004 decision 2).
const BP_RISK_SPLITS={safe:0.8,mid:0.5,bold:0.2};
const BP_RISK_LABELS={safe:'เซฟ',mid:'กลาง',bold:'ใจถึง'};

// Normalise the เลขแนะนำ input (array of {field,num} | array of nums | Set) to a Set of nums.
function bpRecoSet(recoNums){
  const s=new Set();
  if(!recoNums)return s;
  const items=typeof recoNums.forEach==='function'&&!Array.isArray(recoNums)?[...recoNums]:recoNums;
  (items||[]).forEach(x=>{ const n=x&&typeof x==='object'?x.num:x; if(n!=null)s.add(String(n)); });
  return s;
}

// Split the budget between the two tiers, rolling an unfundable tier's money into the other so
// the plan always sums to the full budget. Below the minimum stake entirely → both tiers empty.
function bpTierBudgets(budget,risk,cfg){
  const split=BP_RISK_SPLITS[risk]??0.5;
  let b2=Math.round(budget*split), b3=budget-b2;
  const min=cfg.minStake;
  if(b2<min){ b3+=b2; b2=0; }
  else if(b3<min){ b2+=b3; b3=0; }
  return {b2,b3,split};
}

// Allocate one tier's budget across its candidates: proportional to boostedScore, floored to the
// rounding unit, sub-minimum candidates dropped (lowest first) and their money redistributed among
// survivors, capped at tierCap numbers, with the leftover remainder assigned to rank 1 so the tier
// sums EXACTLY to tierBudget. Candidates arrive pre-sorted by boostedScore desc.
function bpAllocateTier(cands,tierBudget,cfg){
  const {minStake,roundUnit,tierCap}=cfg;
  let work=(cands||[]).slice(0,tierCap);
  if(tierBudget<minStake||!work.length)return [];
  while(true){
    const total=work.reduce((a,r)=>a+r.boostedScore,0);
    const stakes=work.map(r=>{
      const share=total>0?r.boostedScore/total:1/work.length;
      return Math.floor(tierBudget*share/roundUnit)*roundUnit;
    });
    let dropIdx=-1;
    for(let i=work.length-1;i>=0;i--){ if(stakes[i]<minStake){ dropIdx=i; break; } }
    if(dropIdx>=0&&work.length>1){ work.splice(dropIdx,1); continue; }
    const rawStakes=stakes.slice();
    stakes[0]+=tierBudget-stakes.reduce((a,b)=>a+b,0);
    return work.map((r,i)=>({...r,stake:stakes[i],reason:{
      score:r.score,boostedScore:r.boostedScore,boostApplied:!!r.boosted,
      tierTotal:total,share:total>0?r.boostedScore/total:1/work.length,
      rawStake:rawStakes[i],roundedStake:rawStakes[i],finalStake:stakes[i],
      gotRemainder:i===0&&stakes[i]>rawStakes[i]}}));
  }
}

// EV uses only configured payout and the random single-number baseline. Formula Backtest Edge is
// measured across a formula's whole candidate set, so it cannot be added to each number's p. Keep
// the old `adjusted`/`warning` fields as a saved-record compatibility shape; adjusted mirrors theory.
function bpComputeEv(rows,cfg){
  const c={...BP_DEFAULT_CONFIG,...(cfg||{})};
  const payoutFor=len=>len===2?c.pay2:c.pay3;
  const baseP=len=>len===2?1/100:1/1000;
  let total=0,theo=0;
  (rows||[]).forEach(r=>{
    const payout=payoutFor(r.len);
    const p0=baseP(r.len);
    const evT=p0*payout-1;
    total+=r.stake; theo+=r.stake*evT;
  });
  const theoPerBaht=total?theo/total:0;
  const theoretical={perBaht:theoPerBaht,per100:theoPerBaht*100};
  return {
    theoretical,
    adjusted:{...theoretical,positive:theoPerBaht>=0},
    warning:false,
    total,
  };
}

// ── ลอตเตอรี่ใบ (ticket) mode (ISSUE-19) ──
// Standard Thai government prize table (baht per winning ticket). เลขหน้า3/ท้าย3 have two sets each,
// ท้าย2 one set — all handled in bpResolveTicket. Over the full 10⁶ number space this table pays out
// exactly 48฿ of expected value per ticket (6M + 2×100k + 5×200k + 10×80k + 50×40k + 100×20k +
// 2×1000×4k [หน้า3] + 2×1000×4k [ท้าย3] + 10000×2k [ท้าย2] = 48,000,000 / 1,000,000), i.e. −40% at 80฿.
const BP_TICKET_PRIZES={ prize1:6000000, near1:100000, prize2:200000, prize3:80000, prize4:40000, prize5:20000, front3:4000, back3:4000, bottom2:2000 };
const BP_TICKET_EXPECTED_RETURN=48; // baht of expected govt payout per ticket (derivation above)

// Merge the ใบ-mode 6-digit sources (I/J2 pool6 + prize-1 predictions + Mix) into ranked distinct
// candidates. Mix is a labeled SOURCE, never a formula group — it is built from the other groups, so
// counting it as a group would double-count its parents (CONTEXT.md Mix entry). Ranking = number of
// agreeing sources, then distinct formula groups, then number ascending. ทดลอง propagates from J2.
function bpMergeTicketCandidates(sources){
  const map=new Map();
  (sources||[]).forEach(s=>{
    const num=String(s&&s.num||'').trim();
    if(num.length!==6)return;
    const c=map.get(num)||{num,sources:[],groups:[],trust:null};
    const label=s.label||s.kind||'?';
    if(!c.sources.includes(label))c.sources.push(label);
    if(s.kind==='group'&&s.group&&!c.groups.includes(s.group))c.groups.push(s.group);
    if(s.trust==='ทดลอง')c.trust='ทดลอง';
    map.set(num,c);
  });
  return [...map.values()].sort((a,b)=>b.sources.length-a.sources.length||b.groups.length-a.groups.length||a.num.localeCompare(b.num));
}

// Distribute a whole number of tickets across ranked candidates per risk preset (ADR-0004 decision 1
// reinterpreted for ใบ mode): เซฟ spreads across distinct ท้าย 2 endings, ใจถึง stacks on the top
// candidate (chase the full 6-digit), กลาง in between. Returns [{...candidate, qty}].
function bpAllocateTickets(cands,ticketCount,risk){
  if(!cands.length||ticketCount<=0)return [];
  if(risk==='bold'){ return [{...cands[0],qty:ticketCount}]; }
  const spread=(cap)=>{
    const chosen=[],used=new Set();
    for(const c of cands){ const end=c.num.slice(-2); if(used.has(end))continue; used.add(end); chosen.push({...c,qty:1}); if(chosen.length>=cap)break; }
    let i=0,remaining=ticketCount-chosen.length;
    while(remaining>0&&chosen.length){ chosen[i%chosen.length].qty++; i++; remaining--; }
    return chosen;
  };
  // เซฟ: as many distinct endings as tickets allow; กลาง: concentrate onto ~half as many.
  return spread(risk==='mid'?Math.max(1,Math.ceil(ticketCount/2)):ticketCount);
}

// Ticket EV uses only the govt table's expected return and the configured ticket price. The optional
// third argument remains accepted for old callers, but candidate-set Backtest Edge is not a ticket
// probability and must not be converted into baht.
function bpComputeTicketEv(rows,cfg,_legacyEndingEdge=0){
  const c={...BP_DEFAULT_CONFIG,...(cfg||{})};
  const price=c.ticketPrice||80;
  const tickets=(rows||[]).reduce((a,r)=>a+Math.max(0,Math.floor(Number(r.qty)||0)),0);
  const theoPerTicket=BP_TICKET_EXPECTED_RETURN-price;
  const theoPerBaht=price?theoPerTicket/price:0;
  const theoretical={perBaht:theoPerBaht,per100:theoPerBaht*100,perTicket:theoPerTicket,expectedReturn:BP_TICKET_EXPECTED_RETURN};
  return {
    mode:'ticket', tickets, ticketPrice:price,
    theoretical,
    adjusted:{...theoretical,positive:theoPerBaht>=0},
    warning:false,
  };
}

// Resolve ONE ticket against the full government prize table. myhora columns (prize1, front3×2,
// back3×2, bottom2) are always present; sanook columns (near1, prize2–5) exist for only ~456 draws —
// when absent those checks are flagged unverifiable rather than silently counted as misses. Prizes
// stack across independent categories (the standard rule).
function bpResolveTicket(num,actual){
  const t=bpPad(num,6);
  const wins=[];
  const exact=(v,width)=>typeof v==='string'&&new RegExp(`^[0-9]{${width}}$`).test(v);
  if(exact(actual?.prize1,6)&&t===actual.prize1)wins.push({prize:'ที่ 1',amount:BP_TICKET_PRIZES.prize1});
  if([actual?.front3_1,actual?.front3_2].some(x=>exact(x,3)&&x===t.slice(0,3)))wins.push({prize:'เลขหน้า 3 ตัว',amount:BP_TICKET_PRIZES.front3});
  if([actual?.back3_1,actual?.back3_2].some(x=>exact(x,3)&&x===t.slice(-3)))wins.push({prize:'เลขท้าย 3 ตัว',amount:BP_TICKET_PRIZES.back3});
  if(exact(actual?.bottom2,2)&&actual.bottom2===t.slice(-2))wins.push({prize:'เลขท้าย 2 ตัว',amount:BP_TICKET_PRIZES.bottom2});

  const columnGroup=(fields,width)=>{
    const valid=fields.filter(field=>exact(actual?.[field],width)).map(field=>actual[field]);
    return {valid,complete:valid.length===fields.length};
  };
  const near=columnGroup(['near1_1','near1_2'],6);
  if(near.valid.includes(t))wins.push({prize:'ข้างเคียงที่ 1',amount:BP_TICKET_PRIZES.near1});
  const prize2=columnGroup(Array.from({length:5},(_,i)=>`prize2_${i+1}`),6);
  if(prize2.valid.includes(t))wins.push({prize:'ที่ 2',amount:BP_TICKET_PRIZES.prize2});
  const prize3=columnGroup(Array.from({length:10},(_,i)=>`prize3_${i+1}`),6);
  if(prize3.valid.includes(t))wins.push({prize:'ที่ 3',amount:BP_TICKET_PRIZES.prize3});
  const parseList=(value,count)=>{
    const tokens=typeof value==='string'?value.trim().split(/\s+/).filter(Boolean):[];
    if(!tokens.length)return {valid:[],complete:false};
    const valid=tokens.filter(token=>exact(token,6));
    const unique=new Set(valid);
    return {valid:[...unique],complete:tokens.length===count&&valid.length===count&&unique.size===count};
  };
  const prize4=parseList(actual?.prize4,50),prize5=parseList(actual?.prize5,100);
  if(prize4.valid.includes(t))wins.push({prize:'ที่ 4',amount:BP_TICKET_PRIZES.prize4});
  if(prize5.valid.includes(t))wins.push({prize:'ที่ 5',amount:BP_TICKET_PRIZES.prize5});
  const myhoraComplete=exact(actual?.prize1,6)
    &&columnGroup(['front3_1','front3_2'],3).complete
    &&columnGroup(['back3_1','back3_2'],3).complete
    &&exact(actual?.bottom2,2);
  const sanookComplete=near.complete&&prize2.complete&&prize3.complete&&prize4.complete&&prize5.complete;
  return {wins,amount:wins.reduce((a,w)=>a+w.amount,0),unverifiable:!myhoraComplete||!sanookComplete};
}

// The pure seam. Per-number (แทงรายเลข) input: {mode, budget, risk, config, scoreRows, recoNums}.
// Ticket (ลอตเตอรี่ใบ) input: {mode:'ticket', budget, risk, config, ticketSources}.
function bpBuildPlan(input){
  const cfg={...BP_DEFAULT_CONFIG,...(input.config||{})};
  const risk=BP_RISK_SPLITS[input.risk]!=null?input.risk:'mid';
  const budget=Math.max(0,Math.floor(Number(input.budget)||0));
  if(input.mode==='ticket'){
    const price=cfg.ticketPrice||80;
    let merged=bpMergeTicketCandidates(input.ticketSources);
    // Arriving from the Mix page (prioritizeSource:'Mix'), float candidates carrying that source to the
    // front so a Mix number is always buyable/visible — even past one with more overall agreement.
    // Stable sort preserves the agreement ranking within each group.
    if(input.prioritizeSource){
      const has=c=>(c.sources||[]).includes(input.prioritizeSource)?1:0;
      merged=merged.slice().sort((a,b)=>has(b)-has(a));
    }
    const ticketCount=price>0?Math.floor(budget/price):0;
    const rows=bpAllocateTickets(merged,ticketCount,risk).map(c=>({
      num:c.num,field:'ticket',tier:'ticket',qty:c.qty,stake:c.qty*price,
      sources:c.sources,groups:c.groups,trust:c.trust||null,
      ladder:[c.num,c.num.slice(-3),c.num.slice(-2)],hand:false,
    }));
    return {
      mode:'ticket',budget,risk,config:cfg,rows,
      ev:bpComputeTicketEv(rows,cfg),
      ticketPrice:price,ticketCount,totalStake:rows.reduce((a,r)=>a+r.stake,0),
    };
  }
  const recoSet=bpRecoSet(input.recoNums);
  // Candidates for a tier = Decision Center score rows of the matching digit length. Scoring is
  // untouched; เลขแนะนำ membership applies a ×1.5 multiplier for allocation ranking only.
  const mk=(len,field)=>(input.scoreRows||[])
    .filter(r=>String(r.num||'').length===len)
    .map(r=>{
      const boosted=recoSet.has(String(r.num));
      const score=Number(r.score)||0;
      return {num:String(r.num),field,len,tier:len===2?'2d':'3d',score,
        topEdge:(typeof r.topEdge==='number'?r.topEdge:null),trust:r.trust||null,
        topEdgeDraws:(Number.isSafeInteger(r.topEdgeDraws)&&r.topEdgeDraws>0?r.topEdgeDraws:null),
        source:field==='bottom2'?'2 ตัวล่าง':'3 ตัวบน',boosted,boostedScore:score*(boosted?1.5:1),
        reasons:Array.isArray(r.reasons)?r.reasons.slice():[],
        sources:Array.isArray(r.sources)?r.sources.slice():[],
        warnings:Array.isArray(r.warnings)?r.warnings.slice():[],
        formulaCount:Number(r.formulaCount)||0,predictCount:Number(r.predictCount)||0};
    })
    .sort((a,b)=>b.boostedScore-a.boostedScore||a.num.localeCompare(b.num));
  const cand2=mk(2,'bottom2'), cand3=mk(3,'back3');
  let {b2,b3,split}=bpTierBudgets(budget,risk,cfg);
  // A tier with budget but no candidates would strand its money — roll it into the other tier so
  // the plan still sums to the full budget (pick-count scales with what the formulas actually gave).
  if(!cand2.length&&cand3.length){ b3+=b2; b2=0; }
  else if(!cand3.length&&cand2.length){ b2+=b3; b3=0; }
  const rows=[
    ...bpAllocateTier(cand2,b2,cfg),
    ...bpAllocateTier(cand3,b3,cfg),
  ].map(r=>({...r,hand:false}));
  const ev=bpComputeEv(rows,cfg);
  return {
    mode:input.mode||'perNumber',budget,risk,config:cfg,rows,ev,
    tiers:{'2d':{budget:b2},'3d':{budget:b3},split},
    totalStake:rows.reduce((a,r)=>a+r.stake,0),
  };
}

// ── Buy Plan rendering (light HTML string helpers, mirroring the DC/Mix prior art) ──
const BP_FIELD_LABELS={bottom2:'2 ตัวล่าง',prize1_last2:'2 ตัวบน',back3:'3 ตัวบน'};
// Mirror of formula-evaluation.js's function-local _GRP (group key → [label,color]).
// Keep experimental groups here too so source explanations do not lose their group marker.
const BP_GROUP_MAP = {
  A: ['A · กูชอบ', 'var(--gold)'], B: ['B · ลอตโตพลัส', '#4d9de0'], C: ['C · พิชิตโชค', '#a855f7'],
  D: ['D · Claude', '#22d3ee'], X: ['F · Codex', '#a3e635'], G: ['G · แม่นขั้นเทพ', '#f05454'],
  H: ['H · มิสเตอร์ซี', '#f59e0b'], E: ['E · สายมู', '#ec4899'], I: ['I · จักรพรรดิ', '#c084fc'],
  J: ['J · เจ้าสัว', '#10b981'], HM: ['HM · Hermes Pool 1-4', '#2dd4bf'],
  FANO: ['ระนาบฟาโน · รางวัลที่ 1', '#67e8f9'],
  RLL: ['RLL · Reinforcement Learn LLM', '#f472b6'],
};
// Distinct top-level formula groups backing a number, derived from its source labels (name[0],
// Codex X→F; HM/Fano names map to their full group keys). Non-formula sources
// (Predict/รางวัลรอง/พิมพ์เอง) have no group letter → excluded.
function bpGroupsForSources(sources){
  const seen = new Map();
  (sources || []).forEach(s => {
    const t = String(s || '').trim();
    const upper=t.toUpperCase();
    const letter=upper.startsWith('HM')?'HM':
      (upper.startsWith('FANO')||t.startsWith('ระนาบฟาโน'))?'FANO':
      (upper.startsWith('RLL')||t.startsWith('Reinforcement'))?'RLL':t[0];
    if (!letter || !BP_GROUP_MAP[letter] || seen.has(letter)) return;
    seen.set(letter, { letter, label: BP_GROUP_MAP[letter][0], color: BP_GROUP_MAP[letter][1] });
  });
  return [...seen.values()];
}
// Edge describes a formula candidate set's historical hit-rate difference, not this number's odds.
function bpStrengthWord(topEdge){
  const e = typeof topEdge === 'number' ? topEdge : null;
  if (e == null) return { word: 'ไม่มี Edge', cls: 'bp-str-weak' };
  const rounded=Number(e.toFixed(1));
  if (rounded === 0 || rounded < 0) return { word: 'Edge ชุดสูตร', cls: 'bp-str-weak' };
  if (e >= 1) return { word: 'Edge ชุดสูตร', cls: 'bp-str-strong' };
  return { word: 'Edge ชุดสูตร', cls: 'bp-str-mid' };
}
function bpEdgeSignalNoteHtml(){
  return `<aside class="bp-edge-note" aria-label="ความหมาย Edge ของสูตร"><strong>Edge ชุดสูตร</strong><span>ค่าสูงสุดย้อนหลังจากสูตรที่รองรับเลขนี้ · Backtest ใช้ไม่เกิน ${BP_EDGE_BACKTEST_WINDOW} งวดล่าสุด และแสดงจำนวนจริงข้างค่า · วัดส่วนต่าง hit rate ของชุดผู้สมัครสูตรเทียบ baseline สุ่ม (pp = จุดเปอร์เซ็นต์) ไม่ใช่โอกาสของเลขรายตัว และไม่นำไปคำนวณ EV</span></aside>`;
}
function bpAttachEdgeSampleCounts(scoreRows,btRows){
  const byName=new Map((btRows||[]).map(row=>[row.name,row]));
  return (scoreRows||[]).map(row=>{
    if(typeof row?.topEdge!=='number')return {...row,topEdgeDraws:null};
    const candidates=(row.sources||[]).map(source=>byName.get(source)).filter(candidate=>
      candidate&&typeof candidate.edge==='number'&&Math.abs(candidate.edge-row.topEdge)<1e-10
      &&Number.isSafeInteger(candidate.total)&&candidate.total>0);
    const strongest=candidates.sort((a,b)=>b.total-a.total)[0];
    return {...row,topEdgeDraws:strongest?strongest.total:null};
  });
}
// The expand body for one แทงรายเลข row: why the number (reasons + group dots + warnings) and
// why the money (score → share → boost → rounding → baht). Hand-edited rows show a neutral note.
function bpRowExplainHtml(row, roundUnit){
  const dots = bpGroupsForSources(row.sources)
    .map(g => `<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
  const reasons = (row.reasons || []).map(x => {
    const text=String(x).replace(/((?:backtest\s+)?edge\s+[+\-−]?\d+(?:\.\d+)?)%/gi,'$1 pp');
    return `<li>${escHtml(text)}</li>`;
  }).join('')
    || '<li class="bp-why-none">มาจากสัญญาณรวม ไม่มีเหตุผลรายตัว</li>';
  const warns = (row.warnings || []).map(w => `<div class="bp-why-warn">⚠ ${escHtml(w)}</div>`).join('');
  const rs = row.reason || {};
  const money = row.hand
    ? `<div class="bp-why-hand">แก้เอง — ตัวเลขนี้คุณกำหนดเอง ไม่ได้มาจากการจัดเงินของระบบ</div>`
    : `<div class="bp-why-money">คะแนน <b>${(Number(rs.score) || 0).toFixed(1)}</b>`
      + ` → สัดส่วนในกอง <b>${Math.round((rs.share || 0) * 100)}%</b>`
      + (rs.boostApplied ? ` → <b>×1.5</b> เลขแนะนำ` : '')
      + ` → ปัดลงหน่วย ${roundUnit || 10} = <b>${row.stake}฿</b>`
      + (rs.gotRemainder ? ` <span class="bp-why-rem">· +เศษที่เหลือของกอง</span>` : '')
      + `</div>`;
  return `<div class="bp-why">
    <div class="bp-why-block"><div class="bp-why-h">ทำไมได้เลขนี้</div>
      <div class="bp-why-groups">${dots}</div><ul class="bp-why-reasons">${reasons}</ul>${warns}
      <div class="bp-why-none">Edge เป็นผลย้อนหลังของชุดผู้สมัครสูตร ไม่ใช่โอกาสถูกรางวัลของเลขนี้</div></div>
    <div class="bp-why-block"><div class="bp-why-h">ทำไมเงินเท่านี้</div>${money}</div>
  </div>`;
}
// Toggle an expand detail block by element id; flips the caret + aria-expanded on the button.
function bpToggleRow(id, btn){
  const el = document.getElementById(id); if (!el) return;
  const open = !el.classList.toggle('hidden');
  if (btn) { btn.textContent = open ? '▾' : '▸'; btn.setAttribute('aria-expanded', String(open)); }
}
window.bpToggleRow = bpToggleRow;
// Expand body for one ลอตเตอรี่ใบ row: which sources agreed (tickets have no per-number Edge, so
// agreement count stands in for strength) and what to search if the exact ticket is sold out.
function bpTicketExplainHtml(row){
  const dots = bpGroupsForSources(row.sources)
    .map(g => `<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
  const srcs = (row.sources || []).map(s => escHtml(s)).join(', ') || '—';
  const n = (row.sources || []).length;
  const agree = n >= 3 ? 'หลายแหล่งเห็นตรงกัน' : n === 2 ? 'สองแหล่งเห็นตรงกัน' : 'มาจากแหล่งเดียว';
  const L = row.ladder || [row.num, String(row.num).slice(-3), String(row.num).slice(-2)];
  return `<div class="bp-why">
    <div class="bp-why-block"><div class="bp-why-h">ทำไมใบนี้</div>
      <div class="bp-why-groups">${dots}</div>
      <div class="bp-why-agree">เห็นตรงกัน <b>${n}</b> แหล่ง (${agree}): ${srcs}</div></div>
    <div class="bp-why-block"><div class="bp-why-h">ถ้าเลขเต็มขายหมด</div>
      <div class="bp-why-ladder">ไล่ซื้อ เต็ม 6 (${escHtml(L[0])}) → ท้าย 3 (${escHtml(L[1])}) → ท้าย 2 (${escHtml(L[2])})</div></div>
  </div>`;
}
function bpPlanTableHtml(plan){
  if(!plan||!plan.rows.length)return '<div class="dash-empty">งบไม่พอวางเลขแม้แต่ตัวเดียว (ขั้นต่ำ '+(plan?.config?.minStake??20)+'฿/เลข) — เพิ่มงบแล้วลองใหม่</div>';
  const tierBlock=(tierKey,label)=>{
    const rows=plan.rows.filter(r=>r.tier===tierKey);
    if(!rows.length)return '';
    const body=rows.map((r,i)=>`<tr class="bp-row${i===0?' bp-rank1':''}">
      <td class="bp-num">${escHtml(r.num)}${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}</td>
      <td class="bp-field">${escHtml(BP_FIELD_LABELS[r.field]||r.field)}</td>
      <td class="bp-stake">${r.stake}฿</td>
    </tr>`).join('');
    return `<section class="bp-tier">
      <h2 class="bp-tier-head">${label} <span class="dc-status">${rows.length} เลข · ${rows.reduce((a,r)=>a+r.stake,0)}฿</span></h2>
      <div class="bp-table-scroll" tabindex="0" role="region" aria-label="ตารางรายการ ${label} เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม"><table class="bp-table"><thead><tr><th>เลข</th><th>ประเภท</th><th>เงิน</th></tr></thead><tbody>${body}</tbody></table></div>
    </section>`;
  };
  return `<div class="bp-plan">
    ${tierBlock('2d','เงิน 2 หลัก (2 ตัวล่าง/บน)')}
    ${tierBlock('3d','เงิน 3 หลัก (3 ตัวบน)')}
    <div class="bp-total">รวมทั้งชุด <b>${plan.totalStake}฿</b> จากงบ ${plan.budget}฿ · ความเสี่ยง ${BP_RISK_LABELS[plan.risk]||plan.risk}</div>
  </div>`;
}
function bpEvCardHtml(plan){
  const ev=plan.ev;
  if(plan.mode==='ticket'){
    const price=Number(plan.config.ticketPrice)||80;
    const expectedNet=ev.theoretical.perTicket;
    const netText=bpExpectedNetText(expectedNet, 'ต่อใบ');
    return `<div class="bp-ev-card">
      <h2 class="bp-ev-label">ผลตอบแทนคาดหมาย · ลอตเตอรี่ใบ</h2>
      <div class="bp-ev-theory">ตารางรางวัลคาดจ่ายเฉลี่ย <b>${ev.theoretical.expectedReturn.toFixed(0)}฿ ต่อใบ</b> · ราคาที่ตั้งไว้ ${price}฿ · ${netText}</div>
      <div class="bp-ev-note">เป็นค่าเฉลี่ยระยะยาวจากตารางรางวัล ไม่ได้ทำนายผลของใบนี้ และไม่ได้นำ Edge ของชุดสูตรมาแปลงเป็นเงิน</div>
    </div>`;
  }
  const hasStake=ev.total>0;
  const result=hasStake
    ?`<div class="bp-ev-theory">ตามอัตราจ่ายที่ตั้งไว้ ${bpExpectedNetText(ev.theoretical.per100, 'ต่อเงินเดิมพัน 100฿')} ในระยะยาว</div>`
    :`<div class="bp-ev-theory">ยังไม่มีเงินเดิมพันในรายการ จึงยังคำนวณค่าเฉลี่ยของชุดนี้ไม่ได้</div>`;
  return `<div class="bp-ev-card">
    <h2 class="bp-ev-label">ผลตอบแทนคาดหมาย · แทงรายเลข</h2>
    ${result}
    <div class="bp-ev-note">คำนวณจากอัตราจ่าย ×${plan.config.pay2} (2 ตัว) / ×${plan.config.pay3} (3 ตัว) และโอกาสสุ่มตามจำนวนหลัก ไม่ใช้ Edge ย้อนหลังของชุดสูตร</div>
  </div>`;
}
function bpExpectedNetText(value,unit){
  const n=Number(value)||0;
  if(Math.abs(n)<0.05)return `<b>คาดคุ้มทุน ${unit}</b>`;
  return n<0?`<b>คาดเสีย ${Math.abs(n).toFixed(1)}฿ ${unit}</b>`:`<b>คาดสุทธิ +${n.toFixed(1)}฿ ${unit}</b>`;
}

// ── Resolution + ledger seams (ISSUE-18, ADR-0004 decision 8) ──
// bpResolvePlan(plan, actualDrawRow) → resolution: per-row ถูก/ผิด + baht returned (stake × the
// payout FROZEN in the plan), per-plan net = returned − spent. Hit definitions are exact per bet
// type. actualDrawRow is the history row (or null → Pending) from dcActualForDate — the same
// ISO-target-date → Thai-history-row lookup the Decision Center track record already uses.
function bpPad(v,n){ return String(v==null?'':v).padStart(n,'0').slice(-n); }
function bpResolvePlan(plan,actual){
  const rows=plan&&plan.rows?plan.rows:[];
  const spent=rows.reduce((a,r)=>a+(Number(r.stake)||0),0);
  if(!actual){
    return {status:'pending',rows:rows.map(r=>({...r,hit:null,returned:0})),returned:0,spent,net:0,budget:plan?plan.budget:0};
  }
  const exact=(v,width)=>typeof v==='string'&&new RegExp(`^[0-9]{${width}}$`).test(v);
  const prize1=exact(actual.prize1,6)?actual.prize1:null;
  const bottom2=exact(actual.bottom2,2)?actual.bottom2:null;
  const targets={bottom2,prize1_last2:prize1?prize1.slice(-2):null,back3:prize1?prize1.slice(-3):null};
  const cfg={...BP_DEFAULT_CONFIG,...((plan&&plan.config)||{})};
  const payoutFor=field=>field==='back3'?cfg.pay3:cfg.pay2;
  let returned=0,unverifiable=false;
  const resolved=rows.map(r=>{
    if(r.field==='ticket'){
      const hasQty=typeof r.qty==='number'||(typeof r.qty==='string'&&r.qty.trim()!=='');
      const qtyValue=hasQty?Number(r.qty):NaN;
      if(!Number.isFinite(qtyValue)||!Number.isInteger(qtyValue)){
        unverifiable=true;
        return {...r,hit:null,returned:0,wins:[],unverifiable:true};
      }
      const qty=Math.max(0,qtyValue);
      if(qty===0){
        const hasSavedStake=typeof r.stake==='number'||(typeof r.stake==='string'&&r.stake.trim()!=='');
        const stake=hasSavedStake?Number(r.stake):NaN;
        if(!Number.isFinite(stake)||stake!==0){
          unverifiable=true;
          return {...r,hit:null,returned:0,wins:[],unverifiable:true};
        }
        return {...r,hit:false,returned:0,wins:[],unverifiable:false};
      }
      const expectedStake=qty*(Number(cfg.ticketPrice)||80);
      const savedStake=Number(r.stake)||0;
      if(!Number.isFinite(savedStake)||savedStake<0||savedStake!==expectedStake){
        unverifiable=true;
        return {...r,hit:null,returned:0,wins:[],unverifiable:true};
      }
      const tr=bpResolveTicket(r.num,actual);
      const ret=qty*tr.amount;
      returned+=ret; if(tr.unverifiable)unverifiable=true;
      return {...r,hit:tr.amount>0?true:tr.unverifiable?null:false,returned:ret,wins:tr.wins,unverifiable:tr.unverifiable};
    }
    if(!['bottom2','prize1_last2','back3'].includes(r.field)){
      unverifiable=true;
      return {...r,hit:null,returned:0,unverifiable:true};
    }
    const width=r.field==='back3'?3:2;
    const target=targets[r.field];
    const outcome=target==null?null:bpPad(r.num,width)===target;
    const ret=outcome===true?(Number(r.stake)||0)*payoutFor(r.field):0;
    returned+=ret;
    if(outcome===null)unverifiable=true;
    return {...r,hit:outcome,returned:ret,unverifiable:outcome===null};
  });
  return {status:unverifiable?'unverifiable':'resolved',rows:resolved,returned,spent,net:unverifiable?null:returned-spent,budget:plan.budget,unverifiable};
}

// Theoretical expected net (baht) of the money a plan actually wagered — mode-aware so the ledger's
// random-play comparison uses the right prize structure (−5%/baht for แทงรายเลข, −40%/ticket for ใบ).
function bpPlanTheoreticalNet(plan){
  const rows=(plan&&plan.rows)||[];
  if(plan&&plan.mode==='ticket'){
    const ev=bpComputeTicketEv(rows,plan.config);
    return ev.theoretical.perTicket*ev.tickets;
  }
  const spent=rows.reduce((a,r)=>a+(Number(r.stake)||0),0);
  return bpComputeEv(rows,plan?plan.config:{}).theoretical.perBaht*spent;
}

// bpLedger(savedPlans, histRows) → cumulative real-money answer. Totals accumulate over RESOLVED
// plans only (a pending plan's return is unknown); the random-play expectation is the theoretical
// EV in baht of the amounts ACTUALLY wagered on those resolved plans (ADR-0004: the honest metric).
function bpLedger(plans,histRows){
  const list=Array.isArray(plans)?plans:[];
  let resolved=0,pending=0,unverifiable=0,spent=0,returned=0,randomExpectedNet=0;
  const items=list.map(plan=>{
    const actual=(typeof dcActualForDate==='function')?dcActualForDate(histRows,plan.date):null;
    const res=bpResolvePlan(plan,actual);
    const planSpent=(plan.rows||[]).reduce((a,r)=>a+(Number(r.stake)||0),0);
    if(res.status==='resolved'){
      resolved++; spent+=planSpent; returned+=res.returned;
      randomExpectedNet+=bpPlanTheoreticalNet(plan);
    }else if(res.status==='unverifiable'){
      unverifiable++;
    }else{ pending++; }
    return {plan,res,spent:planSpent};
  });
  return {totalPlans:list.length,resolved,pending,unverifiable,spent,returned,net:returned-spent,randomExpectedNet,items};
}

// ── Buy Plan page state, config/prefs persistence, loader + handlers ──
// Config (payouts/min/round) and last-used mode/budget/risk persist in localStorage under their
// own keys, isolated from every Decision Center / Mix key. Saved plans (ISSUE-18) get a third key.
const BP_CONFIG_KEY='lottery_buyplan_config';
const BP_PREFS_KEY='lottery_buyplan_prefs';
const BP_HISTORY_KEY='lottery_buyplan_history'; // saved ชุดซื้อ — own key, separate from every DC/Mix store

// Saved-plan storage. Records are frozen at save time and immutable — delete-whole-plan only.
function bpHistoryPayloadIsValid(value){
  return Array.isArray(value)&&value.every(plan=>plan&&typeof plan==='object'&&!Array.isArray(plan)
    &&typeof plan.id==='string'&&plan.id.length>0&&typeof plan.date==='string'
    &&Array.isArray(plan.rows)&&plan.rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)));
}
function bpHistory(){
  LotteryUiState.buyplan.historyReadError=null;
  let raw;
  try{raw=localStorage.getItem(BP_HISTORY_KEY);}
  catch(e){LotteryUiState.buyplan.historyReadError='unavailable';return null;}
  if(raw===null)return [];
  let records;
  try{records=JSON.parse(raw);}
  catch(e){LotteryUiState.buyplan.historyReadError='malformed';return null;}
  if(!bpHistoryPayloadIsValid(records)){LotteryUiState.buyplan.historyReadError='malformed';return null;}
  return records;
}
function bpHistoryAdd(rec){
  const list=bpHistory();
  if(!Array.isArray(list)){
    const error=new Error('Buy Plan history is unreadable');error.code='bp_history_unreadable';throw error;
  }
  list.unshift(rec);
  if(!bpHistoryPayloadIsValid(list)){
    LotteryUiState.buyplan.historyReadError='malformed';
    const error=new Error('Buy Plan history record is malformed');error.code='bp_history_unreadable';throw error;
  }
  localStorage.setItem(BP_HISTORY_KEY,JSON.stringify(list));
}
// A duplicate is the same target, purchase mode, applicable payout, and actual wager amounts.
// Ignore rank/budget/risk/source metadata: those may change while the purchase being recorded did not.
function bpSavedPlanSignature(plan){
  if(!plan||!Array.isArray(plan.rows)||!plan.rows.length)return '';
  const mode=plan.mode==='ticket'?'ticket':'perNumber';
  const cfg={...BP_DEFAULT_CONFIG,...(plan.config||{})};
  const config=mode==='ticket'?{ticketPrice:Number(cfg.ticketPrice)}:{pay2:Number(cfg.pay2),pay3:Number(cfg.pay3)};
  const rows=new Map();
  plan.rows.forEach(r=>{
    const field=String(r.field||''),num=String(r.num||'').trim();
    if(!field||!num)return;
    const key=`${field}\u0000${num}`;
    const item=rows.get(key)||{field,num,stake:0,qty:0};
    item.stake+=Math.max(0,Number(r.stake)||0);
    if(field==='ticket')item.qty+=Math.max(0,Math.floor(Number(r.qty)||0));
    rows.set(key,item);
  });
  const canonicalRows=[...rows.values()].sort((a,b)=>a.field.localeCompare(b.field)||a.num.localeCompare(b.num))
    .map(r=>r.field==='ticket'?{num:r.num,field:r.field,qty:r.qty,stake:r.stake}:{num:r.num,field:r.field,stake:r.stake});
  return JSON.stringify({date:String(plan.date||''),mode,config,rows:canonicalRows});
}
function bpPlanAlreadySaved(plan,plans=bpHistory()){
  const signature=bpSavedPlanSignature(plan);
  return !!signature&&Array.isArray(plans)&&plans.some(saved=>bpSavedPlanSignature(saved)===signature);
}
function bpHasUnsavedDraft(plan=LotteryUiState.buyplan.workingPlan,plans=bpHistory()){
  if(!plan||!LotteryUiState.buyplan.workingPlanTouched)return false;
  return !Array.isArray(plans)||!bpPlanAlreadySaved(plan,plans);
}
function bpConfirmDraftDiscard(action){
  const plan=LotteryUiState.buyplan.workingPlan;
  if(!bpHasUnsavedDraft(plan))return true;
  const message=`แผนงวด ${fmtDate(plan.date)} มีการแก้ไขที่ยังไม่บันทึก\n${action} จะทิ้งเลขและยอดที่ปรับไว้\nต้องการดำเนินการต่อหรือไม่?`;
  return typeof window!=='undefined'&&typeof window.confirm==='function'&&window.confirm(message);
}
function bpHistoryDelete(id){
  const plans=bpHistory();
  if(!Array.isArray(plans)){
    if(typeof toast==='function')toast('ลบชุดซื้อไม่ได้ — อ่านประวัติไม่สำเร็จ ข้อมูลเดิมยังไม่ถูกแก้','error');
    return false;
  }
  try{
    localStorage.setItem(BP_HISTORY_KEY,JSON.stringify(plans.filter(x=>x.id!==id)));
    return true;
  }catch(e){
    if(typeof toast==='function')toast('ลบชุดซื้อไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม','error');
    return false;
  }
}
function bpReadConfig(){
  const fallback={...BP_DEFAULT_CONFIG};
  const fail=reason=>{
    LotteryUiState.buyplan.configReadError=reason;
    bpRenderConfigReadStatus();
    return fallback;
  };
  let raw;
  try{raw=localStorage.getItem(BP_CONFIG_KEY);}
  catch(e){return fail('unavailable');}
  if(raw===null){LotteryUiState.buyplan.configReadError=null;bpRenderConfigReadStatus();return fallback;}
  let stored;
  try{stored=JSON.parse(raw);}
  catch(e){return fail('malformed');}
  if(!stored||typeof stored!=='object'||Array.isArray(stored))return fail('malformed');
  const cfg={...fallback};
  Object.keys(BP_DEFAULT_CONFIG).forEach(key=>{
    if(Object.prototype.hasOwnProperty.call(stored,key))cfg[key]=stored[key];
  });
  if(Object.values(cfg).some(value=>!Number.isInteger(value)||value<=0))return fail('malformed');
  LotteryUiState.buyplan.configReadError=null;
  bpRenderConfigReadStatus();
  return cfg;
}
function bpWriteConfig(cfg){ localStorage.setItem(BP_CONFIG_KEY,JSON.stringify(cfg)); }
function bpConfigReadMessage(){
  return LotteryUiState.buyplan.configReadError==='malformed'
    ?'ข้อมูลเรตที่เก็บไว้มีรูปแบบหรือค่าที่ไม่ถูกต้อง'
    :'เบราว์เซอร์ไม่อนุญาตให้อ่านเรตที่เก็บไว้';
}
function bpConfigStatusHtml(){
  if(!LotteryUiState.buyplan.configReadError)return '';
  return `<div class="feature-state feature-state-error" role="alert"><div class="feature-state-mark" aria-hidden="true">!</div><div><strong>อ่านเรตเดิมไม่ได้</strong><p>${bpConfigReadMessage()} · ตอนนี้ใช้ค่าเริ่มต้นคำนวณชั่วคราว</p><div class="bp-config-recovery-actions"><button type="button" class="btn btn-secondary" onclick="bpDownloadConfigBackup()">ดาวน์โหลดข้อมูลเรตเดิม</button><button type="button" class="btn" onclick="bpRetryConfigRead()">ลองอ่านอีกครั้ง</button></div></div></div>`;
}
function bpRenderConfigReadStatus(){
  const status=document.getElementById('bp-config-status');
  if(!status)return;
  const html=bpConfigStatusHtml();
  status.hidden=!html;
  status.innerHTML=html;
}
function bpConfigWarningHtml(){
  if(!LotteryUiState.buyplan.configReadError)return '';
  return `<section class="card feature-state feature-state-error bp-config-warning" role="alert"><div class="feature-state-mark" aria-hidden="true">!</div><div><strong>แผนนี้ใช้ค่าเรตเริ่มต้นชั่วคราว</strong><p>${bpConfigReadMessage()} จึงยังยืนยัน EV ตามเรตที่คุณตั้งไว้ไม่ได้</p><button type="button" class="btn btn-secondary" onclick="bpToggleConfig(true)">ตรวจและแก้เรต</button></div></section>`;
}
function bpDownloadConfigBackup(){
  let raw;
  try{raw=localStorage.getItem(BP_CONFIG_KEY);}
  catch(e){if(typeof toast==='function')toast('อ่านข้อมูลเรตสำรองไม่ได้ — ข้อมูลเดิมไม่ได้ถูกแก้','error');return false;}
  if(raw===null){if(typeof toast==='function')toast('ไม่พบข้อมูลเรตที่ดาวน์โหลดได้','error');return false;}
  try{
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='lottery_buyplan_config_backup.json';
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),0);
    return true;
  }catch(e){if(typeof toast==='function')toast('ดาวน์โหลดข้อมูลเรตสำรองไม่สำเร็จ — ข้อมูลเดิมยังอยู่','error');return false;}
}
function bpRetryConfigRead(){
  bpFillConfigInputs();
  if(LotteryUiState.buyplan.configReadError){
    if(typeof toast==='function')toast('ยังอ่านเรตเดิมไม่ได้ — ระบบยังใช้ค่าเริ่มต้นชั่วคราว','error');
    return false;
  }
  bpRender();
  if(typeof toast==='function')toast('อ่านเรตที่บันทึกไว้แล้ว','success');
  return true;
}
function bpReadPrefs(){
  try{return {mode:'perNumber',budget:500,risk:'mid',...JSON.parse(localStorage.getItem(BP_PREFS_KEY)||'{}')};}
  catch(e){return {mode:'perNumber',budget:500,risk:'mid'};}
}
function bpWritePrefs(p){ localStorage.setItem(BP_PREFS_KEY,JSON.stringify(p)); }
function bpAnnounceStatus(message){
  const status=document.getElementById('bp-status');
  if(status)status.textContent=message;
}
function bpAnnouncePlanSummary(){
  const plan=LotteryUiState.buyplan.workingPlan;
  if(!plan)return;
  const money=value=>Number(value||0).toLocaleString('th-TH');
  const rowSummary=plan.mode==='ticket'
    ?`${plan.rows.length} เลข ${plan.rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0)} ใบ`
    :`${plan.rows.length} รายการ`;
  bpAnnounceStatus(`แผนปัจจุบัน ${rowSummary} รวม ${money(plan.totalStake)} บาท จากงบ ${money(plan.budget)} บาท`);
}

function bpLoadNotice(root,state,title,message,date){
  if(!root)return;
  bpAnnounceStatus('');
  const role=state==='error'||state==='partial'?'alert':'status';
  const draw=date?`<div class="feature-state-date">งวดเป้าหมาย ${escHtml(fmtDate(date))}</div>`:'';
  root.className='';
  root.dataset.state=state;
  root.setAttribute('aria-busy','false');
  root.innerHTML=bpConfigWarningHtml()+`<section class="card feature-state${role==='alert'?' feature-state-error':''}" role="${role}">
    <div class="feature-state-mark" aria-hidden="true">${role==='alert'?'!':'…'}</div>
    <div><h2>${escHtml(title)}</h2>${draw}<p>${escHtml(message)}</p>
      <button type="button" class="btn${role==='alert'?' btn-primary':''}" onclick="loadBuyPlan()">↻ ลองโหลดอีกครั้ง</button>
    </div>
  </section>`;
}

function markBuyPlanDataStale(message){
  const root=document.getElementById('bp-plan-root');
  const state=LotteryUiState.buyplan;
  if(!root||(!state.workingPlan&&root.dataset.state!=='loading'))return;
  state.sourceStale=true;
  state.loadRequestId++;
  root.setAttribute('aria-busy','false');
  if(root.dataset.state==='loading'){
    root.className='';root.dataset.state='stale';
    root.textContent='การคำนวณเริ่มก่อนอัปเดตข้อมูลและถูกยกเลิก · คำนวณแผนใหม่เพื่อใช้แคชปัจจุบัน';
  }
  const save=root.querySelector?.('.bp-save-row button');
  if(save){save.disabled=true;save.setAttribute('aria-disabled','true');save.textContent='คำนวณใหม่ก่อนบันทึก';}
  const hint=root.querySelector?.('.bp-save-hint');
  if(hint)hint.textContent='ข้อมูลย้อนหลังเปลี่ยนแล้ว · คำนวณแผนจากข้อมูลล่าสุดก่อนบันทึก';
  showCacheRefreshNotice('bp-data-refresh-notice','bp-plan-root','แผนซื้อใช้ข้อมูลก่อนรีเฟรช',
    `${message} · ฉบับที่แก้ไว้ยังอยู่ กดคำนวณใหม่เพื่ออัปเดตแหล่งเลขและค่า Edge`,'คำนวณแผนจากข้อมูลล่าสุด',()=>bpRebuildCurrentPlan());
  bpAnnounceStatus(`${message} · แผนยังไม่อัปเดต`);
}
window.markBuyPlanDataStale=markBuyPlanDataStale;

async function loadBuyPlan({force=false}={}){
  const root=document.getElementById('bp-plan-root');
  if(!root)return;
  bpReadConfig();
  const prefs=bpReadPrefs();
  bpSyncControls(prefs);
  const dateEl=document.getElementById('bp-date');
  if(dateEl&&!dateEl.options.length){
    dateEl.innerHTML=clientDraws().map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
  }
  const next=dateEl?.value||nextDrawInfo().iso;
  const currentPlan=LotteryUiState.buyplan.workingPlan;
  if(bpHasUnsavedDraft(currentPlan)){
    if(currentPlan.date===next&&!force){
      bpPaint();
      return currentPlan;
    }
    const action=currentPlan.date===next?'คำนวณชุดใหม่':'เปลี่ยนงวดเป้าหมาย';
    if(!bpConfirmDraftDiscard(action)){
      if(dateEl)dateEl.value=currentPlan.date;
      bpPaint();
      return currentPlan;
    }
  }
  LotteryUiState.buyplan.sourceStale=false;
  clearCacheRefreshNotice('bp-data-refresh-notice');
  root.className='dc-loading';
  root.textContent='กำลังจัดชุดซื้อจากสัญญาณงวดนี้...';
  bpAnnounceStatus('กำลังจัดชุดซื้อจากสัญญาณงวดนี้');
  const requestId=++LotteryUiState.buyplan.loadRequestId;
  const isStale=()=>requestId!==LotteryUiState.buyplan.loadRequestId;
  // A refresh is a new plan request. Do not leave the previous draw's editable plan or sources live.
  LotteryServerData.buyplan.sources=null;
  LotteryServerData.buyplan.history=[];
  LotteryUiState.buyplan.workingPlan=null;
  LotteryUiState.buyplan.workingPlanTouched=false;
  root.dataset.state='loading';
  root.setAttribute('aria-busy','true');
  try{
    root.className='dc-loading';
    root.textContent='กำลังจัดชุดซื้อ...';
    const [pred,hist]=await Promise.all([
      api(`predict/all?top_n=10&date=${next}&beam_width=500&k_back=100&preset=optimized`),
      api('prize-history?n=260'),
    ]);
    if(isStale())return;
    const apiFailed=!!pred?.error||pred?.ok===false||!!hist?.error||hist?.ok===false||!pred?.categories||!Array.isArray(hist?.data);
    if(apiFailed)throw new Error('Buy Plan source API returned an error or invalid payload');
    if(pred.date!==next)throw new Error('Buy Plan prediction target did not match the selected draw');
    const cats=pred.categories||{};
    const requiredCategories=['prize1','front3_1','front3_2','back3_1','back3_2','bottom2'];
    const failedCategories=requiredCategories.filter(key=>!cats[key]||cats[key].error||!Array.isArray(cats[key].numbers));
    if(pred.report_status==='partial'||failedCategories.length){
      LotteryServerData.buyplan.sources=null;
      LotteryServerData.buyplan.history=[];
      LotteryUiState.buyplan.workingPlan=null;
      LotteryUiState.buyplan.workingPlanTouched=false;
      const failedLabels=failedCategories.map(key=>cats[key]?.label||key).join(', ');
      bpLoadNotice(root,'partial','ทำนายได้ไม่ครบทุกหมวด',
        'ยังไม่สร้างแผนจากข้อมูลบางส่วน เพื่อให้แหล่งเลขและงบคำนวณจากชุดข้อมูลเดียวกัน'+(failedLabels?' · ตรวจใหม่: '+failedLabels:''),next);
      return;
    }
    const rows=(hist.data||[]).filter(Boolean);
    if(!rows.length){
      LotteryServerData.buyplan.sources=null;
      LotteryServerData.buyplan.history=[];
      LotteryUiState.buyplan.workingPlan=null;
      LotteryUiState.buyplan.workingPlanTouched=false;
      bpLoadNotice(root,'empty','ยังไม่มีผลย้อนหลังสำหรับจัดชุดซื้อ',
        'ไม่พบข้อมูลผลรางวัลย้อนหลัง จึงยังคำนวณแหล่งเลขและงบของงวดนี้ไม่ได้',next);
      return;
    }
    const formulaResults=dcComputeFormulaResults(rows,next);
    const formulaMatches=dcBuildPredictFormulaMatches(cats,formulaResults);
    const btRows=dcFormulaBacktestRows(rows,BP_EDGE_BACKTEST_WINDOW);
    const secondarySignals=dcSecondaryPrizeSignals(rows,10);
    const scored=dcBuildScoreRows({cats,formulaResults,formulaMatches,btRows,mode:'coverage',secondarySignals});
    const scoreRows=bpAttachEdgeSampleCounts(scored.all,btRows);
    const btMap=new Map((btRows||[]).map(r=>[r.name,r]));
    const recoObj=dcRecommendedNumbers(formulaResults,btMap);
    const recoNums=[];
    Object.values(recoObj).forEach(list=>(list||[]).forEach(c=>{ if(c&&c.num)recoNums.push(c.num); }));
    // ใบ-mode 6-digit sources: I/J2 pool6 candidates + prize-1 beam predictions + Mix (labeled source).
    const ticketSources=[];
    (formulaResults||[]).filter(fr=>fr.field==='pool6').forEach(fr=>{
      (fr.preds||[]).forEach(num=>ticketSources.push({num:String(num),label:fr.name,kind:'group',group:String(fr.name||'?')[0],trust:fr.trust||null}));
    });
    (cats.prize1?.numbers||[]).map(predNum).filter(Boolean).forEach(num=>ticketSources.push({num:String(num),label:'Predict ที่ 1',kind:'predict',trust:null}));
    try{ const mix=(typeof _mixCompute==='function')?_mixCompute(formulaResults):null; (mix?.preds||[]).forEach(num=>ticketSources.push({num:String(num),label:'Mix',kind:'mix',trust:null})); }catch(e){}
    LotteryServerData.buyplan.sources={scoreRows,recoNums,ticketSources:ticketSources.filter(s=>String(s.num).length===6)};
    LotteryServerData.buyplan.history=rows;
    bpRender();
  }catch(e){
    if(isStale())return;
    console.warn('loadBuyPlan failed',e);
    LotteryServerData.buyplan.sources=null;
    LotteryServerData.buyplan.history=[];
    LotteryUiState.buyplan.workingPlan=null;
    LotteryUiState.buyplan.workingPlanTouched=false;
    bpLoadNotice(root,'error','โหลดข้อมูลจัดชุดซื้อไม่สำเร็จ',
      'ตรวจการเชื่อมต่อและข้อมูลย้อนหลัง แล้วลองโหลดใหม่',next);
  }
}
window.loadBuyPlan=loadBuyPlan;

// Regenerate a fresh plan from cached sources + current prefs/config, then paint. Callers that can
// replace a manually edited draft must confirm first. No refetch. Row-level edits below mutate
// LotteryUiState.buyplan.workingPlan and call bpPaint() only.
function bpRender(){
  const root=document.getElementById('bp-plan-root');
  if(!root||!LotteryServerData.buyplan.sources)return;
  const prefs=bpReadPrefs();
  const cfg=bpReadConfig();
  const dateEl=document.getElementById('bp-date');
  let plan;
  if(prefs.mode==='ticket'){
    const prioritizeSource=LotteryUiState.buyplan.mixIntent?'Mix':undefined;
    plan=bpBuildPlan({mode:'ticket',budget:prefs.budget,risk:prefs.risk,config:cfg,ticketSources:LotteryServerData.buyplan.sources.ticketSources,prioritizeSource});
  }else{
    plan=bpBuildPlan({mode:'perNumber',budget:prefs.budget,risk:prefs.risk,config:cfg,scoreRows:LotteryServerData.buyplan.sources.scoreRows,recoNums:LotteryServerData.buyplan.sources.recoNums});
  }
  plan.date=dateEl?.value||nextDrawInfo().iso;
  LotteryUiState.buyplan.workingPlan=plan;
  LotteryUiState.buyplan.workingPlanTouched=false;
  bpPaint();
}
function bpRecomputeWorking(){
  const p=LotteryUiState.buyplan.workingPlan; if(!p)return;
  p.totalStake=p.rows.reduce((a,r)=>a+(Number(r.stake)||0),0);
  if(p.mode==='ticket'){
    p.ticketCount=p.rows.reduce((a,r)=>a+(Number(r.qty)||0),0);
    p.ev=bpComputeTicketEv(p.rows,p.config);
  }else{
    p.ev=bpComputeEv(p.rows,p.config);
  }
}
// Paint the current working plan (editable) + save button + the auto-resolved history/ledger.
function bpPaint(){
  const root=document.getElementById('bp-plan-root');
  if(!root||!LotteryUiState.buyplan.workingPlan)return;
  const plan=LotteryUiState.buyplan.workingPlan;
  const noRows=!plan.rows.length;
  const savedPlans=bpHistory();
  const historyUnreadable=!Array.isArray(savedPlans);
  const alreadySaved=!noRows&&!historyUnreadable&&bpPlanAlreadySaved(plan,savedPlans);
  const unsavedDraft=bpHasUnsavedDraft(plan,savedPlans);
  const saveDisabled=LotteryUiState.buyplan.sourceStale||noRows||alreadySaved||historyUnreadable;
  const saveLabel=LotteryUiState.buyplan.sourceStale?'คำนวณใหม่ก่อนบันทึก':historyUnreadable?'ปิดบันทึกไว้':alreadySaved?'✓ ชุดนี้บันทึกแล้ว':noRows?'เพิ่มเลขก่อนบันทึก':'💾 บันทึกชุดนี้';
  const saveHint=LotteryUiState.buyplan.sourceStale
    ?'ข้อมูลย้อนหลังเปลี่ยนแล้ว · คำนวณแผนจากข้อมูลล่าสุดก่อนบันทึก'
    :historyUnreadable
    ?'อ่านประวัติชุดซื้อไม่ได้ — ปิดการบันทึกไว้เพื่อป้องกันข้อมูลเดิมถูกเขียนทับ'
    :alreadySaved
    ?'มีชุดเลขและยอดเดียวกันบันทึกสำหรับงวดนี้แล้ว · ปรับเลขหรือยอดก่อนบันทึกชุดใหม่'
    :noRows?'เพิ่มรายการเลขก่อน แล้วจึงบันทึกชุดซื้อได้'
    :'บันทึกเองเท่านั้น — เข้าประวัติเพื่อวัดผลจริงเป็นบาท (บันทึกแล้วแก้ไม่ได้ ลบได้ทั้งชุด)';
  const body=plan.mode==='ticket'?bpEditableTicketHtml(plan):bpEditablePlanHtml(plan);
  root.className='';
  root.dataset.state='ready';root.setAttribute('aria-busy','false');
  root.innerHTML=bpConfigWarningHtml()+`<div class="bp-plan-context"><strong>งวดเป้าหมาย ${escHtml(fmtDate(plan.date))}</strong><span>ข้อมูลย้อนหลัง ${LotteryServerData.buyplan.history?.length||0} งวด · Edge Backtest สูงสุด ${BP_EDGE_BACKTEST_WINDOW} งวด</span></div>`
    +bpUnsavedDraftHtml(plan,savedPlans,unsavedDraft)
    +bpEvCardHtml(plan)
    +body
    +`<div class="bp-save-row"><button type="button" class="btn btn-primary" onclick="bpSaveCurrentPlan()"${saveDisabled?' disabled aria-disabled="true"':''}>${saveLabel}</button><span class="bp-save-hint" role="status" aria-live="polite">${saveHint}</span></div>`
    +bpHistoryLedgerHtml(savedPlans);
  bpAnnouncePlanSummary();
}
function bpUnsavedDraftHtml(plan=LotteryUiState.buyplan.workingPlan,plans=bpHistory(),knownUnsaved=null){
  if(!(knownUnsaved??bpHasUnsavedDraft(plan,plans)))return '';
  return `<section class="bp-unsaved-draft"><div class="bp-unsaved-draft-copy"><strong>แผนนี้มีการแก้ไขที่ยังไม่บันทึก</strong><span>เปลี่ยนงวด โหมด งบ หรือความเสี่ยงแล้วระบบจะถามก่อนทิ้งรายการที่แก้ไว้</span></div><button type="button" class="btn btn-secondary" onclick="bpRebuildCurrentPlan()">คำนวณชุดใหม่จากข้อมูลล่าสุด</button></section>`;
}
function bpRebuildCurrentPlan(){return loadBuyPlan({force:true});}
window.bpRebuildCurrentPlan=bpRebuildCurrentPlan;
function bpBudgetOverrunHtml(plan){
  const total=Number(plan?.totalStake),budget=Number(plan?.budget);
  if(!Number.isFinite(total)||!Number.isFinite(budget)||total<=budget)return '';
  const overrun=Math.round((total-budget)*100)/100;
  const amount=new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(overrun);
  return `<span class="bp-budget-overrun dc-status warn" role="status" aria-live="polite">เกินงบ ${amount}฿</span>`;
}
function bpBudgetRemainingHtml(plan){
  const total=Number(plan?.totalStake),budget=Number(plan?.budget);
  if(!Number.isFinite(total)||!Number.isFinite(budget)||total>=budget)return '';
  const remaining=Math.round((budget-total)*100)/100;
  if(remaining<=0)return '';
  const amount=new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(remaining);
  return `<span class="bp-budget-remaining dc-status" role="status" aria-live="polite">เหลืองบ ${amount}฿</span>`;
}
// Editable ticket cards: each 6-digit number with its เต็ม6 → ท้าย3 → ท้าย2 ladder, editable ticket
// quantity, per-card delete, source chips + ทดลอง badge, plus a hand-add-ticket form.
function bpEditableTicketHtml(plan){
  const price=plan.config.ticketPrice||80;
  if(!plan.rows.length){
    return `<div class="dash-empty">งบไม่พอซื้อสักใบ (ใบละ ${price}฿) — เพิ่มงบ หรือพิมพ์เลขเอง</div>`+bpAddTicketFormHtml();
  }
  const cards=plan.rows.map((r,i)=>{
    const chips=(r.sources||[]).map(s=>`<span class="dc-source-chip">${escHtml(s)}</span>`).join('');
    const tDots=bpGroupsForSources(r.sources).map(g=>`<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
    const tAgree=(r.sources||[]).length>1?`<span class="bp-strength">เห็นตรงกัน ${(r.sources||[]).length} แหล่ง</span>`:'';
    return `<article class="bp-ticket-card${i===0?' bp-rank1':''}">
      <div class="bp-ticket-top">
        <h3 class="bp-ticket-num">${escHtml(r.num)}</h3>
        <span class="bp-groups">${tDots}</span>${tAgree}
        ${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}
        <button class="bp-why-toggle" aria-expanded="false" aria-label="อธิบายลอตเตอรี่เลข ${escHtml(r.num)}" aria-controls="bp-tdetail-${i}" title="ทำไมใบนี้" onclick="bpToggleRow('bp-tdetail-${i}',this)">▸</button>
        <button type="button" id="bp-row-delete-${i}" class="bp-del" aria-label="ลบลอตเตอรี่เลข ${escHtml(r.num)}" title="ลบลอตเตอรี่เลข ${escHtml(r.num)}" onclick="bpDeleteRow(${i})">✕</button>
      </div>
      <div class="bp-row-detail hidden" id="bp-tdetail-${i}">${bpTicketExplainHtml(r)}</div>
      <div class="bp-ladder">
        <span class="bp-ladder-step">เต็ม 6 · <b>${escHtml(r.ladder[0])}</b></span>
        <span class="bp-ladder-arrow">→</span>
        <span class="bp-ladder-step">ท้าย 3 · <b>${escHtml(r.ladder[1])}</b></span>
        <span class="bp-ladder-arrow">→</span>
        <span class="bp-ladder-step">ท้าย 2 · <b>${escHtml(r.ladder[2])}</b></span>
      </div>
      <div class="bp-ticket-foot">
        <span class="bp-ticket-qty">จำนวนใบ <input type="number" min="0" step="1" value="${r.qty}" aria-label="จำนวนใบเลข ${escHtml(r.num)}" onchange="bpEditTicketQty(${i},this.value)"> ใบ = ${r.stake}฿</span>
        <span class="bp-ticket-src">${chips}</span>
      </div>
    </article>`;
  }).join('');
  const mixBanner=LotteryUiState.buyplan.mixIntent?`<div class="bp-mix-banner">📥 มาจากหน้า <b>ไม่รู้ซื้ออะไรดี (Mix)</b> — รวมเลขชุด Mix ไว้ในรายการใบด้านล่างแล้ว (ดูป้าย "Mix" บนใบที่ Mix โหวต)</div>`:'';
  return `<section class="bp-plan" aria-label="แผนซื้อที่คำนวณได้">
    ${mixBanner}
    <h2 class="bp-tier-head">ใบที่แนะนำ (เรียงตามเสียงสนับสนุน) <span class="dc-status">${plan.ticketCount} ใบ · ${plan.totalStake}฿</span></h2>
    <div class="bp-ticket-grid">${cards}</div>
    <div class="bp-total">รวม <b>${plan.ticketCount} ใบ = ${plan.totalStake}฿</b> จากงบ ${plan.budget}฿ (ใบละ ${price}฿) ${bpBudgetOverrunHtml(plan)}${bpBudgetRemainingHtml(plan)} · ${BP_RISK_LABELS[plan.risk]||plan.risk}</div>
    ${bpAddTicketFormHtml()}
  </section>`;
}
function bpAddTicketFormHtml(){
  return `<div class="bp-add-row">
    <label class="bp-add-label" for="bp-add-ticket-num">เลขใบ 6 หลัก:</label>
    <input id="bp-add-ticket-num" class="bp-add-num" inputmode="numeric" placeholder="เลข 6 หลัก" style="width:120px">
    <label class="bp-add-label" for="bp-add-ticket-qty">จำนวนใบ:</label>
    <input id="bp-add-ticket-qty" class="bp-add-stake" type="number" min="1" step="1" placeholder="กี่ใบ" value="1">
    <button class="btn" onclick="bpAddTicket()">+ เพิ่มใบ</button>
  </div>`;
}
function bpEditTicketQty(idx,val){
  const p=LotteryUiState.buyplan.workingPlan; if(!p||!p.rows[idx])return;
  LotteryUiState.buyplan.workingPlanTouched=true;
  const qty=Math.max(0,Math.floor(Number(val)||0));
  const price=p.config.ticketPrice||80;
  p.rows[idx].qty=qty; p.rows[idx].stake=qty*price; p.rows[idx].hand=true;
  if(qty===0)p.rows.splice(idx,1);
  bpRecomputeWorking(); bpPaint();
}
window.bpEditTicketQty=bpEditTicketQty;
function bpAddTicket(){
  const p=LotteryUiState.buyplan.workingPlan; if(!p)return;
  const num=String(document.getElementById('bp-add-ticket-num')?.value||'').trim();
  const qty=Math.max(1,Math.floor(Number(document.getElementById('bp-add-ticket-qty')?.value)||0));
  if(!/^\d{6}$/.test(num)){ if(typeof toast==='function')toast('เลขใบต้องมี 6 หลัก','error'); return; }
  LotteryUiState.buyplan.workingPlanTouched=true;
  const price=p.config.ticketPrice||80;
  p.rows.push({num,field:'ticket',tier:'ticket',qty,stake:qty*price,sources:['พิมพ์เอง'],groups:[],trust:null,ladder:[num,num.slice(-3),num.slice(-2)],hand:true});
  bpRecomputeWorking(); bpPaint();
  if(typeof toast==='function')toast('เพิ่มใบแล้ว','success');
}
window.bpAddTicket=bpAddTicket;

// Editable plan table: stake inputs, per-row delete, and a hand-add form. Row edits/deletes mark
// the row แก้เอง; deleting does NOT redistribute (the user is in control now — just re-total).
function bpEditablePlanHtml(plan){
  if(!plan.rows.length){
    return `<div class="dash-empty">งบไม่พอวางเลขแม้แต่ตัวเดียว (ขั้นต่ำ ${plan.config.minStake}฿/เลข) — เพิ่มงบ หรือเพิ่มเลขเอง</div>`+bpAddFormHtml();
  }
  const indexed=plan.rows.map((r,i)=>({r,i}));
  const tierBlock=(tierKey,label)=>{
    const items=indexed.filter(x=>x.r.tier===tierKey);
    if(!items.length)return '';
    const body=items.map(({r,i})=>{
      const dots=bpGroupsForSources(r.sources).map(g=>`<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
      const star=r.boosted?'<span class="bp-reco-star" title="เลขแนะนำ">⭐</span>':'';
      const edgeValue=typeof r.topEdge==='number'?Number(r.topEdge.toFixed(1)):null;
      const st=bpStrengthWord(edgeValue);
      const edgeTxt=edgeValue==null?'':` ${edgeValue>0?'+':edgeValue<0?'−':''}${Math.abs(edgeValue).toFixed(1)} pp`;
      const edgeSample=Number.isSafeInteger(r.topEdgeDraws)&&r.topEdgeDraws>0?` · ${r.topEdgeDraws}/${BP_EDGE_BACKTEST_WINDOW} งวด`:'';
      const edgeSampleTitle=edgeSample?` · ใช้ผลทดสอบ ${r.topEdgeDraws} จากสูงสุด ${BP_EDGE_BACKTEST_WINDOW} งวด`:'';
      return `<tr class="bp-row">
      <td class="bp-num">${escHtml(r.num)}${star}${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}
        <div class="bp-num-meta"><span class="bp-groups">${dots}</span><span class="bp-strength ${st.cls}" title="ค่าสูงสุดย้อนหลังของ Edge ชุดผู้สมัครในสูตรที่รองรับเลขนี้ ไม่ใช่โอกาสของเลขรายตัว${edgeSampleTitle}">${st.word}${edgeTxt}${edgeSample}</span></div></td>
      <td class="bp-field">${escHtml(BP_FIELD_LABELS[r.field]||r.field)}</td>
      <td class="bp-stake-edit"><input type="number" min="0" step="${plan.config.roundUnit}" value="${r.stake}" aria-label="เงินเดิมพันเลข ${escHtml(r.num)}" onchange="bpEditStake(${i},this.value)">฿</td>
      <td class="bp-row-actions"><button type="button" class="bp-why-toggle" aria-expanded="false" aria-label="อธิบายเลข ${escHtml(r.num)} และเงินที่จัดให้" aria-controls="bp-detail-${i}" title="ทำไมได้เลขนี้ เงินเท่านี้" onclick="bpToggleRow('bp-detail-${i}',this)">▸</button><button type="button" id="bp-row-delete-${i}" class="bp-del" aria-label="ลบเลข ${escHtml(r.num)} หมวด ${escHtml(BP_FIELD_LABELS[r.field]||r.field)}" title="ลบเลข ${escHtml(r.num)} หมวด ${escHtml(BP_FIELD_LABELS[r.field]||r.field)}" onclick="bpDeleteRow(${i})">✕</button></td>
    </tr>
    <tr class="bp-row-detail hidden" id="bp-detail-${i}"><td colspan="4">${bpRowExplainHtml(r,plan.config.roundUnit)}</td></tr>`;
    }).join('');
    return `<section class="bp-tier">
      <h2 class="bp-tier-head">${label} <span class="dc-status">${items.length} เลข · ${items.reduce((a,x)=>a+x.r.stake,0)}฿</span></h2>
      <div class="bp-table-scroll" tabindex="0" role="region" aria-label="ตารางรายการ ${label} เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม"><table class="bp-table"><thead><tr><th>เลข</th><th>ประเภท</th><th>เงิน</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
    </section>`;
  };
  return `<div class="bp-plan">
    ${bpEdgeSignalNoteHtml()}
    ${tierBlock('2d','เงิน 2 หลัก (2 ตัวล่าง/บน)')}
    ${tierBlock('3d','เงิน 3 หลัก (3 ตัวบน)')}
    <div class="bp-total">รวมที่จะซื้อจริง <b>${plan.totalStake}฿</b> จากงบ ${plan.budget}฿ ${bpBudgetOverrunHtml(plan)}${bpBudgetRemainingHtml(plan)} · ความเสี่ยง ${BP_RISK_LABELS[plan.risk]||plan.risk}</div>
    ${bpAddFormHtml()}
  </div>`;
}
function bpAddFormHtml(){
  return `<div class="bp-add-row">
    <label class="bp-add-label" for="bp-add-num">เลขที่ต้องการเพิ่ม:</label>
    <input id="bp-add-num" class="bp-add-num" inputmode="numeric" placeholder="เลข">
    <label class="bp-add-label" for="bp-add-type">ประเภท:</label>
    <select id="bp-add-type" class="bp-add-type">
      <option value="bottom2">2 ตัวล่าง</option>
      <option value="prize1_last2">2 ตัวบน</option>
      <option value="back3">3 ตัวบน</option>
    </select>
    <label class="bp-add-label" for="bp-add-stake">เงินเดิมพัน (฿):</label>
    <input id="bp-add-stake" class="bp-add-stake" type="number" min="0" step="10" placeholder="เงิน ฿">
    <button class="btn" onclick="bpAddRow()">+ เพิ่ม</button>
  </div>`;
}

function bpEditStake(idx,val){
  if(!LotteryUiState.buyplan.workingPlan||!LotteryUiState.buyplan.workingPlan.rows[idx])return;
  LotteryUiState.buyplan.workingPlanTouched=true;
  LotteryUiState.buyplan.workingPlan.rows[idx].stake=Math.max(0,Math.round(Number(val)||0));
  LotteryUiState.buyplan.workingPlan.rows[idx].hand=true;
  bpRecomputeWorking(); bpPaint();
}
window.bpEditStake=bpEditStake;
function bpFocusAfterDelete(index){
  const plan=LotteryUiState.buyplan.workingPlan;
  if(!plan)return;
  if(plan.rows.length){
    const nextIndex=Math.min(index,plan.rows.length-1);
    document.getElementById(`bp-row-delete-${nextIndex}`)?.focus();
    return;
  }
  document.getElementById(plan.mode==='ticket'?'bp-add-ticket-num':'bp-add-num')?.focus();
}
function bpDeleteRow(idx){
  if(!LotteryUiState.buyplan.workingPlan||!LotteryUiState.buyplan.workingPlan.rows[idx])return;
  LotteryUiState.buyplan.workingPlanTouched=true;
  LotteryUiState.buyplan.workingPlan.rows.splice(idx,1);
  bpRecomputeWorking(); bpPaint();
  bpFocusAfterDelete(idx);
}
window.bpDeleteRow=bpDeleteRow;
function bpAddRow(){
  if(!LotteryUiState.buyplan.workingPlan)return;
  const num=String(document.getElementById('bp-add-num')?.value||'').trim();
  const type=document.getElementById('bp-add-type')?.value||'bottom2';
  const stake=Math.round(Number(document.getElementById('bp-add-stake')?.value)||0);
  const width=type==='back3'?3:2;
  if(!/^\d+$/.test(num)||num.length!==width){ if(typeof toast==='function')toast(`เลข ${BP_FIELD_LABELS[type]} ต้องมี ${width} หลัก`,'error'); return; }
  if(stake<=0){ if(typeof toast==='function')toast('ใส่จำนวนเงินก่อน','error'); return; }
  LotteryUiState.buyplan.workingPlanTouched=true;
  LotteryUiState.buyplan.workingPlan.rows.push({num,field:type,len:width,tier:width===2?'2d':'3d',stake,score:0,boostedScore:0,boosted:false,topEdge:null,trust:null,source:BP_FIELD_LABELS[type],hand:true});
  bpRecomputeWorking(); bpPaint();
  if(typeof toast==='function')toast('เพิ่มเลขแล้ว','success');
}
window.bpAddRow=bpAddRow;

// Manual save — freezes mode/budget/risk/date, every row, the payout config BY VALUE, and the EV คู่
// shown right now. Immutable afterwards (ADR-0004 decision 7). Never auto-saves.
function bpSaveCurrentPlan(){
  if(LotteryUiState.buyplan.sourceStale){if(typeof toast==='function')toast('แผนนี้ใช้ข้อมูลก่อนรีเฟรช · คำนวณแผนใหม่ก่อนบันทึก','error');return false;}
  const p=LotteryUiState.buyplan.workingPlan;
  if(!p||!p.rows.length){ if(typeof toast==='function')toast('ยังไม่มีเลขให้บันทึก','error'); return; }
  const savedPlans=bpHistory();
  if(!Array.isArray(savedPlans)){
    if(typeof toast==='function')toast('อ่านประวัติชุดซื้อไม่ได้ — ปิดบันทึกไว้เพื่อป้องกันข้อมูลเดิมสูญหาย','error');
    bpPaint();
    return;
  }
  if(bpPlanAlreadySaved(p,savedPlans)){
    if(typeof toast==='function')toast('ชุดเลขและยอดนี้บันทึกไว้แล้ว — ปรับรายการก่อนบันทึกชุดใหม่','error');
    bpPaint();
    return;
  }
  const record={
    id:'bp'+Date.now(),
    savedAt:new Date().toISOString(),
    mode:p.mode, date:p.date, budget:p.budget, risk:p.risk,
    config:{...p.config},
    rows:p.rows.map(r=>{
      const base={num:r.num,field:r.field,tier:r.tier,stake:r.stake,trust:r.trust||null,hand:!!r.hand};
      // ticket rows must keep qty + ladder (qty drives baht resolution; ladder is the sold-out fallback);
      // per-number rows keep len + a human bet-type source label.
      return r.field==='ticket'
        ? {...base,qty:r.qty,ladder:r.ladder,sources:r.sources||[]}
        : {...base,len:r.len,source:r.source||BP_FIELD_LABELS[r.field]||r.field};
    }),
    ev:{theoretical:{...p.ev.theoretical},adjusted:{...p.ev.adjusted},warning:p.ev.warning},
    totalStake:p.totalStake,
  };
  if(p.mode==='ticket'){ record.ticketPrice=p.ticketPrice; record.ticketCount=p.ticketCount; }
  try{
    bpHistoryAdd(record);
  }catch(e){
    if(typeof toast==='function')toast(e?.code==='bp_history_unreadable'
      ?'อ่านประวัติชุดซื้อไม่ได้ — ไม่ได้เขียนทับข้อมูลเดิม'
      :'บันทึกชุดซื้อไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็มหรือเบราว์เซอร์ปิดกั้นการบันทึก','error');
    return;
  }
  if(typeof toast==='function')toast('บันทึกชุดซื้อแล้ว — ล็อกไม่ให้แก้','success');
  bpPaint();
}
window.bpSaveCurrentPlan=bpSaveCurrentPlan;
function bpDeletePlan(id){
  const plans=bpHistory();
  const index=Array.isArray(plans)?plans.findIndex(plan=>plan.id===id):-1;
  const deleted=deleteWithUndo(BP_HISTORY_KEY,'ลบชุดนี้แล้ว',()=>bpHistoryDelete(id),()=>bpPaint());
  if(!deleted)return false;
  bpFocusAfterHistoryDelete(index<0?0:index);
  return true;
}
window.bpDeletePlan=bpDeletePlan;
function bpFocusAfterHistoryDelete(index){
  const plans=bpHistory();
  if(Array.isArray(plans)&&plans.length){
    const nextIndex=Math.min(Math.max(0,index),plans.length-1);
    document.getElementById(`bp-history-delete-${nextIndex}`)?.focus();
    return;
  }
  document.getElementById('bp-history-heading')?.focus();
}

// History + all-time ledger, auto-resolved against the cached prize history on every paint.
function bpHistoryLedgerHtml(plans=bpHistory()){
  const head='<h2 id="bp-history-heading" class="bp-history-head" tabindex="-1">ประวัติชุดซื้อ · Ledger จริงเป็นบาท</h2>';
  if(!Array.isArray(plans)){
    const reason=LotteryUiState.buyplan.historyReadError==='malformed'
      ?'โครงสร้างข้อมูลไม่ถูกต้อง'
      :'เบราว์เซอร์ไม่อนุญาตให้อ่านข้อมูล';
    return `<div class="bp-history bp-history-error" role="alert">${head}<p><strong>อ่านประวัติชุดซื้อไม่ได้</strong> (${reason}) ข้อมูลเดิมยังอยู่และจะไม่ถูกเขียนทับ การบันทึกและลบถูกปิดไว้จนกว่าจะอ่านได้</p><div class="bp-history-actions"><button type="button" class="btn btn-secondary" onclick="bpDownloadHistoryBackup()">ดาวน์โหลดข้อมูลเดิม</button><button type="button" class="btn" onclick="bpPaint()">ลองอ่านอีกครั้ง</button></div></div>`;
  }
  if(!plans.length)return `<div class="bp-history">${head}<div class="dash-empty">ยังไม่มีชุดที่บันทึก — กด "บันทึกชุดนี้" เมื่อจะซื้อจริง เพื่อวัดว่าระบบทำเงินได้จริงไหม</div></div>`;
  const led=bpLedger(plans,LotteryServerData.buyplan.history||[]);
  const hasUnverifiable=led.items.some(item=>item.res.status==='unverifiable');
  const netCls=led.net>=0?'good':'bad';
  const sign=v=>`${v>=0?'+':'−'}${Math.abs(Math.round(v))}฿`;
  const summary=`<div class="bp-ledger-summary">
    <div class="bp-ledger-line">ซื้อ <b>${led.resolved}</b> ชุดที่รู้ผลแล้ว · จ่ายไป <b>${led.spent}฿</b> · ได้คืน <b>${led.returned}฿</b> = <span class="dc-status ${netCls}">net ${sign(led.net)}</span>${hasUnverifiable?' · ยังไม่รวมชุดที่ตรวจผลได้ไม่ครบ':''}</div>
    <div class="bp-ledger-sub">ถ้าสุ่มแทงล้วนๆ ด้วยเงินก้อนเดียวกัน คาดว่าจะได้ราว ${sign(led.randomExpectedNet)} — นี่คือคำตอบตรงๆ ว่า Edge โผล่มาเป็นเงินจริงไหม${led.pending?` · อีก ${led.pending} ชุดยังรอผล`:''}${led.unverifiable?` · ${led.unverifiable} ชุดผลตรวจไม่ครบ`:''}${hasUnverifiable?' · ชุดที่ข้อมูลผลไม่ครบไม่นับในยอดเงินจริง':''}</div>
  </div>`;
  const items=led.items.map(({plan,res,spent},idx)=>{
    const status=res.status==='pending'
      ?'<span class="dc-status warn">รอผล</span>'
      :res.status==='unverifiable'
        ?'<span class="dc-status warn">ข้อมูลผลไม่ครบ — ไม่นับ P/L</span>'
        :`<span class="dc-status ${res.net>=0?'good':'bad'}">net ${sign(res.net)}</span>`;
    const hand=plan.rows.some(r=>r.hand)?'<span class="bp-handedit">มีแก้เอง</span>':'';
    const won=res.rows.filter(r=>r.hit===true).length;
    const verifiedPayout=res.rows.reduce((sum,r)=>sum+(r.hit===true?(Number(r.returned)||0):0),0);
    const knownWin=won?` · ตรวจพบ ${won} รางวัลที่ยืนยันได้ (${sign(verifiedPayout)})`:'';
    return `<div class="bp-hist-item">
      <div class="bp-hist-meta"><b>${fmtDate(plan.date)}</b> · ${plan.rows.length} เลข · ${spent}฿ · ${BP_RISK_LABELS[plan.risk]||plan.risk} ${hand}${won?` · ถูก ${won} เลข`:''}${res.status==='unverifiable'?knownWin:''}</div>
      <div class="bp-hist-right">${status}<button type="button" id="bp-history-delete-${idx}" class="bp-del" data-bp-plan-id="${escHtml(plan.id)}" aria-label="ลบชุดซื้อวันที่ ${escHtml(fmtDate(plan.date))} จำนวน ${plan.rows.length} เลข" onclick="bpDeletePlan(this.dataset.bpPlanId)" title="ลบชุดซื้อวันที่ ${escHtml(fmtDate(plan.date))}">✕</button></div>
    </div>`;
  }).join('');
  return `<div class="bp-history">${head}${summary}<div class="bp-hist-list">${items}</div></div>`;
}
function bpDownloadHistoryBackup(){
  let raw;
  try{raw=localStorage.getItem(BP_HISTORY_KEY);}
  catch(e){if(typeof toast==='function')toast('อ่านข้อมูลสำรองไม่ได้ — ข้อมูลเดิมไม่ได้ถูกแก้','error');return false;}
  if(raw===null){if(typeof toast==='function')toast('ไม่พบประวัติที่ดาวน์โหลดได้','error');return false;}
  try{
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='lottery_buyplan_history_backup.json';
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),0);
    return true;
  }catch(e){
    if(typeof toast==='function')toast('ดาวน์โหลดข้อมูลสำรองไม่สำเร็จ — ข้อมูลเดิมยังอยู่','error');
    return false;
  }
}
window.bpDownloadHistoryBackup=bpDownloadHistoryBackup;

// Reflect the persisted prefs onto the control chrome (active states, budget field value).
function bpSyncControls(prefs,forceBudget=false){
  const bi=document.getElementById('bp-budget-input');
  const quickBudgets=[...document.querySelectorAll('.bp-budget-quick')];
  const selectedBudgetIsQuick=quickBudgets.some(button=>Number(button.dataset.amt)===Number(prefs.budget));
  if(bi&&(forceBudget||document.activeElement!==bi))bi.value=selectedBudgetIsQuick?'':prefs.budget;
  document.querySelectorAll('.bp-risk-btn').forEach(b=>{
    const on=b.dataset.risk===prefs.risk;
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',String(on));
  });
  quickBudgets.forEach(b=>{
    const on=Number(b.dataset.amt)===Number(prefs.budget);
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',String(on));
  });
  document.querySelectorAll('.bp-mode-btn').forEach(b=>{
    const on=b.dataset.mode===prefs.mode;
    b.classList.toggle('active',on);
    b.setAttribute('aria-pressed',String(on));
  });
}
function bpSetBudgetFromInput(input){
  if(!input)return false;
  if(String(input.value??'').trim()===''){
    bpSyncControls(bpReadPrefs(),true);
    return true;
  }
  return bpSetBudget(input.value);
}
window.bpSetBudgetFromInput=bpSetBudgetFromInput;
function bpSetMode(mode){
  if(mode!=='perNumber'&&mode!=='ticket')return;
  try{
    const prefs=bpReadPrefs();
    if(mode===prefs.mode){bpSyncControls(prefs);return true;}
    if(!bpConfirmDraftDiscard('เปลี่ยนโหมดซื้อ')){bpSyncControls(prefs,true);return false;}
    prefs.mode=mode; bpWritePrefs(prefs);
    if(mode!=='ticket')LotteryUiState.buyplan.mixIntent=false; // leaving ใบ mode drops the "came from Mix" hint
    bpSyncControls(prefs,true); bpRender();
    return true;
  }catch(e){
    bpSyncControls(bpReadPrefs(),true);
    if(typeof toast==='function')toast('บันทึกการตั้งค่าชุดซื้อไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม','error');
    return false;
  }
}
window.bpSetMode=bpSetMode;
// Entry point for the Mix page's "จัดชุดซื้อจากเลขชุดนี้ →" button (ISSUE-20, ADR-0004 decision 9).
// Pre-selects ลอตเตอรี่ใบ mode (where Mix is one of the 6-digit sources) and navigates. Conveys intent
// only — the Buy Plan page fetches its own data; the intent just floats Mix candidates to the top and
// shows a banner. LotteryUiState.buyplan.mixIntentPending is a one-shot consumed at the next buyplan load (onPageLoad), so
// a later plain sidebar visit doesn't inherit a stale "came from Mix" state.
function bpFromMix(){
  if(LotteryUiState.mix.sourceStale){if(typeof toast==='function')toast('ชุด Mix ใช้ข้อมูลก่อนรีเฟรช · คำนวณ Mix ใหม่ก่อนส่งต่อ','error');return false;}
  const discardDraft=bpHasUnsavedDraft();
  if(!bpConfirmDraftDiscard('จัดชุดซื้อจาก Mix'))return false;
  try{
    const prefs=bpReadPrefs(); prefs.mode='ticket'; bpWritePrefs(prefs);
  }catch(e){
    LotteryUiState.buyplan.mixIntentPending=false;
    LotteryUiState.buyplan.mixIntent=false;
    if(typeof toast==='function')toast('บันทึกการตั้งค่าชุดซื้อไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม','error');
    return false;
  }
  LotteryUiState.buyplan.mixIntentPending=true;
  if(discardDraft)LotteryUiState.buyplan.workingPlanTouched=false;
  const mixDate=document.getElementById('mix-date')?.value||'';
  const planDate=document.getElementById('bp-date');
  if(mixDate&&planDate){
    if(!planDate.options.length&&typeof clientDraws==='function'){
      planDate.innerHTML=clientDraws().map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
    }
    if(![...planDate.options].some(option=>option.value===mixDate)){
      const option=document.createElement('option');
      option.value=mixDate;
      option.textContent=typeof fmtDate==='function'?fmtDate(mixDate):mixDate;
      planDate.appendChild(option);
    }
    planDate.value=mixDate;
  }
  showPage('buyplan');
  return true;
}
window.bpFromMix=bpFromMix;
function bpSetBudget(v){
  const budget=Math.max(0,Math.floor(Number(v)||0));
  try{
    const prefs=bpReadPrefs();
    if(budget===prefs.budget){bpSyncControls(prefs,true);return true;}
    if(!bpConfirmDraftDiscard('เปลี่ยนงบ')){bpSyncControls(prefs,true);return false;}
    prefs.budget=budget; bpWritePrefs(prefs);
    bpSyncControls(prefs,true); bpRender();
    return true;
  }catch(e){
    bpSyncControls(bpReadPrefs(),true);
    if(typeof toast==='function')toast('บันทึกการตั้งค่าชุดซื้อไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม','error');
    return false;
  }
}
window.bpSetBudget=bpSetBudget;
function bpSetRisk(risk){
  if(!Object.prototype.hasOwnProperty.call(BP_RISK_LABELS,risk))return false;
  try{
    const prefs=bpReadPrefs();
    if(risk===prefs.risk){bpSyncControls(prefs);return true;}
    if(!bpConfirmDraftDiscard('เปลี่ยนระดับความเสี่ยง')){bpSyncControls(prefs,true);return false;}
    prefs.risk=risk; bpWritePrefs(prefs);
    bpSyncControls(prefs,true); bpRender();
    return true;
  }catch(e){
    bpSyncControls(bpReadPrefs(),true);
    if(typeof toast==='function')toast('บันทึกการตั้งค่าชุดซื้อไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม','error');
    return false;
  }
}
window.bpSetRisk=bpSetRisk;
function bpToggleConfig(forceOpen=false){
  const el=document.getElementById('bp-config-panel');
  const button=document.getElementById('bp-config-toggle');
  if(!el)return;
  const open=forceOpen?(el.classList.add('open'),true):el.classList.toggle('open');
  el.hidden=!open;
  if(button)button.setAttribute('aria-expanded',String(open));
  if(forceOpen)document.getElementById('bp-cfg-pay2')?.focus();
}
window.bpToggleConfig=bpToggleConfig;
function bpApplyConfigToCurrentDraft(cfg){
  const plan=LotteryUiState.buyplan.workingPlan;
  if(!plan)return false;
  const hasSources=!!LotteryServerData.buyplan.sources;
  if(!LotteryUiState.buyplan.workingPlanTouched&&hasSources)return false;
  plan.config={...cfg};
  if(plan.mode==='ticket'){
    plan.ticketPrice=cfg.ticketPrice;
    plan.rows=(plan.rows||[]).map(row=>{
      const qty=Math.max(0,Math.floor(Number(row.qty)||0));
      return {...row,qty,stake:qty*cfg.ticketPrice};
    });
  }
  bpRecomputeWorking();
  bpPaint();
  return true;
}
function bpSaveConfig(){
  const num=(id,def)=>{ const v=Number(document.getElementById(id)?.value); return Number.isInteger(v)&&v>0?v:def; };
  const cfg=bpReadConfig();
  cfg.pay2=num('bp-cfg-pay2',cfg.pay2);
  cfg.pay3=num('bp-cfg-pay3',cfg.pay3);
  cfg.minStake=num('bp-cfg-min',cfg.minStake);
  cfg.roundUnit=num('bp-cfg-round',cfg.roundUnit);
  cfg.ticketPrice=num('bp-cfg-ticket',cfg.ticketPrice);
  const inputs=['bp-cfg-pay2','bp-cfg-pay3','bp-cfg-min','bp-cfg-round','bp-cfg-ticket'];
  const invalid=inputs.some(id=>{const value=Number(document.getElementById(id)?.value);return !Number.isInteger(value)||value<=0;});
  if(invalid){ if(typeof toast==='function')toast('ค่าตั้งค่าต้องเป็นจำนวนเต็มบวก','error'); bpFillConfigInputs(); return; }
  try{
    bpWriteConfig(cfg);
  }catch(e){
    if(typeof toast==='function')toast('บันทึกการตั้งค่าเรตไม่สำเร็จ — พื้นที่จัดเก็บอาจเต็ม','error');
    return;
  }
  LotteryUiState.buyplan.configReadError=null;
  bpRenderConfigReadStatus();
  if(!bpApplyConfigToCurrentDraft(cfg))bpRender();
  if(typeof toast==='function')toast('บันทึกการตั้งค่าเรตแล้ว','success');
}
window.bpSaveConfig=bpSaveConfig;
// Populate the config panel inputs from storage when the page mounts.
function bpFillConfigInputs(){
  const cfg=bpReadConfig();
  const set=(id,v)=>{ const el=document.getElementById(id); if(el)el.value=v; };
  set('bp-cfg-pay2',cfg.pay2); set('bp-cfg-pay3',cfg.pay3);
  set('bp-cfg-min',cfg.minStake); set('bp-cfg-round',cfg.roundUnit);
  set('bp-cfg-ticket',cfg.ticketPrice);
}
window.bpFillConfigInputs=bpFillConfigInputs;


function bpConsumeMixIntent(){LotteryUiState.buyplan.mixIntent=LotteryUiState.buyplan.mixIntentPending;LotteryUiState.buyplan.mixIntentPending=false;}
