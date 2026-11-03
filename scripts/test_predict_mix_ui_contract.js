// Ticket04 regressions for prediction API error states and Mix track-record validity.
// Run with: node scripts/test_predict_mix_ui_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = require('./frontend_source').readFrontend('app.js');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');
const reportCoreSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'report-core.js'), 'utf8');
const mixUiSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'mix-ui.js'), 'utf8');
const predictionUiSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'prediction-ui.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.css'), 'utf8');
const astraStart = appSrc.indexOf('var AstraFeature =');
const astraEnd = appSrc.indexOf('// ─── HyperUI theme', astraStart);
if (astraStart < 0 || astraEnd <= astraStart) throw new Error('missing production astra state/helpers');
const astraSource = appSrc.slice(astraStart, astraEnd);

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

function targetedPredictResponse(endpoint, categories) {
  const date = endpoint.match(/[?&]date=([^&]+)/)?.[1] || '';
  return { date, categories };
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
    extractFunction(appSrc, 'mixSnapshotPayloadIsValid'),
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
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
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
    classList: (() => { const names=new Set(); return { add: name => names.add(name), remove: name => names.delete(name), toggle: name => names.has(name)?names.delete(name):names.add(name), contains: name => names.has(name) }; })(),
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
    'LotteryUiState.predict.requestId=0;',
    extractFunction(appSrc, 'setPageStatus'),
    extractFunction(appSrc, 'predNum'),
    extractFunction(appSrc, 'validatePredictCategories'),
    extractFunction(appSrc, 'predScoreKey'),
    extractFunction(appSrc, 'predScore'),
    extractFunction(appSrc, 'escHtml'),
    extractFunction(appSrc, 'p1Front'),
    extractFunction(appSrc, 'p1Back'),
    extractFunction(appSrc, '_renderSimpleRows'),
    extractFunction(appSrc, 'setPredictLoading'),
    extractFunction(appSrc, 'loadPredict'),
    extractFunction(predictionUiSrc, 'syncLuckyNewsTarget'),
    extractFunction(predictionUiSrc, 'syncPredictTarget'),
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
    syncLuckyNewsTarget() {},
    showReportDraft: (_key, provenance) => {
      const origin=getElement('predict-report-origin');
      origin.textContent='ผลคำนวณปัจจุบัน · ยังไม่บันทึก';
      origin.innerHTML=`ผลคำนวณปัจจุบัน · ${provenance?'มีที่มา':'ไม่มีรายละเอียดที่มา'}`;
    },
    fmtDate: value => String(value || ''),
    toast() {},
  };
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, categories };
}

function makeMixPageHarness(options = {}) {
  const elements = Object.create(null);
  const focused = [];
  const getElement = id => elements[id] || (elements[id] = {
    id, value: '', innerHTML: '', textContent: '', className: '', options: [], style: {}, dataset: {},
    focus() { focused.push(id); },
    setAttribute(name, value) { this[name] = String(value); },
    classList: { add() {}, remove() {}, toggle() {} },
  });
  let snapshotJson = Object.prototype.hasOwnProperty.call(options, 'snapshotRaw') ? options.snapshotRaw : JSON.stringify(options.snapshots || []);
  const downloads = [], toasts = [];
  let confirmCalls = 0, deleteCalls = 0;
  const storage = {
    getItem: () => { if (options.storageReadFails) throw new Error('synthetic storage read failure'); return snapshotJson; },
    setItem: (_key, value) => {
      if (options.storageFails !== false) throw new Error('synthetic storage quota failure');
      snapshotJson = value;
    },
    removeItem: () => { if (options.storageFails !== false) throw new Error('synthetic storage remove failure'); snapshotJson = null; },
  };
  if (options.date) {
    const dateEl = getElement('mix-date');
    dateEl.value = options.date;
    dateEl.options = options.dateOptions || [{ value: options.date }];
  }
  const code = [
    'LotteryUiState.mix.loadRequestId=0;',
    extractFunction(appSrc, 'setPageStatus'),
    extractFunction(engineSrc, '_buildPrize1to5Pool'),
    extractFunction(appSrc, 'dcActualForDate'),
    extractFunction(appSrc, 'dcRollingRate'),
    extractFunction(appSrc, 'mixPoolForRow'),
    optionalFunction(appSrc, 'mixPoolIsComplete', 'function mixPoolIsComplete(){ return true; }'),
    extractFunction(appSrc, 'mixSnapshotResult'),
    extractFunction(appSrc, 'mixHitRateTrend'),
    extractFunction(appSrc, 'mixSnapshotPayloadIsValid'),
    extractFunction(appSrc, 'mixSnapshots'),
    extractFunction(appSrc, 'mixAutoSaveSnapshot'),
    extractFunction(appSrc, 'dcTrackStatusBadge'),
    optionalFunction(appSrc, 'mixTrackStatusBadge', 'function mixTrackStatusBadge(status){ return dcTrackStatusBadge(status); }'),
    extractFunction(appSrc, 'mixSnapshotHistoryErrorHtml'),
    extractFunction(appSrc, 'mixShowSnapshotHistoryError'),
    extractFunction(appSrc, 'mixTrackHtml'),
    extractFunction(appSrc, 'mixDeleteSnapshot'),
    extractFunction(appSrc, 'mixClearSnapshots'),
    extractFunction(appSrc, 'mixDownloadSnapshotBackup'),
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
    reportStoreCanWrite: () => options.reportStoreWritable !== false,
    clearCacheRefreshNotice: () => {},
    showCacheRefreshNotice: () => {},
    document: {
      getElementById: getElement, querySelectorAll: () => [], body: { appendChild() {} },
      createElement: tag => ({ tagName: tag, click() { downloads.push(this.download); }, remove() {} }),
    },
    window: { setTimeout: fn => fn() },
    Blob: class { constructor(parts, settings) { this.parts = parts; this.settings = settings; } },
    URL: { createObjectURL: blob => { downloads.push(blob.parts.join('')); return 'blob:mix-history'; }, revokeObjectURL() {} },
    toast: (...args) => toasts.push(args),
    confirm: () => { confirmCalls++; return options.confirm !== false; },
    deleteWithUndo: (_key, _message, mutate, render) => {
      deleteCalls++;
      if (mutate() === false) return false;
      if (typeof render === 'function') render();
      return true;
    },
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
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, downloads, toasts, focused, get snapshotRaw() { return snapshotJson; }, get confirmCalls() { return confirmCalls; }, get deleteCalls() { return deleteCalls; } };
}

