// RLL frontend contract: the batch stays pure and opt-in, the group key resolves, the Picks
// allowlist exists, and the panel/option/CSS are wired. No DOM boot, no network.
// Run with: node scripts/test_rll_frontend_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  console.log('OK: ' + label);
  passed++;
}

const sandbox = {
  console,
  document: {
    getElementById: () => ({ style: {}, innerHTML: '' }),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: () => {},
  },
  escHtml: value => String(value ?? ''),
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: () => Promise.reject(new Error('network is disabled in this test')),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);

const prev = {
  date: '01/11/2026', prize1: '423224', top3: '224', top2: '24', bottom2: '12',
  front3_1: '123', front3_2: '456', back3_1: '789', back3_2: '012',
};
const baseline = sandbox._computeFormulasBatch(prev, '2026-11-16', []);
check('batch without extraRows contains no RLL row', baseline.every(row => row.group !== 'RLL'));

const rllRow = {
  name: 'RLL · Reinforcement Learn LLM', group: 'RLL',
  preds: ['111111', '222222', '333333', '444444', '555555'],
  field: 'prize1_exact', baseline: 5, trust: 'ทดลอง',
};
const withRll = sandbox._computeFormulasBatch(prev, '2026-11-16', [], [rllRow]);
check('extraRows is appended once and the other rows are untouched',
  withRll.length === baseline.length + 1 && withRll[withRll.length - 1].group === 'RLL');
check('the batch stays synchronous (a plain array, not a promise)', Array.isArray(withRll));
check('RLL resolves to its own group, not the default A',
  sandbox._formulaGroupKey('RLL · Reinforcement Learn LLM') === 'RLL');

const decision = read('static/decision-center.js');
check('the Picks gate carries the RLL allowlist keyed on group',
  decision.includes("fr.group==='RLL'") && decision.includes('edge>0||'));
check('the allowlist is scoped to RLL only (no trust-wide bypass)',
  !decision.includes("fr.trust==='ทดลอง'&&edge>=0"));

const buyplan = read('static/buyplan-ui.js');
check('Buy Plan knows the RLL group', /RLL:\s*\['RLL · Reinforcement Learn LLM'/.test(buyplan));
check('source labels starting with Reinforcement map to RLL',
  buyplan.includes("t.startsWith('Reinforcement')") && buyplan.includes("?'RLL'"));

const html = read('static/index.html');
check('the formula tab has the RLL option', html.includes('<option value="RLL">'));
check('the formula page has the RLL panel', html.includes('id="formula-results-RLL"'));
check('the RLL description states the no-evidence and prospective limits',
  html.includes('ยังไม่มีหลักฐานว่าดีกว่าการสุ่ม') && html.includes('prospective เท่านั้น'));

const calculators = read('static/formula-calculators.js');
check('the formula run awaits /api/rll/formula', calculators.includes('rll/formula?date='));
check('the RLL card prints no edge', !/RLL[\s\S]{0,600}edge\s*[:=]/i.test(calculators));

const css = read('static/app.css');
check('the no-evidence chip is styled in both themes',
  css.includes('.rll-noevidence') && css.includes('[data-theme="dark"] .rll-noevidence'));

console.log(`PASS: ${passed} RLL frontend contract checks`);
