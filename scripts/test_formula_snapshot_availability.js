const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'formula-engine.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'm').exec(source);
  assert(match, `missing function ${name}`);
  let i = match.index + match[0].length, depth = 1;
  while (i < source.length && depth) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unterminated function ${name}`);
  return source.slice(match.index, i);
}

const button = { disabled: false, title: '' };
const hint = { textContent: '' };
const state = { activeTab: 'A', autoFillPending: false, hasRun: false };
let candidates = [];
const sandbox = {
  LotteryUiState: { formula: state },
  window: { _formulaCalculationPending: false },
  document: {
    getElementById: id => id === 'f-save-snapshot' ? button : id === 'formula-snapshot-help' ? hint : null,
    querySelectorAll: () => candidates,
  },
};
vm.createContext(sandbox);
vm.runInContext(extractFunction('syncFormulaSnapshotButton'), sandbox);

assert.equal(sandbox.syncFormulaSnapshotButton(), false);
assert.equal(button.disabled, true);
assert.match(button.title, /คำนวณสูตรก่อน/);

state.hasRun = true;
candidates = [{ textContent: '12' }];
state.autoFillPending = true;
sandbox.syncFormulaSnapshotButton();
assert.equal(button.disabled, true, 'snapshot stays unavailable while reference data loads');
assert.match(hint.textContent, /กำลังโหลด/);

state.autoFillPending = false;
sandbox.window._formulaCalculationPending = true;
sandbox.syncFormulaSnapshotButton();
assert.equal(button.disabled, true, 'snapshot stays unavailable while formulas calculate');
assert.match(hint.textContent, /กำลังคำนวณ/);

sandbox.window._formulaCalculationPending = false;
state.hasRun = false;
sandbox.syncFormulaSnapshotButton();
assert.equal(button.disabled, true, 'an interrupted or cleared run cannot be saved');

state.hasRun = true;
candidates = [];
sandbox.syncFormulaSnapshotButton();
assert.equal(button.disabled, true, 'a completed but empty view cannot be saved');
assert.match(hint.textContent, /ยังไม่มีเลข/);

candidates = [{ textContent: ' 0012 ' }];
assert.equal(sandbox.syncFormulaSnapshotButton(), true);
assert.equal(button.disabled, false, 'a valid current standard candidate enables saving');
assert.match(hint.textContent, /ประวัติ Snapshot/);

state.activeTab = 'FANO';
candidates = [{ textContent: '12345' }];
sandbox.syncFormulaSnapshotButton();
assert.equal(button.disabled, true, 'Fano requires six-digit candidates');
candidates = [{ textContent: '000123' }];
assert.equal(sandbox.syncFormulaSnapshotButton(), true);

state.activeTab = 'FANO';
candidates = [{ textContent: '00012' }];
assert.equal(sandbox.syncFormulaSnapshotButton(), false, 'Fano still rejects shorter candidates');

state.activeTab = 'ASTRA';
sandbox.syncFormulaSnapshotButton();
assert.equal(button.disabled, true, 'Astra uses its separate report snapshot');
assert.match(hint.textContent, /Astra/);

assert.match(html, /id="f-save-snapshot"[^>]*disabled/);
assert.match(html, /id="formula-snapshot-help"[^>]*role="status"/);
console.log('PASS: Formula Snapshot availability states and initial accessible guidance');
