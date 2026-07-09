# จัดชุดซื้อ Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every number and every baht in the จัดชุดซื้อ plan explain itself ("ทำไมได้เลขนี้ เงินเท่านี้") via an inline summary + expandable detail, in both modes.

**Architecture:** Purely additive. The reasoning already exists in `dcBuildScoreRows` output (`reasons`/`sources`/`warnings`) but is dropped by `bpBuildPlan`'s `mk()`; the allocation math is computed then discarded by `bpAllocateTier`. This plan threads those through onto each plan row, adds two pure render helpers + two tiny pure data helpers, and wires an expand toggle into the two editable renderers. No scoring, allocation, EV, resolution, or ledger logic changes — stakes stay byte-for-byte identical (guarded by the untouched existing assertions).

**Tech Stack:** Vanilla ES (no framework/build), `static/app.js` + `static/app.css`, Node `vm`-sandbox tests under `scripts/` run with `node scripts/<file>.js` (custom `check()` harness, no test runner).

## Global Constraints

- Governing docs: `PRD-buy-plan-explainability.md`, `docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md`, ADR-0003 (ทดลอง badge semantics).
- **Do NOT change** scoring, allocation math, boost factor, EV formulas, resolution, or ledger. Existing test assertions on stakes/tier sums/drops/remainder MUST stay green unchanged.
- Every static asset is loaded with a `?v=...` cache-bust in `static/index.html`. Bump it (currently `buyplan4`) on ANY edit to a static file, or the browser serves stale cached files (project hard rule — CLAUDE.md).
- All lottery numbers are strings — never parse as int (loses leading zeros).
- Palette: macOS-dark CSS variables in `static/app.css` (`--bg`,`--surface`,`--gold`,`--accent`,`--text3`). Reuse existing `.trust-badge`/`.bp-handedit`/`.dc-source-chip` styles rather than reinventing.
- Strength-word thresholds (single source of truth = `bpStrengthWord`): `topEdge ≥ +1.0 → หนุนแรง`, `0 < topEdge < 1.0 → หนุนกลาง`, `topEdge ≤ 0 or null → หนุนเบา`.
- Run the full JS suite before declaring done: each `scripts/test_*.js` via `node scripts/<file>.js` must print `OK: N checks passed`.

---

### Task 1: Data plumbing + pure helpers

**Files:**
- Modify: `static/app.js` — `mk()` inside `bpBuildPlan` (~2924-2933), `bpAllocateTier` final return (~2772-2773), and add helpers after `BP_FIELD_LABELS` (~2953).
- Test: `scripts/test_buyplan_build.js` (append a new section).

**Interfaces:**
- Consumes: existing `dcBuildScoreRows` row shape (`{num,score,topEdge,trust,sources[],reasons[],warnings[],formulaCount,predictCount}`) and existing `bpBuildPlan` input.
- Produces:
  - Plan rows (แทงรายเลข) additionally carry: `reasons: string[]`, `sources: string[]`, `warnings: string[]`, `formulaCount: number`, `predictCount: number`, and `reason: {score:number, boostedScore:number, boostApplied:boolean, tierTotal:number, share:number, rawStake:number, roundedStake:number, finalStake:number, gotRemainder:boolean}`.
  - `bpGroupsForSources(sources: string[]) → Array<{letter:string,label:string,color:string}>` — distinct formula groups, Codex `X*`→`F`, non-group sources excluded.
  - `bpStrengthWord(topEdge: number|null) → {word:string, cls:string}`.
  - `BP_GROUP_MAP` — group-letter → `[label,color]`, a mirror of formula-engine's local `_GRP`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test_buyplan_build.js` immediately before the final `console.log(...)` line:

```javascript
// ── 9. explainability data (PRD-buy-plan-explainability) ─────────────────────────
const { bpGroupsForSources, bpStrengthWord } = sandbox;
['bpGroupsForSources', 'bpStrengthWord'].forEach(n => {
  if (typeof sandbox[n] !== 'function') throw new Error('FAIL: ' + n + ' not loaded from app.js');
});
const richRows = [
  { num: '45', type: '2 หลัก', score: 82, topEdge: 2.1, trust: null,
    sources: ['C1 พิชิตโชค', 'G แม่นขั้นเทพ', 'I1 จักรพรรดิ', 'Predict 2 ตัวล่าง'],
    reasons: ['สูตร C ให้เลขนี้', 'สูตร G สนับสนุน (backtest edge +2.1%)'], warnings: [], formulaCount: 3, predictCount: 1 },
  { num: '12', type: '2 หลัก', score: 40, topEdge: 0.4, trust: null,
    sources: ['C1 พิชิตโชค'], reasons: ['สูตร C สนับสนุน'], warnings: ['ไม่มีแรงหนุนจาก Predict'], formulaCount: 1, predictCount: 0 },
];
const pRich = bpBuildPlan({ mode: 'perNumber', budget: 500, risk: 'safe', config: CFG, scoreRows: richRows, recoNums: ['45'] });
const r45 = pRich.rows.find(r => r.num === '45');
const t2rich = pRich.rows.filter(r => r.tier === '2d');
check('row carries reasons array through from the score row', Array.isArray(r45.reasons) && r45.reasons.length === 2);
check('row carries sources array through', Array.isArray(r45.sources) && r45.sources.includes('G แม่นขั้นเทพ'));
check('row carries warnings array through', Array.isArray(pRich.rows.find(r => r.num === '12').warnings));
check('row carries a money-trace reason object', r45.reason && typeof r45.reason.share === 'number' && typeof r45.reason.tierTotal === 'number');
check('rank-1 row of a tier is flagged gotRemainder when a remainder exists', t2rich[0].reason.gotRemainder === true);
check('non-rank-1 rows are not flagged gotRemainder', t2rich.slice(1).every(r => r.reason.gotRemainder === false));
check('boosted (เลขแนะนำ) row records boostApplied=true', r45.reason.boostApplied === true);
check('reason.finalStake equals the row stake', t2rich.every(r => r.reason.finalStake === r.stake));
// group dots
const g45 = bpGroupsForSources(r45.sources);
check('bpGroupsForSources returns distinct formula groups only (C,G,I — Predict excluded)',
  g45.length === 3 && g45.map(x => x.letter).sort().join('') === 'CGI');
check('bpGroupsForSources de-dupes repeated group letters', bpGroupsForSources(['C1', 'C2 พิชิตโชค', 'C3']).length === 1);
check('Codex X* source maps to the F group', bpGroupsForSources(['X5 Pattern Link'])[0].label.startsWith('F'));
check('non-formula sources yield no group dots', bpGroupsForSources(['Predict หน้า 3', 'รางวัลรอง 10 งวด', 'พิมพ์เอง']).length === 0);
// strength words
check('strong edge (≥1.0) → หนุนแรง', bpStrengthWord(2.1).word === 'หนุนแรง');
check('mid edge (0<e<1) → หนุนกลาง', bpStrengthWord(0.4).word === 'หนุนกลาง');
check('zero/negative/null edge → หนุนเบา',
  bpStrengthWord(0).word === 'หนุนเบา' && bpStrengthWord(-1).word === 'หนุนเบา' && bpStrengthWord(null).word === 'หนุนเบา');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test_buyplan_build.js`
