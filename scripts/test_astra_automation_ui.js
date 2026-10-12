// Offline synthetic automation UI contracts. No cache/history/snapshot files, network, or app boot.
// Run: node scripts/test_astra_automation_ui.js
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { harness, report, specs, deferred, response, bodies, html, css, app, tag } = require('./test_astra_ui');
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function snapshot(target = '2026-10-16') {
  const saved = report(target);
  saved.source = 'existing_local_cache';
  return { formula_version: 'astra-v1', source_draw_date: saved.training_cutoff_date,
    target_date: target, captured_at: saved.generated_at, cache_sha256: 'a'.repeat(64),
    engine_sha256: 'b'.repeat(64), source: 'sanook', calendar_source: 'glo', report: saved };
}
function automation(target = '2026-10-16', saved = snapshot(target)) {
  return { enabled: true, running: true, phase: saved ? 'saved' : 'waiting', poll_interval_seconds: 900,
    last_check_at: '2026-10-08T12:00:00+07:00', next_check_at: '2026-10-08T12:15:00+07:00',
    last_success_at: saved ? saved.captured_at : null, latest_source_date: '2026-10-01',
    target_date: target, snapshot_count: saved ? 1 : 0, error: null, snapshot: saved };
}
function installFetch(h, status, manual = report()) {
  h.sandbox.fetch = async (route, options) => {
    assert.equal(options?.method || 'GET', 'GET', 'astra UI never writes through the API');
    h.requests.push(route);
    if (route.startsWith('/api/astra/automation?date=')) return response(status);
    if (route.startsWith('/api/predict/astra?date=')) return response(manual);
    throw new Error('Unexpected route: ' + route);
  };
}

test('selected saved report is preferred without invoking inference and keeps immutable provenance', async () => {
  const h = harness(), saved = snapshot(), state = automation('2026-10-16', saved);
  saved.report.warnings = ['synthetic saved report'];
  const serialized = JSON.stringify(state);
  installFetch(h, state);
  await h.sandbox.loadAstra();
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16']);
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal((bodies(h).match(/class="astra-number"/g) || []).length, 25);
  for (const [key, , , count] of specs) assert.equal((h.elements['astra-body-' + key].innerHTML.match(/class="astra-number"/g) || []).length, count);
  assert.match(bodies(h), />000000<\/span>/);
  assert.match(bodies(h), />000<\/span>/);
  assert.match(bodies(h), />00<\/span>/);
  assert.match(h.elements['astra-meta'].innerHTML, /บันทึกถาวร/);
  assert.match(h.elements['astra-meta'].innerHTML, /ไม่เขียนทับ/);
  assert.match(h.elements['astra-meta'].innerHTML, /2026-10-08T12:00:00\+07:00/);
  assert.match(h.elements['astra-meta'].innerHTML, /2026-10-01/);
  assert.match(h.elements['astra-meta'].innerHTML, /sanook/);
  assert.match(h.elements['astra-meta'].innerHTML, /glo/);
  assert.match(h.elements['astra-meta'].innerHTML, /existing_local_cache/);
  assert.match(h.elements['astra-meta'].innerHTML, /ทดลอง/);
  assert.match(h.elements['astra-warnings'].innerHTML, /synthetic saved report/);
  assert.equal(JSON.stringify(state), serialized, 'rendering never rewrites persisted data');
});

