// Ticket04 regressions for prediction API error states and Mix track-record validity.
// Run with: node scripts/test_predict_mix_ui_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'formula-engine.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'm');
  const m = re.exec(source);
  if (!m) throw new Error('not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  if (depth !== 0) throw new Error('unterminated function: ' + name);
  return source.slice(m.index, i);
}

function optionalFunction(source, name, fallback) {
  return source.includes(`function ${name}(`) ? extractFunction(source, name) : fallback;
}

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error('FAIL: ' + label);
  passed++;
}

function fullPoolDraw(date, overrides = {}) {
  const row = { date, prize1: '900001' };
  const scalarFields = [
    'near1_1', 'near1_2',
    'prize2_1', 'prize2_2', 'prize2_3', 'prize2_4', 'prize2_5',
    'prize3_1', 'prize3_2', 'prize3_3', 'prize3_4', 'prize3_5',
    'prize3_6', 'prize3_7', 'prize3_8', 'prize3_9', 'prize3_10',
  ];
  scalarFields.forEach((field, i) => { row[field] = String(100000 + i).padStart(6, '0'); });
  row.prize4 = Array.from({ length: 50 }, (_, i) => String(200000 + i).padStart(6, '0')).join(' ');
  row.prize5 = Array.from({ length: 100 }, (_, i) => String(300000 + i).padStart(6, '0')).join(' ');
  return { ...row, ...overrides };
}

