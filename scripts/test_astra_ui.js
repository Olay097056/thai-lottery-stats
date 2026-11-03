// astra UI verification: synthetic payloads only; no app boot, cache/history I/O, or scorer calls.
// node scripts/test_astra_ui.js => exit 0; validation, UI state, and races fail explicitly.
// Regression commands: test_cache_bust_sync.js, test_accessibility_contract.js,
// test_spa_core_pages_contract.js, test_prediction_xss_contract.js, test_predict_mix_ui_contract.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'static/app.css'), 'utf8');
const app = require('./frontend_source').readFrontend('app.js');
const engine = require('./frontend_source').readFrontend('formula-engine.js');
const code = app.replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');
const specs = [
  ['prize1', 'รางวัลที่ 1', 6, 5], ['front3', 'เลขหน้า 3 ตัว', 3, 2],
  ['back3', 'เลขท้าย 3 ตัวทางการ', 3, 2], ['bottom2', 'เลขท้าย 2 ตัว', 2, 1],
  ['prize2', 'รางวัลที่ 2', 6, 5], ['prize3', 'รางวัลที่ 3', 6, 5], ['prize4', 'รางวัลที่ 4', 6, 5],
];
function report(target = '2026-10-16') {
  return {
    schema_version: 1, formula: 'astra', version: 'astra-v1', trust: 'ทดลอง',
    target_date: target, generated_at: '2026-10-08T12:00:00+07:00',
    training_cutoff_date: '2026-10-01', source: 'supplied_history', window_draws: 20,
    settings: { max_draws: null, min_valid_draws: 20, half_life_draws: 24, weight_floor: 0.5,
      positional_prior: 1, pair_backoff_strength: 10, positional_log_weight: 0.5,
      conditional_log_weight: 0.5, stale_days: 35 },
    warnings: [],
    categories: Object.fromEntries(specs.map(([key, label, digits, requested_count]) => [key, {
      label, digits, requested_count, status: 'ok', valid_draws: 20, invalid_draws: 0,
      training_cutoff_date: '2026-10-01',
      numbers: Array.from({ length: requested_count }, (_, i) => ({ number: String(i).padStart(digits, '0'), rank: i + 1, log_score: -1 - i })),
    }])),
  };
}
function noSnapshot(target = '2026-10-16') {
  return { enabled: true, running: true, phase: 'waiting', poll_interval_seconds: 900,
    last_check_at: null, next_check_at: null, last_success_at: null, latest_source_date: null,
    target_date: target, snapshot_count: 0, error: null, snapshot: null };
}
function element(id) {
  const attrs = new Map();
  const classes = new Set();
  return { id, value: '', innerHTML: '', textContent: '', hidden: false, disabled: false,
    style: {}, dataset: {}, options: [], children: [],
    classList: { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: name => attrs.get(name) ?? null, removeAttribute: name => attrs.delete(name),
    add(option) { this.options.push(option); }, appendChild(child) { this.children.push(child); },
    addEventListener() {}, remove() {}, querySelectorAll: () => [],
  };
}
function harness() {
  const FixedDate = class extends Date { static now() { return Date.parse('2026-10-08T12:00:00+07:00'); } };
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], element(m[1])]));
  const requests = [];
  const toasts = [];
  const sandbox = {
    console, Date: FixedDate, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Option: function(text, value) { this.text = text; this.value = value; },
    addEventListener() {},
    location: { hash: '', pathname: '/', search: '' },
    history: { pushState() {} },
    document: { getElementById: id => elements[id] || null, querySelector: () => null,
      querySelectorAll: () => [], createElement: () => element(''), addEventListener() {},
      documentElement: { dataset: { theme: 'light' } } },
    localStorage: { getItem: () => null, setItem() { throw new Error('no snapshot writes'); } },
    fetch: async route => { requests.push(route); return response(route.startsWith('/api/astra/automation') ? noSnapshot() : report()); },
  };
  sandbox.window = sandbox;
  require('./frontend_source').prepareContext(sandbox);
  // Full real module declarations: never redeclare parallel request counters/state in the test.
  vm.runInContext(engine, sandbox, { filename: 'formula-engine.js' });
  vm.runInContext(code, sandbox, { filename: 'app.js' });
  for (const name of ['_computeFormulasBatch', 'runFormulaBacktest', 'dcComputeFormulaResults',
    '_mixCompute', 'loadMixPage', 'loadBuyPlan', 'dcRecommendedNumbers', 'renderPageSnapshots']) {
    sandbox[name] = () => { throw new Error('astra must not enter ' + name); };
  }
  sandbox.toast = (...args) => toasts.push(args);
  elements['shared-draw-date'].value = '2026-10-16';
  return { sandbox, elements, requests, toasts };
}
let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function tag(id) { return html.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))?.[0] || ''; }
function bodies(h) { return specs.map(([key]) => h.elements['astra-body-' + key]?.innerHTML || '').join('\n'); }