test('automation status explains read-only checks and backend lifecycle with an accessible refresh', async () => {
  const h = harness();
  assert.match(tag('astra-auto-status'), /role="status"/);
  assert.match(tag('astra-auto-status'), /aria-live="polite"/);
  assert.match(tag('astra-auto-status'), /aria-atomic="true"/);
  assert.match(tag('astra-auto-refresh'), /^<button\b/);
  assert.match(tag('astra-auto-refresh'), /type="button"/);
  const refresh = tag('astra-auto-refresh').match(/onclick="([^"]+)"/)?.[1];
  assert.ok(refresh, 'refresh has a keyboard-activatable native button');
  const section = html.slice(html.indexOf('id="astra-automation"'), html.indexOf('id="astra-status"'));
  assert.match(section, /อ่านสถานะล่าสุด/);
  assert.match(section, /ไม่สั่งคำนวณหรือบันทึก/);
  assert.match(section, /ตรวจทุก 900 วินาทีเมื่อ backend พร้อม/);
  assert.match(section, /หยุดเมื่อปิด backend หรือคอมพิวเตอร์/);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(rules.some(([, selectors, body]) => selectors.trim().split(/\s*,\s*/).includes('#astra-auto-refresh')
    && /(?:^|;)\s*min-height\s*:\s*44px\s*(?:;|$)/.test(body)));
  installFetch(h, automation());
  await vm.runInContext(refresh, h.sandbox);
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16']);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'saved');
  assert.match(h.elements['astra-auto-status'].textContent, /เปิดใช้งาน/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /2026-10-08T12:00:00\+07:00/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /2026-10-08T12:15:00\+07:00/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /900/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /2026-10-01/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /2026-10-16/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /จำนวนรายงาน/);
});

test('no saved report falls back to explicitly unsaved read-only inference', async () => {
  const h = harness();
  installFetch(h, automation('2026-10-16', null));
  await h.sandbox.loadAstra();
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16', '/api/predict/astra?date=2026-10-16']);
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.match(h.elements['astra-meta'].innerHTML, /ยังไม่บันทึก/);
  assert.match(h.elements['astra-meta'].innerHTML, /อ่านอย่างเดียว/);
  assert.match(h.elements['astra-status'].textContent, /ยังไม่บันทึก/);
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML, /บันทึกถาวร/);
});
test('manual button recomputes without saving or changing results even when a saved report exists', async () => {
  const h = harness(), state = automation(), manual = report();
  manual.warnings = ['synthetic manual report'];
  installFetch(h, state, manual);
  await h.sandbox.loadAstra();
  const action = tag('astra-run').match(/onclick="([^"]+)"/)?.[1];
  assert.match(tag('astra-run'), /recompute/);
  assert.match(html, /ผลคำนวณมือไม่บันทึกถาวร/g);
  assert.equal((html.match(/ผลคำนวณมือไม่บันทึกถาวร/g) || []).length, 2, 'manual-run disclosure appears for both Astra versions');
  await vm.runInContext(action, h.sandbox);
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16', '/api/predict/astra?date=2026-10-16']);
  assert.match(h.elements['astra-meta'].innerHTML, /ยังไม่บันทึก/);
  assert.match(h.elements['astra-warnings'].innerHTML, /synthetic manual report/);
  assert.equal(h.elements['astra-run'].disabled, false);
  vm.runInContext("currentPredTab='formula';_formulaActiveTab='ASTRA';", h.sandbox);
  await h.sandbox.runSharedPrimaryAction();
  assert.equal(h.requests[2], '/api/predict/astra?date=2026-10-16');
  assert.equal(h.requests.length, 3);
});
test('status refresh with no snapshot performs no inference and exposes the manual route', async () => {
  const h = harness();
  installFetch(h, automation('2026-10-16', null));
  await h.sandbox.loadAstra({ statusOnly: true });
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16']);
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.match(h.elements['astra-status'].textContent, /ไม่มีรายงานบันทึก/);
  assert.equal(h.elements['astra-run'].disabled, false);
});

