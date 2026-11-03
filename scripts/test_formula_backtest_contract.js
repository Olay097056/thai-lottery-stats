// Contract regressions for formula backtest validity, target pools, secondary
// outcome denominators, and unavailable no-sample rendering.
// Run with: node scripts/test_formula_backtest_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = require('./frontend_source').readFrontend('formula-engine.js');
const appSrc = require('./frontend_source').readFrontend('app.js');

function check(label, condition) {
  if (!condition) throw new Error('FAIL: ' + label);
  console.log('OK: ' + label);
}

function draw(date, overrides = {}) {
  return {
    date,
    prize1: '123456', top3: '123', top2: '56', bottom2: '78',
    front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444',
    ...overrides,
  };
}

function makeHarness(rows, formulaFactory, n = 1, apiImpl = null) {
  const elements = new Map();
  const button = { disabled: false, textContent: '' };
  function element(){
    return {
      style: {}, innerHTML: '', value: '', textContent: '', dataset: {}, attributes: {},
      setAttribute(name,value){this.attributes[name]=String(value);if(name==='data-state')this.dataset.state=String(value);},
      removeAttribute(name){delete this.attributes[name];},
    };
  }
  elements.set('bt-formula-n', { value: String(n) });
  elements.set('formula-bt-loading', element());
  elements.set('formula-bt-table', element());
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelector: () => button,
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: () => {},
  };
  const sandbox = {
    console,
    document,
    escHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => Promise.reject(new Error('network is disabled in this test')),
    setInterval(callback){this.__intervalCallback=callback;return 1;},
    clearInterval(){this.__intervalCallback=null;},
  };
  sandbox.window = sandbox;
  require('./frontend_source').prepareContext(sandbox);
  vm.runInContext(engineSrc, sandbox);
  sandbox.setPageStatus=(id,message)=>{document.getElementById(id).textContent=String(message);};
  sandbox.api = async path => apiImpl ? apiImpl(path,sandbox) : ({ data: rows });
  sandbox.__formulaFactory = formulaFactory;
  sandbox.__noMappingCheck = () => null;
  sandbox.__noRender = () => {};
  sandbox.__noTabSwitch = () => {};
  vm.runInContext(
    '_computeFormulasBatch=__formulaFactory;_formulaFieldMappingCheck=__noMappingCheck;_renderBtTable=__noRender;switchFormulaTab=__noTabSwitch;',
    sandbox,
  );
  return {
    sandbox,
    async run() {
      await sandbox.runFormulaBacktest();
      return {
        rows: vm.runInContext('LotteryServerData.formula.backtestRows', sandbox),
        tested: vm.runInContext('LotteryServerData.formula.testedDraws', sandbox),
      };
    },
  };
}

async function testBacktestProgressShowsStagesAndRetryOnPartialFailure() {
  const rows=[draw('01/02/2569'),draw('16/01/2569')];
  const observedStages=[];
  const harness=makeHarness(rows,()=>[{name:'T contract',preds:['78'],field:'bottom2',baseline:1}],1,async(path,sandbox)=>{
    observedStages.push([path,sandbox.document.getElementById('formula-bt-status').textContent,sandbox.document.getElementById('formula-bt-progress-detail').textContent]);
    if(path.startsWith('prize-history'))return {data:rows};
    return {ok:false,error:'temporary failure',retryable:true};
  });
  await harness.run();
  const {sandbox}=harness;
  const status=sandbox.document.getElementById('formula-bt-status').textContent;
  const isPartial=vm.runInContext('LotteryServerData.formula.backtestPartial',sandbox);
  const retry=sandbox.document.getElementById('formula-bt-retry');
  const panel=sandbox.document.getElementById('formula-bt-loading');
  check('Backtest announces history, Fano v4, and Fano v5 stages in order',
    observedStages.map(([,stage])=>stage).join('|').includes('ขั้น 1/4')&&
    observedStages.some(([path,stage])=>path.startsWith('fano/backtest?')&&!path.includes('version=')&&stage.includes('ขั้น 2/4'))&&
    observedStages.some(([path,stage])=>path.includes('version=fano-v5-adaptive-rank-codebook')&&stage.includes('ขั้น 3/4')));
  check('forecast scope explains rolling-window calculations against the selected sample',observedStages.some(([path,,detail])=>path.startsWith('fano/backtest')&&detail.includes('Rolling edge สูงสุด 200 งวด')&&detail.includes('ตัวเลือกหลัก 1 งวด')));
  check('optional formula API failures are explicitly reported as a partial result',status.includes('ได้ผลบางส่วน')&&isPartial===true);
  check('retry is available after a retryable stage failure and busy state settles',retry.style.display==='inline-flex'&&panel.attributes['aria-busy']==='false');
  check('failed formula stages remain visibly identified',sandbox.document.getElementById('formula-bt-step-fano-v4-state').textContent==='ไม่สำเร็จ');
}