test('Astra is selected from the shared Formula dropdown and uses the shared calculate control', () => {
  assert.equal(tag('ftab-btn-ASTRA'), '', 'Astra must not have a standalone tab/button');
  assert.match(tag('ftab-group-select'), /aria-label="เลือกกลุ่มสูตร"/);
  assert.match(html, /<option value="ASTRA">Astra · ทดลอง<\/option>/);
  assert.match(tag('ftab-group-select'), /onchange="if\(this\.value\)switchFormulaTab\(this\.value\)"/);
  assert.doesNotMatch(tag('ftab-group-select'), /showAstraFormulaView/);
  assert.match(tag('astra-version-select'), /aria-label="เลือกรุ่นสูตร Astra"/);
  assert.match(tag('astra-version-select'), /onchange="selectAstraVersion\(this\.value\)"/);
  assert.match(tag('astra-version-control'), /for="astra-version-select"[^>]*hidden/);
  const formulaGroupNav = html.match(/<div class="ftab-nav"[^>]*>[\s\S]*?<\/div>/)?.[0] || '';
  assert.ok(formulaGroupNav.includes('id="ftab-group-select"') && formulaGroupNav.includes('id="astra-version-control"'),
    'the Astra version choice sits beside the shared formula-group selector');
  assert.doesNotMatch(tag('ftab-desc-ASTRA'), /astra-version-select/, 'Astra controls do not live in a separate description panel');
  assert.equal(tag('astra-run'), '', 'Astra must not have a separate calculate button');
  assert.equal(tag('astra-sigma-run'), '', 'Astra-Σ must use the shared calculate button too');
  assert.match(tag('f-run-formulas'), /onclick="runAllFormulas\(\{userInitiated:true\}\)"/);
  assert.doesNotMatch(html, /class="astra-panel-heading|class="astra-version-row|class="astra-runbar/,
    'Astra must not introduce a standalone hero or control panels');
});

test('Astra inference is opt-in through the shared Formula calculate button', async () => {
  const h = harness();
  h.sandbox.initFormulaPage = async () => {};
  h.sandbox.renderPageSnapshots = () => {};
  await h.sandbox.switchPredTab('formula');
  h.sandbox.switchFormulaTab('ASTRA');
  let options = null;
  h.sandbox.loadSelectedAstraFormula = value => { options = value; return Promise.resolve(); };
  h.sandbox._validateFormulaInputs = () => { throw new Error('Astra does not use or validate the legacy manual fields'); };
  assert.equal(await h.sandbox.runAllFormulas(), false, 'auto-run or programmatic calculation cannot start Astra inference');
  assert.equal(options, null);
  const action = tag('f-run-formulas').match(/onclick="([^"]+)"/)?.[1];
  assert.ok(action, 'Astra uses the same calculate button as the other Formula groups');
  await vm.runInContext(action, h.sandbox);
  assert.equal(JSON.stringify(options), JSON.stringify({ recompute: true }),
    'the shared calculate action explicitly starts inference for the selected Astra version');
  assert.deepEqual(h.requests, [], 'routing can be verified without touching any API');
});

test('Astra calculation stays available while unrelated formula history is loading', () => {
  const h = harness();
  h.sandbox.LotteryUiState.navigation.predictionTab = 'formula';
  h.sandbox.LotteryUiState.formula.activeTab = 'ASTRA';
  h.sandbox.LotteryUiState.formula.autoFillPending = true;
  h.sandbox._setFormulaAutoFillPending(true);
  assert.equal(h.elements['f-run-formulas'].disabled, false,
    'Astra does not depend on legacy formula autofill and remains calculable');
  h.sandbox.setAstraState('loading', '2026-10-16', 'loading');
  assert.equal(h.elements['f-run-formulas'].disabled, true, 'only the active Astra request disables its calculate action');
  h.sandbox.setAstraState('error', '2026-10-16', 'error');
  assert.equal(h.elements['f-run-formulas'].disabled, false, 'the calculate action is restored for retry after failure');
});