function makePredictionMethodHarness({ sharedDate = '2026-11-16', mixDates = [] } = {}) {
  const elements = Object.create(null);
  const makeSelect = (id, values = []) => {
    const el = {
      id, value: '', options: values.map(value => ({ value })), _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(value) {
        this._html = String(value);
        this.options = [...this._html.matchAll(/<option value="([^"]+)"/g)].map(match => ({ value: match[1] }));
      },
      appendChild(option) { this.options.push(option); },
    };
    elements[id] = el;
    return el;
  };
  makeSelect('shared-draw-date', [sharedDate]).value = sharedDate;
  const mixDate = makeSelect('mix-date', mixDates);
  const guide = { open: true };
  const calls = [];
  const code = [
    extractFunction(mixUiSrc, 'syncMixTargetDate'),
    extractFunction(reportCoreSrc, 'choosePredictionMethod'),
  ].join('\n\n');
  const sandbox = {
    document: {
      getElementById: id => elements[id] || null,
      querySelector: () => guide,
      createElement: () => ({ value: '', textContent: '' }),
    },
    clientDraws: () => [
      { date: '2026-11-01', label: '1 พ.ย. 2569' },
      { date: '2026-11-16', label: '16 พ.ย. 2569' },
    ],
    fmtDate: value => value,
    showPage: page => calls.push(page),
    switchFormulaTab() {}, selectAstraVersion() {}, switchPredTab() {},
  };
  require('./frontend_source').prepareContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, mixDate, guide, calls };
}

function makeFormulaHarness(alreadyFilled = false, apiOverride) {
  const elements = Object.create(null);
  elements['f-target-date'] = { value: '2026-10-16', options: [{}], appendChild() {} };
  const messages = [];
  const code = [
    'LotteryUiState.formula.autoFillRequestId=0; LotteryUiState.formula.autoFillPending=false;',
    extractFunction(engineSrc, 'syncFormulaSnapshotButton'),
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
    showFormulaManualInput() {},
    switchFormulaTab() {},
    _formulaFilled: alreadyFilled,
    _formulaHasRun: false,
    _formulaActiveTab: 'A',
    updateFormulaTargetDisplay() {},
  };
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
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
    'LotteryUiState.formula.autoFillRequestId=0; LotteryUiState.formula.filled=false; LotteryUiState.formula.autoFillPending=false; LotteryUiState.formula.hasRun=true; LotteryUiState.formula.activeTab="A";',
    extractFunction(engineSrc, 'syncFormulaSnapshotButton'),
    extractFunction(engineSrc, '_parseThai'),
    extractFunction(engineSrc, '_setFormulaAutoFillPending'),
    extractFunction(engineSrc, 'autoFillFormula'),
    extractFunction(appSrc, 'formulaSaveSnapshot'),
    extractFunction(engineSrc, '_runAllFormulas'),
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
    updateFormulaTargetDisplay() {},
    showFormulaManualInput() {},
    toast: (...args) => calls.push(`toast:${args.join('|')}`),
    setFormulaLoading: message => {
      calls.push(`loading:${message}`);
      if (message.startsWith('ขั้น 1/5')) {
        calls.push('calculation:started');
        resultNodes.push({ textContent: String(elements['f-prize1']?.value || '123456') });
        throw new Error('calculation-started');
      }
    },
    _clearFormulaResults: message => calls.push(`clear:${message}`),
    _validateFormulaInputs: () => { calls.push('validate'); return true; },
    _fv: id => String(elements[id]?.value ?? '').trim(),
  };
  sandbox.window = sandbox;
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, calls, inputIds, staleInputIds };
}

function makeSharedActionHarness(autofillResult) {
  const calls = [];
  const sandbox = {
    currentPredTab: 'formula',
    _formulaActiveTab: 'A',
    autoFillFormula: async () => autofillResult,
    runAllFormulas: () => calls.push('run'),
  };
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext(extractFunction(appSrc, 'runSharedPrimaryAction'), sandbox);
  return { sandbox, calls };
}

function makeCompareHarness() {
  const element = { innerHTML: '' };
  const dateElement = { value: '2026-10-16' };
  const sandbox = {
    document: { getElementById: id => id === 'predict-mode-compare' ? element : id === 'pred-date' ? dateElement : null },
    api: async () => ({ error: 'synthetic <compare> failure', predictions: [] }),
    predNum: row => String(row?.num ?? ''),
    numChip: value => String(value ?? ''),
  };
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext([extractFunction(appSrc, 'escHtml'), extractFunction(appSrc, 'loadPredictModeCompare')].join('\n\n'), sandbox);
  return { sandbox, element, dateElement };
}

function makeLuckyNewsHarness(api) {
  const elements = Object.create(null);
  const getElement = id => elements[id] || (elements[id] = {
    id, value: id === 'pred-date' ? '2026-10-16' : '', textContent: '', innerHTML: '', style: {},
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] ?? null; },
    scrollIntoView() {},
  });
  const sandbox = {
    document: { getElementById: getElement },
    api,
    fmtDate: date => date === '2026-10-16' ? '16 ต.ค. 2569' : '1 พ.ย. 2569',
    toast() {},
  };
  require('./frontend_source').prepareContext(sandbox);
  vm.runInContext(`${extractFunction(predictionUiSrc, 'syncLuckyNewsTarget')}\n${extractFunction(predictionUiSrc, 'loadLuckyNews')}`, sandbox);
  return { sandbox, elements, dateElement: getElement('pred-date') };
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
  const predictTargetSyncs = [];
  const code = [
    astraSource,
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
    _formulaActiveTab: 'A',
    autoFillFormula: (...args) => autoFillCalls.push(args),
    loadPredict: () => loaded.push({ pred: elements['pred-date'].value, shared: elements['shared-draw-date'].value }),
    syncPredictTarget: date => predictTargetSyncs.push(date),
  };
  sandbox.window = sandbox;
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, loaded, dateIds, autoFillCalls, predictTargetSyncs };
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
  require('./frontend_source').prepareContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','static','shared','server-data.js'),'utf8'),sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, elements, cards, summaryIds };
}