async function testSuccessfulBacktestWithAllTargetsSkippedIsNotAnError() {
  const rows=[draw('01/02/2569'),draw('16/01/2569')];
  const targetDate='2569-02-01';
  const harness=makeHarness(rows,()=>[{name:'T contract',preds:['78'],field:'bottom2',baseline:1}],1,async path=>{
    if(path.startsWith('prize-history'))return {data:rows};
    return {ok:true,forecasts:[],skipped_targets:[targetDate]};
  });
  await harness.run();
  check('successful empty forecast batches with explicit skipped targets do not create an API failure',
    vm.runInContext('LotteryServerData.formula.backtestPartial',harness.sandbox)===false&&
    harness.sandbox.document.getElementById('formula-bt-retry').style.display==='none'&&
    harness.sandbox.document.getElementById('formula-bt-step-fano-v4-state').textContent==='เสร็จ');
}

function onlyFormula(result) {
  return result.rows.find(row => row.name === 'T contract') || result.rows[0];
}

function extractFunction(source, name) {
  const match = new RegExp('function ' + name + '\\([^)]*\\)\\{', 'm').exec(source);
  if (!match) throw new Error('not found: ' + name);
  let i = match.index + match[0].length;
  let depth = 1;
  while (depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(match.index, i);
}

function exactValues(start, count) {
  return Array.from({ length: count }, (_, i) => String(start + i).padStart(6, '0'));
}

function fullTargetDraw(date) {
  const p2 = exactValues(110001, 5);
  const p3 = exactValues(120001, 10);
  const p4 = exactValues(130001, 50);
  const p5 = exactValues(140001, 100);
  return draw(date, {
    prize1: '999999',
    near1_1: '100001', near1_2: '100002',
    prize2_1: p2[0], prize2_2: p2[1], prize2_3: p2[2], prize2_4: p2[3], prize2_5: p2[4],
    ...Object.fromEntries(p3.map((v, i) => [`prize3_${i + 1}`, v])),
    prize4: p4.join(' '),
    prize5: p5.join(' '),
  });
}

async function testInvalidTargetFieldIsUnavailable() {
  const rows = [draw('01/02/2569', { bottom2: '' }), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['00'], field: 'bottom2', baseline: 1 }]);
  const result = await harness.run();
  const row = onlyFormula(result);
  check('blank bottom2 is not padded into a false 00 hit', row.hits === 0);
  check('blank bottom2 does not enter the formula denominator', row.total === 0);
  check('zero-sample pct and edge are unavailable, not measured zero', row.pct === null && row.edge === null);
}

async function testMalformedPrize1PairIsSkipped() {
  const rows = [draw('01/02/2569', { prize1: '１２３４５６' }), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['00'], field: 'bottom2', baseline: 1 }]);
  const result = await harness.run();
  check('non-ASCII prize1 is not a tested draw', result.tested === 0 && result.rows.length === 0);
}

async function testSecondaryMetricExcludesPrize4AndPrize5() {
  const rows = [draw('01/02/2569', { prize4: '111456', back3_1: '111', back3_2: '222' }), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['456'], field: 'back3exact', baseline: 1 }]);
  const result = await harness.run();
  const row = onlyFormula(result);
  check('prize4 alone does not count as a secondary-result sample', row.subTotal === 0 && row.subHits === 0);
}

async function testSecondaryMetricStillUsesNear1Prize2AndPrize3() {
  const secondary = {
    near1_1: '100111', near1_2: '100222',
    prize2_1: '101456', prize2_2: '101002', prize2_3: '101003', prize2_4: '101004', prize2_5: '101005',
  };
  for (let i = 1; i <= 10; i++) secondary[`prize3_${i}`] = String(102000 + i).padStart(6, '0');
  const rows = [draw('01/02/2569', { ...secondary, back3_1: '111', back3_2: '222' }), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['456'], field: 'back3exact', baseline: 1 }]);
  const result = await harness.run();
  const row = onlyFormula(result);
  check('complete near1/prize2/prize3 fixture records its secondary hit', row.subTotal === 1 && row.subHits === 1);
}