test('Astra is nested in the Formula calculator with seven fixed headings and no startup inference', async () => {
  assert.equal(tag('ftab-btn-ASTRA'), '');
  assert.ok(tag('ftab-group-select').includes('aria-controls="formula-results-A"'));
  assert.ok(tag('formula-results-ASTRA').includes('role="group"'));
  assert.match(tag('formula-results-ASTRA'), /aria-label="ผลสูตร Astra"/);
  const astraResultCards = [...html.matchAll(/<article[^>]*id="astra(?:-sigma)?-category-[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.equal(astraResultCards.length, 14, 'both versions expose seven prize categories');
  assert.ok(astraResultCards.every(tag => tag.includes('class="card formula-card astra-card') && tag.includes('data-group="ASTRA"')),
    'both versions reuse the standard formula-result card component');
  const formulaPanelStart = html.indexOf('id="pred-main-tab-formula"');
  const astraPanelStart = html.indexOf('id="formula-results-ASTRA"');
  const formulaPanelEnd = html.indexOf('</div><!-- /pred-main-tab-formula -->', formulaPanelStart);
  assert.ok(formulaPanelStart >= 0 && astraPanelStart > formulaPanelStart && astraPanelStart < formulaPanelEnd,
    'Astra result panel is physically nested inside the Formula main panel');
  assert.equal(tag('pred-main-btn-astra'), '');
  assert.equal(tag('pred-main-tab-astra'), '');
  assert.match(tag('astra-version-select'), /^<select\b/);
  assert.match(tag('astra-version-select'), /aria-label="เลือกรุ่นสูตร Astra"/);
  assert.match(html, /<option value="astra-v1" selected>Astra v1 · ทดลอง<\/option>/);
  assert.match(html, /<option value="astra-sigma">Astra-Σ · ทดลอง v0\.1<\/option>/);
  for (const [key, label] of specs) {
    assert.match(html, new RegExp('<h[34][^>]*id="astra-heading-' + key + '"[^>]*>' + label + '</h[34]>'));
    assert.ok(tag('astra-body-' + key));
  }
  assert.match(tag('astra-status'), /role="status"/);
  assert.match(tag('astra-status'), /aria-live="polite"/);
  assert.match(tag('astra-status'), /aria-atomic="true"/);
  assert.match(tag('astra-method'), /^<details\b/);
  assert.match(tag('astra-report-details'), /^<details\b/);
  assert.equal((html.match(/id="astra-report-details"/g) || []).length, 1, 'v1 report disclosure has one unique DOM id');
  assert.equal((html.match(/id="astra-meta"/g) || []).length, 1, 'v1 report metadata has one unique DOM id');
  assert.match(html, /<details id="astra-report-details"[^>]*>[\s\S]*?<div id="astra-meta"[^>]*>[\s\S]*?<\/details>/,
    'v1 provenance and report metadata are available in a collapsed disclosure after the result cards');
  const v1ResultsMarkup = html.slice(html.indexOf('id="astra-results"'), html.indexOf('id="astra-method"'));
  assert.ok(v1ResultsMarkup.indexOf('id="astra-categories"') < v1ResultsMarkup.indexOf('id="astra-report-details"'),
    'v1 report disclosure follows the visible result cards');
  assert.match(html, /<details id="astra-sigma-report-details"[^>]*>[\s\S]*?<div id="astra-sigma-meta"[^>]*>[\s\S]*?<\/details>/,
    'Sigma provenance and report metadata are available in a collapsed disclosure');
  assert.doesNotMatch(tag('astra-report-details'), /\sopen(?:\s|>)/, 'report metadata starts collapsed');
  assert.doesNotMatch(tag('astra-sigma-report-details'), /\sopen(?:\s|>)/, 'Sigma report metadata starts collapsed');
  const tabButtons = [...html.matchAll(/<button[^>]*id="pred-main-btn-([^"]+)"[^>]*>/g)];
  assert.deepEqual(tabButtons.map(m => m[1]), ['predict', 'formula', 'decision', 'oldver']);
  assert.ok(tabButtons.every(m => /aria-pressed="(?:true|false)"/.test(m[0]) && /aria-controls=/.test(m[0])));
  assert.match(html, /id="formula-results-ASTRA"[^>]*class="formula-results-panel[^\"]*astra-formula-panel/);
  assert.match(css, /\.astra-grid/);
  const h = harness();
  assert.equal(h.requests.length, 0);
  h.sandbox.initFormulaPage = async () => {};
  h.sandbox.renderPageSnapshots = () => {};
  await h.sandbox.switchPredTab('formula');
  h.sandbox.switchFormulaTab('A');
  assert.equal(h.requests.length, 0, 'opening Formula and an ordinary group never starts Astra inference');
  vm.runInContext("LotteryUiState.formula.activeTab='ASTRA';", h.sandbox);
  await h.sandbox.switchPredTab('formula');
  h.sandbox.onPageLoad('predict');
  assert.equal(h.requests.filter(route => /(?:astra\/automation|predict\/astra(?:-sigma)?)/.test(route)).length, 0,
    'reopening Formula while Astra is selected never starts Astra inference');
});

test('shared Formula controls keep a 44px minimum touch height', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(rules.some(([, selectors, body]) => {
    const group = selectors.trim().split(/\s*,\s*/);
    return group.includes('button') && group.includes('[role="button"]')
      && /(?:^|;)\s*min-height\s*:\s*44px\s*(?:;|$)/.test(body);
  }), 'native and ARIA buttons require min-height:44px');
  assert.ok(rules.some(([, selectors, body]) => selectors.trim().split(/\s*,\s*/).includes('.astra-method summary')
    && /(?:^|;)\s*min-height\s*:\s*44px\s*(?:;|$)/.test(body)), '.astra-method summary requires min-height:44px');
  assert.match(css, /select,input\[type=text\],input\[type=number\],input\[type=search\]\{min-height:44px\}/,
    'the shared version selector keeps the project control touch target');
  assert.equal((css.match(/\.astra-target-line\s*\{/g) || []).length, 1,
    'Astra target status has one authoritative visual rule');
});

test('explicit astra load renders all 25 ranked string numbers and provenance', async () => {
  const h = harness();
  assert.equal(typeof h.sandbox.loadAstra, 'function');
  await h.sandbox.loadAstra({recompute:true});
  assert.deepEqual(h.requests, ['/api/predict/astra?date=2026-10-16']);
  assert.equal((bodies(h).match(/class="astra-number"/g) || []).length, 25);
  assert.match(bodies(h), />000000<\/span>/);
  assert.match(bodies(h), />000<\/span>/);
  assert.match(bodies(h), />00<\/span>/);
  assert.match(bodies(h), /คะแนนจัดอันดับ/);
  assert.doesNotMatch(bodies(h), /log_score/, 'users see a plain-language score label, not the implementation field name');
  for (const [key, , , count] of specs) {
    assert.equal((h.elements['astra-body-' + key].innerHTML.match(/class="astra-number"/g) || []).length, count);
    assert.match(h.elements['astra-body-' + key].innerHTML, /2026-10-01/);
    assert.match(h.elements['astra-body-' + key].innerHTML, /20/);
  }
  assert.match(h.elements['astra-meta'].innerHTML, /astra-v1/);
  assert.match(h.elements['astra-meta'].innerHTML, /ทดลอง/);
  assert.match(h.elements['astra-meta'].innerHTML, /2026-10-08T12:00:00\+07:00/);
  assert.match(h.elements['astra-meta'].innerHTML, /supplied_history/);
  assert.match(h.elements['astra-status'].textContent, /25/);
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'false');
});

// Untrusted JSON crosses a single boundary: reject the entire report, never partial success.
const mutations = [
  ['null envelope', () => null], ['array envelope', () => []], ['primitive envelope', () => 'ok'],
  ['empty envelope', () => ({})], ['API detail', () => ({ detail: '<img src=x onerror=alert(1)>' })],
  ['API error', () => ({ error: '<svg onload=alert(1)>' })],
  ...Object.keys(report()).map(key => ['missing ' + key, r => { delete r[key]; return r; }]),
  ['extra envelope field', r => ({ ...r, confidence: 99 })],
  ['wrong schema', r => ({ ...r, schema_version: '1' })], ['wrong formula', r => ({ ...r, formula: 'other' })],
  ['wrong version', r => ({ ...r, version: 'astra-v2' })], ['wrong trust', r => ({ ...r, trust: 'แนะนำ' })],
  ['unverified source', r => ({ ...r, source: 'live' })], ['wrong target', r => ({ ...r, target_date: '2026-11-01' })],
  ['target alias', r => ({ ...r, target_date: '2026-10-16T00:00:00' })],
  ['naive generation', r => ({ ...r, generated_at: '2026-10-08T12:00:00' })],
  ['bad generation date', r => ({ ...r, generated_at: '2026-02-30T12:00:00+07:00' })],
  ['bad generation clock', r => ({ ...r, generated_at: '2026-10-08T24:00:00+07:00' })],
  ['bad generation zone', r => ({ ...r, generated_at: '2026-10-08T12:00:00+99:00' })],
  ['target is not future of generation', r => ({ ...r, generated_at: '2026-10-16T01:00:00+07:00' })],
  ['cutoff null with window', r => ({ ...r, training_cutoff_date: null })],
  ['cutoff not a date', r => ({ ...r, training_cutoff_date: '2026-02-30' })],
  ['cutoff after generation', r => ({ ...r, training_cutoff_date: '2026-10-09' })],
  ['cutoff at target', r => ({ ...r, training_cutoff_date: r.target_date })],
  ['window count mismatch', r => ({ ...r, window_draws: 21 })], ['window unsafe integer', r => ({ ...r, window_draws: Number.MAX_SAFE_INTEGER + 1 })],
  ['negative window', r => ({ ...r, window_draws: -1 })], ['fractional window', r => ({ ...r, window_draws: 20.5 })],
  ['settings null', r => ({ ...r, settings: null })], ['settings array', r => ({ ...r, settings: [] })],
  ...Object.keys(report().settings).map(key => ['changed setting ' + key, r => { r.settings[key] += 1; return r; }]),
  ['warnings null', r => ({ ...r, warnings: null })], ['warnings string', r => ({ ...r, warnings: 'warning' })],
  ...[null, {}, [], 1, '', '   '].map(value => ['invalid warning ' + JSON.stringify(value), r => ({ ...r, warnings: [value] })]),
  ['categories null', r => ({ ...r, categories: null })], ['categories array', r => ({ ...r, categories: [] })],
  ['extra category', r => { r.categories.prize5 = r.categories.prize4; return r; }],
];
for (const [key] of specs) {
  report().categories[key].numbers.forEach((_, i) => mutations.push(['invalid row at ' + key + '[' + i + ']', r => { r.categories[key].numbers[i] = null; return r; }]));
  for (const value of [undefined, null, [], 1, 'ok']) mutations.push(['invalid category ' + key + ' ' + value, r => { r.categories[key] = value; return r; }]);
  for (const field of Object.keys(report().categories[key])) mutations.push(['missing ' + key + '.' + field, r => { delete r.categories[key][field]; return r; }]);
  for (const [field, value] of [
    ['label', '<img src=x onerror=alert(1)>'], ['digits', 4], ['requested_count', 99],
    ['status', 'error'], ['valid_draws', '20'], ['valid_draws', -1], ['valid_draws', 20.1],
    ['invalid_draws', null], ['invalid_draws', 1], ['training_cutoff_date', null],
    ['training_cutoff_date', '2026-10-02'], ['numbers', null], ['numbers', '000000'], ['numbers', []],
  ]) mutations.push(['invalid ' + key + '.' + field + '=' + value, r => { r.categories[key][field] = value; return r; }]);
  for (const value of [null, [], 7, '000000', {}, { number: '000000', rank: 1 }]) {
    mutations.push(['invalid row ' + key + ' ' + JSON.stringify(value), r => { r.categories[key].numbers[0] = value; return r; }]);
  }
  for (const [field, value] of [
    ['number', 0], ['number', ' 000000'], ['number', '000000\n'], ['number', '０１２３４５'],
    ['number', '<svg>'], ['rank', '1'], ['rank', 0], ['rank', 1.5], ['log_score', null],
    ['log_score', '1'], ['log_score', NaN], ['log_score', Infinity], ['log_score', -Infinity],
  ]) mutations.push(['invalid row ' + key + '.' + field + '=' + value, r => { r.categories[key].numbers[0][field] = value; return r; }]);
}
mutations.push(
  ['duplicate numbers', r => { r.categories.prize1.numbers[4].number = r.categories.prize1.numbers[0].number; return r; }],
  ['duplicate rank', r => { r.categories.prize1.numbers[4].rank = 1; return r; }],
  ['extra row', r => { r.categories.prize1.numbers.push({ number: '123456', rank: 6, log_score: -10 }); return r; }],
  ['wrong score order', r => { r.categories.prize1.numbers[4].log_score = 0; return r; }],
  ['wrong exact tie order', r => { const a = r.categories.prize1.numbers; a[1].log_score = a[0].log_score; [a[0].number, a[1].number] = [a[1].number, a[0].number]; return r; }],
  ['status insufficient with predictions', r => { r.categories.prize1.status = 'insufficient_data'; return r; }],
  ['status ok below minimum', r => { r.categories.prize1.valid_draws = 19; r.categories.prize1.invalid_draws = 1; return r; }],
);
for (const [label, mutate] of mutations) test('fails closed: ' + label, async () => {
  const h = harness();
  await h.sandbox.loadAstra({recompute:true}); // must clear a previous good report, not leave stale numbers
  const bad = mutate(report());
  h.sandbox.fetch = async () => ({ ok: true, json: async () => bad });
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'error');
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'false');
  assert.match(h.elements['astra-status'].textContent, /ไม่สำเร็จ/);
  assert.doesNotMatch(bodies(h), /class="astra-number"|<img|<svg/);
  for (const [key] of specs) assert.match(h.elements['astra-body-' + key].innerHTML, /ไม่สำเร็จ/);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(payload = report(), ok = true, status = ok ? 200 : 500) { return { ok, status, json: async () => payload }; }
function insufficient(r, key, valid = 0) {
  Object.assign(r.categories[key], { status: 'insufficient_data', valid_draws: valid,
    invalid_draws: r.window_draws - valid, training_cutoff_date: valid ? '2026-09-16' : null, numbers: [] });
}
test('loading immediately clears old numbers, exposes local status, and keeps all headings', async () => {
  const h = harness();
  vm.runInContext("LotteryUiState.navigation.predictionTab='formula';LotteryUiState.formula.activeTab='ASTRA';", h.sandbox);
  await h.sandbox.loadAstra({recompute:true});
  const pending = deferred();
  h.sandbox.fetch = () => pending.promise;
  const request = h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'loading');
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'true');
  assert.match(h.elements['astra-status'].textContent, /กำลัง/);
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.equal(h.elements['f-run-formulas'].disabled, true);
  for (const [key] of specs) assert.match(h.elements['astra-body-' + key].innerHTML, /กำลัง/);
  pending.resolve(response());
  await request;
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['f-run-formulas'].disabled, false);
});
test('insufficient categories preserve counts and never invent replacement numbers', async () => {
  const h = harness(), partial = report();
  insufficient(partial, 'prize4', 19);
  h.sandbox.fetch = async () => response(partial);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal((bodies(h).match(/class="astra-number"/g) || []).length, 20);
  assert.match(h.elements['astra-body-prize4'].innerHTML, /ข้อมูลไม่เพียงพอ/);
  assert.match(h.elements['astra-body-prize4'].innerHTML, /ใช้ได้ 19 · ใช้ไม่ได้ 1/);
  assert.match(h.elements['astra-body-prize4'].innerHTML, /2026-09-16/);
  const empty = report();
  empty.window_draws = 0; empty.training_cutoff_date = null;
  specs.forEach(([key]) => insufficient(empty, key));
  h.sandbox.fetch = async () => response(empty);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'empty');
  assert.match(h.elements['astra-status'].textContent, /ไม่มีหมวดที่มีข้อมูลเพียงพอ/);
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.match(h.elements['astra-meta'].innerHTML, /ไม่มีข้อมูล/);
  for (const [key] of specs) assert.match(h.elements['astra-body-' + key].innerHTML, /ใช้ได้ 0 · ใช้ไม่ได้ 0/);
});
test('all-invalid window is empty with real denominator, not fabricated zero observations', async () => {
  const h = harness(), invalid = report();
  specs.forEach(([key]) => insufficient(invalid, key));
  h.sandbox.fetch = async () => response(invalid);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'empty');
  for (const [key] of specs) assert.match(h.elements['astra-body-' + key].innerHTML, /ใช้ได้ 0 · ใช้ไม่ได้ 20/);
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
});
test('maximum window, exact ties, aware microseconds and cross-category duplicates remain valid', async () => {
  const h = harness(), valid = report();
  valid.window_draws = 784;
  valid.generated_at = '2026-10-08T12:00:00.123456+07:00';
  specs.forEach(([key]) => { valid.categories[key].valid_draws = 784; valid.categories[key].numbers.forEach(row => { row.log_score = -2; }); });
  const serialized = JSON.stringify(valid);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(valid);
  h.sandbox.fetch = async () => response(valid);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal((bodies(h).match(/class="astra-number"/g) || []).length, 25);
  assert.match(h.elements['astra-meta'].innerHTML, /ทุกงวดที่ได้รับก่อนงวดเป้าหมาย/);
  assert.match(h.elements['astra-meta'].innerHTML, /784/);
  assert.equal(JSON.stringify(valid), serialized, 'rendering never mutates the report');
});
test('immutable legacy 200-draw automation snapshots still render with their old scope disclosed', async () => {
  const h = harness(), legacy = report();
  legacy.source = 'existing_local_cache';
  legacy.settings.max_draws = 200;
  legacy.window_draws = 200;
  legacy.training_cutoff_date = '2026-10-07';
  specs.forEach(([key]) => {
    legacy.categories[key].valid_draws = 200;
    legacy.categories[key].invalid_draws = 0;
    legacy.categories[key].training_cutoff_date = '2026-10-07';
  });
  const snapshot = {
    formula_version: 'astra-v1', source_draw_date: '2026-10-07', target_date: '2026-10-16',
    captured_at: legacy.generated_at, cache_sha256: 'a'.repeat(64), engine_sha256: 'b'.repeat(64),
    source: 'sanook', calendar_source: 'glo', report: legacy,
  };
  const state = noSnapshot();
  state.snapshot_count = 1;
  state.snapshot = snapshot;
  h.sandbox.fetch = async route => { h.requests.push(route); return response(state); };

  await h.sandbox.loadAstra();

  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16']);
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.match(h.elements['astra-meta'].innerHTML, /รายงานเดิม · ไม่เกิน 200 งวดก่อนงวดเป้าหมาย/);
  assert.match(h.elements['astra-meta'].innerHTML, /งวดที่ใช้[\s\S]*?200/);
});
test('stale threshold uses Thailand calendar days, including aware UTC generation', async () => {
  const h = harness(), valid = report();
  valid.generated_at = '2026-10-07T18:00:00Z'; // October 8 in Thailand
  valid.training_cutoff_date = '2026-09-03'; // exactly 35 days, not stale
  specs.forEach(([key]) => { valid.categories[key].training_cutoff_date = valid.training_cutoff_date; });
  h.sandbox.fetch = async () => response(valid);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-warnings'].hidden, true);
  valid.training_cutoff_date = '2026-09-02';
  specs.forEach(([key]) => { valid.categories[key].training_cutoff_date = valid.training_cutoff_date; });
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-warnings'].hidden, false);
});
test('stale history is visibly warned even if the backend warning array is empty', async () => {
  const h = harness(), stale = report();
  stale.source = 'existing_local_cache';
  stale.training_cutoff_date = '2026-08-01';
  specs.forEach(([key]) => { stale.categories[key].training_cutoff_date = stale.training_cutoff_date; });
  h.sandbox.fetch = async () => response(stale);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-warnings'].hidden, false);
  assert.match(h.elements['astra-warnings'].innerHTML, /เก่า.*35/);
  assert.match(h.elements['astra-meta'].innerHTML, /existing_local_cache/);
  assert.match(h.elements['astra-status'].textContent, /คำเตือน/);
  h.sandbox.fetch = async () => response();
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-warnings'].hidden, true);
  assert.equal(h.elements['astra-warnings'].innerHTML, '');
});
test('warning text is HTML escaped including quotes and ampersands, never trusted markup', async () => {
  const h = harness(), payload = report();
  payload.warnings = ['<img src=x onerror="alert(1)"> & \'quoted\'', '<svg onload=alert(1)>'];
  h.sandbox.fetch = async () => response(payload);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.match(h.elements['astra-warnings'].innerHTML, /&lt;img/);
  assert.match(h.elements['astra-warnings'].innerHTML, /&quot;alert\(1\)&quot;/);
  assert.match(h.elements['astra-warnings'].innerHTML, /&amp;/);
  assert.doesNotMatch(h.elements['astra-warnings'].innerHTML, /<img|<svg/);
});
for (const date of ['', '2026-2-30', '2026-02-30', '2026-10-16\n', '<img src=x onerror=alert(1)>']) test('invalid target fails locally without fetching: ' + JSON.stringify(date), async () => {
  const h = harness();
  h.elements['shared-draw-date'].value = date;
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.requests.length, 0);
  assert.equal(h.elements['astra-results'].dataset.state, 'error');
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML, /<img/);
});
for (const kind of ['network', 'bad json', 'HTTP failure with valid-looking payload']) test(kind + ' stays in explicit local error and preserves generic API announcements', async () => {
  const h = harness();
  h.sandbox.fetch = async () => {
    if (kind === 'network') throw new Error('<img src=x onerror=alert(1)>');
    if (kind === 'bad json') return { ok: true, json: async () => { throw new SyntaxError('<svg>'); } };
    return response(report(), false);
  };
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'error');
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'false');
  assert.equal(h.toasts.length, 0, 'astra owns a local error, no duplicate global toast');
  assert.doesNotMatch(bodies(h), /<img|<svg|class="astra-number"/);
  if (kind === 'network') {
    await h.sandbox.api('ordinary');
    assert.equal(h.toasts.length, 1, 'ordinary API errors retain their toast');
  }
});
test('requireOk preserves the HTTP status and structured server error instead of rewriting it as a network failure', async () => {
  const h=harness();
  const detail='astra requires a canonical future Thailand date and valid dated history';
  h.sandbox.fetch=async()=>response({detail},false,400);
  const result=await h.sandbox.api('predict/astra?date=2026-10-16',{
    requireOk:true,suppressNetworkToast:true,suppressSpinnerAnnouncement:true,
  });
  assert.equal(result.http_status,400);
  assert.equal(result.error_code,'request_failed');
  assert.equal(result.retryable,false);
  assert.equal(result.detail,detail);
});
test('Astra v1 shows its safe 400 explanation without suggesting a retry', async () => {
  const h=harness();
  h.sandbox.fetch=async()=>response({detail:'astra requires a canonical future Thailand date and valid dated history'},false,400);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state,'error');
  assert.match(h.elements['astra-status'].textContent,/เลือกงวดอนาคตที่ถูกต้อง/);
  assert.doesNotMatch(h.elements['astra-status'].textContent,/ลองใหม่|ลองอีกครั้ง/);
  assert.doesNotMatch(bodies(h),/class="astra-number"/);
});
test('Astra v1 reports a cache 503 and keeps the server-recommended retry guidance', async () => {
  const h=harness();
  h.sandbox.fetch=async()=>response({detail:'astra local cache is missing or unreadable; no refresh was attempted'},false,503);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state,'error');
  assert.match(h.elements['astra-status'].textContent,/อ่านแคชผลรางวัลของ Astra ไม่ได้/);
  assert.match(h.elements['astra-status'].textContent,/สามารถลองใหม่ได้/);
});
test('automation-status failures show the cause and do not masquerade as a successful empty state', async () => {
  const h=harness();
  h.sandbox.fetch=async route=>{h.requests.push(route);return response({detail:'date must use canonical YYYY-MM-DD'},false,400);};
  await h.sandbox.loadAstra();
  assert.equal(h.requests.length,1);
  assert.equal(h.elements['astra-auto-status'].dataset.state,'error');
  assert.match(h.elements['astra-auto-status'].textContent,/วันที่งวดของระบบ Astra/);
  assert.equal(h.elements['astra-results'].dataset.state,'error');
});
test('malformed successful Astra report is identified as invalid data without network retry language', async () => {
  const h=harness();
  h.sandbox.fetch=async()=>response({ok:true,target_date:'2026-10-16'});
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state,'error');
  assert.match(h.elements['astra-status'].textContent,/server ส่งข้อมูลไม่ครบ/);
  assert.doesNotMatch(h.elements['astra-status'].textContent,/ลองใหม่|เชื่อมต่อ server/);
  assert.doesNotMatch(bodies(h),/class="astra-number"/);
});
test('Astra-Σ keeps its own cache error copy and network errors remain explicitly retryable', async () => {
  const h=harness();
  h.sandbox.fetch=async()=>response({detail:'Astra-Σ local cache is missing or unreadable; no refresh was attempted'},false,503);
  await h.sandbox.loadAstraSigma();
  assert.match(h.elements['astra-sigma-status'].textContent,/อ่านแคชผลรางวัลของ Astra-Σ ไม่ได้/);
  assert.match(h.elements['astra-sigma-status'].textContent,/สามารถลองใหม่ได้/);
  h.sandbox.fetch=async()=>{throw new Error('offline');};
  await h.sandbox.loadAstra({recompute:true});
  assert.match(h.elements['astra-status'].textContent,/เชื่อมต่อ server หรืออ่านคำตอบไม่ได้/);
  assert.match(h.elements['astra-status'].textContent,/สามารถลองใหม่ได้/);
});
test('quiet astra spinner does not suppress an overlapping ordinary API announcement', async () => {
  const h = harness(), pending = [];
  h.sandbox.fetch = () => { const next = deferred(); pending.push(next); return next.promise; };
  const a = h.sandbox.loadAstra({recompute:true});
  const spinner = h.elements['api-spinner'];
  assert.equal(spinner.getAttribute('aria-hidden'), 'true');
  assert.equal(spinner.classList.contains('active'), true);
  const b = h.sandbox.api('ordinary');
  assert.equal(spinner.getAttribute('aria-hidden'), null);
  pending[1].resolve(response({}));
  await b;
  assert.equal(spinner.getAttribute('aria-hidden'), 'true');
  assert.equal(spinner.classList.contains('active'), true);
  pending[0].resolve(response());
  await a;
  assert.equal(spinner.classList.contains('active'), false);
});

