// Formula's first visit should use one prize-history response for its date choices and inputs.
// Run with: node scripts/test_formula_initial_history_reuse.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepareContext } = require('./frontend_source');

const root = path.join(__dirname, '..', 'static');
const engine = fs.readFileSync(path.join(root, 'formula-engine.js'), 'utf8');
function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'm').exec(engine);
  assert(match, `missing function ${name}`);
  let i = match.index + match[0].length, depth = 1;
  while (i < engine.length && depth) {
    if (engine[i] === '{') depth++;
    else if (engine[i] === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unterminated function ${name}`);
  return engine.slice(match.index, i);
}

function option(value, textContent = value) { return { value, textContent }; }
function makeHarness(response) {
  const calls = [], messages = [];
  const elements = Object.create(null);
  elements['f-target-date'] = {
    value: '', options: [],
    appendChild(item) {
      this.options.push(item);
      if (!this.value) this.value = item.value;
    },
  };
  elements['pred-date'] = {
    value: '2026-10-16',
    options: [option('2026-10-16', '16 ต.ค. 2569'), option('2026-11-01', '1 พ.ย. 2569')],
  };
  for (const id of ['f-prize1', 'f-top3', 'f-bottom2', 'f-front3-1', 'f-front3-2', 'f-back3-1', 'f-back3-2', 'f-drawday', 'f-prev-info']) {
    elements[id] = { value: '', textContent: '', disabled: false };
  }
  const sandbox = {
    Date, JSON, Set, Map, Math,
    document: {
      getElementById: id => elements[id] || null,
      createElement: () => ({ value: '', textContent: '' }),
    },
    api: async endpoint => { calls.push(endpoint); return response; },
    _bindFormulaInputSanitizers() {},
    setFormulaLoading: message => messages.push(`loading:${message}`),
    _clearFormulaResults: message => messages.push(`clear:${message}`),
    showFormulaManualInput() { sandbox.manualInputOpened = true; },
    switchFormulaTab() {},
    updateFormulaTargetDisplay() {},
    manualInputOpened: false,
  };
  sandbox.window = sandbox;
  prepareContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'server-data.js'), 'utf8'), sandbox);
  vm.runInContext([
    'LotteryUiState.formula.activeTab="A"; LotteryUiState.formula.filled=false; LotteryUiState.formula.autoFillPending=false; LotteryUiState.formula.autoFillRequestId=0;',
    extractFunction('initFormulaPage'),
    extractFunction('syncFormulaSnapshotButton'),
    extractFunction('_parseThai'),
    extractFunction('_setFormulaAutoFillPending'),
    extractFunction('autoFillFormula'),
  ].join('\n\n'), sandbox);
  return { sandbox, elements, calls, messages };
}

async function main() {
  const row = { date: '01/10/2026', prize1: '000017', top3: '007', bottom2: '05', front3_1: '001', front3_2: '002', back3_1: '003', back3_2: '004' };
  const success = makeHarness({ data: [row] });
  await success.sandbox.initFormulaPage();
  assert.deepEqual(success.calls, ['prize-history?n=500']);
  assert.deepEqual(success.elements['f-target-date'].options.map(item => item.value), ['2026-10-16', '2026-11-01', '2026-10-01']);
  assert.equal(success.elements['f-prize1'].value, '000017');
  assert.equal(success.elements['f-top3'].value, '007');
  assert.equal(success.elements['f-bottom2'].value, '05');
  assert.equal(success.elements['f-prev-info'].textContent, 'งวด: 01/10/2026 | รางวัลที่1: 000017');
  assert.equal(success.sandbox.LotteryUiState.formula.filled, true);

  success.calls.length = 0;
  await success.sandbox.autoFillFormula();
  assert.deepEqual(success.calls, ['prize-history?n=500'], 'manual refresh must still fetch current history');
  assert.equal(success.elements['f-prize1'].value, '000017');

  success.calls.length = 0;
  success.sandbox.LotteryUiState.formula.filled = false;
  await success.sandbox.initFormulaPage();
  assert.deepEqual(success.calls, ['prize-history?n=500'], 're-entry still refreshes from the full history endpoint');

  const empty = makeHarness({ data: [] });
  await empty.sandbox.initFormulaPage();
  assert.deepEqual(empty.calls, ['prize-history?n=500']);
  assert(empty.messages.some(message => message.includes('ยังไม่มีประวัติงวด')));
  assert(!empty.messages.some(message => message.includes('โหลดข้อมูลงวดไม่สำเร็จ')));

  const failed = makeHarness({ error: 'offline' });
  await failed.sandbox.initFormulaPage();
  assert.deepEqual(failed.calls, ['prize-history?n=500'], 'a failed first read must not trigger a duplicate autofill request');
  assert.deepEqual(failed.elements['f-target-date'].options.map(item => item.value), ['2026-10-16', '2026-11-01'], 'scheduled targets remain selectable when history is unavailable');
  assert(failed.messages.some(message => message.includes('โหลดข้อมูลงวดไม่สำเร็จ')));
  assert.equal(failed.sandbox.manualInputOpened, true);
  assert.equal(failed.sandbox.LotteryUiState.formula.filled, false);

  console.log('PASS: Formula initial history reuse, target choices, leading zeroes, manual refresh, re-entry, valid-empty, and retryable failure (18 assertions)');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