async function testEmptyPredictionsDoNotEnterSecondaryDenominator() {
  const secondary = {
    near1_1: '100111', near1_2: '100222',
    prize2_1: '101001', prize2_2: '101002', prize2_3: '101003', prize2_4: '101004', prize2_5: '101005',
  };
  for (let i = 1; i <= 10; i++) secondary[`prize3_${i}`] = String(102000 + i).padStart(6, '0');
  const rows = [draw('01/02/2569', secondary), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: [], field: 'bottom2', baseline: 1 }]);
  const result = await harness.run();
  const row = onlyFormula(result);
  check('empty prediction set is not counted as a secondary miss', row.subTotal === 0 && row.subHits === 0);
}

async function testEmptyPredictionsDoNotEnterPool14ComparisonDenominator() {
  const rows = [fullTargetDraw('01/02/2569'), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: [], field: 'pool6', baseline: 1 }]);
  const row = onlyFormula(await harness.run());
  check('empty pool6 prediction array is not a pool1-4 comparison miss', row.pool14Total === 0 && row.pool14Hits === 0);
}

async function testIncompletePrizePoolsAreNotScoredAsMisses() {
  const rows = [draw('01/02/2569'), draw('16/01/2569')];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['888888'], field: 'pool6', baseline: 10 }]);
  const result = await harness.run();
  const row = onlyFormula(result);
  check('incomplete pool6 target is excluded from hit/miss denominator', row.total === 0 && row.pct === null);
  check('incomplete pool1-4 target is excluded from comparison denominator', row.pool14Total === 0);
}

async function testCompletePrizePoolsRemainScorable() {
  const rows = [fullTargetDraw('01/02/2569'), draw('16/01/2569')];
  const winningPrize5 = rows[0].prize5.split(' ')[99];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: [winningPrize5], field: 'pool6', baseline: 1 }]);
  const result = await harness.run();
  const row = onlyFormula(result);
  check('complete pool1-5 target still records its pool6 hit', row.total === 1 && row.hits === 1);
  check('complete pool1-4 target contributes to the separate comparison denominator', row.pool14Total === 1 && row.pool14Hits === 0);
}

async function testRollingEdgeUsesBaselineWhenSelectedPeriodHasNoSample() {
  const rows = [
    draw('01/02/2569', { bottom2: '' }),
    draw('16/01/2569', { bottom2: '00' }),
    draw('01/01/2569', { bottom2: '11' }),
  ];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['00'], field: 'bottom2', baseline: 1 }], 1);
  const row = onlyFormula(await harness.run());
  check('selected period stays unavailable when its only actual target is invalid', row.total === 0 && row.pct === null && row.baseP === null && row.edge === null);
  check('rolling edge still subtracts the 1% field baseline when older valid samples exist',
    Object.values(row.rolling).every(window => window.total === 1 && window.pct === 100 && Math.abs(window.edge - 99) < 1e-9));
  vm.runInContext(extractFunction(appSrc, '_renderBtTable'), harness.sandbox);
  vm.runInContext('_renderBtTable()', harness.sandbox);
  const html = harness.sandbox.document.getElementById('formula-bt-table').innerHTML;
  check('rolling edge remains visible even while the selected-period Edge is unavailable',
    html.includes('W50: +99.0 pp') && html.includes('W100: +99.0 pp') && html.includes('W200: +99.0 pp'));
}

async function testRollingEdgeUnavailableWithoutRollingSample() {
  const rows = [draw('01/02/2569', { bottom2: '' }), draw('16/01/2569', { bottom2: '' })];
  const harness = makeHarness(rows, () => [{ name: 'T contract', preds: ['00'], field: 'bottom2', baseline: 1 }], 1);
  const row = onlyFormula(await harness.run());
  check('rolling rate and edge stay unavailable when no valid rolling targets exist',
    row.total === 0 && row.rolling[50].total === 0 && row.rolling[50].pct === null && row.rolling[50].edge === null);
}

async function testFinalPicksRankOnlyMeasuredBacktestRows() {
  const harness = makeHarness([], () => []);
  const el = harness.sandbox.document.getElementById('formula-final');
  el.classList = { add: () => {}, remove: () => {} };
  vm.runInContext(`
    LotteryServerData.formula.backtestRows=[{name:'N',edge:null},{name:'L',edge:-2}];
    _collectFormulaConsensus=()=>[{num:'00',typeKey:'bottom2',formulaCount:2}];
    _formulaConsensusChip=()=>'<span>00</span>';
    bindFormulaConsensusDetails=()=>{};
  `, harness.sandbox);
  harness.sandbox._renderFormulaFinalPicks();
  check('final picks ranks the best finite backtest edge without crashing on no-sample rows',
    el.innerHTML.includes('-2.0%') && el.innerHTML.includes('L'));
}