test('Astra chosen from the Formula selector activates the standard results panel and legacy routing forwards there', async () => {
  const h = harness();
  h.sandbox.initFormulaPage = async () => {};
  h.sandbox.renderPageSnapshots = () => {};
  h.sandbox.document.querySelectorAll = selector => {
    if (selector === '.ftab-btn') return [h.elements['ftab-btn-ALL'], h.elements['ftab-btn-BT']].filter(Boolean);
    if (selector === '.ftab-info') return [h.elements['ftab-desc-ASTRA']];
    if (selector === '.formula-results-panel') return [h.elements['formula-results-A'], h.elements['formula-results-ASTRA']];
    return [];
  };
  vm.runInContext("LotteryUiState.navigation.page='predict';", h.sandbox);
  await h.sandbox.switchPredTab('formula');
  await h.sandbox.showAstraFormulaView();
  assert.equal(h.elements['shared-draw-date'].value, '2026-10-16');
  assert.equal(h.elements['pred-main-tab-formula'].hidden, false);
  assert.equal(h.elements['ftab-group-select'].value, 'ASTRA');
  assert.equal(h.elements['ftab-group-select'].getAttribute('aria-controls'), 'formula-results-ASTRA');
  assert.equal(h.elements['ftab-group-select'].classList.contains('ftab-select-active'), true);
  assert.equal(h.elements['formula-results-ASTRA'].classList.contains('active'), true);
  assert.equal(h.elements['pred-main-btn-formula'].getAttribute('aria-pressed'), 'true');
  for (const other of ['predict', 'decision', 'oldver']) {
    assert.equal(h.elements['pred-main-tab-' + other].hidden, true);
    assert.equal(h.elements['pred-main-btn-' + other].getAttribute('aria-pressed'), 'false');
  }
  assert.deepEqual(h.requests, [], 'selecting Astra from the shared menu is navigation only');
  await h.sandbox.switchPredTab('astra');
  assert.equal(vm.runInContext('LotteryUiState.navigation.predictionTab', h.sandbox), 'formula');
  assert.equal(h.elements['pred-main-btn-formula'].getAttribute('aria-pressed'), 'true');
  assert.equal(h.elements['ftab-group-select'].value, 'ASTRA');
  assert.equal(h.elements['formula-results-ASTRA'].classList.contains('active'), true);
  assert.deepEqual(h.requests, [], 'legacy Astra route is navigation only');
  await h.sandbox.loadAstra({recompute:true});
  assert.deepEqual(h.requests, ['/api/predict/astra?date=2026-10-16'], 'explicit calculate action runs Astra inference');
  h.sandbox.switchFormulaTab('A');
  assert.equal(h.elements['ftab-group-select'].value, 'A');
  assert.equal(h.elements['ftab-group-select'].getAttribute('aria-controls'), 'formula-results-A');
  assert.equal(h.elements['ftab-group-select'].classList.contains('ftab-select-active'), true);
  assert.equal(h.elements['formula-results-ASTRA'].classList.contains('active'), false);
});
for (const staleKind of ['success', 'malformed', 'network error']) test('newest same-target request wins over late ' + staleKind, async () => {
  const h = harness(), pending = [];
  h.sandbox.fetch = () => { const next = deferred(); pending.push(next); return next.promise; };
  const first = h.sandbox.loadAstra({recompute:true}), second = h.sandbox.loadAstra({recompute:true});
  const newer = report(); newer.warnings = ['newest response'];
  pending[1].resolve(response(newer)); await second;
  const expected = h.elements['astra-warnings'].innerHTML;
  if (staleKind === 'network error') pending[0].reject(new Error('stale error'));
  else pending[0].resolve(response(staleKind === 'malformed' ? null : report()));
  await first;
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-warnings'].innerHTML, expected);
  assert.match(h.elements['astra-warnings'].innerHTML, /newest response/);
  assert.equal(h.toasts.length, 0);
});
for (const userAction of [false, true]) test('hidden target change clears loaded output without starting an astra request: userAction=' + userAction, async () => {
  const h = harness();
  await h.sandbox.loadAstra({recompute:true});
  h.sandbox.syncSharedDrawDate('2026-11-01', userAction);
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.match(h.elements['astra-meta'].innerHTML, /2026-11-01/);
  assert.equal(h.elements['shared-draw-date'].value, '2026-11-01');
  h.sandbox.fetch = async route => { h.requests.push(route); return response(route.startsWith('/api/astra/automation') ? noSnapshot('2026-11-01') : report('2026-11-01')); };
  await h.sandbox.loadAstra();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[1], '/api/astra/automation?date=2026-11-01');
  assert.equal(h.requests[2], '/api/predict/astra?date=2026-11-01');
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
});
for (const visible of [false, true]) test('non-user target synchronization invalidates pending responses and ABA dates while ' + (visible ? 'active' : 'hidden'), async () => {
  const h = harness(), pending = deferred();
  vm.runInContext(visible ? "LotteryUiState.navigation.page='predict';LotteryUiState.navigation.predictionTab='formula';LotteryUiState.formula.activeTab='ASTRA';" : "LotteryUiState.navigation.predictionTab='predict';", h.sandbox);
  h.sandbox.fetch = () => { h.requests.push('pending'); return pending.promise; };
  const request = h.sandbox.loadAstra({recompute:true});
  h.sandbox.syncSharedDrawDate('2026-11-01', false);
  h.sandbox.syncSharedDrawDate('2026-10-16', false);
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  pending.resolve(response()); await request;
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'false');
});
for (const staleKind of ['success', 'malformed', 'network error']) test('active user target change starts new loading state untouched by old ' + staleKind, async () => {
  const h = harness(), pending = [];
  vm.runInContext("LotteryUiState.navigation.page='predict';LotteryUiState.navigation.predictionTab='formula';LotteryUiState.formula.activeTab='ASTRA';", h.sandbox);
  h.sandbox.fetch = route => { h.requests.push(route); const next = deferred(); pending.push(next); return next.promise; };
  const first = h.sandbox.loadAstra({recompute:true});
  const second = h.sandbox.syncSharedDrawDate('2026-11-01', true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1], '/api/astra/automation?date=2026-11-01');
  assert.equal(h.elements['astra-results'].dataset.state, 'loading');
  if (staleKind === 'network error') pending[0].reject(new Error('obsolete'));
  else pending[0].resolve(response(staleKind === 'malformed' ? null : report()));
  await first;
  assert.equal(h.elements['astra-results'].dataset.state, 'loading');
  assert.equal(h.elements['f-run-formulas'].disabled, false, 'manual remains usable while only automation status is pending');
  assert.match(h.elements['astra-status'].textContent, /2026-11-01/);
  pending[1].resolve(response(noSnapshot('2026-11-01')));
  await second;
  assert.equal(h.requests.length, 2, 'a target change may read automation status but must not infer');
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.equal(h.elements['f-run-formulas'].disabled, false, 'shared Calculate remains enabled until user starts inference');
  assert.match(h.elements['astra-status'].textContent, /ไม่มีรายงานบันทึก/);
  assert.match(h.elements['astra-meta'].innerHTML, /2026-11-01/);
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML, /2026-10-16/);
});
test('astra selected on another page is hidden: shared user change invalidates but does not load', async () => {
  const h = harness();
  vm.runInContext("LotteryUiState.navigation.page='dashboard';LotteryUiState.navigation.predictionTab='formula';LotteryUiState.formula.activeTab='ASTRA';", h.sandbox);
  await h.sandbox.loadAstra({recompute:true});
  h.sandbox.syncSharedDrawDate('2026-11-01', true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
});
test('shared startup synchronization neither initializes nor requests astra', () => {
  const h = harness();
  const before = bodies(h);
  h.sandbox.syncSharedDrawDate('2026-11-01');
  assert.equal(h.requests.length, 0);
  assert.equal(bodies(h), before);
  assert.doesNotMatch(app.slice(app.indexOf('async function init(){'), app.indexOf('function dcAddSource(')), /loadAstra\(/);
});
test('same-value shared sync still invalidates a request; clearing target cannot revive it', async () => {
  const h = harness(), pending = deferred();
  h.sandbox.fetch = () => pending.promise;
  const first = h.sandbox.loadAstra({recompute:true});
  h.sandbox.syncSharedDrawDate('2026-10-16');
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  h.elements['shared-draw-date'].value = '';
  h.sandbox.syncSharedDrawDate('');
  pending.resolve(response()); await first;
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
});

module.exports = { harness, report, specs, deferred, response, bodies, html, css, app, tag };
if (require.main === module) (async () => {
  for (const [name, fn] of tests) {
    try { await fn(); } catch (error) { error.message = name + ': ' + error.message; throw error; }
    passed++;
    if (!name.startsWith('fails closed:')) console.log('PASS ' + name);
  }
  console.log(`astra UI: ${passed} synthetic cases passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