const invalidStatuses = [
  ['null', () => null], ['array', () => []], ['primitive', () => 'ok'], ['empty', () => ({})],
  ['raw API error', () => ({ error: '<svg onload=alert(1)>' })],
  ...Object.keys(automation()).map(key => ['missing ' + key, s => { delete s[key]; return s; }]),
  ['extra key', s => ({ ...s, internal_path: 'private' })],
  ...['enabled', 'running'].flatMap(key => [null, 'true', 0, 1, {}, []].map(value => [key + '=' + JSON.stringify(value), s => ({ ...s, [key]: value })])),
  ...['unknown', '__proto__', 'constructor', '<img src=x>', '', null, 1, []].map(value => ['phase=' + value, s => ({ ...s, phase: value })]),
  ...[0, '900', 900.1, 901, null, Infinity].map(value => ['interval=' + value, s => ({ ...s, poll_interval_seconds: value })]),
  ...[-1, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(value => ['count=' + value, s => ({ ...s, snapshot_count: value })]),
  ...['latest_source_date', 'target_date'].flatMap(key => ['2026-02-30', '2026-1-01', '2026-10-16\n', '2026-10-16T00:00:00', '', [], 1, '<svg>'].map(value => [key + '=' + value, s => ({ ...s, [key]: value })])),
  ...['last_check_at', 'next_check_at', 'last_success_at'].flatMap(key => [
    '2026-10-08T12:00:00', '2026-02-30T12:00:00+07:00', '2026-10-08T24:00:00+07:00',
    '2026-10-08T12:00:00+99:00', '2026-10-08T12:00:00+07:00\n', '', 1, [], {}, '<img>',
  ].map(value => [key + '=' + value, s => ({ ...s, [key]: value })])),
  ...['unknown', '__proto__', 'constructor', '<img src=x>', '', false, [], 1].map(value => ['error=' + value, s => ({ ...s, error: value })]),
  ['snapshot count conflict', s => ({ ...s, snapshot_count: 0 })],
];
const invalidSnapshots = [
  ['array', () => []], ['primitive', () => 'ok'], ['empty', () => ({})],
  ...Object.keys(snapshot()).map(key => ['missing ' + key, s => { delete s[key]; return s; }]),
  ['extra key', s => ({ ...s, url: '<img src=x>' })],
  ...[
    ['formula_version', 'astra-v2'], ['target_date', '2026-11-01'], ['target_date', '2026-10-16T00:00:00'],
    ['source_draw_date', '2026-10-02'], ['source_draw_date', null], ['source_draw_date', '2026-02-30'],
    ['captured_at', '2026-10-08T12:00:01+07:00'], ['captured_at', '2026-10-08T12:00:00'],
    ['captured_at', null], ['source', 'existing_local_cache'], ['source', '<svg>'], ['calendar_source', 'nominal'],
    ['calendar_source', null], ['report', null], ['report', []], ['report', 'ok'],
  ].map(([key, value]) => [key + '=' + value, s => ({ ...s, [key]: value })]),
  ...['cache_sha256', 'engine_sha256'].flatMap(key => [null, [], 1, 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(64) + '\n'].map(value => [key + '=' + value, s => ({ ...s, [key]: value })])),
  ...[
    ['source', 'supplied_history'], ['version', 'astra-v2'], ['trust', 'แนะนำ'], ['target_date', '2026-11-01'],
    ['generated_at', '2026-10-08T12:00:01+07:00'], ['training_cutoff_date', '2026-10-02'], ['warnings', [null]],
  ].map(([key, value]) => ['report.' + key, s => { s.report[key] = value; return s; }]),
  ...specs.map(([key]) => ['malformed report row ' + key, s => { s.report.categories[key].numbers[0] = null; return s; }]),
];
for (const [label, mutate] of invalidSnapshots) invalidStatuses.push(['snapshot ' + label, s => ({ ...s, snapshot: mutate(s.snapshot) })]);
for (const [label, mutate] of invalidStatuses) test('rejects automation payload: ' + label, async () => {
  const h = harness();
  installFetch(h, automation());
  await h.sandbox.loadAstra(); // stale good metadata/numbers must disappear on a bad read
  const bad = mutate(automation());
  installFetch(h, bad);
  await h.sandbox.loadAstra();
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2026-10-16', '/api/astra/automation?date=2026-10-16']);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'error');
  assert.match(h.elements['astra-auto-status'].textContent, /ไม่สำเร็จ/);
  assert.match(h.elements['astra-auto-status'].textContent, /ไม่ยืนยัน/);
  assert.equal(h.elements['astra-auto-meta'].innerHTML, '');
  assert.equal(h.elements['astra-results'].dataset.state, 'error');
  assert.equal(h.elements['astra-run'].disabled, false);
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'false');
  assert.doesNotMatch(bodies(h) + h.elements['astra-meta'].innerHTML, /class="astra-number"|<svg|<img/);
  assert.equal(h.toasts.length, 0);
  installFetch(h, bad);
  await h.sandbox.loadAstra({ recompute: true });
  assert.equal(h.requests[2], '/api/predict/astra?date=2026-10-16');
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'error', 'manual success does not claim auto recovery');
  assert.match(h.elements['astra-meta'].innerHTML, /ยังไม่บันทึก/);
});
for (const failure of ['network', 'bad JSON', 'HTTP failure']) test('status ' + failure + ' stays truthful and leaves manual computation usable', async () => {
  const h = harness();
  h.sandbox.fetch = async route => {
    h.requests.push(route);
    if (route.startsWith('/api/predict/astra')) return response();
    if (failure === 'network') throw new Error('<img src=x>');
    if (failure === 'bad JSON') return { ok: true, json: async () => { throw new Error('<svg>'); } };
    return response(automation(), false);
  };
  await h.sandbox.loadAstra();
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'error');
  assert.match(h.elements['astra-auto-status'].textContent, /ไม่ยืนยัน/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements['astra-run'].disabled, false);
  await h.sandbox.loadAstra({ recompute: true });
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'error');
  assert.equal(h.toasts.length, 0);
});

