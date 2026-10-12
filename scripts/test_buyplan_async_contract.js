// Regression tests for Buy Plan request ordering and API failure states.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrcRaw = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
const appSrc = appSrcRaw.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const dom = Object.create(null);
let selectedDate = '2026-10-01';
dom['bp-plan-root'] = { className: '', textContent: '', innerHTML: '' };
dom['bp-date'] = { options: { length: 1 }, get value() { return selectedDate; } };
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
vm.createContext(sandbox);
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
  workingDate: vm.runInContext('_bpWorkingPlan?.date', sandbox),
  sourceMarker: vm.runInContext('_bpSources?.scoreRows?.[0]?.sourceMarker', sandbox),
});
vm.runInContext('bpPaint = function(){ window.recordBuyPlanPaint(); }', sandbox);

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

  selectedDate = '2026-10-01';
  const loadA = sandbox.loadBuyPlan();
  selectedDate = '2026-10-16';
  const loadB = sandbox.loadBuyPlan();
  predB.resolve({ categories: { sourceMarker: 'newer-date' } });
  histB.resolve({ data: [] });
  await loadB;
  predA.resolve({ categories: { sourceMarker: 'older-date' } });
  histA.resolve({ data: [] });
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
  check('API error response renders explicit recoverable Buy Plan error, not a normal empty plan', dom['bp-plan-root'].textContent.includes('โหลดหน้าจัดชุดซื้อไม่สำเร็จ'));
  check('failed API load does not render a fabricated empty plan', sandbox.renders.length === 0);

  selectedDate = '2026-12-01';
  sandbox.api = async endpoint => {
    if (endpoint.startsWith('predict/all')) throw new Error('network failure');
    return { data: [] };
  };
  dom['bp-plan-root'].textContent = '';
  await sandbox.loadBuyPlan();
  check('network failure renders the same recoverable Buy Plan error state', dom['bp-plan-root'].textContent.includes('โหลดหน้าจัดชุดซื้อไม่สำเร็จ'));
  check('network failure does not render a fabricated empty plan', sandbox.renders.length === 0);

  console.log(`OK: ${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
