// Contract test for the formula results empty state (blank panel before the first run).
// The state exists because the panel used to render 0 characters and 0 buttons: the copy, the hook
// and the action wiring are the whole deliverable, so they are asserted here.
// Run with: node scripts/test_formula_empty_state_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  console.log('OK: ' + label);
  passed++;
}

const start = src.indexOf('function _formulaEmptyPanelHtml');
const end = src.indexOf('function switchFormulaTab');
if (start < 0 || end < 0) throw new Error('empty-state block not found in formula-engine.js');
const block = src.slice(start, end);

const sandbox = { console, document: { getElementById: () => null, addEventListener: () => {} }, Element: class {} };
vm.createContext(sandbox);
vm.runInContext(block + '\nthis.render = _formulaEmptyPanelHtml;', sandbox);

const noRun = sandbox.render('no-run');
const noMatch = sandbox.render('no-match');

// 1. structure
check('no-run hook', noRun.includes('data-formula-empty="no-run"'));
check('no-match hook', noMatch.includes('data-formula-empty="no-match"'));
check('role=status on both', noRun.includes('role="status"') && noMatch.includes('role="status"'));
check('head is a paragraph, not a heading', noRun.includes('<p class="formula-empty-head">'));

// 2. the locked copy
check('no-run head', noRun.includes('ยังไม่มีผลคำนวณ'));
check('no-run body', noRun.includes('กดปุ่มคำนวณเพื่อให้สูตรทั้งหมดทำงานในงวดที่เลือก'));
check('no-match head', noMatch.includes('กลุ่มนี้ไม่มีผลในงวดนี้'));
check('no-match body', noMatch.includes('เลือกกลุ่มอื่น หรือกดคำนวณใหม่เพื่อให้สูตรทำงานอีกครั้ง'));

// 3. the action exists only where it can do something
check('no-run has the action', noRun.includes('data-action="run-formulas"'));
check('action is a real button', /<button type="button" class="formula-empty-action"/.test(noRun));
check('action label is exactly คำนวณทุกสูตร', />คำนวณทุกสูตร<\/button>/.test(noRun));
check('no-match has no action', !noMatch.includes('data-action') && !noMatch.includes('<button'));

// 4. no English prose leaks into the visible copy
check('no english prose', !/(no results|nothing yet|run formulas)/i.test(noRun + noMatch));

// 5. the panel uses it, and the action is delegated once
check('switchFormulaTab renders the state', src.includes("_formulaEmptyPanelHtml(LotteryUiState.formula.hasRun?'no-match':'no-run')"));
check('switchFormulaTab replaces a stale state after a run', src.includes("panel.querySelector('[data-formula-empty]')"));
check('delegated click wired once', /_formulaEmptyBound\s*=\s*false/.test(src) && src.includes('_bindFormulaEmptyActions();'));
check('the action targets the real run button', /getElementById\('f-run-formulas'\)/.test(src));

// 6. app.css must have balanced comment markers. A stray `*/` inside a comment closes it early,
// leaves junk before the next selector and makes the browser drop that whole rule silently — which
// is exactly how `.formula-empty` disappeared on the first port.
const css = fs.readFileSync(path.join(ROOT, 'static', 'app.css'), 'utf8');
const opens = (css.match(/\/\*/g) || []).length;
const closes = (css.match(/\*\//g) || []).length;
check(`app.css comment markers balanced (${opens} open / ${closes} close)`, opens === closes);
check('app.css defines the empty-state rules', /\.formula-empty\{/.test(css) && /\.formula-empty-action:active\{/.test(css));

console.log('\n' + passed + ' checks passed');
