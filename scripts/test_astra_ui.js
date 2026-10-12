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
const app = fs.readFileSync(path.join(root, 'static/app.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'static/formula-engine.js'), 'utf8');
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
    settings: { max_draws: 200, min_valid_draws: 20, half_life_draws: 24, weight_floor: 0.5,
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
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], element(m[1])]));
  const requests = [];
  const toasts = [];
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
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
  vm.createContext(sandbox);
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

test('Astra is nested in the Formula calculator with seven fixed headings and no startup inference', () => {
  assert.ok(tag('ftab-btn-ASTRA').startsWith('<button'));
  assert.ok(tag('ftab-btn-ASTRA').includes('type="button"'));
  assert.ok(tag('ftab-btn-ASTRA').includes('aria-pressed="false"'));
  assert.ok(tag('ftab-btn-ASTRA').includes('aria-controls="formula-results-ASTRA"'));
  assert.ok(tag('formula-results-ASTRA').includes('role="group"'));
  assert.match(tag('formula-results-ASTRA'), /aria-labelledby="astra-heading"/);
  const formulaPanelStart = html.indexOf('id="pred-main-tab-formula"');
  const astraPanelStart = html.indexOf('id="formula-results-ASTRA"');
  const formulaPanelEnd = html.indexOf('</div><!-- /pred-main-tab-formula -->', formulaPanelStart);
  assert.ok(formulaPanelStart >= 0 && astraPanelStart > formulaPanelStart && astraPanelStart < formulaPanelEnd,
    'Astra result panel is physically nested inside the Formula main panel');
  assert.equal(tag('pred-main-btn-astra'), '');
  assert.equal(tag('pred-main-tab-astra'), '');
  assert.match(tag('astra-version-v1'), /^<button\b/);
  assert.match(tag('astra-version-sigma'), /^<button\b/);
  for (const [key, label] of specs) {
    assert.match(html, new RegExp('<h[34][^>]*id="astra-heading-' + key + '"[^>]*>' + label + '</h[34]>'));
    assert.ok(tag('astra-body-' + key));
  }
  assert.match(tag('astra-status'), /role="status"/);
  assert.match(tag('astra-status'), /aria-live="polite"/);
  assert.match(tag('astra-status'), /aria-atomic="true"/);
  assert.match(tag('astra-method'), /^<details\b/);
  const tabButtons = [...html.matchAll(/<button[^>]*id="pred-main-btn-([^"]+)"[^>]*>/g)];
  assert.deepEqual(tabButtons.map(m => m[1]), ['predict', 'formula', 'decision', 'oldver']);
  assert.ok(tabButtons.every(m => /aria-pressed="(?:true|false)"/.test(m[0]) && /aria-controls=/.test(m[0])));
  assert.match(html, /id="formula-results-ASTRA"[^>]*class="formula-results-panel[^\"]*astra-formula-panel/);
  assert.match(css, /\.astra-grid/);
  const h = harness();
  assert.equal(h.requests.length, 0);
});

test('astra run, tab, and method controls keep a 44px minimum touch height', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const selector of ['#astra-run', '#ftab-btn-ASTRA', '.astra-method summary']) {
    assert.ok(rules.some(([, selectors, body]) => selectors.trim().split(/\s*,\s*/).includes(selector)
      && /(?:^|;)\s*min-height\s*:\s*44px\s*(?:;|$)/.test(body)), selector + ' requires min-height:44px');
  }
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
  assert.match(bodies(h), /log_score/);
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
  ['window too large', r => ({ ...r, window_draws: 201 })], ['window numeric string', r => ({ ...r, window_draws: '20' })],
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
function response(payload = report(), ok = true) { return { ok, json: async () => payload }; }
function insufficient(r, key, valid = 0) {
  Object.assign(r.categories[key], { status: 'insufficient_data', valid_draws: valid,
    invalid_draws: r.window_draws - valid, training_cutoff_date: valid ? '2026-09-16' : null, numbers: [] });
}
test('loading immediately clears old numbers, exposes local status, and keeps all headings', async () => {
  const h = harness();
  await h.sandbox.loadAstra({recompute:true});
  const pending = deferred();
  h.sandbox.fetch = () => pending.promise;
  const request = h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'loading');
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'true');
  assert.match(h.elements['astra-status'].textContent, /กำลัง/);
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.equal(h.elements['astra-run'].disabled, true);
  for (const [key] of specs) assert.match(h.elements['astra-body-' + key].innerHTML, /กำลัง/);
  pending.resolve(response());
  await request;
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-run'].disabled, false);
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
  valid.window_draws = 200;
  valid.generated_at = '2026-10-08T12:00:00.123456+07:00';
  specs.forEach(([key]) => { valid.categories[key].valid_draws = 200; valid.categories[key].numbers.forEach(row => { row.log_score = -2; }); });
  const serialized = JSON.stringify(valid);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(valid);
  h.sandbox.fetch = async () => response(valid);
  await h.sandbox.loadAstra({recompute:true});
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal((bodies(h).match(/class="astra-number"/g) || []).length, 25);
  assert.equal(JSON.stringify(valid), serialized, 'rendering never mutates the report');
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

test('Astra formula subview activates only inside Formula and legacy Astra routing forwards there', async () => {
  const h = harness();
  h.sandbox.initFormulaPage = async () => {};
  h.sandbox.renderPageSnapshots = () => {};
  h.elements['ftab-btn-ASTRA'].dataset.ftab = 'ASTRA';
  h.sandbox.document.querySelectorAll = selector => {
    if (selector === '.ftab-btn') return [h.elements['ftab-btn-ASTRA']];
    if (selector === '.ftab-info') return [h.elements['ftab-desc-ASTRA']];
    if (selector === '.formula-results-panel') return [h.elements['formula-results-A'], h.elements['formula-results-ASTRA']];
    return [];
  };
  vm.runInContext("currentPage='predict';", h.sandbox);
  await h.sandbox.switchPredTab('formula');
  await h.sandbox.showAstraFormulaView();
  assert.equal(h.elements['shared-draw-date'].value, '2026-10-16');
  assert.equal(h.elements['pred-main-tab-formula'].hidden, false);
  assert.equal(h.elements['ftab-btn-ASTRA'].getAttribute('aria-pressed'), 'true');
  assert.equal(h.elements['formula-results-ASTRA'].classList.contains('active'), true);
  assert.equal(h.elements['pred-main-btn-formula'].getAttribute('aria-pressed'), 'true');
  for (const other of ['predict', 'decision', 'oldver']) {
    assert.equal(h.elements['pred-main-tab-' + other].hidden, true);
    assert.equal(h.elements['pred-main-btn-' + other].getAttribute('aria-pressed'), 'false');
  }
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16', '/api/predict/astra?date=2026-10-16']);
  await h.sandbox.switchPredTab('astra');
  assert.equal(vm.runInContext('currentPredTab', h.sandbox), 'formula');
  assert.equal(h.elements['pred-main-btn-formula'].getAttribute('aria-pressed'), 'true');
  assert.equal(h.elements['ftab-btn-ASTRA'].getAttribute('aria-pressed'), 'true');
  assert.equal(h.elements['formula-results-ASTRA'].classList.contains('active'), true);
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
  vm.runInContext(visible ? "currentPage='predict';currentPredTab='formula';_formulaActiveTab='ASTRA';" : "currentPredTab='predict';", h.sandbox);
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
  vm.runInContext("currentPage='predict';currentPredTab='formula';_formulaActiveTab='ASTRA';", h.sandbox);
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
  assert.equal(h.elements['astra-run'].disabled, false, 'manual remains usable while only automation status is pending');
  assert.match(h.elements['astra-status'].textContent, /2026-11-01/);
  pending[1].resolve(response(noSnapshot('2026-11-01')));
  await new Promise(setImmediate);
  assert.equal(h.requests[2], '/api/predict/astra?date=2026-11-01');
  assert.equal(h.elements['astra-run'].disabled, true, 'read-only inference still blocks duplicate button activation');
  pending[2].resolve(response(report('2026-11-01'))); await second;
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-run'].disabled, false);
  assert.match(h.elements['astra-meta'].innerHTML, /2026-11-01/);
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML, /2026-10-16/);
});
test('astra selected on another page is hidden: shared user change invalidates but does not load', async () => {
  const h = harness();
  vm.runInContext("currentPage='dashboard';currentPredTab='formula';_formulaActiveTab='ASTRA';", h.sandbox);
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