const phaseLabels = {
  idle: 'รอเริ่มตรวจ', checking: 'กำลังตรวจผลใหม่', waiting: 'รอรอบตรวจถัดไป', saved: 'บันทึกรายงานแล้ว',
  waiting_results: 'รอผลรางวัลครบ', waiting_calendar: 'รอปฏิทินงวด', catching_up: 'กำลังรับงวดใหม่ที่ค้าง',
  error: 'ตรวจหรือบันทึกไม่สำเร็จ', disabled: 'ปิดระบบอัตโนมัติ', stopped: 'ตัวทำงานหยุดแล้ว',
};
for (const [phase, label] of Object.entries(phaseLabels)) test('status phase is explicit in Thai: ' + phase, async () => {
  const h = harness(), state = automation();
  Object.assign(state, { phase, enabled: phase !== 'disabled', running: !['disabled', 'stopped'].includes(phase) });
  if (!state.running) state.next_check_at = null;
  installFetch(h, state);
  await h.sandbox.loadAstra();
  assert.equal(h.elements['astra-auto-status'].dataset.state, phase);
  assert.ok(h.elements['astra-auto-status'].textContent.includes(label));
  if (!state.running) {
    assert.match(h.elements['astra-auto-status'].textContent, /ตัวทำงานหยุด/);
    assert.doesNotMatch(h.elements['astra-auto-status'].textContent, /ตัวทำงานกำลังทำงาน/);
    assert.match(h.elements['astra-auto-meta'].innerHTML, /ยังไม่กำหนด/);
  }
  assert.equal(h.elements['astra-results'].dataset.state, 'ready', 'disabled/stopped workers can still expose a valid stored report');
  assert.equal(h.requests.length, 1);
});
const errorLabels = {
  cache_missing: 'ไม่พบแคช', cache_invalid: 'แคชผลรางวัลไม่ถูกต้อง', cache_changed: 'แคชเปลี่ยน',
  storage_unavailable: 'พื้นที่บันทึกใช้งานไม่ได้', storage_invalid: 'ข้อมูลบันทึกไม่ถูกต้อง',
  source_unavailable: 'ติดต่อแหล่งผลไม่ได้', source_invalid: 'ข้อมูลจากแหล่งผลไม่ถูกต้อง', results_pending: 'รอผลรางวัลครบ',
  calendar_invalid: 'ปฏิทินงวดไม่ถูกต้อง', calendar_unavailable: 'ยังอ่านปฏิทินงวดไม่ได้',
  inference_failed: 'คำนวณไม่สำเร็จ', internal_error: 'ระบบอัตโนมัติขัดข้อง',
};
for (const [error, label] of Object.entries(errorLabels)) test('safe error stays visible without inventing a saved report: ' + error, async () => {
  const h = harness(), state = automation('2026-10-16', null);
  Object.assign(state, { phase: 'error', error });
  installFetch(h, state);
  await h.sandbox.loadAstra({ statusOnly: true });
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'error');
  assert.ok(h.elements['astra-auto-status'].textContent.includes(label));
  assert.ok(h.elements['astra-auto-status'].textContent.includes(error));
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.equal(h.elements['astra-run'].disabled, false);
  assert.equal(h.requests.length, 1);
});
test('null metadata remains unavailable rather than inventing checks, dates, or success', async () => {
  const h = harness(), state = automation('2026-10-16', null);
  for (const key of ['last_check_at', 'next_check_at', 'last_success_at', 'latest_source_date', 'target_date']) state[key] = null;
  installFetch(h, state);
  await h.sandbox.loadAstra({ statusOnly: true });
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'waiting');
  assert.match(h.elements['astra-auto-meta'].innerHTML, /ยังไม่เคยตรวจ/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /ยังไม่เคยสำเร็จ/);
  assert.doesNotMatch(h.elements['astra-auto-meta'].innerHTML, /null|undefined|NaN|1970/);
});
test('worker target may advance while selected immutable report and escaped warnings retain their own provenance', async () => {
  const h = harness(), state = automation();
  state.target_date = '2026-11-01'; state.latest_source_date = '2026-10-16'; state.snapshot_count = 2;
  state.snapshot.report.warnings = ['<svg onload="alert(1)"> & saved'];
  installFetch(h, state);
  h.sandbox.setInterval = h.sandbox.setTimeout = () => { throw new Error('no browser polling'); };
  await h.sandbox.loadAstra();
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.match(h.elements['astra-meta'].innerHTML, /2026-10-16/);
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML, /2026-11-01/);
  assert.match(h.elements['astra-auto-meta'].innerHTML, /2026-11-01/);
  assert.match(h.elements['astra-warnings'].innerHTML, /&lt;svg/);
  assert.match(h.elements['astra-warnings'].innerHTML, /&amp;/);
  assert.doesNotMatch(h.elements['astra-warnings'].innerHTML, /<svg/);
});