async function testFinalPicksShowUnavailableWhenNoEdgesAreMeasured() {
  const harness = makeHarness([], () => []);
  const el = harness.sandbox.document.getElementById('formula-final');
  el.classList = { add: () => {}, remove: () => {} };
  vm.runInContext(`
    LotteryServerData.formula.backtestRows=[{name:'N',edge:null}];
    _collectFormulaConsensus=()=>[{num:'00',typeKey:'bottom2',formulaCount:2}];
    _formulaConsensusChip=()=>'<span>00</span>';
    bindFormulaConsensusDetails=()=>{};
  `, harness.sandbox);
  harness.sandbox._renderFormulaFinalPicks();
  check('final picks reports unavailable backtest ranking when rows exist but none has a valid edge',
    el.innerHTML.includes('—') && el.innerHTML.includes('ไม่มีข้อมูลครบ') && !el.innerHTML.includes('รัน Backtest เพื่อจัดอันดับสูตร'));
}

async function testNoDataRendererUsesUnavailableState() {
  const elements = { 'formula-bt-table': { innerHTML: '' } };
  const sandbox = {
    console,
    document: {
      getElementById: id => elements[id] || (elements[id] = { style: {}, innerHTML: '' }),
      querySelector: () => null,
    },
  };
  sandbox.window = sandbox;
  require('./frontend_source').prepareContext(sandbox);
  vm.runInContext(engineSrc, sandbox);
  vm.runInContext(extractFunction(appSrc, 'escHtml'), sandbox);
  vm.runInContext(extractFunction(appSrc, '_renderBtTable'), sandbox);
  vm.runInContext(`LotteryServerData.formula.backtestRows=[{
    name:'T contract',group:'T',groupColor:'#aaa',field:'bottom2',typeLabel:'เต็ม 2หลัก',board:'2-digit exact',
    total:0,hits:0,pct:null,baseP:null,baseLabel:'—',edge:null,ciLow:null,ciHigh:null,
    subHits:0,subTotal:0,subPct:null,rolling:{},edge50:null,edge100:null,edge200:null,degraded:false,trust:null,preds_n:1,pool14Hits:0,pool14Total:0
  }];LotteryServerData.formula.testedDraws=0;LotteryServerData.formula.backtestFieldCheck=null;_renderBtTable();`, sandbox);
  const html = sandbox.document.getElementById('formula-bt-table').innerHTML;
  check('zero-sample renderer shows unavailable instead of 0.0%', html.includes('—') && !html.includes('0.0%'));
}

const tests = [
  ['progress-retry', testBacktestProgressShowsStagesAndRetryOnPartialFailure],
  ['skipped-targets-success', testSuccessfulBacktestWithAllTargetsSkippedIsNotAnError],
  ['invalid-target', testInvalidTargetFieldIsUnavailable],
  ['malformed-prize1', testMalformedPrize1PairIsSkipped],
  ['secondary-prize4', testSecondaryMetricExcludesPrize4AndPrize5],
  ['secondary-control', testSecondaryMetricStillUsesNear1Prize2AndPrize3],
  ['empty-predictions', testEmptyPredictionsDoNotEnterSecondaryDenominator],
  ['empty-pool14-predictions', testEmptyPredictionsDoNotEnterPool14ComparisonDenominator],
  ['incomplete-pool', testIncompletePrizePoolsAreNotScoredAsMisses],
  ['complete-pool', testCompletePrizePoolsRemainScorable],
  ['rolling-baseline-no-sample', testRollingEdgeUsesBaselineWhenSelectedPeriodHasNoSample],
  ['rolling-empty-sample', testRollingEdgeUnavailableWithoutRollingSample],
  ['final-picks-null-edge', testFinalPicksRankOnlyMeasuredBacktestRows],
  ['final-picks-no-edge', testFinalPicksShowUnavailableWhenNoEdgesAreMeasured],
  ['no-data-renderer', testNoDataRendererUsesUnavailableState],
];
(async () => {
  const requested = process.argv[2];
  const selected = requested ? tests.filter(([name]) => name === requested) : tests;
  if (!selected.length) throw new Error(`Unknown test: ${requested}`);
  for (const [, test] of selected) await test();
  console.log(`PASS: ${selected.length} formula backtest contract test(s)`);
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