Expected: throws `FAIL: bpGroupsForSources not loaded from app.js` (helpers don't exist yet).

- [ ] **Step 3: Add the two pure helpers + group map**

In `static/app.js`, immediately after the `const BP_FIELD_LABELS=...` line (~2953), insert:

```javascript
// Mirror of formula-engine.js's function-local _GRP (group letter → [label,color]); Codex X* → F.
// Kept in sync manually — groups A–J are stable. Change both if a new group is added.
const BP_GROUP_MAP = {
  A: ['A · กูชอบ', 'var(--gold)'], B: ['B · ลอตโตพลัส', '#4d9de0'], C: ['C · พิชิตโชค', '#a855f7'],
  D: ['D · Claude', '#22d3ee'], X: ['F · Codex', '#a3e635'], G: ['G · แม่นขั้นเทพ', '#f05454'],
  H: ['H · มิสเตอร์ซี', '#f59e0b'], E: ['E · สายมู', '#ec4899'], I: ['I · จักรพรรดิ', '#c084fc'],
  J: ['J · เจ้าสัว', '#10b981'],
};
// Distinct top-level formula groups backing a number, derived from its source labels (name[0],
// Codex X→F). Non-formula sources (Predict/รางวัลรอง/พิมพ์เอง) have no group letter → excluded.
function bpGroupsForSources(sources){
  const seen = new Map();
  (sources || []).forEach(s => {
    const letter = String(s || '').trim()[0];
    if (!letter || !BP_GROUP_MAP[letter] || seen.has(letter)) return;
    seen.set(letter, { letter, label: BP_GROUP_MAP[letter][0], color: BP_GROUP_MAP[letter][1] });
  });
  return [...seen.values()];
}
// Plain-Thai confidence word from a number's best supporting Edge (percentage points).
function bpStrengthWord(topEdge){
  const e = typeof topEdge === 'number' ? topEdge : null;
  if (e == null || e <= 0) return { word: 'หนุนเบา', cls: 'bp-str-weak' };
  if (e >= 1) return { word: 'หนุนแรง', cls: 'bp-str-strong' };
  return { word: 'หนุนกลาง', cls: 'bp-str-mid' };
}
```

- [ ] **Step 4: Thread reasons/sources through `mk()`**

In `static/app.js`, `bpBuildPlan`'s `mk()` (~2929-2931), replace the returned object:

```javascript
      return {num:String(r.num),field,len,tier:len===2?'2d':'3d',score,
        topEdge:(typeof r.topEdge==='number'?r.topEdge:null),trust:r.trust||null,
        source:field==='bottom2'?'2 ตัวล่าง':'3 ตัวบน',boosted,boostedScore:score*(boosted?1.5:1)};
```

with:

```javascript
      return {num:String(r.num),field,len,tier:len===2?'2d':'3d',score,
        topEdge:(typeof r.topEdge==='number'?r.topEdge:null),trust:r.trust||null,
        source:field==='bottom2'?'2 ตัวล่าง':'3 ตัวบน',boosted,boostedScore:score*(boosted?1.5:1),
        reasons:Array.isArray(r.reasons)?r.reasons.slice():[],
        sources:Array.isArray(r.sources)?r.sources.slice():[],
        warnings:Array.isArray(r.warnings)?r.warnings.slice():[],
        formulaCount:Number(r.formulaCount)||0,predictCount:Number(r.predictCount)||0};
```

- [ ] **Step 5: Attach the money-trace `reason` in `bpAllocateTier`**

In `static/app.js`, `bpAllocateTier` (~2772-2773), replace:

```javascript
    stakes[0]+=tierBudget-stakes.reduce((a,b)=>a+b,0);
    return work.map((r,i)=>({...r,stake:stakes[i]}));
```

with:

```javascript
    const rawStakes=stakes.slice();
    stakes[0]+=tierBudget-stakes.reduce((a,b)=>a+b,0);
    return work.map((r,i)=>({...r,stake:stakes[i],reason:{
      score:r.score,boostedScore:r.boostedScore,boostApplied:!!r.boosted,
      tierTotal:total,share:total>0?r.boostedScore/total:1/work.length,
      rawStake:rawStakes[i],roundedStake:rawStakes[i],finalStake:stakes[i],
      gotRemainder:i===0&&stakes[i]>rawStakes[i]}}));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node scripts/test_buyplan_build.js`
Expected: `OK: N checks passed` (N = old count + 15). All prior assertions still pass (stakes unchanged).

- [ ] **Step 7: Commit**

```bash
git add static/app.js scripts/test_buyplan_build.js
git commit -m "feat(buyplan): thread reasons + money-trace onto plan rows; add group/strength helpers"
```

---

### Task 2: แทงรายเลข inline+expand render

**Files:**
- Modify: `static/app.js` — add `bpRowExplainHtml`/`bpToggleRow`, edit `bpEditablePlanHtml` row template (~3265-3270).
- Modify: `static/app.css` — add explainability styles.
- Test: `scripts/test_buyplan_build.js` (append section 10).

**Interfaces:**
- Consumes: Task 1's `bpGroupsForSources`, `bpStrengthWord`, and the row `reasons`/`reason`/`sources`/`warnings` fields.
- Produces: `bpRowExplainHtml(row, roundUnit) → string` (the expand body); `bpToggleRow(id, btn)` (window-exported DOM toggle); collapsed rows now render `.bp-group-dot`/`.bp-strength`/`.bp-reco-star` and a `.bp-why-toggle` button paired with a hidden `<tr class="bp-row-detail hidden" id="bp-detail-N">`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test_buyplan_build.js` before the final `console.log`:

```javascript
// ── 10. แทงรายเลข explain rendering ───────────────────────────────────────────────
const { bpRowExplainHtml, bpEditablePlanHtml } = sandbox;
['bpRowExplainHtml', 'bpEditablePlanHtml'].forEach(n => {
  if (typeof sandbox[n] !== 'function') throw new Error('FAIL: ' + n + ' not loaded from app.js');
});
const exHtml = bpRowExplainHtml(r45, 10);
check('explain body lists each recorded reason', exHtml.includes('สูตร C ให้เลขนี้') && exHtml.includes('สูตร G สนับสนุน'));
check('explain body shows the money chain with คะแนน and สัดส่วน', exHtml.includes('คะแนน') && exHtml.includes('สัดส่วน'));
check('explain body shows the ×1.5 เลขแนะนำ step for a boosted row', exHtml.includes('×1.5'));
check('explain body shows a group dot for a backing group', exHtml.includes('bp-group-dot'));
const warnHtml = bpRowExplainHtml(pRich.rows.find(r => r.num === '12'), 10);
check('a row with a warning surfaces it in the explain body', warnHtml.includes('ไม่มีแรงหนุนจาก Predict'));
const handRow = { ...r45, hand: true };
check('a hand-edited row shows the แก้เอง note instead of the system money math', bpRowExplainHtml(handRow, 10).includes('แก้เอง'));
const planHtml = bpEditablePlanHtml(pRich);
check('editable plan renders a ⭐ on the เลขแนะนำ row', planHtml.includes('bp-reco-star'));
check('editable plan renders the strength word', /หนุน(แรง|กลาง|เบา)/.test(planHtml));
check('editable plan renders a why-toggle and a hidden detail row', planHtml.includes('bp-why-toggle') && planHtml.includes('bp-row-detail'));
check('editable plan detail row carries the matching id', planHtml.includes('id="bp-detail-'));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test_buyplan_build.js`
Expected: throws `FAIL: bpRowExplainHtml not loaded from app.js`.

- [ ] **Step 3: Add `bpRowExplainHtml` + `bpToggleRow`**

In `static/app.js`, immediately after `bpStrengthWord` (added in Task 1), insert:

```javascript
// The expand body for one แทงรายเลข row: why the number (reasons + group dots + warnings) and
// why the money (score → share → boost → rounding → baht). Hand-edited rows show a neutral note.
function bpRowExplainHtml(row, roundUnit){
  const dots = bpGroupsForSources(row.sources)
    .map(g => `<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
  const reasons = (row.reasons || []).map(x => `<li>${escHtml(x)}</li>`).join('')
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
      <div class="bp-why-groups">${dots}</div><ul class="bp-why-reasons">${reasons}</ul>${warns}</div>
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
```

- [ ] **Step 4: Wire the collapsed extras + detail row into `bpEditablePlanHtml`**

In `static/app.js`, inside `bpEditablePlanHtml`'s `tierBlock`, replace the `body` mapping (~3265-3270):

```javascript
    const body=items.map(({r,i})=>`<tr class="bp-row">
      <td class="bp-num">${escHtml(r.num)}${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}</td>
      <td class="bp-field">${escHtml(BP_FIELD_LABELS[r.field]||r.field)}</td>
      <td class="bp-stake-edit"><input type="number" min="0" step="${plan.config.roundUnit}" value="${r.stake}" aria-label="เงินเดิมพันเลข ${escHtml(r.num)}" onchange="bpEditStake(${i},this.value)">฿</td>
      <td><button class="bp-del" title="ลบเลขนี้ (เจ้ามืออั้น/ไม่เอา)" onclick="bpDeleteRow(${i})">✕</button></td>
    </tr>`).join('');
```

with:

```javascript
    const body=items.map(({r,i})=>{
      const dots=bpGroupsForSources(r.sources).map(g=>`<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
      const star=r.boosted?'<span class="bp-reco-star" title="เลขแนะนำ">⭐</span>':'';
      const st=bpStrengthWord(r.topEdge);
      const edgeTxt=typeof r.topEdge==='number'?` ${r.topEdge>=0?'+':'−'}${Math.abs(r.topEdge).toFixed(1)}%`:'';
      return `<tr class="bp-row">
      <td class="bp-num">${escHtml(r.num)}${star}${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}
        <div class="bp-num-meta"><span class="bp-groups">${dots}</span><span class="bp-strength ${st.cls}">${st.word}${edgeTxt}</span></div></td>
      <td class="bp-field">${escHtml(BP_FIELD_LABELS[r.field]||r.field)}</td>
      <td class="bp-stake-edit"><input type="number" min="0" step="${plan.config.roundUnit}" value="${r.stake}" aria-label="เงินเดิมพันเลข ${escHtml(r.num)}" onchange="bpEditStake(${i},this.value)">฿</td>
      <td class="bp-row-actions"><button class="bp-why-toggle" aria-expanded="false" title="ทำไมได้เลขนี้ เงินเท่านี้" onclick="bpToggleRow('bp-detail-${i}',this)">▸</button><button class="bp-del" title="ลบเลขนี้ (เจ้ามืออั้น/ไม่เอา)" onclick="bpDeleteRow(${i})">✕</button></td>
    </tr>
    <tr class="bp-row-detail hidden" id="bp-detail-${i}"><td colspan="4">${bpRowExplainHtml(r,plan.config.roundUnit)}</td></tr>`;
    }).join('');
```

- [ ] **Step 5: Add CSS**

In `static/app.css`, append near the end (in/after the buy-plan skin block):

```css
/* จัดชุดซื้อ explainability */
.bp-num-meta{display:flex;align-items:center;gap:6px;margin-top:3px}
.bp-groups{display:inline-flex;gap:3px}
.bp-group-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.bp-reco-star{font-size:.8em;margin-left:3px}
.bp-strength{font-size:.72rem;color:var(--text3)}
.bp-strength.bp-str-strong{color:#34d399}
.bp-strength.bp-str-mid{color:var(--accent)}
.bp-row-actions{white-space:nowrap;display:flex;gap:4px;justify-content:flex-end}
.bp-why-toggle{background:none;border:1px solid var(--surface2,#2a2a2e);color:var(--text2,#aaa);border-radius:6px;cursor:pointer;padding:1px 7px;font-size:.85rem}
.bp-why-toggle:hover{color:var(--text);border-color:var(--accent)}
.bp-row-detail.hidden{display:none}
.bp-row-detail>td{background:rgba(255,255,255,.02);padding:10px 14px}
.bp-why{display:flex;flex-wrap:wrap;gap:18px}
.bp-why-block{flex:1;min-width:220px}
.bp-why-h{font-size:.72rem;letter-spacing:.04em;color:var(--text3);text-transform:uppercase;margin-bottom:5px}
.bp-why-groups{display:flex;gap:4px;margin-bottom:5px}
.bp-why-reasons{margin:0;padding-left:18px;font-size:.85rem;color:var(--text2,#ccc);line-height:1.55}
.bp-why-none{list-style:none;margin-left:-18px;color:var(--text3);font-style:italic}
.bp-why-warn{color:#fbbf24;font-size:.82rem;margin-top:4px}
.bp-why-money{font-size:.88rem;color:var(--text2,#ccc);line-height:1.6}
.bp-why-money b{color:var(--text)}
.bp-why-rem{color:var(--gold)}
.bp-why-hand{font-size:.85rem;color:var(--text3);font-style:italic}
.bp-why-agree{font-size:.85rem;color:var(--text2,#ccc)}
.bp-why-ladder{font-size:.85rem;color:var(--text2,#ccc)}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node scripts/test_buyplan_build.js`
Expected: `OK: N checks passed` (10 new checks added).

- [ ] **Step 7: Commit**

```bash
git add static/app.js static/app.css scripts/test_buyplan_build.js
git commit -m "feat(buyplan): inline group dots/strength + expandable why for แทงรายเลข rows"
```

---

### Task 3: ลอตเตอรี่ใบ inline+expand render

**Files:**
- Modify: `static/app.js` — add `bpTicketExplainHtml`, edit `bpEditableTicketHtml` card template (~3196-3216).
- Test: `scripts/test_buyplan_ticket.js` (append a section). *(If this file has no `sandbox` export of `bpEditableTicketHtml`, add it to the destructure like Task 1/2 did.)*

**Interfaces:**
- Consumes: Task 1's `bpGroupsForSources`; ticket row fields already present (`sources[]`, `groups[]`, `trust`, `ladder[3]`); Task 2's `bpToggleRow`.
- Produces: `bpTicketExplainHtml(row) → string`; ticket cards render group dots + an agreement pill in `.bp-ticket-top` and a `.bp-why-toggle` paired with a hidden `<div class="bp-row-detail hidden" id="bp-tdetail-N">`.

- [ ] **Step 1: Write the failing tests**

Open `scripts/test_buyplan_ticket.js`, ensure `bpEditableTicketHtml` and `bpTicketExplainHtml` are pulled from `sandbox` (add them to the existing destructure/guard list), then append before its final `console.log`:

```javascript
// ── ticket explainability (PRD-buy-plan-explainability) ──────────────────────────
const tSources = [
  { num: '123456', label: 'I1', kind: 'group', group: 'I · จักรพรรดิ', trust: null },
  { num: '123456', label: 'Mix', kind: 'mix' },
  { num: '778899', label: 'beam', kind: 'predict' },
];
const CFGT = { pay2: 95, pay3: 950, minStake: 20, roundUnit: 10, tierCap: 10, ticketPrice: 80 };
const pT = bpBuildPlan({ mode: 'ticket', budget: 240, risk: 'safe', config: CFGT, ticketSources: tSources });
const tRow = pT.rows.find(r => r.num === '123456');
const tEx = bpTicketExplainHtml(tRow);
check('ticket explain shows the agreement count (2 แหล่ง for 123456)', tEx.includes('2') && tEx.includes('แหล่ง'));
check('ticket explain lists the sources', tEx.includes('I1') && tEx.includes('Mix'));
check('ticket explain shows the fallback ladder', tEx.includes('เต็ม 6') && tEx.includes('ท้าย 2'));
check('ticket explain shows a group dot for group I', tEx.includes('bp-group-dot'));
const ticketHtml = bpEditableTicketHtml(pT);
check('ticket card renders a why-toggle', ticketHtml.includes('bp-why-toggle'));
check('ticket card renders a hidden detail block with matching id', ticketHtml.includes('id="bp-tdetail-'));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test_buyplan_ticket.js`
Expected: throws `FAIL: bpTicketExplainHtml not loaded` (or a ReferenceError on the destructure).

- [ ] **Step 3: Add `bpTicketExplainHtml`**

In `static/app.js`, immediately after `bpToggleRow` (Task 2), insert:

```javascript
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
```

- [ ] **Step 4: Wire the toggle + agreement pill into `bpEditableTicketHtml`**

In `static/app.js`, `bpEditableTicketHtml`'s card map (~3196-3216), replace the `return \`<div class="bp-ticket-card...`` template with one that (a) adds dots + agreement to `.bp-ticket-top`, and (b) appends a toggle button and hidden detail block. Replace the card's return template:

```javascript
    return `<div class="bp-ticket-card${i===0?' bp-rank1':''}">
      <div class="bp-ticket-top">
        <span class="bp-ticket-num">${escHtml(r.num)}</span>
        ${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}
        <button class="bp-del" title="ลบใบนี้" onclick="bpDeleteRow(${i})">✕</button>
      </div>
```

with:

```javascript
    const tDots=bpGroupsForSources(r.sources).map(g=>`<span class="bp-group-dot" style="background:${g.color}" title="${escHtml(g.label)}"></span>`).join('');
    const tAgree=(r.sources||[]).length>1?`<span class="bp-strength">เห็นตรงกัน ${(r.sources||[]).length} แหล่ง</span>`:'';
    return `<div class="bp-ticket-card${i===0?' bp-rank1':''}">
      <div class="bp-ticket-top">
        <span class="bp-ticket-num">${escHtml(r.num)}</span>
        <span class="bp-groups">${tDots}</span>${tAgree}
        ${dcTrustBadge(r.trust)}${r.hand?'<span class="bp-handedit">แก้เอง</span>':''}
        <button class="bp-why-toggle" aria-expanded="false" title="ทำไมใบนี้" onclick="bpToggleRow('bp-tdetail-${i}',this)">▸</button>
        <button class="bp-del" title="ลบใบนี้" onclick="bpDeleteRow(${i})">✕</button>
      </div>
      <div class="bp-row-detail hidden" id="bp-tdetail-${i}">${bpTicketExplainHtml(r)}</div>
```

*(Leave the rest of the card — `.bp-ladder`, `.bp-ticket-foot` — unchanged; the two inserted lines `const tDots.../const tAgree...` go just before the `return` inside the `.map((r,i)=>{...})`.)*

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/test_buyplan_ticket.js`
Expected: `OK: N checks passed` (6 new checks).

- [ ] **Step 6: Commit**

```bash
git add static/app.js scripts/test_buyplan_ticket.js
git commit -m "feat(buyplan): agreement + ladder why-expand for ลอตเตอรี่ใบ tickets"
```

---

### Task 4: Cache-bust, docs, full-suite + browser verification

**Files:**
- Modify: `static/index.html` (3 `?v=` refs), `CLAUDE.md` (Buy Plan section), `CHANGELOG.md`, `CONTEXT.md` (glossary note).

**Interfaces:** none (release/docs task).

- [ ] **Step 1: Bump the cache-bust token**

In `static/index.html`, change all three `?v=buyplan4` → `?v=buyplan5` (the `app.css`, `formula-engine.js`, and `app.js` `<link>`/`<script>` tags — lines ~10, ~600, ~601).

- [ ] **Step 2: Run the full JS test suite**

Run each test file:
```bash
for f in scripts/test_*.js; do echo "== $f =="; node "$f" || exit 1; done
```
Expected: every file prints `OK: N checks passed`, no `FAIL:`. (On Windows PowerShell: `Get-ChildItem scripts/test_*.js | ForEach-Object { node $_.FullName }`.)

- [ ] **Step 3: Browser verification**

Start the app (`.claude/launch.json` config, port 8509) and open จัดชุดซื้อ. Confirm, capturing a screenshot as proof:
- แทงรายเลข: each row shows group dots + strength word (+ Edge %), เลขแนะนำ rows show ⭐, `▸` expands to reasons + the `คะแนน → สัดส่วน → ×1.5 → ปัด` chain, rank-1 row shows `+เศษที่เหลือของกอง`, a hand-edited row (change a stake) shows the แก้เอง note.
- ลอตเตอรี่ใบ: cards show dots + "เห็นตรงกัน N แหล่ง", `▸` expands to the agreement sentence + ladder, ทดลอง badge still present on J2 rows.
- ทดลอง badge, EV คู่ card, save/ledger all unchanged.

- [ ] **Step 4: Update docs**

- `CLAUDE.md` จัดชุดซื้อ section: add a sentence that each plan row is now self-explaining (group dots + หนุนแรง/กลาง/เบา + expandable "ทำไมได้เลขนี้ เงินเท่านี้"), reasons sourced from `dcBuildScoreRows`, money-trace from `bpAllocateTier` — display-only, no allocation change. Reference `PRD-buy-plan-explainability.md`.
- `CHANGELOG.md`: add an entry under the current phase describing the explainability layer.
- `CONTEXT.md`: add a one-line glossary note for the หนุนแรง/กลาง/เบา strength word (derived from a number's best supporting backtest Edge; display-only).

- [ ] **Step 5: Commit**

```bash
git add static/index.html CLAUDE.md CHANGELOG.md CONTEXT.md
git commit -m "docs(buyplan): explainability changelog/context + bump cache-bust to buyplan5"
```

---

## Self-Review

**Spec coverage:** PRD stories 1-3 (group dots / strength word / ⭐) → Task 2 Steps 4-5; story 4 (reasons list) → Tasks 1+2; stories 5-6 (money chain + remainder) → Task 1 Step 5 + Task 2 Step 3; story 7 (warnings) → Task 1 + Task 2 test; story 8 (ticket parity) → Task 3; story 9 (แก้เอง note) → Task 2 Step 3 (`bpRowExplainHtml` hand branch); story 10 (collapsed default) → `.bp-row-detail.hidden` + `<details>`-free toggle. PRD "Technical Design → Data/Render/Testing" all mapped. Non-goals respected (no scoring/EV/ledger edits anywhere).

**Placeholder scan:** none — every code step shows complete code; no TBD/TODO.

**Type consistency:** `bpGroupsForSources`→`{letter,label,color}` used identically in Tasks 2 & 3; `reason` object keys (`score/share/boostApplied/gotRemainder/finalStake`) defined in Task 1 Step 5 and consumed verbatim in Task 2 Step 3 tests + `bpRowExplainHtml`; `bpToggleRow(id, btn)` signature identical at both call sites (`'bp-detail-N'`, `'bp-tdetail-N'`). Cache token `buyplan4→buyplan5` consistent.