test('pending automation read clears old metadata and lets manual computation take over without stale loading', async () => {
  const h = harness(), pending = deferred();
  installFetch(h, automation());
  await h.sandbox.loadAstra();
  h.sandbox.fetch = route => {
    h.requests.push(route);
    return route.startsWith('/api/astra/automation') ? pending.promise : Promise.resolve(response());
  };
  const old = h.sandbox.loadAstra();
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'loading');
  assert.equal(h.elements['astra-auto-meta'].innerHTML, '');
  assert.equal(h.elements['astra-results'].getAttribute('aria-busy'), 'true');
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.equal(h.elements['astra-run'].disabled, false, 'a hung status read must not block manual inference');
  await h.sandbox.loadAstra({ recompute: true });
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'idle');
  assert.match(h.elements['astra-auto-status'].textContent, /ไม่ยืนยัน/);
  const expected = h.elements['astra-meta'].innerHTML;
  pending.reject(new Error('stale status error')); await old;
  assert.equal(h.elements['astra-meta'].innerHTML, expected);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'idle');
  assert.equal(h.toasts.length, 0);
});
for (const late of ['saved', 'missing', 'malformed', 'network']) test('newest same-target status wins over late ' + late, async () => {
  const h = harness(), pending = [];
  h.sandbox.fetch = route => { h.requests.push(route); const p = deferred(); pending.push(p); return p.promise; };
  const first = h.sandbox.loadAstra(), second = h.sandbox.loadAstra();
  const newer = automation(); newer.snapshot.report.warnings = ['newest saved report'];
  pending[1].resolve(response(newer)); await second;
  const expected = h.elements['astra-meta'].innerHTML + h.elements['astra-auto-meta'].innerHTML;
  if (late === 'network') pending[0].reject(new Error('stale failure'));
  else pending[0].resolve(response(late === 'malformed' ? null : automation('2026-10-16', late === 'missing' ? null : snapshot())));
  await first;
  assert.equal(h.elements['astra-meta'].innerHTML + h.elements['astra-auto-meta'].innerHTML, expected);
  assert.match(h.elements['astra-warnings'].innerHTML, /newest saved report/);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'saved');
  assert.equal(h.requests.length, 2, 'stale no-snapshot response cannot dispatch inference');
});
for (const late of ['saved', 'missing', 'malformed', 'network']) test('selected target race ignores old automation ' + late, async () => {
  const h = harness(), pending = [];
  vm.runInContext("currentPage='predict';currentPredTab='formula';_formulaActiveTab='ASTRA';", h.sandbox);
  h.sandbox.fetch = route => { h.requests.push(route); const p = deferred(); pending.push(p); return p.promise; };
  const first = h.sandbox.loadAstra();
  const second = h.sandbox.syncSharedDrawDate('2026-11-01', true);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'loading');
  assert.match(h.elements['astra-auto-status'].textContent, /2026-11-01/);
  pending[1].resolve(response(automation('2026-11-01'))); await second;
  if (late === 'network') pending[0].reject(new Error('stale failure'));
  else pending[0].resolve(response(late === 'malformed' ? null : automation('2026-10-16', late === 'missing' ? null : snapshot())));
  await first;
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
  assert.match(h.elements['astra-meta'].innerHTML, /2026-11-01/);
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML + h.elements['astra-auto-meta'].innerHTML, /2026-10-16/);
  assert.equal(h.requests.length, 2);
});
for (const visible of [false, true]) test('non-user ABA and clearing target invalidate auto status without fetching while visible=' + visible, async () => {
  const h = harness(), pending = deferred();
  vm.runInContext(visible ? "currentPage='predict';currentPredTab='formula';_formulaActiveTab='ASTRA';" : "currentPredTab='predict';", h.sandbox);
  h.sandbox.fetch = route => { h.requests.push(route); return pending.promise; };
  const first = h.sandbox.loadAstra();
  h.sandbox.syncSharedDrawDate('2026-11-01', false);
  h.sandbox.syncSharedDrawDate('2026-10-16', false);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'idle');
  pending.resolve(response(automation('2026-10-16', null))); await first;
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'idle');
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements['astra-auto-meta'].innerHTML, '');
  h.elements['shared-draw-date'].value = '';
  h.sandbox.syncSharedDrawDate('');
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'idle');
});
for (const late of ['valid', 'malformed', 'network']) test('a late unsaved inference cannot replace a newer saved report: ' + late, async () => {
  const h = harness(), pending = [];
  h.sandbox.fetch = route => { h.requests.push(route); const p = deferred(); pending.push(p); return p.promise; };
  const first = h.sandbox.loadAstra();
  pending[0].resolve(response(automation('2026-10-16', null)));
  await new Promise(setImmediate);
  assert.equal(h.requests[1], '/api/predict/astra?date=2026-10-16');
  const second = h.sandbox.loadAstra();
  pending[2].resolve(response(automation())); await second;
  const expected = h.elements['astra-meta'].innerHTML;
  if (late === 'network') pending[1].reject(new Error('old inference'));
  else pending[1].resolve(response(late === 'malformed' ? null : report()));
  await first;
  assert.equal(h.elements['astra-meta'].innerHTML, expected);
  assert.match(h.elements['astra-meta'].innerHTML, /บันทึกถาวร/);
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'saved');
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
});

