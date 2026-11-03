// Regression tests for Buy Plan request ordering and API failure states.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrcRaw = require('./frontend_source').readFrontend('app.js');
const appSrc = appSrcRaw.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');
const dom = Object.create(null);
let selectedDate = '2026-10-01';
dom['bp-plan-root'] = { className: '', textContent: '', innerHTML: '', dataset: {}, setAttribute(name, value) { this[name] = String(value); } };
dom['bp-date'] = { options: { length: 1 }, get value() { return selectedDate; }, set value(value) { selectedDate = value; } };
const sandbox = {
  console,
  document: {
    getElementById: id => dom[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: () => {},
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(new Error('network disabled in harness')),
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
require('./frontend_source').prepareContext(sandbox);
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

sandbox.dcComputeFormulaResults = (_rows, date) => [{ date }];
sandbox.dcBuildPredictFormulaMatches = (_cats, results) => results;
sandbox.dcFormulaBacktestRows = () => [];
sandbox.dcSecondaryPrizeSignals = () => [];
sandbox.dcBuildScoreRows = ({ cats }) => ({ all: [{ sourceMarker: cats.sourceMarker }] });
sandbox.dcRecommendedNumbers = () => ({});
sandbox._mixCompute = () => ({ preds: [] });
sandbox.renders = [];
sandbox.recordBuyPlanPaint = () => sandbox.renders.push({
  selectedDate,
  workingDate: vm.runInContext('LotteryUiState.buyplan.workingPlan?.date', sandbox),
  sourceMarker: vm.runInContext('LotteryServerData.buyplan.sources?.scoreRows?.[0]?.sourceMarker', sandbox),
});
vm.runInContext('bpPaint = function(){ window.recordBuyPlanPaint(); }', sandbox);
const requiredCategories = ['prize1', 'front3_1', 'front3_2', 'back3_1', 'back3_2', 'bottom2'];
function prediction(date, sourceMarker, reportStatus = 'ready') {
  return { date, report_status: reportStatus,
    categories: Object.assign(Object.fromEntries(requiredCategories.map(key => [key, { label: key, numbers: [] }])), { sourceMarker }) };
}
function history() { return { data: [{ date: '01/01/2026', prize1: '111111' }] }; }

async function main() {
  const predA = deferred(), histA = deferred(), predB = deferred(), histB = deferred();
  sandbox.api = endpoint => {
    const date = endpoint.match(/date=([^&]+)/)?.[1];
    if (endpoint.startsWith('predict/all') && date === '2026-10-01') return predA.promise;
    if (endpoint.startsWith('predict/all') && date === '2026-10-16') return predB.promise;
    if (endpoint === 'prize-history?n=260') {
      return sandbox.historyRequestCount++ === 0 ? histA.promise : histB.promise;
    }
    return Promise.resolve({});
  };
  sandbox.historyRequestCount = 0;

  sandbox.LotteryServerData.buyplan.sources = { scoreRows: [{ sourceMarker: 'old-draw' }] };
  sandbox.LotteryUiState.buyplan.workingPlan = { date: '2026-09-16', rows: [] };
  selectedDate = '2026-10-01';
  const loadA = sandbox.loadBuyPlan();
  check('starting a new Buy Plan load immediately invalidates the old editable plan and sources', sandbox.LotteryServerData.buyplan.sources === null && sandbox.LotteryUiState.buyplan.workingPlan === null);
  selectedDate = '2026-10-16';
  const loadB = sandbox.loadBuyPlan();
  predB.resolve(prediction('2026-10-16', 'newer-date'));
  histB.resolve(history());
  await loadB;
  predA.resolve(prediction('2026-10-01', 'older-date'));
  histA.resolve(history());
  await loadA;
  const latest = sandbox.renders.at(-1);
  check('late response for an older draw date cannot replace newer selected-date sources', latest.sourceMarker === 'newer-date');
  check('late response cannot relabel the active plan with stale data', latest.workingDate === '2026-10-16');

  sandbox.renders.length = 0;
  sandbox.api = endpoint => endpoint.startsWith('predict/all')
    ? Promise.resolve({ error: 'offline' })
    : Promise.resolve({ error: 'offline' });
  selectedDate = '2026-11-01';
  dom['bp-plan-root'].textContent = '';
  await sandbox.loadBuyPlan();
  check('API error response renders explicit recoverable Buy Plan error, not a normal empty plan', dom['bp-plan-root'].innerHTML.includes('โหลดข้อมูลจัดชุดซื้อไม่สำเร็จ') && dom['bp-plan-root'].innerHTML.includes('onclick="loadBuyPlan()"'));
  check('failed API load does not render a fabricated empty plan', sandbox.renders.length === 0);

  selectedDate = '2026-11-16';
  sandbox.api = endpoint => endpoint.startsWith('predict/all')
    ? Promise.resolve(prediction('2026-11-16', 'partial-draw', 'partial'))
    : Promise.resolve(history());
  dom['bp-plan-root'].innerHTML = '';
  await sandbox.loadBuyPlan();
  check('partial prediction response is identified and rejected before building a Buy Plan', dom['bp-plan-root'].dataset.state === 'partial' && dom['bp-plan-root'].innerHTML.includes('ทำนายได้ไม่ครบทุกหมวด'));
  check('partial prediction data cannot be saved or reused as an editable plan', sandbox.renders.length === 0 && sandbox.LotteryServerData.buyplan.sources === null && sandbox.LotteryUiState.buyplan.workingPlan === null);

  selectedDate = '2026-12-01';
  sandbox.api = async endpoint => {
    if (endpoint.startsWith('predict/all')) throw new Error('network failure');
    return history();
  };
  dom['bp-plan-root'].textContent = '';
  await sandbox.loadBuyPlan();
  check('network failure renders the same recoverable Buy Plan error state', dom['bp-plan-root'].innerHTML.includes('โหลดข้อมูลจัดชุดซื้อไม่สำเร็จ'));
  check('network failure does not render a fabricated empty plan', sandbox.renders.length === 0);

  selectedDate = '2026-12-16';
  const missingDatePrediction = prediction(undefined, 'missing-date');
  delete missingDatePrediction.date;
  sandbox.api = endpoint => endpoint.startsWith('predict/all')
    ? Promise.resolve(missingDatePrediction)
    : Promise.resolve(history());
  dom['bp-plan-root'].textContent = '';
  await sandbox.loadBuyPlan();
  check('prediction response without an explicit target date is rejected', dom['bp-plan-root'].dataset.state === 'error' && dom['bp-plan-root'].innerHTML.includes('โหลดข้อมูลจัดชุดซื้อไม่สำเร็จ'));
  check('response without a target date cannot create reusable Buy Plan sources', sandbox.renders.length === 0 && sandbox.LotteryServerData.buyplan.sources === null);

  selectedDate = '2027-01-01';
  sandbox.api = endpoint => endpoint.startsWith('predict/all')
    ? Promise.resolve(prediction('2026-12-16', 'mismatched-date'))
    : Promise.resolve(history());
  dom['bp-plan-root'].textContent = '';
  await sandbox.loadBuyPlan();
  check('prediction response for a different target date is rejected', dom['bp-plan-root'].dataset.state === 'error' && dom['bp-plan-root'].innerHTML.includes('โหลดข้อมูลจัดชุดซื้อไม่สำเร็จ'));
  check('response for a different target date cannot create reusable Buy Plan sources', sandbox.renders.length === 0 && sandbox.LotteryServerData.buyplan.sources === null);

  // Manually edited working plans survive routine re-entry and are only replaced after confirmation.
  const editedDraft = { mode: 'perNumber', date: '2027-02-01', budget: 500, risk: 'mid', config: { pay2: 95, pay3: 950 }, rows: [{ num: '07', field: 'bottom2', stake: 40 }], totalStake: 40 };
  sandbox.LotteryUiState.buyplan.workingPlan = editedDraft;
  sandbox.LotteryUiState.buyplan.workingPlanTouched = true;
  sandbox.LotteryServerData.buyplan.sources = { scoreRows: [{ sourceMarker: 'draft-source' }] };
  sandbox.LotteryServerData.buyplan.history = [{ date: 'old-source' }];
  selectedDate = editedDraft.date;
  let confirmationCount = 0, confirmationResult = false, protectedFetchCount = 0;
  sandbox.confirm = () => { confirmationCount++; return confirmationResult; };
  sandbox.api = endpoint => { protectedFetchCount++; return Promise.resolve(endpoint.startsWith('predict/all') ? prediction('2027-02-02', 'confirmed-target') : history()); };
  const sameTargetResult = await sandbox.loadBuyPlan();
  check('same-target re-entry keeps the edited draft without refetching', sameTargetResult === editedDraft && protectedFetchCount === 0 && sandbox.LotteryUiState.buyplan.workingPlanTouched);
  check('same-target re-entry keeps the current source cache intact', sandbox.LotteryServerData.buyplan.sources?.scoreRows?.[0]?.sourceMarker === 'draft-source' && sandbox.LotteryServerData.buyplan.history[0]?.date === 'old-source');

  selectedDate = '2027-02-02';
  confirmationResult = false;
  const canceledTarget = await sandbox.loadBuyPlan();
  check('canceling target change preserves the edited plan and restores its date', canceledTarget === editedDraft && selectedDate === editedDraft.date && confirmationCount === 1 && protectedFetchCount === 0);

  confirmationResult = true;
  selectedDate = '2027-02-02';
  await sandbox.loadBuyPlan();
  check('confirming target change fetches matching sources and replaces the edited plan', protectedFetchCount === 2 && sandbox.LotteryUiState.buyplan.workingPlan?.date === '2027-02-02' && !sandbox.LotteryUiState.buyplan.workingPlanTouched);

  const rebuiltDraft = { ...editedDraft, date: '2027-02-02' };
  sandbox.LotteryUiState.buyplan.workingPlan = rebuiltDraft;
  sandbox.LotteryUiState.buyplan.workingPlanTouched = true;
  selectedDate = rebuiltDraft.date;
  confirmationResult = false;
  const canceledRebuild = await sandbox.loadBuyPlan({ force: true });
  check('canceling explicit rebuild keeps the current edited draft', canceledRebuild === rebuiltDraft && sandbox.LotteryUiState.buyplan.workingPlanTouched && protectedFetchCount === 2);
  confirmationResult = true;
  await sandbox.loadBuyPlan({ force: true });
  check('confirmed explicit rebuild fetches current target sources', protectedFetchCount === 4 && sandbox.LotteryUiState.buyplan.workingPlan?.date === rebuiltDraft.date && !sandbox.LotteryUiState.buyplan.workingPlanTouched);

  console.log(`OK: ${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