async function main() {
  const newsPending = [];
  const luckyNews = makeLuckyNewsHarness(() => new Promise(resolve => newsPending.push(resolve)));
  const oldNews = luckyNews.sandbox.loadLuckyNews();
  check('Predict news announces its loading state', luckyNews.elements['lucky-news-section'].getAttribute('aria-busy') === 'true');
  luckyNews.elements['lucky-note'].textContent = 'หมายเหตุของงวดก่อน';
  luckyNews.dateElement.value = '2026-11-01';
  luckyNews.sandbox.syncLuckyNewsTarget('2026-11-01');
  check('changing the Predict target hides and clears its old news', luckyNews.elements['lucky-news-section'].style.display === 'none' && luckyNews.elements['lucky-note'].textContent === '');
  const currentNews = luckyNews.sandbox.loadLuckyNews();
  newsPending[0]({ date: '2026-10-16', sources: ['old fixture'], numbers_3: ['111'], numbers_2: ['11'], note: 'old target' });
  await oldNews;
  check('an older news response cannot overwrite or finish the current target loading state', luckyNews.elements['lucky-news-section'].getAttribute('aria-busy') === 'true' && !luckyNews.elements['lucky-3d'].innerHTML.includes('111'));
  newsPending[1]({ date: '2026-11-01', sources: ['current fixture'], query: 'current query', numbers_3: ['007'], numbers_2: ['05'], note: 'current note' });
  await currentNews;
  check('Predict news identifies its target and preserves leading-zero numbers', luckyNews.elements['lucky-source'].textContent.includes('1 พ.ย. 2569') && luckyNews.elements['lucky-3d'].innerHTML.includes('007') && luckyNews.elements['lucky-2d'].innerHTML.includes('05'));
  check('Predict news leaves its busy state after the current response settles', luckyNews.elements['lucky-news-section'].getAttribute('aria-busy') === 'false');
  luckyNews.elements['lucky-note'].textContent = 'previous note';
  const failedNews = luckyNews.sandbox.loadLuckyNews();
  check('retrying Predict news clears the previous note while loading', luckyNews.elements['lucky-note'].textContent === '');
  newsPending[2]({ error: 'fixture failure' });
  await failedNews;
  check('failed Predict news clears stale notes and releases its busy state', luckyNews.elements['lucky-note'].textContent === '' && luckyNews.elements['lucky-news-section'].getAttribute('aria-busy') === 'false');
  check('failed Predict news does not reuse candidates from the prior successful request', !luckyNews.elements['lucky-3d'].innerHTML.includes('007') && !luckyNews.elements['lucky-2d'].innerHTML.includes('05'));
  check('Predict local date changes invalidate stale reports and news for the previous target', /id="pred-date" onchange="syncPredictTarget\(this\.value\)"/.test(indexSrc));
  check('stale Predict report state uses the existing warning tokens', /\.report-origin\.is-stale\{border-color:var\(--orange-text\);background:var\(--orange-soft\);color:var\(--orange-text\)\}/.test(fs.readFileSync(path.join(__dirname,'..','static','app.css'),'utf8')));
  const wrongTargetNews = makeLuckyNewsHarness(async () => ({ date: '2026-10-16', numbers_3: ['999'], numbers_2: ['99'] }));
  wrongTargetNews.dateElement.value = '2026-11-01';
  await wrongTargetNews.sandbox.loadLuckyNews();
  check('Predict rejects news whose response date differs from the selected draw', wrongTargetNews.elements['lucky-source'].textContent.includes('ไม่ตรงกับงวดที่เลือก') && !wrongTargetNews.elements['lucky-3d'].innerHTML.includes('999'));

  const readyPredict = makePredictHarness();
  Object.values(readyPredict.categories).forEach(category => { delete category.error; });
  readyPredict.categories.prize1.numbers = [{ num: '012345', score: 1 }];
  readyPredict.categories.bottom2.numbers = [{ num: '07', score: 1 }];
  await readyPredict.sandbox.loadPredict();
  readyPredict.elements['pred-date'].value = '2026-11-01';
  readyPredict.sandbox.syncPredictTarget('2026-11-01');
  check('changing Predict target marks the visible old report stale and disables its Snapshot action', readyPredict.elements['predict-report-origin'].classList.contains('is-stale') && readyPredict.elements['predict-report-origin'].textContent.includes('2026-10-16') && readyPredict.elements['predict-report-origin'].textContent.includes('2026-11-01') && readyPredict.elements['pred-save-snapshot'].disabled && readyPredict.elements['p1-tbody'].innerHTML.includes('012345'));
  readyPredict.elements['pred-date'].value = '2026-10-16';
  readyPredict.sandbox.syncPredictTarget('2026-10-16');
  check('returning Predict to the report target restores its current status and Snapshot action', !readyPredict.elements['predict-report-origin'].classList.contains('is-stale') && !readyPredict.elements['pred-save-snapshot'].disabled && readyPredict.elements['predict-status'].textContent === readyPredict.sandbox.LotteryUiState.predict.lastPredictStatus);

  let resolveTargetChangePrediction;
  const targetChangePending = makePredictHarness(endpoint => endpoint.startsWith('predict/all')
    ? new Promise(resolve => { resolveTargetChangePrediction = resolve; })
    : Promise.resolve({ data: [] }));
  const targetChangeRequest = targetChangePending.sandbox.loadPredict();
  const pendingRequestId = targetChangePending.sandbox.LotteryUiState.predict.requestId;
  targetChangePending.elements['pred-date'].value = '2026-11-01';
  targetChangePending.sandbox.syncPredictTarget('2026-11-01');
  check('changing target during the main Predict request invalidates it and clears pending state', targetChangePending.sandbox.LotteryUiState.predict.requestId > pendingRequestId && !targetChangePending.sandbox.LotteryUiState.predict.isLoading && targetChangePending.elements['pred-save-snapshot'].disabled && targetChangePending.elements['predict-report-origin'].textContent.includes('กด “ทำนาย”'));
  resolveTargetChangePrediction({ date: '2026-10-16', categories: { ...targetChangePending.categories, prize1: { numbers: [{ num: '999999', score: 1 }] } } });
  await targetChangeRequest;
  check('a Predict response finishing after target cancellation cannot restore old candidates', !targetChangePending.elements['p1-tbody'].innerHTML.includes('999999') && targetChangePending.sandbox.LotteryServerData.predict.rows.length === 0 && !targetChangePending.sandbox.LotteryUiState.predict.isLoading);

  let resolveOldTargetHistory;
  const targetChangeHistory = makePredictHarness(endpoint => endpoint.startsWith('predict/all')
    ? Promise.resolve(targetedPredictResponse(endpoint, { prize1: { numbers: [{ num: '222222', score: 1 }] }, front3_1: { numbers: [] }, front3_2: { numbers: [] }, back3_1: { numbers: [] }, back3_2: { numbers: [] }, bottom2: { numbers: [] } }))
    : new Promise(resolve => { resolveOldTargetHistory = resolve; }));
  const oldTargetHistoryRequest = targetChangeHistory.sandbox.loadPredict();
  for (let i=0;i<10&&!resolveOldTargetHistory;i++) await Promise.resolve();
  const historyRequestId = targetChangeHistory.sandbox.LotteryUiState.predict.requestId;
  targetChangeHistory.elements['pred-date'].value = '2026-11-01';
  targetChangeHistory.sandbox.syncPredictTarget('2026-11-01');
  check('changing target during reference-history loading keeps the report visibly stale and cancels pending work', targetChangeHistory.sandbox.LotteryUiState.predict.requestId > historyRequestId && !targetChangeHistory.sandbox.LotteryUiState.predict.isLoading && targetChangeHistory.elements['pred-save-snapshot'].disabled && targetChangeHistory.elements['p1-tbody'].innerHTML.includes('222222') && targetChangeHistory.elements['ref-tbody'].innerHTML.includes('เปลี่ยนงวดก่อนโหลดข้อมูลอ้างอิงเสร็จ'));
  resolveOldTargetHistory({ data: [{ date: '16/10/2024', prize1: '111111' }] });
  await oldTargetHistoryRequest;
  check('an old reference-history response cannot replace the new target state', !targetChangeHistory.elements['ref-tbody'].innerHTML.includes('111111') && targetChangeHistory.elements['predict-report-origin'].classList.contains('is-stale'));

  const firstMixVisit = makePredictionMethodHarness();
  firstMixVisit.sandbox.choosePredictionMethod('mix');
  check('opening Mix from the prediction guide populates draw options on first visit', firstMixVisit.mixDate.options.length === 2);
  check('opening Mix from the prediction guide carries the shared target draw', firstMixVisit.mixDate.value === '2026-11-16');
  check('prediction guide closes and Mix navigation continues after target hand-off', firstMixVisit.guide.open === false && firstMixVisit.calls[0] === 'mix');
  const existingMixVisit = makePredictionMethodHarness({ mixDates: ['2026-11-01', '2026-11-16'] });
  existingMixVisit.mixDate.value = '2026-11-01';
  existingMixVisit.sandbox.choosePredictionMethod('mix');
  check('opening Mix replaces a stale independent target with the selected shared draw', existingMixVisit.mixDate.value === '2026-11-16');
  const directMixVisit = makePredictionMethodHarness({ mixDates: ['2026-11-01', '2026-11-16'] });
  directMixVisit.mixDate.value = '2026-11-01';
  directMixVisit.sandbox.showPage('mix');
  check('a direct Mix visit keeps its independent target unless a hand-off runs', directMixVisit.mixDate.value === '2026-11-01');
  const customMixDate = makePredictionMethodHarness({ sharedDate: '2027-01-01' });
  customMixDate.sandbox.choosePredictionMethod('mix');
  check('Mix retains a shared target restored from a snapshot even when it is outside its default draw list', customMixDate.mixDate.value === '2027-01-01' && customMixDate.mixDate.options.some(option => option.value === '2027-01-01'));

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
  check('Mix snapshot schema accepts only six-digit string picks while preserving empty and legacy snapshots', mix.mixSnapshotPayloadIsValid([emptySnapshot, { date: '2026-01-03' }, { date: '2026-01-04', picks: ['012345'] }]) && !mix.mixSnapshotPayloadIsValid([{ date: '2026-01-05', picks: [123456] }]) && !mix.mixSnapshotPayloadIsValid([{ date: '2026-01-05', picks: ['12345'] }]));
  check('malformed Mix pick entries are unverifiable instead of a false miss', mix.mixSnapshotResult({ date: '2026-01-05', picks: [123456] }, [fullPoolDraw('05/01/2026')]).status === 'unverifiable' && mix.mixSnapshotResult({ date: '2026-01-05', picks: ['12345'] }, [fullPoolDraw('05/01/2026')]).status === 'unverifiable');
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
    ? targetedPredictResponse(endpoint, loadingPredict.categories)
    : { data: [{ date: '16/10/2025', prize1: '654321', top3: '321', top2: '21', back3_1: '123', back3_2: '456', bottom2: '78' }] };
  await loadingPredict.sandbox.loadPredict();
  check('Predict announces the completed result count', loadingPredict.elements['predict-status'].textContent === 'ผลทำนายพร้อมแล้ว 2 รายการ');
  check('a matching Predict response enables its Snapshot action', loadingPredict.elements['pred-save-snapshot'].disabled === false);
  check('loading-state fixture starts with prior P1, front3 and reference rows', loadingPredict.elements['p1-tbody'].innerHTML.includes('123456') && loadingPredict.elements['f31-tbody'].innerHTML.includes('789') && loadingPredict.elements['ref-tbody'].innerHTML.includes('654321'));
  let resolvePendingPrediction;
  loadingPredict.sandbox.api = endpoint => endpoint.startsWith('predict/all')
    ? new Promise(resolve => { resolvePendingPrediction = resolve; })
    : Promise.resolve({ data: [] });
  const pendingPrediction = loadingPredict.sandbox.loadPredict();
  check('Predict announces loading while a request is pending', loadingPredict.elements['predict-status'].textContent === 'กำลังโหลดผลทำนาย...');
  const loadingBodies = ['p1-tbody', 'f31-tbody', 'ref-tbody'].map(id => loadingPredict.elements[id].innerHTML);
  check('new Predict load replaces old table rows with an explicit loading state', loadingBodies.every(html => html.includes('กำลังคำนวณ')) && !loadingBodies.some(html => ['123456', '789', '654321'].some(old => html.includes(old))));
  resolvePendingPrediction({ date: '2026-10-16', categories: loadingPredict.categories });
  await pendingPrediction;

  // Predict API returns per-category errors with HTTP 200; render them as errors, not empty data.
  const predict = makePredictHarness();
  await predict.sandbox.loadPredict();
  check('Predict marks category failures as partial even when the response omits report_status', predict.elements['predict-status'].textContent === 'ผลทำนายพร้อมบางหมวด · ตรวจข้อผิดพลาดของหมวดที่ขาด 0 รายการ');
  const p1Body = predict.elements['p1-tbody'].innerHTML;
  const p1Badges = predict.elements['p1-badges'].innerHTML;
  const frontBody = predict.elements['f31-tbody'].innerHTML;
  check('prize1 category failure is visible in the table without backend detail', p1Body.includes('คำนวณรางวัลที่ 1 ไม่สำเร็จ') && !p1Body.includes('synthetic'));
  check('prize1 category failure is visible in badges without backend detail', p1Badges.includes('คำนวณรางวัลที่ 1 ไม่สำเร็จ') && !p1Badges.includes('synthetic'));
  check('secondary category failure is visible without backend detail', frontBody.includes('คำนวณไม่สำเร็จ') && !frontBody.includes('synthetic') && !frontBody.includes('ไม่มีข้อมูล'));
  check('an error-only Predict response does not create an empty saveable snapshot', predict.sandbox.LotteryUiState.predict.lastPredictSnapshot == null);

  const partialSnapshotPredict = makePredictHarness();
  partialSnapshotPredict.categories.bottom2.numbers = [{ num: '07', score: 1 }];
  await partialSnapshotPredict.sandbox.loadPredict();
  check('a partial response with successful candidates stays marked partial in the saveable snapshot', partialSnapshotPredict.sandbox.LotteryUiState.predict.lastPredictSnapshot?.report.report_status === 'partial');

  const missingCategory = makePredictHarness();
  delete missingCategory.categories.back3_2;
  await missingCategory.sandbox.loadPredict();
  check('Predict rejects an incomplete category envelope and does not create a snapshot', missingCategory.elements['predict-status'].textContent.includes('หมวดทำนายไม่ครบ') && missingCategory.sandbox.LotteryUiState.predict.lastPredictSnapshot == null);
  check('malformed Predict category clears all stale candidate rows', missingCategory.sandbox.LotteryServerData.predict.rows.length === 0 && missingCategory.elements['p1-tbody'].innerHTML.includes('หมวดทำนายไม่ครบ'));

  const wrongNumbersShape = makePredictHarness();
  wrongNumbersShape.categories.front3_1.numbers = '789';
  await wrongNumbersShape.sandbox.loadPredict();
  check('Predict rejects category candidates that are not an array', wrongNumbersShape.elements['predict-status'].textContent.includes('หมวดทำนายไม่ครบ') && wrongNumbersShape.sandbox.LotteryUiState.predict.lastPredictSnapshot == null);

  const malformedCandidate = makePredictHarness();
  malformedCandidate.categories.prize1.numbers = [{ num: '12345', score: 1 }];
  await malformedCandidate.sandbox.loadPredict();
  check('Predict rejects malformed candidates before renderers can throw or create a partial save', malformedCandidate.elements['predict-status'].textContent.includes('หมวดทำนายไม่ครบ') && malformedCandidate.sandbox.LotteryUiState.predict.lastPredictSnapshot == null);

  const leadingZeroPredict = makePredictHarness();
  Object.values(leadingZeroPredict.categories).forEach(category=>{delete category.error;});
  leadingZeroPredict.categories.prize1.numbers = [{ num: '012345', score: 1 }];
  leadingZeroPredict.categories.bottom2.numbers = [{ num: '07', score: 1 }];
  await leadingZeroPredict.sandbox.loadPredict();
  check('Predict preserves valid leading-zero candidates and creates a correctly targeted snapshot', leadingZeroPredict.sandbox.LotteryUiState.predict.lastPredictSnapshot?.items.some(item=>item.num==='012345') && leadingZeroPredict.sandbox.LotteryUiState.predict.lastPredictSnapshot?.items.some(item=>item.num==='07'));

  const stalePredict = makePredictHarness();
  stalePredict.categories.prize1.numbers = [{ num: '123456', score: 1 }];
  await stalePredict.sandbox.loadPredict();
  stalePredict.sandbox.api = async () => ({ error: 'synthetic network failure' });
  await stalePredict.sandbox.loadPredict();
  const failedP1 = stalePredict.elements['p1-tbody'].innerHTML;
  check('Predict top-level failure is announced without backend detail', stalePredict.elements['predict-status'].textContent.includes('โหลดผลทำนายไม่สำเร็จ') && !stalePredict.elements['predict-status'].textContent.includes('synthetic'));
  check('top-level Predict failure replaces old rows with a generic error', failedP1.includes('โหลดผลทำนายไม่สำเร็จ') && !failedP1.includes('synthetic') && !failedP1.includes('123456'));
  check('top-level Predict failure invalidates its previous saveable snapshot', stalePredict.sandbox.LotteryUiState.predict.lastPredictSnapshot == null);

  const invalidPredict = makePredictHarness();
  invalidPredict.sandbox.api = async () => ({ detail: [{ msg: 'internal validation detail' }] });
  await invalidPredict.sandbox.loadPredict();
  const invalidBody = invalidPredict.elements['p1-tbody'].innerHTML;
  check('Predict validation errors are announced without backend detail', invalidPredict.elements['predict-status'].textContent.includes('คำขอทำนายไม่ถูกต้อง') && !invalidPredict.elements['predict-status'].textContent.includes('internal validation detail'));
  check('Predict validation response has an actionable error, not an empty-data state', invalidBody.includes('คำขอทำนายไม่ถูกต้อง') && !invalidBody.includes('ไม่มีข้อมูล'));
  check('Predict validation response does not expose backend detail', !invalidBody.includes('internal validation detail'));

  const mismatchPredict = makePredictHarness();
  mismatchPredict.categories.prize1.numbers = [{ num: '123456', score: 1 }];
  await mismatchPredict.sandbox.loadPredict();
  mismatchPredict.categories.prize1.numbers = [{ num: '654321', score: 1 }];
  mismatchPredict.sandbox.api = async endpoint => endpoint.startsWith('predict/all')
    ? { date: '2026-11-01', categories: mismatchPredict.categories }
    : { data: [] };
  await mismatchPredict.sandbox.loadPredict();
  check('Predict rejects an otherwise valid response for a different draw', mismatchPredict.elements['predict-status'].textContent.includes('ไม่ตรงกับงวดที่เลือก') && !mismatchPredict.elements['p1-tbody'].innerHTML.includes('654321'));
  check('mismatched Predict response clears its prior saveable snapshot and rows', mismatchPredict.sandbox.LotteryUiState.predict.lastPredictSnapshot == null && mismatchPredict.sandbox.LotteryServerData.predict.rows.length === 0);
  check('mismatched Predict response disables Snapshot and clears the stale calculating label', mismatchPredict.elements['pred-save-snapshot'].disabled === true && !mismatchPredict.elements['predict-report-origin'].textContent.includes('กำลังคำนวณ'));
  check('mismatched Predict response does not call unrequested history a load failure', mismatchPredict.elements['ref-tbody'].innerHTML.includes('ยังไม่โหลดข้อมูลอ้างอิง เพราะไม่มีผลทำนายที่ตรวจสอบได้') && !mismatchPredict.elements['ref-tbody'].innerHTML.includes('โหลดข้อมูลอ้างอิงไม่สำเร็จ'));
  const missingDatePredict = makePredictHarness(endpoint => endpoint.startsWith('predict/all')
    ? { categories: mismatchPredict.categories }
    : { data: [] });
  await missingDatePredict.sandbox.loadPredict();
  check('Predict rejects an otherwise valid response with no target date', missingDatePredict.elements['predict-status'].textContent.includes('ไม่ตรงกับงวดที่เลือก') && missingDatePredict.sandbox.LotteryUiState.predict.lastPredictSnapshot == null);

  const refFailure = makePredictHarness();
  refFailure.sandbox.api = async path => path.startsWith('predict/all') ? targetedPredictResponse(path, refFailure.categories) : { error: 'synthetic history API failure' };
  await refFailure.sandbox.loadPredict();
  const refBody = refFailure.elements['ref-tbody'].innerHTML;
  check('Predict reference-data failure is announced', refFailure.elements['predict-status'].textContent.includes('โหลดข้อมูลอ้างอิงไม่สำเร็จ'));
  check('reference-history API failure is not misreported as no matching draw', refBody.includes('โหลดข้อมูลอ้างอิงไม่สำเร็จ') && !refBody.includes('ไม่พบงวดวันเดียวกัน'));

  const htmlPayload = '<img src=x onerror=alert(1)>';
  const xssPredict = makePredictHarness(path => path.startsWith('predict/all')
    ? targetedPredictResponse(path, { prize1: { numbers: [] }, front3_1: { numbers: [] }, front3_2: { numbers: [] }, back3_1: { numbers: [] }, back3_2: { numbers: [] }, bottom2: { numbers: [] } })
    : { data: [{ date: `16/10/2025${htmlPayload}`, prize1: `111111${htmlPayload}`, top3: `222${htmlPayload}`, top2: `33${htmlPayload}`, back3_1: `444${htmlPayload}`, back3_2: `555${htmlPayload}`, bottom2: `66${htmlPayload}` }] });
  await xssPredict.sandbox.loadPredict();
  const historyHtml = xssPredict.elements['ref-tbody'].innerHTML;
  const escapedHtmlPayload = '&lt;img src=x onerror=alert(1)&gt;';
  check('Predict history renders API date and prize fields as text, not HTML', !historyHtml.includes('<img') && historyHtml.split(escapedHtmlPayload).length - 1 === 7);

  const compare = makeCompareHarness();
  await compare.sandbox.loadPredictModeCompare('2026-10-16', 5, 500, 100);
  check('Predict mode compare errors are visible without exposing backend detail', compare.element.innerHTML.includes('เทียบโหมดไม่สำเร็จ') && !compare.element.innerHTML.includes('synthetic') && !compare.element.innerHTML.includes('dash-empty'));
  const mismatchCompare = makeCompareHarness();
  mismatchCompare.sandbox.api = async () => ({ date: '2026-11-01', predictions: [{ num: '987654' }] });
  await mismatchCompare.sandbox.loadPredictModeCompare('2026-10-16', 5, 500, 100);
  check('Predict method comparison rejects predictions for a different draw', mismatchCompare.element.innerHTML.includes('เทียบโหมดไม่สำเร็จ') && !mismatchCompare.element.innerHTML.includes('987654'));
  const missingDateCompare = makeCompareHarness();
  missingDateCompare.sandbox.api = async () => ({ predictions: [{ num: '987654' }] });
  await missingDateCompare.sandbox.loadPredictModeCompare('2026-10-16', 5, 500, 100);
  check('Predict method comparison rejects predictions with no target date', missingDateCompare.element.innerHTML.includes('เทียบโหมดไม่สำเร็จ') && !missingDateCompare.element.innerHTML.includes('987654'));
  const matchingCompare = makeCompareHarness();
  matchingCompare.sandbox.api = async () => ({ date: '2026-10-16', predictions: [{ num: '123456' }] });
  await matchingCompare.sandbox.loadPredictModeCompare('2026-10-16', 5, 500, 100);
  check('Predict method comparison keeps results for the selected draw', matchingCompare.element.innerHTML.includes('123456') && !matchingCompare.element.innerHTML.includes('เทียบโหมดไม่สำเร็จ'));
  const raceCompare = makeCompareHarness();
  const pendingCompare = [];
  raceCompare.sandbox.LotteryUiState.predict.requestId = 7;
  raceCompare.sandbox.api = () => new Promise(resolve => pendingCompare.push(resolve));
  const oldCompare = raceCompare.sandbox.loadPredictModeCompare('2026-10-16', 5, 500, 100);
  raceCompare.element.innerHTML = 'new target comparison loading';
  raceCompare.dateElement.value = '2026-11-01';
  raceCompare.sandbox.LotteryUiState.predict.requestId = 8;
  pendingCompare.forEach(resolve => resolve({ date: '2026-10-16', predictions: [{ num: '987654' }] }));
  await oldCompare;
  check('an older Predict mode comparison cannot overwrite the newer target state', raceCompare.element.innerHTML === 'new target comparison loading' && !raceCompare.element.innerHTML.includes('987654'));

  const snapshot = makeSnapshotHarness();
  snapshot.sandbox.loadPageSnapshot('predict', 'predict_fixture');
  check('saved snapshot date invalidates astra without initializing or requesting it', vm.runInContext('getAstraUiState().requestId===1&&!getAstraUiState().started', snapshot.sandbox));
  check('loading a saved Predict snapshot synchronizes all visible draw-date selectors', snapshot.dateIds.every(id => snapshot.elements[id].value === '2026-11-01'));
  check('the prediction request uses the saved snapshot date and shared date', snapshot.loaded.length === 1 && snapshot.loaded[0].pred === '2026-11-01' && snapshot.loaded[0].shared === '2026-11-01');

  const formulaSnapshot = makeSnapshotHarness();
  formulaSnapshot.sandbox.loadPageSnapshot('formula', 'predict_fixture');
  check('loading a formula snapshot marks prior autofilled values stale', formulaSnapshot.autoFillCalls.length === 1 && formulaSnapshot.autoFillCalls[0][0] === true);
  check('loading a formula snapshot adds its date and synchronizes every shared selector', formulaSnapshot.dateIds.every(id => formulaSnapshot.elements[id].value === '2026-11-01' && formulaSnapshot.elements[id].options.some(option => option.value === '2026-11-01')));
  formulaSnapshot.sandbox.LotteryUiState.navigation.predictionTab = 'formula';
  formulaSnapshot.sandbox.syncSharedDrawDate('2026-12-16', true);
  check('a user-driven shared-date change invalidates prior formula values', formulaSnapshot.autoFillCalls.length === 2 && formulaSnapshot.autoFillCalls[1][0] === true);
  check('shared draw-date changes invalidate Predict reports through the same target handler', formulaSnapshot.predictTargetSyncs.at(-1) === '2026-12-16');

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
  check('failed formula autofill remains retryable', formula.sandbox.LotteryUiState.formula.filled === false);
  const refreshFormula = makeFormulaHarness(true);
  await refreshFormula.sandbox.autoFillFormula();
  check('a failed shared-date formula refresh clears the prior autofilled state', refreshFormula.sandbox.LotteryUiState.formula.filled === false);

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
  pendingPredict[1]({ date: '2026-11-01', categories: raceCategories('222222') });
  await newPredict;
  pendingPredict[0]({ date: '2026-10-16', categories: raceCategories('111111') });
  await oldPredict;
  check('an older Predict response cannot overwrite newer date and results', predictRace.sandbox.LotteryUiState.predict.lastPredDate === '2026-11-01' && predictRace.elements['p1-tbody'].innerHTML.includes('222222') && !predictRace.elements['p1-tbody'].innerHTML.includes('111111'));

  const historyResponses = [];
  const historyRace = makePredictHarness(endpoint => {
    if (endpoint.startsWith('predict/all')) return Promise.resolve(targetedPredictResponse(endpoint, raceCategories(endpoint.includes('date=2026-11-01') ? '222222' : '111111')));
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
  await directFormula.sandbox.runAllFormulas();
  check('direct Calculate handler cannot start with autofill pending', !directFormula.calls.includes('calculation:started'));
  rejectFormulaHistory(new Error('synthetic history failure'));
  await formulaAutofill;
  check('failed date autofill leaves stale values blank and re-enables manual entry', directFormula.staleInputIds.every(id => directFormula.elements[id].value === '') && directFormula.inputIds.every(id => directFormula.elements[id].disabled === false) && directFormula.elements['f-run-formulas'].disabled === false);
  const savesBeforeFailureSnapshot = directFormula.sandbox.saves.length;
  directFormula.sandbox.formulaSaveSnapshot();
  check('formula snapshot is unavailable after failed autofill until a calculation succeeds', directFormula.sandbox.saves.length === savesBeforeFailureSnapshot);
  ['123456', '456', '12', '123', '456', '789', '987', '1'].forEach((value, i) => { directFormula.elements[directFormula.inputIds[i]].value = value; });
  await directFormula.sandbox.runAllFormulas();
  check('manual formula values remain calculable after autofill failure', directFormula.calls.includes('calculation:started'));
  directFormula.sandbox.LotteryUiState.formula.hasRun = true;
  directFormula.sandbox.syncFormulaSnapshotButton();
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

  check('initFormulaPage does not replace the current autofill state with a stale false result', !extractFunction(engineSrc, 'initFormulaPage').includes('LotteryUiState.formula.filled=await autoFillFormula()'));

  const mixPageStart = indexSrc.indexOf('<div class="page" id="page-mix">');
  const mixNoticeStart = indexSrc.indexOf('<div class="mix-record-notice" id="mix-record-notice"', mixPageStart);
  const mixTargetStart = indexSrc.indexOf('<div class="ctrl-row">', mixPageStart);
  const mixRootStart = indexSrc.indexOf('<div id="mix-root"', mixPageStart);
  const mixNotice = indexSrc.slice(mixNoticeStart, mixTargetStart);
  check('Mix discloses first-result auto-registration before target and action controls', mixPageStart >= 0 && mixNoticeStart > mixPageStart && mixNoticeStart < mixTargetStart && mixTargetStart < mixRootStart && mixNotice.includes('role="note"') && mixNotice.includes('อัตโนมัติ'));
  check('Mix notice explains immutable first results and save-failure status', mixNotice.includes('ไม่เขียนทับชุดแรก') && mixNotice.includes('บันทึกไม่สำเร็จ'));
  check('Mix first-run notice uses visible HyperUI surface styling', cssSrc.includes('.mix-record-notice{display:flex') && cssSrc.includes('background:var(--surface2)') && cssSrc.includes('border-radius:var(--radius-btn)'));

  const mixPage = makeMixPageHarness();
  await mixPage.sandbox.loadMixPage();
  const mixRoot = mixPage.elements['mix-root'];
  check('Mix announces when its result sets are ready', mixPage.elements['mix-status'].textContent === 'ผสมเลขเสร็จแล้ว 10 ชุด');
  check('Mix labels its rank-weighted random selection clearly', mixRoot.innerHTML.includes('สุ่ม 1 เลข · ถ่วงตามอันดับ') && mixRoot.innerHTML.includes('อันดับต้นมีน้ำหนักสุ่มมากกว่าอันดับท้าย'));
  check('Mix predictions remain visible when snapshot storage fails', mixRoot.innerHTML.includes('000000') && !mixRoot.textContent.includes('โหลดหน้านี้ไม่สำเร็จ'));
  check('Mix page reports that auto-saving history failed', mixRoot.innerHTML.includes('บันทึกประวัติ Mix ไม่สำเร็จ'));
  const weightedMix = makeMixPageHarness({ Math: Object.assign(Object.create(Math), { random: () => 0 }) });
  weightedMix.sandbox.LotteryServerData.mix.predictions = ['111111', '222222'];
  weightedMix.sandbox.mixRandomPick();
  check('Mix shows the selected rank and its share of random-selection weight', weightedMix.elements['mix-random-result'].innerHTML.includes('111111') && weightedMix.elements['mix-random-result'].innerHTML.includes('น้ำหนัก 2/3'));
  const firstSavedMix = makeMixPageHarness({ storageFails: false });
  await firstSavedMix.sandbox.loadMixPage();
  check('Mix tells the user when the first result for a draw was saved', firstSavedMix.elements['mix-root'].innerHTML.includes('บันทึกชุด Mix แรกของงวดนี้แล้ว'));
  check('Mix first result is stored once for the selected draw', JSON.parse(firstSavedMix.sandbox.localStorage.getItem('lottery_mix_snapshots')).length === 1);
  const malformedMixHistory = makeMixPageHarness({ storageFails: false, snapshotRaw: '{broken mix history' });
  await malformedMixHistory.sandbox.loadMixPage();
  check('corrupt Mix history does not block the current calculation', malformedMixHistory.elements['mix-root'].dataset.state === 'ready' && malformedMixHistory.elements['mix-root'].innerHTML.includes('000000'));
  check('corrupt Mix history is shown as an alert with backup and retry actions', malformedMixHistory.elements['mix-root'].innerHTML.includes('role="alert"') && malformedMixHistory.elements['mix-root'].innerHTML.includes('mixDownloadSnapshotBackup()') && malformedMixHistory.elements['mix-root'].innerHTML.includes('ลองอ่านอีกครั้ง'));
  check('automatic Mix save leaves malformed history bytes untouched', malformedMixHistory.snapshotRaw === '{broken mix history');
  check('direct Mix autosave refuses to replace an unreadable history', malformedMixHistory.sandbox.mixAutoSaveSnapshot({ date: '2026-10-16', picks: ['111111'] }, null) === false && malformedMixHistory.snapshotRaw === '{broken mix history');
  check('Mix backup downloads the exact original bytes without rewriting storage', malformedMixHistory.sandbox.mixDownloadSnapshotBackup() === true && malformedMixHistory.downloads.includes('{broken mix history') && malformedMixHistory.snapshotRaw === '{broken mix history');
  const malformedDeleteMix = makeMixPageHarness({ storageFails: false, snapshotRaw: '{broken mix history' });
  check('Mix delete-one refuses unreadable history without entering the shared delete flow', malformedDeleteMix.sandbox.mixDeleteSnapshot('2026-10-16') === false && malformedDeleteMix.deleteCalls === 0 && malformedDeleteMix.snapshotRaw === '{broken mix history');
  check('Mix delete-all refuses unreadable history before showing confirmation', malformedDeleteMix.sandbox.mixClearSnapshots() === false && malformedDeleteMix.confirmCalls === 0 && malformedDeleteMix.deleteCalls === 0);
  const nonArrayMixHistory = makeMixPageHarness({ storageFails: false, snapshotRaw: '{"date":"2026-10-16"}' });
  await nonArrayMixHistory.sandbox.loadMixPage();
  check('non-array Mix history renders as malformed and is not overwritten', nonArrayMixHistory.elements['mix-root'].innerHTML.includes('รูปแบบข้อมูลไม่ถูกต้อง') && nonArrayMixHistory.snapshotRaw === '{"date":"2026-10-16"}');
  const malformedRecordMix = makeMixPageHarness({ storageFails: false, snapshotRaw: '[null]' });
  await malformedRecordMix.sandbox.loadMixPage();
  check('invalid Mix record shape is retained as an error instead of an empty ledger', malformedRecordMix.elements['mix-root'].innerHTML.includes('อ่านประวัติ Mix ไม่ได้') && malformedRecordMix.snapshotRaw === '[null]');
  const malformedPickRaw = JSON.stringify([{ date: '2026-10-16', picks: [123456] }]);
  const malformedPicksMix = makeMixPageHarness({ storageFails: false, snapshotRaw: malformedPickRaw });
  await malformedPicksMix.sandbox.loadMixPage();
  check('malformed stored Mix picks show recovery instead of scoring a miss', malformedPicksMix.elements['mix-root'].innerHTML.includes('อ่านประวัติ Mix ไม่ได้') && malformedPicksMix.snapshotRaw === malformedPickRaw && !malformedPicksMix.elements['mix-root'].innerHTML.includes('ตรวจไม่ได้'));
  check('malformed stored Mix picks block automatic save and deletion without mutating bytes', malformedPicksMix.sandbox.mixAutoSaveSnapshot({ date: '2026-11-01', picks: ['111111'] }) === false && malformedPicksMix.sandbox.mixDeleteSnapshot('2026-10-16') === false && malformedPicksMix.snapshotRaw === malformedPickRaw);
  const unavailableMixHistory = makeMixPageHarness({ storageReadFails: true, storageFails: false });
  await unavailableMixHistory.sandbox.loadMixPage();
  check('Mix read exceptions show a distinct recoverable storage error and preserve calculation output', unavailableMixHistory.elements['mix-root'].innerHTML.includes('เบราว์เซอร์ไม่อนุญาตให้อ่านข้อมูล') && unavailableMixHistory.elements['mix-root'].innerHTML.includes('000000'));
  check('Mix read exceptions block automatic save', unavailableMixHistory.sandbox.LotteryUiState.mix.snapshotReadError === 'unavailable' && unavailableMixHistory.sandbox.mixAutoSaveSnapshot({ date: '2026-10-16', picks: [] }, null) === false);
  check('Mix delete-one and delete-all also refuse storage read exceptions', unavailableMixHistory.sandbox.mixDeleteSnapshot('2026-10-16') === false && unavailableMixHistory.sandbox.mixClearSnapshots() === false && unavailableMixHistory.deleteCalls === 0 && unavailableMixHistory.confirmCalls === 0);
  const emptyMixLedger = makeMixHarness([]);
  check('a valid missing or empty Mix ledger remains a normal empty history', Array.isArray(emptyMixLedger.mixSnapshots()) && emptyMixLedger.mixSnapshots().length === 0);
  check('a missing-key Mix ledger still renders the normal empty state', emptyMixLedger.mixTrackHtml([]).includes('ยังไม่มีประวัติ') && !emptyMixLedger.mixTrackHtml([]).includes('อ่านประวัติ Mix ไม่ได้'));
  emptyMixLedger.localStorage.getItem = () => null;
  check('a truly missing Mix storage key remains a valid empty ledger', Array.isArray(emptyMixLedger.mixSnapshots()) && emptyMixLedger.mixSnapshots().length === 0 && emptyMixLedger.mixTrackHtml([]).includes('ยังไม่มีประวัติ'));
  const legacyMixLedger = makeMixHarness([{ date: '2026-01-03' }]);
  check('legacy Mix snapshots without a picks field remain readable and are not discarded', Array.isArray(legacyMixLedger.mixSnapshots()) && legacyMixLedger.mixTrackHtml([]).includes('ไม่มีชุดให้ตรวจ'));
  const blockedWriteRaw = JSON.stringify([{ date: '2026-10-01', picks: ['123456'] }]);
  const blockedMixWrite = makeMixPageHarness({ snapshotRaw: blockedWriteRaw });
  await blockedMixWrite.sandbox.loadMixPage();
  check('a blocked Mix snapshot write preserves valid prior ledger bytes', blockedMixWrite.snapshotRaw === blockedWriteRaw && blockedMixWrite.elements['mix-root'].innerHTML.includes('บันทึกประวัติ Mix ไม่สำเร็จ'));
  const retainedMix = makeMixPageHarness({ storageFails: false, snapshots: [{ date: '2026-10-16', picks: ['999999'] }] });
  await retainedMix.sandbox.loadMixPage();
  check('Mix explains when the registered first result is retained', retainedMix.elements['mix-root'].innerHTML.includes('ประวัติจะคงชุดแรกและไม่เขียนทับ'));
  check('reopening Mix does not replace the registered first result', JSON.parse(retainedMix.sandbox.localStorage.getItem('lottery_mix_snapshots'))[0].picks[0] === '999999');
  const readOnlyRetainedMix = makeMixPageHarness({ reportStoreWritable: false, snapshots: [{ date: '2026-10-16', picks: ['888888'] }] });
  await readOnlyRetainedMix.sandbox.loadMixPage();
  check('Mix treats an existing first result as retained without requiring write access', readOnlyRetainedMix.elements['mix-root'].innerHTML.includes('ประวัติจะคงชุดแรกและไม่เขียนทับ') && !readOnlyRetainedMix.elements['mix-root'].innerHTML.includes('บันทึกประวัติ Mix ไม่สำเร็จ'));
  check('read-only Mix storage preserves the existing registered result', JSON.parse(readOnlyRetainedMix.sandbox.localStorage.getItem('lottery_mix_snapshots'))[0].picks[0] === '888888');
  const unsafeMixDate = `2026-10-16');window.__mixXss=true;//`;
  const unsafeMix = makeMixPageHarness({ storageFails: false, snapshots: [{ date: unsafeMixDate, picks: ['111111'] }, { date: '2026-10-01', picks: ['222222'] }] });
  const unsafeMixHtml = unsafeMix.sandbox.mixTrackHtml([], [{ date: unsafeMixDate, picks: ['111111'] }]);
  check('Mix delete handler keeps saved dates in escaped data instead of JavaScript source', unsafeMixHtml.includes(`data-mix-date="${unsafeMix.sandbox.escHtml(unsafeMixDate)}" onclick="mixDeleteSnapshot(this.dataset.mixDate)"`) && !unsafeMixHtml.includes(`onclick="mixDeleteSnapshot('${unsafeMixDate}`));
  check('Mix can still delete only the snapshot whose saved date contains an apostrophe', unsafeMix.sandbox.mixDeleteSnapshot(unsafeMixDate) === true && JSON.parse(unsafeMix.snapshotRaw).length === 1 && JSON.parse(unsafeMix.snapshotRaw)[0].date === '2026-10-01');
  const focusMix = makeMixPageHarness({ storageFails: false, snapshots: [
    { date: '2026-10-01', picks: ['000001'] },
    { date: '2026-10-16', picks: ['000002'] },
    { date: '2026-11-01', picks: ['000003'] },
  ] });
  check('Mix snapshot delete actions have positional IDs and the empty state can receive focus', focusMix.sandbox.mixTrackHtml([], JSON.parse(focusMix.snapshotRaw)).includes('id="mix-history-delete-2"') && /<div id="mix-history-empty" class="dash-empty" tabindex="-1">/.test(focusMix.sandbox.mixTrackHtml([], [])));
  check('deleting a middle Mix snapshot returns focus to the next record at that position', focusMix.sandbox.mixDeleteSnapshot('2026-10-16') === true && focusMix.focused.at(-1) === 'mix-history-delete-1');
  check('deleting the final Mix snapshot returns focus to the preceding record', focusMix.sandbox.mixDeleteSnapshot('2026-11-01') === true && focusMix.focused.at(-1) === 'mix-history-delete-0');
  check('deleting the last Mix snapshot returns focus to the empty-history message', focusMix.sandbox.mixDeleteSnapshot('2026-10-01') === true && focusMix.focused.at(-1) === 'mix-history-empty');
  const clearMix = makeMixPageHarness({ storageFails: false, snapshots: [
    { date: '2026-10-01', picks: ['000001'] },
    { date: '2026-10-16', picks: ['000002'] },
  ] });
  check('clearing all Mix history moves focus to its empty-state message', clearMix.sandbox.mixClearSnapshots() === true && clearMix.focused.at(-1) === 'mix-history-empty' && clearMix.sandbox.mixSnapshots().length === 0);
  const canceledClearMix = makeMixPageHarness({ storageFails: false, confirm: false, snapshots: [{ date: '2026-10-01', picks: ['000001'] }] });
  check('canceling Mix clear-all preserves history and leaves focus on the existing page', canceledClearMix.sandbox.mixClearSnapshots() === false && canceledClearMix.focused.length === 0 && JSON.parse(canceledClearMix.snapshotRaw).length === 1);
  const failedMix = makeMixPageHarness({ api: async () => ({ error: 'synthetic unavailable' }) });
  await failedMix.sandbox.loadMixPage();
  check('Mix API failure is shown as a recoverable error with an in-place retry', failedMix.elements['mix-root'].dataset.state === 'error' && failedMix.elements['mix-root'].innerHTML.includes('onclick="loadMixPage()"'));
  check('Mix failure clears stale predictions instead of leaving an old random-pick pool', failedMix.sandbox.LotteryServerData.mix.predictions.length === 0 && failedMix.elements['mix-status'].textContent.includes('ไม่สำเร็จ'));
  const emptyMix = makeMixPageHarness({ api: async () => ({ data: [] }) });
  await emptyMix.sandbox.loadMixPage();
  check('valid empty history is distinct from an API error and remains retryable', emptyMix.elements['mix-root'].dataset.state === 'empty' && emptyMix.elements['mix-root'].innerHTML.includes('ยังไม่มีข้อมูลย้อนหลัง'));

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