test('status copy is explicitly last-read data, not a claim of continuous browser monitoring', () => {
  const section = html.slice(html.indexOf('id="astra-automation"'), html.indexOf('id="astra-status"'));
  assert.match(section, /สถานะจากการอ่านครั้งล่าสุด/);
  assert.match(section, /ไม่อัปเดตเอง/);
});
for (const target of ['', '2026-02-30', '2026-1-16', '2026-10-16\n', '<svg onload=alert(1)>']) test('invalid selected target never fetches automation: ' + JSON.stringify(target), async () => {
  const h = harness();
  h.elements['shared-draw-date'].value = target;
  await h.sandbox.loadAstra();
  assert.equal(h.requests.length, 0);
  assert.equal(h.elements['astra-results'].dataset.state, 'error');
  assert.equal(h.elements['astra-auto-status'].dataset.state, 'error');
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML + bodies(h), /<svg/);
});
test('saved insufficient categories stay visible and never trigger a replacement inference', async () => {
  const h = harness(), state = automation();
  for (const [key] of specs) Object.assign(state.snapshot.report.categories[key], {
    status: 'insufficient_data', valid_draws: 0, invalid_draws: 20, training_cutoff_date: null, numbers: [],
  });
  installFetch(h, state);
  await h.sandbox.loadAstra();
  assert.equal(h.elements['astra-results'].dataset.state, 'empty');
  assert.match(h.elements['astra-meta'].innerHTML, /บันทึกถาวร/);
  for (const [key] of specs) assert.match(h.elements['astra-body-' + key].innerHTML, /ข้อมูลไม่เพียงพอ/);
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.equal(h.requests.length, 1);
});
test('status-only refresh invalidates old manual inference even without a saved report', async () => {
  const h = harness(), pending = deferred();
  h.sandbox.fetch = route => { h.requests.push(route); return route.startsWith('/api/predict') ? pending.promise : Promise.resolve(response(automation('2026-10-16', null))); };
  const first = h.sandbox.loadAstra({ recompute: true });
  await h.sandbox.loadAstra({ statusOnly: true });
  pending.resolve(response()); await first;
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.match(h.elements['astra-status'].textContent, /ไม่มีรายงานบันทึก/);
  assert.doesNotMatch(bodies(h), /class="astra-number"/);
  assert.equal(h.requests.length, 2);
});
test('quiet status read preserves the overlapping generic API announcement', async () => {
  const h = harness(), pending = [];
  h.sandbox.fetch = () => { const p = deferred(); pending.push(p); return p.promise; };
  const first = h.sandbox.loadAstra();
  const spinner = h.elements['api-spinner'];
  assert.equal(spinner.getAttribute('aria-hidden'), 'true');
  const other = h.sandbox.api('ordinary');
  assert.equal(spinner.getAttribute('aria-hidden'), null);
  pending[0].resolve(response(automation())); await first;
  assert.equal(spinner.getAttribute('aria-hidden'), null);
  assert.equal(spinner.classList.contains('active'), true);
  pending[1].resolve(response({})); await other;
  assert.equal(spinner.classList.contains('active'), false);
  assert.equal(h.toasts.length, 0);
});