function makeMixHarness(snapshots = []) {
  let snapshotJson = JSON.stringify(snapshots);
  const storage = {
    getItem: key => key === 'lottery_mix_snapshots' ? snapshotJson : null,
    setItem: (key, value) => { if (key === 'lottery_mix_snapshots') snapshotJson = value; },
    removeItem: key => { if (key === 'lottery_mix_snapshots') snapshotJson = '[]'; },
  };
  const code = [
    extractFunction(engineSrc, '_buildPrize1to5Pool'),
    extractFunction(appSrc, 'dcActualForDate'),
    extractFunction(appSrc, 'dcRollingRate'),
    extractFunction(appSrc, 'mixPoolForRow'),
    optionalFunction(appSrc, 'mixPoolIsComplete', 'function mixPoolIsComplete(){ return true; }'),
    extractFunction(appSrc, 'mixSnapshotResult'),
    extractFunction(appSrc, 'mixHitRateTrend'),
    extractFunction(appSrc, 'mixSnapshots'),
    extractFunction(appSrc, 'dcTrackStatusBadge'),
    extractFunction(appSrc, 'mixTrackStatusBadge'),
    extractFunction(appSrc, 'mixTrackHtml'),
  ].join('\n\n');
  const sandbox = {
    console, Date, JSON, Set, Map, Math,
    localStorage: storage,
    fmtDate: value => String(value || ''),
    escHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function makePredictHarness(apiOverride) {
  const elements = Object.create(null);
  const initialValues = {
    'pred-date': '2026-10-16',
    'pred-topn': '10',
    'p1-preset': 'optimized',
    'p1-beam': '500',
    'p1-kback': '100',
  };
  const getElement = id => elements[id] || (elements[id] = {
    id,
    value: initialValues[id] || '',
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
  });
  const categories = {
    prize1: { label: 'รางวัลที่ 1', numbers: [], error: 'synthetic <prize1> failure' },
    front3_1: { label: 'หน้า 3 ชุด 1', numbers: [], error: 'synthetic <front3> failure' },
    front3_2: { numbers: [] },
    back3_1: { numbers: [] },
    back3_2: { numbers: [] },
    bottom2: { numbers: [] },
  };
  const api = apiOverride || (async endpoint => endpoint.startsWith('predict/all') ? { date: '2026-10-16', categories } : { data: [] });
  const code = [
    'let _predictRequestId=0;',
    extractFunction(appSrc, 'predNum'),
    extractFunction(appSrc, 'predScoreKey'),
    extractFunction(appSrc, 'predScore'),
    extractFunction(appSrc, 'escHtml'),
    extractFunction(appSrc, 'p1Front'),
    extractFunction(appSrc, 'p1Back'),
    extractFunction(appSrc, '_renderSimpleRows'),
    extractFunction(appSrc, 'setPredictLoading'),
    extractFunction(appSrc, 'loadPredict'),
  ].join('\n\n');
  const sandbox = {
    console, Date, Math, Map, Set, Promise,
    document: { getElementById: getElement, querySelectorAll: () => [] },
    api,
    numChip: value => String(value ?? ''),
    predDetailHtml: ({ num }) => String(num ?? ''),
    predictionSupportMap: () => new Map(),
    renderPredictSummary() {},
    renderPredictFinalPanel() {},
    renderPredictDecisionBoard() {},
    renderPredictionConsensus() {},
    filterPredictions() {},
    fmtDate: value => String(value || ''),
    toast() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, categories };
}

function makeMixPageHarness(options = {}) {
  const elements = Object.create(null);
  const getElement = id => elements[id] || (elements[id] = {
    id, value: '', innerHTML: '', textContent: '', className: '', options: [], style: {},
    classList: { add() {}, remove() {}, toggle() {} },
  });
  const storage = {
    getItem: () => '[]',
    setItem: () => { throw new Error('synthetic storage quota failure'); },
    removeItem() {},
  };
  if (options.date) {
    const dateEl = getElement('mix-date');
    dateEl.value = options.date;
    dateEl.options = options.dateOptions || [{ value: options.date }];
  }
  const code = [
    'let _mixLoadRequestId=0;',
    extractFunction(engineSrc, '_buildPrize1to5Pool'),
    extractFunction(appSrc, 'dcActualForDate'),
    extractFunction(appSrc, 'dcRollingRate'),
    extractFunction(appSrc, 'mixPoolForRow'),
    optionalFunction(appSrc, 'mixPoolIsComplete', 'function mixPoolIsComplete(){ return true; }'),
    extractFunction(appSrc, 'mixSnapshotResult'),
    extractFunction(appSrc, 'mixHitRateTrend'),
    extractFunction(appSrc, 'mixSnapshots'),
    extractFunction(appSrc, 'mixAutoSaveSnapshot'),
    extractFunction(appSrc, 'dcTrackStatusBadge'),
    optionalFunction(appSrc, 'mixTrackStatusBadge', 'function mixTrackStatusBadge(status){ return dcTrackStatusBadge(status); }'),
    extractFunction(appSrc, 'mixTrackHtml'),
    extractFunction(appSrc, 'mixRandomPick'),
    extractFunction(appSrc, 'loadMixPage'),
  ].join('\n\n');
  const positions = Array.from({ length: 6 }, () => ({
    groupCount: 1,
    ranked: [{ digit: '1', groups: ['A'] }, { digit: '2', score: 1, groups: ['B'] }],
  }));
  const sandbox = {
    Date, JSON, Set, Map, Math: options.Math || Math,
    console: { warn() {}, log() {}, error() {} },
    localStorage: storage,
    document: { getElementById: getElement, querySelectorAll: () => [] },
    api: options.api || (async () => ({ data: [{ date: '01/01/2026', prize1: '111111' }] })),
    clientDraws: () => [],
    nextDrawInfo: () => ({ iso: '2026-10-16' }),
    dcComputeFormulaResults: options.computeFormulaResults || (() => []),
    _mixCompute: options.mixCompute || (() => ({
      preds: Array.from({ length: 10 }, (_, i) => String(i).padStart(6, '0')),
      positions,
      fallbackUsed: false,
    })),
    fmtDate: value => String(value || ''),
    escHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    chartOpts: () => ({ scales: { y: {} } }),
    mkChart() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements };
}

function makeFormulaHarness(alreadyFilled = false, apiOverride) {
  const elements = Object.create(null);
  elements['f-target-date'] = { value: '2026-10-16', options: [{}], appendChild() {} };
  const messages = [];
  const code = [
    'let _formulaAutoFillRequestId=0; let _formulaAutoFillPending=false;',
    extractFunction(engineSrc, 'initFormulaPage'),
    extractFunction(engineSrc, '_parseThai'),
    extractFunction(engineSrc, '_setFormulaAutoFillPending'),
    extractFunction(engineSrc, 'autoFillFormula'),
    extractFunction(appSrc, 'formulaSaveSnapshot'),
  ].join('\n\n');
  const sandbox = {
    Date, JSON, Set, Map, Math,
    document: { getElementById: id => elements[id] || (elements[id] = { value: '', options: [], style: {} }), createElement: () => ({}) },
    api: apiOverride || (async () => ({ error: 'synthetic history API failure' })),
    _bindFormulaInputSanitizers() {},
    setFormulaLoading() {},
    _clearFormulaResults: message => messages.push(message),
    switchFormulaTab() {},
    _formulaFilled: alreadyFilled,
    _formulaHasRun: false,
    _formulaActiveTab: 'A',
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, messages };
}

function makeFormulaCalculationHarness(api) {
  const elements = Object.create(null);
  const inputIds = ['f-prize1', 'f-top3', 'f-bottom2', 'f-front3-1', 'f-front3-2', 'f-back3-1', 'f-back3-2', 'f-drawday'];
  const staleInputIds = inputIds.filter(id => id !== 'f-drawday');
  const oldValues = ['654321', '321', '21', '123', '456', '789', '987', '16'];
  inputIds.forEach((id, i) => { elements[id] = { value: oldValues[i], disabled: false }; });
  elements['f-target-date'] = { value: '2026-11-01', options: [] };
  elements['f-run-formulas'] = { disabled: false };
  elements['f-save-snapshot'] = { disabled: false };
  elements['f-load-formula'] = { disabled: false };
  const resultNodes = [];
  const calls = [];
  const code = [
    'let _formulaAutoFillRequestId=0; let _formulaFilled=false; let _formulaAutoFillPending=false; let _formulaHasRun=true;',
    extractFunction(engineSrc, '_parseThai'),
    extractFunction(engineSrc, '_setFormulaAutoFillPending'),
    extractFunction(engineSrc, 'autoFillFormula'),
    extractFunction(appSrc, 'formulaSaveSnapshot'),
    extractFunction(engineSrc, 'runAllFormulas'),
  ].join('\n\n');
  const sandbox = {
    Date, JSON, Set, Map, Math,
    document: {
      getElementById: id => elements[id] || null,
      querySelectorAll: selector => selector.includes('#formula-final') || selector.includes('#formula-results-ALL') ? resultNodes : [],
      querySelector: () => null,
    },
    api,
    calls,
    saves: [],
    savePageSnapshot: (...args) => sandbox.saves.push(args),
    nextDrawInfo: () => ({ iso: '2026-11-01' }),
    fmtDate: value => String(value),
    toast: (...args) => calls.push(`toast:${args.join('|')}`),
    setFormulaLoading: message => {
      calls.push(`loading:${message}`);
      if (message === 'กำลังคำนวณทุกสูตร...') {
        calls.push('calculation:started');
        resultNodes.push({ textContent: String(elements['f-prize1']?.value || '123456') });
        throw new Error('calculation-started');
      }
    },
    _clearFormulaResults: message => calls.push(`clear:${message}`),
    _validateFormulaInputs: () => { calls.push('validate'); return true; },
    _fv: id => String(elements[id]?.value ?? '').trim(),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, calls, inputIds, staleInputIds };
}

function makeSharedActionHarness(autofillResult) {
  const calls = [];
  const sandbox = {
    currentPredTab: 'formula',
    autoFillFormula: async () => autofillResult,
    runAllFormulas: () => calls.push('run'),
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(appSrc, 'runSharedPrimaryAction'), sandbox);
  return { sandbox, calls };
}

function makeCompareHarness() {
  const element = { innerHTML: '' };
  const sandbox = {
    document: { getElementById: id => id === 'predict-mode-compare' ? element : null },
    api: async () => ({ error: 'synthetic <compare> failure', predictions: [] }),
    predNum: row => String(row?.num ?? ''),
    numChip: value => String(value ?? ''),
  };
  vm.createContext(sandbox);
  vm.runInContext([extractFunction(appSrc, 'escHtml'), extractFunction(appSrc, 'loadPredictModeCompare')].join('\n\n'), sandbox);
  return { sandbox, element };
}

function makeSnapshotHarness() {
  const elements = Object.create(null);
  const dateIds = ['shared-draw-date', 'pred-date', 'f-target-date', 'dc-date', 'dc-date-old', 'dash-date'];
  for (const id of dateIds) {
    const options = [{ value: '2026-10-16' }];
    let selected = '2026-10-16';
    elements[id] = {
      get value() { return options.some(option => option.value === selected) ? selected : ''; },
      set value(value) { selected = options.some(option => option.value === value) ? value : ''; },
      options,
      add(option) { options.push(option); },
    };
  }
  elements['pred-topn'] = { value: '10' };
  elements['p1-preset'] = { value: 'optimized' };
  const snapshot = { id: 'predict_fixture', date: '2026-11-01', topn: 20, preset: 'balanced' };
  const loaded = [];
  const autoFillCalls = [];
  const code = [
    extractFunction(appSrc, '_setSelectValueKeepingOptions'),
    extractFunction(appSrc, 'syncSharedDrawDate'),
    extractFunction(appSrc, 'loadPageSnapshot'),
  ].join('\n\n');
  function TestOption(label, value) { this.text = label; this.value = value; }
  const sandbox = {
    document: { getElementById: id => elements[id] || null },
    pageSnapshots: () => [snapshot],
    fmtDate: value => String(value),
    Option: TestOption,
    _sharedDateSyncing: false,
    autoFillFormula: (...args) => autoFillCalls.push(args),
    loadPredict: () => loaded.push({ pred: elements['pred-date'].value, shared: elements['shared-draw-date'].value }),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, loaded, dateIds, autoFillCalls };
}

function makeSharedFocusHarness() {
  const elements = Object.create(null);
  const getElement = id => elements[id] || (elements[id] = {
    id, value: '', textContent: '', style: {}, classList: { add() {}, remove() {} },
  });
  const cards = ['prize1', 'front3', 'front3', 'back3', 'back3', 'bottom2'].map(group => ({
    dataset: { predGroup: group }, textContent: group, style: { display: '' },
  }));
  const summaryIds = ['predict-summary', 'predict-final', 'predict-decision-board', 'predict-consensus'];
  summaryIds.forEach(id => { elements[id] = { id, style: { display: '' }, classList: { add() {}, remove() {} } }; });
  const code = [
    extractFunction(appSrc, 'applySharedLotteryFocus'),
    extractFunction(appSrc, 'filterPredictions'),
  ].join('\n\n');
  const sandbox = {
    document: {
      getElementById: getElement,
      querySelectorAll: selector => selector === '#all-pred-grid .predict-card' ? cards : [],
    },
    filterFormulaCards() {},
  };
  elements['shared-lottery-focus'] = { value: 'top3' };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, cards, summaryIds };
}

async function main() {
  // Mix pool: a blank prize1 is not the real winning number 000000.
  const mix = makeMixHarness();
  const blankPool = mix.mixPoolForRow({ prize1: '' });
  check('blank prize1 is never padded into a false 000000 pool hit', !blankPool.has('000000'));
  const invalidP1 = mix.mixSnapshotResult(
    { date: '2026-01-01', picks: ['000000'] },
    [{ date: '01/01/2026', prize1: '' }],
  );
  check('invalid prize1 cannot make a Mix snapshot hit', invalidP1.status !== 'hit');

  // A known hit remains verifiable, but a non-hit against a partial prize1-5 pool is not a miss.
  const partial = [{ date: '02/01/2026', prize1: '111111' }];
  const knownHit = mix.mixSnapshotResult({ date: '2026-01-02', picks: ['111111'] }, partial);
  check('a matching valid prize1 remains a definite hit even when Sanook data is absent', knownHit.status === 'hit');
  const unknown = mix.mixSnapshotResult({ date: '2026-01-02', picks: ['222222'] }, partial);
  check('a non-hit with missing Sanook prizes is unverifiable, not a miss', unknown.status === 'unverifiable');

  const partialP4 = fullPoolDraw('03/01/2026', {
    prize4: Array.from({ length: 49 }, (_, i) => String(200000 + i).padStart(6, '0')).join(' '),
  });
  const incomplete = mix.mixSnapshotResult({ date: '2026-01-03', picks: ['999999'] }, [partialP4]);
  check('a truncated prize4 list makes an otherwise non-hit unverifiable', incomplete.status === 'unverifiable');

  const duplicateP4Values = Array.from({ length: 50 }, (_, i) => String(200000 + i).padStart(6, '0'));
  duplicateP4Values[49] = duplicateP4Values[0];
  const duplicateP4 = fullPoolDraw('03/01/2026', { prize4: duplicateP4Values.join(' ') });
  check('duplicate values within prize4 make a non-hit unverifiable', mix.mixSnapshotResult({ date: '2026-01-03', picks: ['999999'] }, [duplicateP4]).status === 'unverifiable');

  const duplicateP5Values = Array.from({ length: 100 }, (_, i) => String(300000 + i).padStart(6, '0'));
  duplicateP5Values[99] = duplicateP5Values[0];
  const duplicateP5 = fullPoolDraw('03/01/2026', { prize5: duplicateP5Values.join(' ') });
  check('duplicate values within prize5 make a non-hit unverifiable', mix.mixSnapshotResult({ date: '2026-01-03', picks: ['999999'] }, [duplicateP5]).status === 'unverifiable');

  const duplicateAcrossTiers = fullPoolDraw('03/01/2026', { prize3_1: '100002' });
  check('the same number in prize2 and prize3 does not make a complete draw unverifiable', mix.mixSnapshotResult({ date: '2026-01-03', picks: ['999999'] }, [duplicateAcrossTiers]).status === 'miss');

  const shortScalarRow = fullPoolDraw('06/01/2026', { prize2_1: '1' });
  const shortScalarHit = mix.mixSnapshotResult({ date: '2026-01-06', picks: ['000001'] }, [shortScalarRow]);
  check('a short scalar prize value cannot create a padded false Mix hit', shortScalarHit.status === 'unverifiable' && shortScalarHit.hits === 0);
  const validSlotHit = mix.mixSnapshotResult({ date: '2026-01-06', picks: [shortScalarRow.prize2_2] }, [shortScalarRow]);
  check('a valid scalar slot remains a definite Mix hit despite an unrelated malformed scalar', validSlotHit.status === 'hit' && validSlotHit.hits === 1);
  check('a valid prize4 list token remains a definite Mix hit despite an unrelated malformed scalar', mix.mixSnapshotResult({ date: '2026-01-06', picks: [shortScalarRow.prize4.split(' ')[0]] }, [shortScalarRow]).status === 'hit');
  check('a valid prize5 list token remains a definite Mix hit despite an unrelated malformed scalar', mix.mixSnapshotResult({ date: '2026-01-06', picks: [shortScalarRow.prize5.split(' ')[0]] }, [shortScalarRow]).status === 'hit');
  check('a short scalar prize value cannot verify a miss', mix.mixSnapshotResult({ date: '2026-01-06', picks: ['999999'] }, [shortScalarRow]).status === 'unverifiable');

  const completeHitRow = fullPoolDraw('04/01/2026');
  const completeMissRow = fullPoolDraw('05/01/2026');
  check('complete pool still verifies known hits', mix.mixSnapshotResult({ date: '2026-01-04', picks: [completeHitRow.prize3_1] }, [completeHitRow]).status === 'hit');
  check('complete pool still verifies misses', mix.mixSnapshotResult({ date: '2026-01-05', picks: ['999999'] }, [completeMissRow]).status === 'miss');
  const emptySnapshotRow = fullPoolDraw('03/01/2026');
  const emptySnapshot = { date: '2026-01-03', picks: [] };
  check('an empty Mix snapshot has no scored hit/miss result', mix.mixSnapshotResult(emptySnapshot, [emptySnapshotRow]).status === 'no-picks');
  check('a legacy Mix snapshot missing picks also has no scored hit/miss result', mix.mixSnapshotResult({ date: '2026-01-03' }, [emptySnapshotRow]).status === 'no-picks');
  check('a Mix snapshot with picks and no matching draw remains pending', mix.mixSnapshotResult({ date: '2026-01-07', picks: ['123456'] }, []).status === 'pending');
  mix.localStorage.setItem('lottery_mix_snapshots', JSON.stringify([emptySnapshot]));
  const emptyTrack = mix.mixTrackHtml([emptySnapshotRow]);
  check(`an empty Mix snapshot is shown as unscored, not as a miss: ${emptyTrack}`, emptyTrack.includes('ไม่มีชุดให้ตรวจ') && emptyTrack.includes('ไม่มีชุดตัวเลขใน Snapshot — ไม่นับเป็นถูก/พลาด'));

  const trend = mix.mixHitRateTrend([
    { date: '2026-01-02', picks: ['222222'] },
    emptySnapshot,
    { date: '2026-01-04', picks: [completeHitRow.prize3_1] },
    { date: '2026-01-05', picks: ['999999'] },
  ], [...partial, emptySnapshotRow, completeHitRow, completeMissRow], 5, 20);
  check('rolling hit rate excludes unverifiable and empty-prediction snapshots', trend.length === 2 && trend[0].value === 100 && trend[1].value === 50);

  mix.localStorage?.setItem?.('lottery_mix_snapshots', JSON.stringify([{ date: '2026-01-02', picks: ['222222'] }]));
  const trackHtml = mix.mixTrackHtml(partial);
  check('Mix track record labels incomplete results as ตรวจไม่ได้, not รอผล', trackHtml.includes('ตรวจไม่ได้') && !trackHtml.includes('รอผล'));
  check('Mix track record explains that unverifiable results are not hit/miss', trackHtml.includes('ไม่นับเป็นถูก/พลาด'));

  const loadingPredict = makePredictHarness();
  Object.values(loadingPredict.categories).forEach(category => { delete category.error; });
  loadingPredict.categories.prize1.numbers = [{ num: '123456', score: 1 }];
  loadingPredict.categories.front3_1.numbers = [{ num: '789', score: 1 }];
  loadingPredict.sandbox.api = async endpoint => endpoint.startsWith('predict/all')
    ? { categories: loadingPredict.categories }
    : { data: [{ date: '16/10/2025', prize1: '654321', top3: '321', top2: '21', back3_1: '123', back3_2: '456', bottom2: '78' }] };
  await loadingPredict.sandbox.loadPredict();
  check('loading-state fixture starts with prior P1, front3 and reference rows', loadingPredict.elements['p1-tbody'].innerHTML.includes('123456') && loadingPredict.elements['f31-tbody'].innerHTML.includes('789') && loadingPredict.elements['ref-tbody'].innerHTML.includes('654321'));
  let resolvePendingPrediction;
  loadingPredict.sandbox.api = endpoint => endpoint.startsWith('predict/all')
    ? new Promise(resolve => { resolvePendingPrediction = resolve; })
    : Promise.resolve({ data: [] });
  const pendingPrediction = loadingPredict.sandbox.loadPredict();
  const loadingBodies = ['p1-tbody', 'f31-tbody', 'ref-tbody'].map(id => loadingPredict.elements[id].innerHTML);
  check('new Predict load replaces old table rows with an explicit loading state', loadingBodies.every(html => html.includes('กำลังคำนวณ')) && !loadingBodies.some(html => ['123456', '789', '654321'].some(old => html.includes(old))));
  resolvePendingPrediction({ categories: loadingPredict.categories });
  await pendingPrediction;

  // Predict API returns per-category errors with HTTP 200; render them as errors, not empty data.
  const predict = makePredictHarness();
  await predict.sandbox.loadPredict();
  const p1Body = predict.elements['p1-tbody'].innerHTML;
  const p1Badges = predict.elements['p1-badges'].innerHTML;
  const frontBody = predict.elements['f31-tbody'].innerHTML;
  check('prize1 category failure is visible in the table without backend detail', p1Body.includes('คำนวณรางวัลที่ 1 ไม่สำเร็จ') && !p1Body.includes('synthetic'));
  check('prize1 category failure is visible in badges without backend detail', p1Badges.includes('คำนวณรางวัลที่ 1 ไม่สำเร็จ') && !p1Badges.includes('synthetic'));
  check('secondary category failure is visible without backend detail', frontBody.includes('คำนวณไม่สำเร็จ') && !frontBody.includes('synthetic') && !frontBody.includes('ไม่มีข้อมูล'));
  check('an error-only Predict response does not create an empty saveable snapshot', predict.sandbox._lastPredictSnapshot == null);

  const stalePredict = makePredictHarness();
  stalePredict.categories.prize1.numbers = [{ num: '123456', score: 1 }];
  await stalePredict.sandbox.loadPredict();
  stalePredict.sandbox.api = async () => ({ error: 'synthetic network failure' });
  await stalePredict.sandbox.loadPredict();
  const failedP1 = stalePredict.elements['p1-tbody'].innerHTML;
  check('top-level Predict failure replaces old rows with a generic error', failedP1.includes('โหลดผลทำนายไม่สำเร็จ') && !failedP1.includes('synthetic') && !failedP1.includes('123456'));
  check('top-level Predict failure invalidates its previous saveable snapshot', stalePredict.sandbox._lastPredictSnapshot == null);

  const invalidPredict = makePredictHarness();
  invalidPredict.sandbox.api = async () => ({ detail: [{ msg: 'internal validation detail' }] });
  await invalidPredict.sandbox.loadPredict();
  const invalidBody = invalidPredict.elements['p1-tbody'].innerHTML;
  check('Predict validation response has an actionable error, not an empty-data state', invalidBody.includes('คำขอทำนายไม่ถูกต้อง') && !invalidBody.includes('ไม่มีข้อมูล'));
  check('Predict validation response does not expose backend detail', !invalidBody.includes('internal validation detail'));

  const refFailure = makePredictHarness();
  refFailure.sandbox.api = async path => path.startsWith('predict/all') ? { categories: refFailure.categories } : { error: 'synthetic history API failure' };
  await refFailure.sandbox.loadPredict();
  const refBody = refFailure.elements['ref-tbody'].innerHTML;
  check('reference-history API failure is not misreported as no matching draw', refBody.includes('โหลดข้อมูลอ้างอิงไม่สำเร็จ') && !refBody.includes('ไม่พบงวดวันเดียวกัน'));

  const htmlPayload = '<img src=x onerror=alert(1)>';
  const xssPredict = makePredictHarness(path => path.startsWith('predict/all')
    ? { categories: { prize1: { numbers: [] }, front3_1: { numbers: [] }, front3_2: { numbers: [] }, back3_1: { numbers: [] }, back3_2: { numbers: [] }, bottom2: { numbers: [] } } }
    : { data: [{ date: `16/10/2025${htmlPayload}`, prize1: `111111${htmlPayload}`, top3: `222${htmlPayload}`, top2: `33${htmlPayload}`, back3_1: `444${htmlPayload}`, back3_2: `555${htmlPayload}`, bottom2: `66${htmlPayload}` }] });
  await xssPredict.sandbox.loadPredict();
  const historyHtml = xssPredict.elements['ref-tbody'].innerHTML;
  const escapedHtmlPayload = '&lt;img src=x onerror=alert(1)&gt;';
  check('Predict history renders API date and prize fields as text, not HTML', !historyHtml.includes('<img') && historyHtml.split(escapedHtmlPayload).length - 1 === 7);

  const compare = makeCompareHarness();
  await compare.sandbox.loadPredictModeCompare('2026-10-16', 5, 500, 100);
  check('Predict mode compare errors are visible without exposing backend detail', compare.element.innerHTML.includes('เทียบโหมดไม่สำเร็จ') && !compare.element.innerHTML.includes('synthetic') && !compare.element.innerHTML.includes('dash-empty'));

  const snapshot = makeSnapshotHarness();
  snapshot.sandbox.loadPageSnapshot('predict', 'predict_fixture');
  check('loading a saved Predict snapshot synchronizes all visible draw-date selectors', snapshot.dateIds.every(id => snapshot.elements[id].value === '2026-11-01'));
  check('the prediction request uses the saved snapshot date and shared date', snapshot.loaded.length === 1 && snapshot.loaded[0].pred === '2026-11-01' && snapshot.loaded[0].shared === '2026-11-01');

  const formulaSnapshot = makeSnapshotHarness();
  formulaSnapshot.sandbox.loadPageSnapshot('formula', 'predict_fixture');
  check('loading a formula snapshot marks prior autofilled values stale', formulaSnapshot.autoFillCalls.length === 1 && formulaSnapshot.autoFillCalls[0][0] === true);
  check('loading a formula snapshot adds its date and synchronizes every shared selector', formulaSnapshot.dateIds.every(id => formulaSnapshot.elements[id].value === '2026-11-01' && formulaSnapshot.elements[id].options.some(option => option.value === '2026-11-01')));
  formulaSnapshot.sandbox.currentPredTab = 'formula';
  formulaSnapshot.sandbox.syncSharedDrawDate('2026-12-16', true);
  check('a user-driven shared-date change invalidates prior formula values', formulaSnapshot.autoFillCalls.length === 2 && formulaSnapshot.autoFillCalls[1][0] === true);

  const sharedFocus = makeSharedFocusHarness();
  sharedFocus.sandbox.applySharedLotteryFocus();
  check('shared Top3 focus filters instead of silently showing every Predict category', sharedFocus.cards.every(card => card.style.display === 'none') && sharedFocus.elements['predict-filter-count'].textContent.startsWith('ไม่มีหมวดทำนาย'));
  check('shared Top3 no-match also hides aggregate prediction panels', sharedFocus.summaryIds.every(id => sharedFocus.elements[id].style.display === 'none'));
  sharedFocus.elements['shared-lottery-focus'].value = 'front3';
  sharedFocus.sandbox.applySharedLotteryFocus();
  check('a supported shared focus restores aggregate prediction panels', sharedFocus.summaryIds.every(id => sharedFocus.elements[id].style.display === ''));
  const predictFilterMarkup = indexSrc.match(/<select id="predict-group-filter"[^>]*>([\s\S]*?)<\/select>/)?.[1] || '';
  check('Predict filter contains the Top3 no-match option required by the shared focus', /<option value="top3">/.test(predictFilterMarkup));

  const formula = makeFormulaHarness();
  await formula.sandbox.initFormulaPage();
  check('formula API failure is reported as a load error, not as no history', formula.messages.some(message => message.includes('โหลดข้อมูลงวดไม่สำเร็จ')) && !formula.messages.some(message => message.includes('ยังไม่มีประวัติงวด')));
  check('failed formula autofill remains retryable', formula.sandbox._formulaFilled === false);
  const refreshFormula = makeFormulaHarness(true);
  await refreshFormula.sandbox.autoFillFormula();
  check('a failed shared-date formula refresh clears the prior autofilled state', refreshFormula.sandbox._formulaFilled === false);

  const autofillResponses = [];
  const autofillRace = makeFormulaHarness(false, () => new Promise(resolve => autofillResponses.push(resolve)));
  const oldAutofill = autofillRace.sandbox.autoFillFormula();
  autofillRace.elements['f-target-date'].value = '2026-11-01';
  const currentAutofill = autofillRace.sandbox.autoFillFormula();
  autofillResponses[1]({ data: [{ date: '16/10/2026', prize1: '222222', top3: '222', bottom2: '22' }] });
  await currentAutofill;
  autofillResponses[0]({ data: [{ date: '01/10/2026', prize1: '111111', top3: '111', bottom2: '11' }] });
  await oldAutofill;
  check('an older formula autofill cannot overwrite the inputs for a newer selected draw', autofillRace.elements['f-target-date'].value === '2026-11-01' && autofillRace.elements['f-prize1'].value === '222222' && autofillRace.elements['f-prev-info'].textContent.includes('222222'));

  const pendingPredict = [];
  const predictRace = makePredictHarness(endpoint => endpoint.startsWith('predict/all')
    ? new Promise(resolve => pendingPredict.push(resolve))
    : Promise.resolve({ data: [] }));
  const oldPredict = predictRace.sandbox.loadPredict();
  predictRace.elements['pred-date'].value = '2026-11-01';
  const newPredict = predictRace.sandbox.loadPredict();
  const raceCategories = number => ({
    prize1: { numbers: [{ num: number, score: 1 }] },
    front3_1: { numbers: [] }, front3_2: { numbers: [] },
    back3_1: { numbers: [] }, back3_2: { numbers: [] }, bottom2: { numbers: [] },
  });
  pendingPredict[1]({ categories: raceCategories('222222') });
  await newPredict;
  pendingPredict[0]({ categories: raceCategories('111111') });
  await oldPredict;
  check('an older Predict response cannot overwrite newer date and results', predictRace.sandbox._lastPredDate === '2026-11-01' && predictRace.elements['p1-tbody'].innerHTML.includes('222222') && !predictRace.elements['p1-tbody'].innerHTML.includes('111111'));

  const historyResponses = [];
  const historyRace = makePredictHarness(endpoint => {
    if (endpoint.startsWith('predict/all')) return Promise.resolve({ categories: raceCategories(endpoint.includes('date=2026-11-01') ? '222222' : '111111') });
    if (endpoint.startsWith('history')) return historyResponses.length === 0
      ? new Promise(resolve => historyResponses.push(resolve))
      : Promise.resolve({ data: [{ date: '01/11/2024', prize1: '222222', top3: '222', top2: '22', back3_1: '222', back3_2: '222', bottom2: '22' }] });
    return Promise.resolve({ data: [] });
  });
  const oldHistoryLoad = historyRace.sandbox.loadPredict();
  for (let i = 0; i < 10 && historyResponses.length === 0; i++) await Promise.resolve();
  historyRace.sandbox.document.getElementById('pred-date').value = '2026-11-01';
  const currentHistoryLoad = historyRace.sandbox.loadPredict();
  await currentHistoryLoad;
  const currentRefRows = historyRace.elements['ref-tbody'].innerHTML;
  historyResponses[0]({ data: [{ date: '16/10/2024', prize1: '111111', top3: '111', top2: '11', back3_1: '111', back3_2: '111', bottom2: '11' }] });
  await oldHistoryLoad;
  check('an older Predict history response cannot replace the current target reference rows', currentRefRows.includes('222222') && historyRace.elements['ref-tbody'].innerHTML.includes('222222') && !historyRace.elements['ref-tbody'].innerHTML.includes('111111'));

  const failedShared = makeSharedActionHarness(false);
  failedShared.sandbox.runSharedPrimaryAction();
  await Promise.resolve();
  check('shared formula action does not calculate stale inputs after autofill failure', failedShared.calls.length === 0);
  const successfulShared = makeSharedActionHarness(true);
  successfulShared.sandbox.runSharedPrimaryAction();
  await Promise.resolve();
  check('shared formula action calculates after successful autofill', successfulShared.calls.length === 1);

  let rejectFormulaHistory;
  const directFormula = makeFormulaCalculationHarness(() => new Promise((_, reject) => { rejectFormulaHistory = reject; }));
  const formulaAutofill = directFormula.sandbox.autoFillFormula(true);
  await Promise.resolve();
  check('changing formula target clears old autofilled results before history resolves', directFormula.staleInputIds.every(id => directFormula.elements[id].value === '') && directFormula.elements['f-drawday'].value === '1');
  check('formula fields and direct Calculate are disabled while autofill is pending', directFormula.inputIds.every(id => directFormula.elements[id].disabled === true) && directFormula.elements['f-run-formulas'].disabled === true);
  try { directFormula.sandbox.runAllFormulas(); } catch (error) { if (error.message !== 'calculation-started') throw error; }
  check('direct Calculate handler cannot start with autofill pending', !directFormula.calls.includes('calculation:started'));
  rejectFormulaHistory(new Error('synthetic history failure'));
  await formulaAutofill;
  check('failed date autofill leaves stale values blank and re-enables manual entry', directFormula.staleInputIds.every(id => directFormula.elements[id].value === '') && directFormula.inputIds.every(id => directFormula.elements[id].disabled === false) && directFormula.elements['f-run-formulas'].disabled === false);
  const savesBeforeFailureSnapshot = directFormula.sandbox.saves.length;
  directFormula.sandbox.formulaSaveSnapshot();
  check('formula snapshot is unavailable after failed autofill until a calculation succeeds', directFormula.sandbox.saves.length === savesBeforeFailureSnapshot);
  ['123456', '456', '12', '123', '456', '789', '987', '1'].forEach((value, i) => { directFormula.elements[directFormula.inputIds[i]].value = value; });
  let manualRunError = null;
  try { directFormula.sandbox.runAllFormulas(); } catch (error) { manualRunError = error; }
  check('manual formula values remain calculable after autofill failure', manualRunError?.message === 'calculation-started' && directFormula.calls.includes('calculation:started'));
  const savesBeforeRecoverySnapshot = directFormula.sandbox.saves.length;
  directFormula.sandbox.formulaSaveSnapshot();
  check('formula snapshots can be saved after manual calculation succeeds', directFormula.sandbox.saves.length === savesBeforeRecoverySnapshot + 1);
  directFormula.elements['f-target-date'].value = '2026-11-01';
  const savesBeforePendingSave = directFormula.sandbox.saves.length;
  const pendingSaveApi = new Promise(() => {});
  directFormula.sandbox.api = () => pendingSaveApi;
  directFormula.sandbox.autoFillFormula(true);
  directFormula.sandbox.formulaSaveSnapshot();
  check('formula snapshot cannot be saved from old result chips during date autofill', directFormula.sandbox.saves.length === savesBeforePendingSave && directFormula.calls.some(call => call.includes('กำลังโหลดข้อมูลงวดก่อน')));

  check('initFormulaPage does not replace the current autofill state with a stale false result', !extractFunction(engineSrc, 'initFormulaPage').includes('_formulaFilled=await autoFillFormula()'));

  const mixPage = makeMixPageHarness();
  await mixPage.sandbox.loadMixPage();
  const mixRoot = mixPage.elements['mix-root'];
  check('Mix predictions remain visible when snapshot storage fails', mixRoot.innerHTML.includes('000000') && !mixRoot.textContent.includes('โหลดหน้านี้ไม่สำเร็จ'));
  check('Mix page reports that auto-saving history failed', mixRoot.innerHTML.includes('บันทึกประวัติ Mix ไม่สำเร็จ'));

  const mixPending = [];
  const raceMath = Object.create(Math);
  raceMath.random = () => 0;
  const mixRace = makeMixPageHarness({
    date: '2026-12-01',
    dateOptions: [{ value: '2026-12-01' }, { value: '2026-12-16' }],
    Math: raceMath,
    api: () => new Promise(resolve => mixPending.push(resolve)),
    computeFormulaResults: (_rows, date) => date,
    mixCompute: date => ({
      preds: [date === '2026-12-01' ? '111111' : '222222', ...Array.from({ length: 9 }, (_, i) => String(i).padStart(6, '0'))],
      positions: Array.from({ length: 6 }, () => ({ groupCount: 1, ranked: [{ digit: '1', groups: ['A'] }] })),
      fallbackUsed: false,
    }),
  });
  const oldMix = mixRace.sandbox.loadMixPage();
  mixRace.elements['mix-date'].value = '2026-12-16';
  const newMix = mixRace.sandbox.loadMixPage();
  mixPending[1]({ data: [{ date: '01/01/2026', prize1: '111111' }] });
  await newMix;
  mixPending[0]({ data: [{ date: '01/01/2026', prize1: '111111' }] });
  await oldMix;
  mixRace.sandbox.mixRandomPick();
  check('an older Mix response cannot overwrite the latest target or random-pick pool', mixRace.elements['mix-root'].innerHTML.includes('2026-12-16') && !mixRace.elements['mix-root'].innerHTML.includes('2026-12-01') && mixRace.elements['mix-random-result'].innerHTML.includes('222222'));

  console.log(`OK: ${passed} checks passed`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
