const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'static', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'static', 'app.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'static', 'app.js'), 'utf8');
const formula = fs.readFileSync(path.join(root, 'static', 'formula-engine.js'), 'utf8');

let checks = 0;
const failures = [];
function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}
function functionBody(source, name) {
  const start = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!start) return '';
  let i = start.index + start[0].length;
  let depth = 1;
  while (i < source.length && depth) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return depth ? '' : source.slice(start.index, i);
}
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const matches = [...uncommented.matchAll(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.at(-1)?.[1] || '';
}

check(!app.includes("label:'มั่นใจสูง'") && !app.includes("label:'น่าเฝ้า'") && !app.includes("label:'เสี่ยงสูง'"), 'prediction badges do not present heuristic scores as confidence or risk probabilities');
check(index.includes('คะแนนนี้ใช้จัดอันดับภายในชุดคำนวณ') && index.includes('ไม่ใช่ความน่าจะเป็น'), 'prediction UI explains the score limitation');

const destructiveFunctions = [
  'dcDeleteSnapshot', 'dcClearSnapshots', 'deletePageSnapshot', 'clearPageSnapshots',
  'dcDeleteSnapshotOld', 'dcClearSnapshotsOld', 'mixDeleteSnapshot', 'mixClearSnapshots',
  'bpDeletePlan',
];
for (const name of destructiveFunctions) {
  check(functionBody(app, name).includes('deleteWithUndo('), `${name} provides a one-step undo for deleted saved data`);
}
for (const name of ['dcClearSnapshots', 'clearPageSnapshots', 'dcClearSnapshotsOld', 'mixClearSnapshots']) {
  check(functionBody(app, name).includes('confirm('), `${name} confirms before clearing all saved data`);
}
check(functionBody(app, 'deleteWithUndo').includes('showUndoToast') && functionBody(app, 'deleteWithUndo').includes('localStorage.getItem'), 'undo retains and restores the exact prior localStorage value');
check(functionBody(app, 'showUndoToast').includes('aria-label') && functionBody(app, 'showUndoToast').includes("textContent='เลิกทำ'"), 'undo toast exposes a clear accessible action');

for (const selector of ['.dc-status.good', '.dc-status.warn', '.trust-badge', '.pred-pill.high', '.pred-pill.mid', '.formula-quality.good', '.formula-quality.single', '.dash-formula-edge', '.dc-score', '.dc-source-chip.formula', '.dc-lotto-formula-title', '.dc-bt-hit', '.dc-compare-strip.agree .dc-compare-mid', '.num-badge.agree', '.ftab-btn[data-color="green"].active', '.consensus-badge.strong', '.consensus-chip.type-top3 .consensus-num', '.consensus-source[data-group="H"]', '.consensus-heat', '.bp-why-warn']) {
  const block = rule(selector);
  check(block.includes('var(--green-text)') || block.includes('var(--orange-text)'), `${selector} uses theme-aware readable semantic text tokens`);
}
check(css.includes('.dc-status,.trust-badge,.pred-pill,.formula-quality,.consensus-badge,.consensus-source{font-size:.7rem;'), 'small status badges use a readable minimum type size');

check(index.includes('id="nav-scroll-control"') && functionBody(app, 'scrollSidebarNav').includes('scrollBy'), 'mobile page navigation has a visible, operable horizontal-scroll control');
check(functionBody(app, 'showPage').includes('focusPageHeading') && functionBody(app, 'focusPageHeading').includes('document.title') && functionBody(app, 'showPage').includes('syncPageLocation'), 'SPA navigation focuses the new page heading, updates its title, and syncs its URL');
check(functionBody(app, 'syncPageLocation').includes('history.pushState') && functionBody(app, 'syncPredTabLocation').includes('syncPageLocation') && functionBody(app, 'restorePageLocation').includes("window.location.hash"), 'page and subview changes support browser history and restore from the URL');
check(index.includes('<nav id="sidebar" aria-label="เมนูหลัก">') && !index.includes('class="nav" role="navigation"'), 'sidebar exposes exactly one named navigation landmark');

const tableRegions = [...index.matchAll(/<div class="tbl-wrap"[^>]*>/g)].map(m => m[0]);
check(tableRegions.length > 0 && tableRegions.every(tag => tag.includes('tabindex="0"') && tag.includes('role="region"') && tag.includes('aria-label=')), 'every static horizontally scrollable table is a named keyboard-focusable region');
const staticWrappedTables = [...index.matchAll(/<div class="tbl-wrap"[^>]*>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/g)].map(m => m[1]);
check(staticWrappedTables.length === tableRegions.length && staticWrappedTables.every(table => table.includes('<caption')), 'every static scrollable table has a programmatic caption');
check(functionBody(app, '_renderBtTable').includes('tabindex="0"') && functionBody(app, '_renderBtTable').includes('aria-label='), 'generated Backtest table is a named keyboard-focusable region');
check(functionBody(app, '_renderBtTable').includes('<caption'), 'generated Backtest table has a programmatic caption');
check(functionBody(formula, '_renderPool14Comparison').includes('tabindex="0"') && functionBody(formula, '_renderPool14Comparison').includes('aria-label='), 'generated Pool 1-4 comparison table is a named keyboard-focusable region');
check(functionBody(formula, '_renderPool14Comparison').includes('<caption'), 'generated Pool 1-4 table has a programmatic caption');

check(functionBody(formula, '_formulaError').includes("setAttribute('aria-invalid','true')") && functionBody(formula, '_formulaError').includes("setAttribute('aria-describedby'"), 'formula errors are programmatically associated with invalid controls');
check(functionBody(formula, '_validateFormulaInputs').includes('formula-input-status') && functionBody(formula, '_validateFormulaInputs').includes('.focus()'), 'formula validation announces errors and focuses the first invalid field');
check(index.includes('id="formula-input-status"') && index.includes('role="alert" aria-live="assertive"'), 'formula validation status is present and announced accessibly');

check(functionBody(app, 'loadFreq').includes('onclick="loadFreq()"') && functionBody(app, 'filterHistory').includes('onclick="loadHistory()"'), 'frequency and history error states provide direct retry buttons');
check(!index.includes('id="shared-workflow"') && !index.includes('onclick="loadPredict()"') && !index.includes('onclick="showPage(\'decision\')"'), 'Predict offers one view selector and one primary run action');
const predMainButtons = [...index.matchAll(/<button[^>]*id="pred-main-btn-[^"]+"[^>]*>/g)].map(match => match[0]);
check(index.includes('class="pred-page-tabs" role="group"') && predMainButtons.length === 4 && !index.includes('id="pred-main-btn-astra"') && /id="ftab-btn-ASTRA"[^>]*aria-pressed="false"/.test(index) && functionBody(app, 'switchPredTab').includes("setAttribute('aria-pressed'"), 'Predict exposes four synchronized subviews and Astra is an accessible Formula subview');
check(functionBody(app, 'syncPrimaryRunAction').includes("button.hidden=tab==='formula'") && functionBody(app, 'runSharedPrimaryAction').includes("_formulaActiveTab==='ASTRA'") && index.includes('id="astra-run"') && index.includes('id="astra-sigma-run"'), 'Astra has formula-local run actions without a duplicate shared action');
check(!rule('.bp-mode-btn').includes('cursor:default') && rule('.bp-mode-btn').includes('cursor:pointer') && css.includes('.bp-mode-btn:focus-visible'), 'Buy Plan mode choices look and behave like interactive buttons');
check(css.includes('min-height:44px') && css.includes('.nav-scroll-control'), 'touch controls meet the mobile target size and have clear navigation affordance');
check(rule('button,[role="button"]').includes('min-height:44px') && rule('button,[role="button"]').includes('min-width:44px'), 'button targets meet the 44px minimum touch size');
check(rule('select,input[type=text],input[type=number],input[type=search]').includes('min-height:44px'), 'form controls meet the 44px minimum touch height');
check(css.includes('scrollbar-width:thin') && css.includes('.pred-page-tabs::-webkit-scrollbar{display:block;'), 'narrow-screen prediction tabs expose a visible horizontal-scroll affordance');
check(index.includes('Beam width') && index.includes('aria-describedby="p1-beam-help"') && index.includes('Back3 Pool') && index.includes('aria-describedby="p1-kback-help"') && index.includes('id="p1-beam-help"') && index.includes('id="p1-kback-help"'), 'advanced prediction controls include linked Thai-language help');

if (failures.length) {
  console.error(`FAIL: ${failures.length}/${checks} UX fix checks`);
  failures.forEach(message => console.error(` - ${message}`));
  process.exit(1);
}
console.log(`PASS: ${checks} UX fix checks`);