test('explicit official shifted target is readable without changing shared dates or invoking inference', async () => {
  const h = harness(), shared = h.elements['shared-draw-date'];
  shared.value = '2027-01-16';
  const originalOptions = JSON.stringify(shared.options);
  const calendarBefore = JSON.stringify(h.sandbox.clientDraws());
  installFetch(h, automation('2027-01-17', null));
  await h.sandbox.loadAstra({ statusOnly: true });
  assert.match(tag('astra-auto-target'), /^<button\b/);
  const button = h.elements['astra-auto-target'];
  assert.equal(button.hidden, false);
  assert.match(button.textContent, /2027-01-17/);
  assert.equal(shared.value, '2027-01-16', 'status read must not override explicit selection');
  installFetch(h, automation('2027-01-17'));
  const action = tag('astra-auto-target').match(/onclick="([^"]+)"/)?.[1];
  await vm.runInContext(action, h.sandbox);
  assert.deepEqual(h.requests, ['/api/astra/automation?date=2027-01-16', '/api/astra/automation?date=2027-01-17']);
  assert.match(h.elements['astra-meta'].innerHTML, /2027-01-17/);
  assert.match(h.elements['astra-target-label'].textContent, /2027-01-17/);
  assert.match(h.elements['astra-target-label'].textContent, /เฉพาะ astra/);
  assert.equal(shared.value, '2027-01-16');
  assert.equal(JSON.stringify(shared.options), originalOptions);
  assert.equal(JSON.stringify(h.sandbox.clientDraws()), calendarBefore);
  assert.equal(h.elements['astra-results'].dataset.state, 'ready');
});

