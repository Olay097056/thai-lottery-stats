// Regression contract for report freshness after the shared cache refresh.
// Run with: node scripts/test_refresh_stale_reports_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('static/dashboard-ui.js');
const reportCore = read('static/report-core.js');
const predict = read('static/prediction-ui.js');
const formula = read('static/formula-engine.js');
const calculators = read('static/formula-calculators.js');
const mix = read('static/mix-ui.js');
const mixSupport = read('static/mix-support.js');
const buyplan = read('static/buyplan-ui.js');
const astra = read('static/astra-ui.js');

function extract(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'm').exec(source);
  if (!match) throw new Error('missing function: ' + name);
  let i = match.index + match[0].length, depth = 1;
  while (i < source.length && depth) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  if (depth) throw new Error('unterminated function: ' + name);
  return source.slice(match.index, i);
}

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error('FAIL: ' + label);
  passed++;
}
function classList() {
  const names = new Set();
  return { add: name => names.add(name), remove: name => names.delete(name), contains: name => names.has(name) };
}

async function main() {
  const refresh = extract(dashboard, 'refreshData');
  const refreshCalls = { stale: [], broadcasts: [], dashboards: 0, predict: 0, mix: 0, buyplan: 0 };
  let nextVersion = 'new';
  const refreshHarness = {
    LotteryServerData: { health: { report: { data_version: 'old' } } },
    api: async endpoint => endpoint === 'refresh' ? { rows: 12 } : null,
    loadDataStatus: async () => {
      const report = { data_version: nextVersion };
      refreshHarness.LotteryServerData.health.report = report;
      return report;
    },
    markLotteryReportsStale: value => refreshCalls.stale.push(value),
    broadcastLotteryReportsStale: value => refreshCalls.broadcasts.push(value),
    loadDashboard: () => { refreshCalls.dashboards++; },
    loadPredict: () => { refreshCalls.predict++; },
    loadMixPage: () => { refreshCalls.mix++; },
    loadBuyPlan: () => { refreshCalls.buyplan++; },
    toast: () => {},
  };
  vm.runInNewContext(refresh, refreshHarness);
  await refreshHarness.refreshData();
  check('changed cache fingerprint marks reports stale', refreshCalls.stale.length === 1 && refreshCalls.stale[0].verified === true);
  check('changed cache fingerprint broadcasts a verified stale signal', refreshCalls.broadcasts.length === 1 && refreshCalls.broadcasts[0].verified === true);
  check('global refresh does not recompute or register reports', refreshCalls.predict === 0 && refreshCalls.mix === 0 && refreshCalls.buyplan === 0);
  nextVersion = 'new';
  await refreshHarness.refreshData();
  check('unchanged cache fingerprint leaves reports current', refreshCalls.stale.length === 1);
  check('unchanged cache fingerprint sends no cross-tab signal', refreshCalls.broadcasts.length === 1);
  refreshHarness.LotteryServerData.health.report = { data_version: null };
  nextVersion = 'unknown';
  await refreshHarness.refreshData();
  check('unverifiable cache fingerprint conservatively marks reports stale', refreshCalls.stale.length === 2 && refreshCalls.stale[1].verified === false);
  check('unverifiable cache fingerprint broadcasts a conservative stale signal', refreshCalls.broadcasts.length === 2 && refreshCalls.broadcasts[1].verified === false);

  const reportState = { health: { dataEpoch: 4 } };
  const staleFeatures = [];
  const freshnessHarness = {
    LotteryUiState: reportState,
    markPredictDataStale: message => staleFeatures.push(['predict', message]),
    markFormulaDataStale: message => staleFeatures.push(['formula', message]),
    markMixDataStale: message => staleFeatures.push(['mix', message]),
    markBuyPlanDataStale: message => staleFeatures.push(['buyplan', message]),
    AstraFeature: { markDataStale: message => staleFeatures.push(['astra', message]) },
    window: null,
  };
  freshnessHarness.window = freshnessHarness;
  vm.runInNewContext(extract(reportCore, 'markLotteryReportsStale'), freshnessHarness);
  freshnessHarness.markLotteryReportsStale({ verified: true });
  check('cache refresh advances the shared request epoch', reportState.health.dataEpoch === 5);
  check('cache refresh notifies every derived report view', staleFeatures.map(row => row[0]).join(',') === 'predict,formula,mix,buyplan,astra');

  const channelBus = new Map();
  class FakeBroadcastChannel {
    constructor(name) { this.name = name; this.listeners = []; const peers = channelBus.get(name) || []; peers.push(this); channelBus.set(name, peers); }
    addEventListener(name, callback) { if (name === 'message') this.listeners.push(callback); }
    postMessage(data) { for (const peer of channelBus.get(this.name) || []) if (peer !== this) for (const listener of peer.listeners) listener({ data }); }
  }
  function createTabHarness() {
    const events = [];
    const harness = {
      BroadcastChannel: FakeBroadcastChannel,
      LotteryUiState: { health: { dataEpoch: 0 } },
      markPredictDataStale: message => events.push(['predict', message]),
      markFormulaDataStale: message => events.push(['formula', message]),
      markMixDataStale: message => events.push(['mix', message]),
      markBuyPlanDataStale: message => events.push(['buyplan', message]),
      AstraFeature: { markDataStale: message => events.push(['astra', message]) },
      events,
    };
    harness.window = harness;
    vm.runInNewContext(reportCore, harness);
    return harness;
  }
  const senderTab = createTabHarness();
  const receiverTab = createTabHarness();
  senderTab.broadcastLotteryReportsStale({ verified: true });
  check('open sibling tab advances its epoch when another tab refreshes', receiverTab.LotteryUiState.health.dataEpoch === 1);
  check('open sibling tab invalidates all five report families', receiverTab.events.map(row => row[0]).join(',') === 'predict,formula,mix,buyplan,astra');
  check('verified cross-tab refresh keeps its verified message', receiverTab.events.every(row => row[1].includes('อัปเดตแล้ว')));
  senderTab.broadcastLotteryReportsStale({ verified: false });
  check('unverified cross-tab refresh also invalidates sibling reports', receiverTab.LotteryUiState.health.dataEpoch === 2 && receiverTab.events.length === 10);
  check('unverified cross-tab refresh carries conservative copy', receiverTab.events.slice(5).every(row => row[1].includes('ยืนยันเวอร์ชัน')));

  const storageListeners = new Map();
  const fakeLocalStorage = {
    setItem(key, newValue) {
      for (const [owner, listener] of storageListeners) if (owner !== this.owner) listener({ key, newValue });
    },
    removeItem() {},
  };
  function createStorageTab() {
    const events = [];
    const harness = {
      LotteryUiState: { health: { dataEpoch: 0 } },
      markPredictDataStale: message => events.push(['predict', message]),
      markFormulaDataStale: message => events.push(['formula', message]),
      markMixDataStale: message => events.push(['mix', message]),
      markBuyPlanDataStale: message => events.push(['buyplan', message]),
      AstraFeature: { markDataStale: message => events.push(['astra', message]) },
      addEventListener(name, listener) { if (name === 'storage') storageListeners.set(this, listener); },
      localStorage: fakeLocalStorage,
      events,
    };
    harness.window = harness;
    vm.runInNewContext(reportCore, harness);
    return harness;
  }
  const storageSender = createStorageTab();
  fakeLocalStorage.owner = storageSender;
  const storageReceiver = createStorageTab();
  storageSender.broadcastLotteryReportsStale({ verified: true });
  check('storage-event fallback also marks a sibling tab stale', storageReceiver.LotteryUiState.health.dataEpoch === 1 && storageReceiver.events.length === 5);

  const noticeElements = Object.create(null);
  const target = { before(node) { this.inserted = node; } };
  const noticeHarness = {
    document: {
      getElementById: id => noticeElements[id] || (id === 'mix-root' ? target : null),
      createElement: tag => ({ tagName: tag, children: [], attributes: {}, listeners: {}, dataset: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        append(...nodes) { this.children.push(...nodes); },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        remove() { this.removed = true; },
      }),
    },
  };
  vm.runInNewContext(extract(reportCore, 'showCacheRefreshNotice'), noticeHarness);
  let recomputed = 0;
  noticeHarness.showCacheRefreshNotice('mix-data-refresh-notice', 'mix-root', 'ผล Mix เก่า', 'โหลดใหม่ได้', 'ผสมเลขใหม่', () => recomputed++);
  const staleNotice = target.inserted;
  check('stale notice is inserted before the affected report section', staleNotice?.id === 'mix-data-refresh-notice');
  check('stale notice has a polite status role and a labeled action', staleNotice?.attributes.role === 'status' && staleNotice.children[1].children[2].textContent === 'ผสมเลขใหม่');
  staleNotice.children[1].children[2].listeners.click();
  check('stale notice action invokes its recompute callback', recomputed === 1);

  const predictElements = Object.create(null);
  const getPredict = id => predictElements[id] || (predictElements[id] = { disabled: false, title: '', innerHTML: '', textContent: '', classList: classList() });
  const predictState = { sourceStale: false, lastPredictSnapshot: { date: '2026-10-16' }, isLoading: true, requestId: 8, lastPredictStatus: '' };
  const predictHarness = {
    LotteryUiState: { predict: predictState }, LotteryServerData: { predict: { rows: [] } },
    document: { getElementById: getPredict }, escHtml: value => String(value),
    setPredictLoading: () => {}, setPageStatus: (_id, value) => { predictHarness.status = value; },
  };
  vm.runInNewContext(extract(predict, 'markPredictDataStale'), predictHarness);
  predictHarness.markPredictDataStale('ข้อมูลย้อนหลังอัปเดตแล้ว');
  check('Predict invalidates an in-flight request and blocks stale snapshots', predictState.sourceStale && predictState.requestId === 9 && !predictState.isLoading && getPredict('pred-save-snapshot').disabled);
  check('Predict gives an in-context recompute action', getPredict('predict-report-origin').innerHTML.includes('คำนวณ Predict ใหม่'));
  check('Predict snapshot handler refuses stale output', extract(predict, 'predictSaveSnapshot').includes('sourceStale'));

  const formulaElements = Object.create(null);
  const getFormula = id => formulaElements[id] || (formulaElements[id] = { disabled: false, innerHTML: '', classList: classList() });
  const formulaState = { activeTab: 'LUNA', hasRun: true, autoFillPending: false, autoFillRequestId: 2, sourceStale: false };
  const formulaHarness = {
    LotteryUiState: { formula: formulaState }, LotteryServerData: { formula: { history: [] } },
    _formulaCalculationRequestId: 5, _formulaCalculationPending: true,
    document: { getElementById: getFormula }, escHtml: value => String(value),
    _setFormulaAutoFillPending: () => {}, syncFormulaSnapshotButton: () => {}, setPageStatus: () => {},
  };
  formulaHarness.window = formulaHarness;
  vm.runInNewContext(extract(formula, 'markFormulaDataStale'), formulaHarness);
  formulaHarness.markFormulaDataStale('ข้อมูลย้อนหลังอัปเดตแล้ว');
  check('Formula cancels old async work and marks the result stale', formulaState.sourceStale && formulaState.autoFillRequestId === 3 && formulaHarness._formulaCalculationRequestId === 6);
  check('Formula exposes a fresh-history recompute action', getFormula('formula-report-origin').innerHTML.includes('recomputeFormulaAfterCacheRefresh'));
  check('Formula calculation refuses stale cached inputs', extract(calculators, '_runAllFormulas').includes('sourceStale'));
  check('Formula snapshot handler blocks stale output', extract(predict, 'formulaSaveSnapshot').includes('sourceStale'));
  const formulaRecompute = extract(formula, 'recomputeFormulaAfterCacheRefresh');
  check('Formula tells the user that source reload replaces the current number fields', formulaRecompute.includes('window.confirm') && formulaRecompute.includes('autoFillFormula(true)'));
  check('Formula checks the cache epoch before calculation', formulaRecompute.includes('dataEpoch'));
  const historyOnlyState = { activeTab: 'A', hasRun: false, autoFillPending: false, autoFillRequestId: 0, sourceStale: false };
  const historyOnlyHarness = {
    LotteryUiState: { formula: historyOnlyState }, LotteryServerData: { formula: { history: [{ date: '01/10/2026' }] } },
    window: { _formulaCalculationRequestId: 0, _formulaCalculationPending: false }, document: { getElementById: getFormula },
    escHtml: value => String(value), _setFormulaAutoFillPending: () => {}, syncFormulaSnapshotButton: () => {}, setPageStatus: () => {},
  };
  historyOnlyHarness.window = historyOnlyHarness;
  vm.runInNewContext(extract(formula, 'markFormulaDataStale'), historyOnlyHarness);
  historyOnlyHarness.markFormulaDataStale('ข้อมูลย้อนหลังอัปเดตแล้ว');
  check('Formula marks cached history stale even before the first calculation', historyOnlyState.sourceStale);

  const mixElements = Object.create(null);
  const getMix = id => mixElements[id] || (mixElements[id] = { dataset: { state: 'ready' }, setAttribute(name, value) { this[name] = value; } });
  const mixState = { sourceStale: false, loadRequestId: 10 };
  const mixHarness = {
    LotteryUiState: { mix: mixState }, LotteryServerData: { mix: { history: [{}], predictions: ['000001'] } },
    document: { getElementById: getMix },
    showCacheRefreshNotice: (...args) => { mixHarness.notice = args; }, setPageStatus: () => {},
  };
  vm.runInNewContext(extract(mix, 'markMixDataStale'), mixHarness);
  mixHarness.markMixDataStale('ข้อมูลย้อนหลังอัปเดตแล้ว');
  check('Mix invalidates in-flight work without recalculating', mixState.sourceStale && mixState.loadRequestId === 11 && mixHarness.notice[4] === 'ผสมเลขใหม่');
  check('Mix disables stale random and Buy Plan handoff controls', extract(mix, 'markMixDataStale').includes('button.disabled=true'));
  check('Mix random pick refuses stale output', extract(mixSupport, 'mixRandomPick').includes('sourceStale'));
  check('Mix handoff refuses stale output', extract(buyplan, 'bpFromMix').includes('LotteryUiState.mix.sourceStale'));

  const buyPlanElements = Object.create(null);
  const buyPlanRoot = { dataset: { state: 'ready' }, setAttribute(name, value) { this[name] = value; }, querySelector: () => null };
  buyPlanElements['bp-plan-root'] = buyPlanRoot;
  const getBuyPlan = id => buyPlanElements[id] || null;
  const draft = { date: '2026-10-16', rows: [{ num: '000123', stake: 20 }] };
  const buyPlanState = { sourceStale: false, loadRequestId: 3, workingPlan: draft, workingPlanTouched: true };
  const buyPlanHarness = {
    LotteryUiState: { buyplan: buyPlanState }, document: { getElementById: getBuyPlan },
    showCacheRefreshNotice: (...args) => { buyPlanHarness.notice = args; }, bpAnnounceStatus: () => {},
  };
  vm.runInNewContext(extract(buyplan, 'markBuyPlanDataStale'), buyPlanHarness);
  buyPlanHarness.markBuyPlanDataStale('ข้อมูลย้อนหลังอัปเดตแล้ว');
  check('Buy Plan marks stale while preserving the edited draft object', buyPlanState.sourceStale && buyPlanState.loadRequestId === 4 && buyPlanState.workingPlan === draft && buyPlanState.workingPlanTouched);
  check('Buy Plan stale notice uses the confirmed rebuild flow', buyPlanHarness.notice[4] === 'คำนวณแผนจากข้อมูลล่าสุด' && typeof buyPlanHarness.notice[5] === 'function');
  check('Buy Plan save handler refuses a stale plan', extract(buyplan, 'bpSaveCurrentPlan').includes('sourceStale'));
  check('Buy Plan forced rebuild retains discard confirmation', extract(buyplan, 'loadBuyPlan').includes('bpConfirmDraftDiscard(action)'));
  check('Astra keeps its report while invalidating old request generations', astra.includes("function markDataStale(message)") && astra.includes("ui.requestId++") && astra.includes("ui.sigmaRequestId++"));

  console.log(`Refresh stale-report contract: ${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