test('automatic target stays astra-only for manual use and resets on shared selection changes', async () => {
  const h = harness();
  installFetch(h, automation('2027-01-17', null));
  await h.sandbox.loadAstra({ statusOnly: true });
  await h.sandbox.showAstraAutomaticTarget();
  assert.equal(h.elements['astra-results'].dataset.state, 'idle');
  assert.ok(h.requests.every(route => route.startsWith('/api/astra/automation?')));
  installFetch(h, automation('2027-01-17'), report('2027-01-17'));
  await h.sandbox.loadAstra({ recompute: true });
  assert.equal(h.requests.at(-1), '/api/predict/astra?date=2027-01-17');
  assert.match(h.elements['astra-target-label'].textContent, /เฉพาะ astra/);
  h.sandbox.syncSharedDrawDate('2026-11-01', false);
  assert.equal(h.elements['astra-auto-target'].hidden, true);
  assert.match(h.elements['astra-target-label'].textContent, /2026-11-01/);
  assert.doesNotMatch(h.elements['astra-target-label'].textContent, /เฉพาะ astra/);
  installFetch(h, automation('2026-11-01'));
  await h.sandbox.loadAstra({ statusOnly: true });
  assert.equal(h.requests.at(-1), '/api/astra/automation?date=2026-11-01');
});
test('late automatic-target response cannot replace a new shared target even after ABA reset', async () => {
  const h = harness(), pending = deferred();
  installFetch(h, automation('2027-01-17', null));
  await h.sandbox.loadAstra({ statusOnly: true });
  h.sandbox.fetch = route => { h.requests.push(route); return pending.promise; };
  const old = h.sandbox.showAstraAutomaticTarget();
  h.sandbox.syncSharedDrawDate('2026-11-01', false);
  h.sandbox.syncSharedDrawDate('2026-10-16', false);
  installFetch(h, automation());
  await h.sandbox.loadAstra({ statusOnly: true });
  pending.resolve(response(automation('2027-01-17'))); await old;
  assert.match(h.elements['astra-meta'].innerHTML, /2026-10-16/);
  assert.doesNotMatch(h.elements['astra-meta'].innerHTML, /2027-01-17/);
});
test('missing or failed calendar status hides and disables the explicit target action', async () => {
  const h = harness();
  for (const status of [automation(null, null), null]) {
    installFetch(h, status);
    await h.sandbox.loadAstra({ statusOnly: true });
    const before = h.requests.length;
    assert.equal(h.elements['astra-auto-target'].hidden, true);
    await h.sandbox.showAstraAutomaticTarget();
    assert.equal(h.requests.length, before);
  }
  assert.match(tag('astra-auto-target'), /type="button"/);
  assert.match(css, /#astra-auto-target\[hidden\]\{display:none\}/);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (error) { error.message = name + ': ' + error.message; throw error; }
    passed++;
    if (!name.startsWith('rejects automation payload:')) console.log('PASS ' + name);
  }
  console.log(`astra automation UI: ${passed} synthetic cases passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
