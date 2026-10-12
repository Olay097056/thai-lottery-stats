// Ticket06 SPA-core contract regressions; all data fixtures are synthetic.
// Run with: node scripts/test_spa_core_pages_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.css'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
const astraStart = appSrc.indexOf('// ─── astra: isolated');
const astraEnd = appSrc.indexOf('// ─── HyperUI theme', astraStart);
if (astraStart < 0 || astraEnd <= astraStart) throw new Error('missing production astra state/helpers');
const astraSource = appSrc.slice(astraStart, astraEnd);
function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'm').exec(source);
  if (!start) throw new Error('not found: ' + name);
  let i = start.index + start[0].length;
  let depth = 1;
  while (i < source.length && depth) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  if (depth) throw new Error('unterminated function: ' + name);
  return source.slice(start.index, i);
}

let passed = 0;
const securityCase = process.env.T06_SECURITY_CASE || '';
function check(label, condition) {
  if (!condition) throw new Error('FAIL: ' + label);
  passed++;
}

const elements = {
  'freq-col': { value: 'prize1' },
  'freq-top': { value: '30', options: ['30', '50', '100', '200'].map(value => ({ value, disabled: false })) },
  'freq-tbody': { innerHTML: '' },
  'freq-status': { textContent: '' },
  'never-list': { innerHTML: '' },
};
const requests = [];
const frequencyCallOptions = [];
const sandbox = {
  document: { getElementById: id => elements[id] || null },
  api: async (route, options) => {
    requests.push(route);
    frequencyCallOptions.push(options);
    return { data: [{ 'เลข': '012345', 'จำนวนครั้ง': 2, 'อัตรา (%)': 50 }], never: [] };
  },
  chartOpts: () => ({}),
  _charts: {},
  mkChart: () => {},
};
const fakeTimers = new Map();
let nextFakeTimerId = 0;
sandbox.setTimeout = callback => { const id = ++nextFakeTimerId; fakeTimers.set(id, callback); return id; };
sandbox.clearTimeout = id => fakeTimers.delete(id);
function flushTimers() {
  const callbacks = [...fakeTimers.values()];
  fakeTimers.clear();
  callbacks.forEach(callback => callback());
}
vm.createContext(sandbox);
const frequencyState = appSrc.split(/\r?\n/).find(line => line === 'let _freqLoadRequestId=0;');
if (!frequencyState) throw new Error('missing frequency request state declaration');
vm.runInContext(extractFunction(appSrc, 'escHtml'), sandbox);
vm.runInContext(frequencyState + String.fromCharCode(10) + extractFunction(appSrc, 'loadFreq'), sandbox);

(async () => {
  const spinnerTagStart = indexSrc.indexOf('<div id="api-spinner"');
  const spinnerTagEnd = indexSrc.indexOf('>', spinnerTagStart);
  const spinnerTag = spinnerTagStart >= 0 && spinnerTagEnd > spinnerTagStart ? indexSrc.slice(spinnerTagStart, spinnerTagEnd + 1) : '';
  check('generic API spinner starts hidden from screen readers', spinnerTag.includes('aria-hidden="true"'));

  const apiToasts = [];
  const apiSpinnerAttributes = new Map([['aria-hidden', 'true']]);
  const apiSpinnerClasses = new Set();
  const apiSpinner = {
    classList: { add(name) { apiSpinnerClasses.add(name); }, remove(name) { apiSpinnerClasses.delete(name); } },
    setAttribute(name, value) { apiSpinnerAttributes.set(name, String(value)); },
    removeAttribute(name) { apiSpinnerAttributes.delete(name); },
  };
  const apiSandbox = {
    window: { _lastApiErrToast: 0 },
    document: { getElementById: () => apiSpinner },
    Date: { now: () => 10000 },
    fetch: async () => { throw new Error('synthetic network failure'); },
    toast: (...args) => apiToasts.push(args),
  };
  const apiState = appSrc.split(String.fromCharCode(10)).map(line => line.replace(String.fromCharCode(13), '')).find(line => line.startsWith('let _apiInFlight='));
  if (!apiState) throw new Error('missing API request state declaration');
  vm.createContext(apiSandbox);
  vm.runInContext(apiState + String.fromCharCode(10) + extractFunction(appSrc, 'api'), apiSandbox);
  const quietApiResult = await apiSandbox.api('history?n=50', { suppressNetworkToast: true, suppressSpinnerAnnouncement: true });
  check('page-local network errors suppress the duplicate global toast', !!quietApiResult.error && apiToasts.length === 0);
  check('page-local API requests keep the generic spinner hidden from screen readers', apiSpinnerAttributes.get('aria-hidden') === 'true');
  const defaultApiResult = await apiSandbox.api('other');
  check('other API calls retain the global network-error toast', !!defaultApiResult.error && apiToasts.length === 1);
  let resolveGenericFetch;
  apiSandbox.fetch = () => new Promise(resolve => { resolveGenericFetch = resolve; });
  const genericApiRequest = apiSandbox.api('other');
  check('generic API calls expose the global spinner status while pending', !apiSpinnerAttributes.has('aria-hidden'));
  resolveGenericFetch({ json: async () => ({ data: [] }) });
  await genericApiRequest;
  check('generic API calls hide the global spinner status after completion', apiSpinnerAttributes.get('aria-hidden') === 'true');

  const overlappingFetches = [];
  apiSandbox.fetch = () => new Promise((resolve, reject) => overlappingFetches.push({ resolve, reject }));
  const toastCountBeforeOverlap = apiToasts.length;
  const quietFirst = apiSandbox.api('history?n=50', { suppressNetworkToast: true, suppressSpinnerAnnouncement: true });
  check('quiet request is visually active without a global spinner announcement',
    apiSpinnerClasses.has('active') && apiSpinnerAttributes.get('aria-hidden') === 'true');
  const ordinarySecond = apiSandbox.api('other');
  check('ordinary request exposes the shared spinner beside a quiet request',
    apiSpinnerClasses.has('active') && !apiSpinnerAttributes.has('aria-hidden'));
  overlappingFetches[0].reject(new Error('synthetic quiet request failure'));
  const quietFailure = await quietFirst;
  check('quiet concurrent failure suppresses its global toast while ordinary call remains pending',
    !!quietFailure.error && apiToasts.length === toastCountBeforeOverlap && apiSpinnerClasses.has('active') && !apiSpinnerAttributes.has('aria-hidden'));
  overlappingFetches[1].resolve({ json: async () => ({ ok: true }) });
  await ordinarySecond;
  check('shared spinner hides after ordinary completion when quiet request already settled',
    !apiSpinnerClasses.has('active') && apiSpinnerAttributes.get('aria-hidden') === 'true');

  apiSandbox.window._lastApiErrToast = 0;
  const quietSecond = apiSandbox.api('history?n=50', { suppressNetworkToast: true, suppressSpinnerAnnouncement: true });
  const ordinaryFirst = apiSandbox.api('other');
  check('overlapping ordinary and quiet calls expose the ordinary loading announcement', !apiSpinnerAttributes.has('aria-hidden'));
  overlappingFetches[3].reject(new Error('synthetic ordinary request failure'));
  const ordinaryFailure = await ordinaryFirst;
  check('ordinary concurrent failure keeps its toast while the remaining quiet call hides the global spinner',
    !!ordinaryFailure.error && apiToasts.length === toastCountBeforeOverlap + 1 && apiSpinnerClasses.has('active') && apiSpinnerAttributes.get('aria-hidden') === 'true');
  overlappingFetches[2].resolve({ json: async () => ({ data: [] }) });
  await quietSecond;
  check('shared spinner is hidden after both mixed requests settle',
    !apiSpinnerClasses.has('active') && apiSpinnerAttributes.get('aria-hidden') === 'true');

  await sandbox.loadFreq();
  check('prize1 calls its frequency endpoint', requests[0] === 'freq-table?col=prize1&top_n=30');
  check('frequency pages suppress duplicate global network-error toasts', frequencyCallOptions[0]?.suppressNetworkToast === true);
  check('frequency pages suppress duplicate generic loading announcements', frequencyCallOptions[0]?.suppressSpinnerAnnouncement === true);
  check('frequency rendering preserves a leading-zero string', elements['freq-tbody'].innerHTML.includes('012345'));
  check('unsupported prize1 never-list is not reported as all numbers seen',
    elements['never-list'].innerHTML.includes('ไม่รองรับ') && !elements['never-list'].innerHTML.includes('ทุกเลขเคยออกแล้ว'));
  check('frequency result count is announced through a live status region', elements['freq-status'].textContent === 'แสดงผลความถี่ 1 รายการ');
  check('frequency displays a provided percentage', elements['freq-tbody'].innerHTML.includes('<td>50.00%</td>'));
  sandbox.api = async () => ({ data: [{ 'เลข': '012', 'จำนวนครั้ง': 2, 'ออกล่าสุด': '16/07/2026', '10 งวดล่าสุด': '16/07/26' }], never: [] });
  await sandbox.loadFreq();
  check('frequency rows without a percentage show unavailable rather than fabricated 0.00%',
    elements['freq-tbody'].innerHTML.includes('<td>—</td>') && !elements['freq-tbody'].innerHTML.includes('0.00%'));
  if (!securityCase || securityCase === 'frequency-number') {
    sandbox.api = async () => ({ data: [{ 'เลข': '<img src=x onerror=alert(1)>', 'จำนวนครั้ง': 1, 'อัตรา (%)': 50 }], never: [] });
    await sandbox.loadFreq();
    check('frequency API number strings are escaped before HTML rendering',
      !elements['freq-tbody'].innerHTML.includes('<img') && elements['freq-tbody'].innerHTML.includes('&lt;img src=x'));
  }
  if (!securityCase || securityCase === 'frequency-never') {
    elements['freq-col'].value = 'top3';
    sandbox.api = async () => ({ data: [{ 'เลข': '012345', 'จำนวนครั้ง': 1, 'อัตรา (%)': 50 }], never: ['<svg onload=alert(1)>'] });
    await sandbox.loadFreq();
    check('frequency never-list strings are escaped before HTML rendering',
      !elements['never-list'].innerHTML.includes('<svg') && elements['never-list'].innerHTML.includes('&lt;svg onload=alert(1)&gt;'));
  }
  sandbox.api = async () => ({ data: [{ 'เลข': '012345', 'จำนวนครั้ง': 2, 'อัตรา (%)': '50' }], never: [] });
  await sandbox.loadFreq();
  check('frequency rejects nonnumeric percentage values instead of throwing during cell formatting',
    elements['freq-status'].textContent === 'โหลดตารางความถี่ไม่สำเร็จ ลองใหม่อีกครั้ง' && elements['freq-tbody'].innerHTML.includes('โหลดตารางความถี่ไม่สำเร็จ'));
  sandbox.api = async () => ({ data: [null], never: [] });
  await sandbox.loadFreq();
  check('malformed standard frequency rows show an explicit error instead of leaving the loading row',
    elements['freq-status'].textContent === 'โหลดตารางความถี่ไม่สำเร็จ ลองใหม่อีกครั้ง' && elements['freq-tbody'].innerHTML.includes('โหลดตารางความถี่ไม่สำเร็จ'));
  const frequencyStatusTag = indexSrc.match(/<div[^>]*id="freq-status"[^>]*>/)?.[0] || '';
  check('frequency status region is polite, atomic, and screen-reader available',
    frequencyStatusTag.includes('class="sr-only"') && frequencyStatusTag.includes('role="status"') && frequencyStatusTag.includes('aria-live="polite"') && frequencyStatusTag.includes('aria-atomic="true"'));
  elements['freq-col'].value = 'top3';
  sandbox.api = async () => ({ error: 'fixture backend error', data: [], never: [] });
  await sandbox.loadFreq();
  check('frequency API errors are explicit and never mislabeled as a measured outcome',
    elements['freq-tbody'].innerHTML.includes('โหลดตารางความถี่ไม่สำเร็จ') && !elements['never-list'].innerHTML.includes('ทุกเลขเคยออกแล้ว'));
  check('frequency API errors are announced through a live status region',
    elements['freq-status'].textContent === 'โหลดตารางความถี่ไม่สำเร็จ ลองใหม่อีกครั้ง');
  sandbox.api = async () => ({ data: [], never: Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0')) });
  await sandbox.loadFreq();
  check('a valid zero-sample frequency response has an explicit empty-table state',
    elements['freq-tbody'].innerHTML.includes('ยังไม่มีข้อมูลความถี่'));
  check('a zero-sample frequency response is announced through a live status region',
    elements['freq-status'].textContent === 'ยังไม่มีข้อมูลความถี่');

  elements['freq-col'].value = 'prize2';
  elements['freq-top'].value = '100';
  sandbox.api = async () => ({ data: [null] });
  await sandbox.loadFreq();
  check('malformed Sanook frequency rows show an explicit error instead of throwing',
    elements['freq-status'].textContent === 'โหลดตารางความถี่ไม่สำเร็จ ลองใหม่อีกครั้ง' && elements['freq-tbody'].innerHTML.includes('โหลดตารางความถี่ไม่สำเร็จ'));
  elements['freq-top'].value = '100';
  const sanookRoutes = [];
  sandbox.api = async route => { sanookRoutes.push(route); return { data: [{ number: '123456', count: 2, pct: 50 }] }; };
  await sandbox.loadFreq();
  check('Sanook frequency never sends a top_n above the API limit', sanookRoutes[0] === 'prize-freq?prize=prize2&top_n=50');
  check('Sanook selection clamps and disables unsupported larger Top N choices',
    elements['freq-top'].value === '50' && elements['freq-top'].options.filter(option => Number(option.value) > 50).every(option => option.disabled));
  elements['freq-col'].value = 'top3';
  await sandbox.loadFreq();
  check('standard frequency re-enables larger supported Top N choices',
    elements['freq-top'].options.filter(option => Number(option.value) > 50).every(option => !option.disabled));

  elements['hist-n'] = { value: '50' };
  elements['hist-search'] = { value: '' };
  elements['hist-tbody'] = { innerHTML: '' };
  elements['hist-status'] = { textContent: '' };
  const testNewline = String.fromCharCode(10);
  const historyState = appSrc.split(/\r?\n/).find(line => line.startsWith('let _histData='));
  if (!historyState) throw new Error('missing history state declaration');
  vm.runInContext(historyState + testNewline + extractFunction(appSrc, 'filterHistory') + testNewline + extractFunction(appSrc, 'loadHistory'), sandbox);
  let historyCallOptions;
  sandbox.api = async (_route, options) => { historyCallOptions = options; return { error: 'fixture backend error', data: [] }; };
  await sandbox.loadHistory();
  check('history pages suppress duplicate global network-error toasts', historyCallOptions?.suppressNetworkToast === true);
  check('history pages suppress duplicate generic loading announcements', historyCallOptions?.suppressSpinnerAnnouncement === true);
  check('history API errors are explicit instead of becoming a blank table',
    elements['hist-tbody'].innerHTML.includes('โหลดผลย้อนหลังไม่สำเร็จ'));
  check('history API errors are announced through a live status region',
    elements['hist-status'].textContent === 'โหลดผลย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง');
  sandbox.api = async () => ({ data: [] });
  await sandbox.loadHistory();
  check('a valid empty history response has an explicit empty state',
    elements['hist-tbody'].innerHTML.includes('ไม่พบผลย้อนหลัง'));
  check('an empty history result is announced through a live status region',
    elements['hist-status'].textContent === 'ไม่พบผลย้อนหลัง');
  sandbox.api = async () => ({ data: [null] });
  await sandbox.loadHistory();
  check('malformed history rows show an explicit error instead of leaving a loading row',
    elements['hist-status'].textContent === 'โหลดผลย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง' && elements['hist-tbody'].innerHTML.includes('โหลดผลย้อนหลังไม่สำเร็จ'));
  sandbox.api = async () => ({ data: [{}] });
  await sandbox.loadHistory();
  check('history rows without a required date are rejected as malformed',
    elements['hist-status'].textContent === 'โหลดผลย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง' && elements['hist-tbody'].innerHTML.includes('โหลดผลย้อนหลังไม่สำเร็จ'));
  sandbox.api = async () => ({ data: [{ date: '16/07/2026', prize1: 123 }] });
  await sandbox.loadHistory();
  check('history preserves lottery results as strings by rejecting numeric prize values',
    elements['hist-status'].textContent === 'โหลดผลย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง' && elements['hist-tbody'].innerHTML.includes('โหลดผลย้อนหลังไม่สำเร็จ'));

  const historyRows = [
    { date: '16/07/2026', prize1: '012345', top3: '123', top2: '45', front3_1: '111', front3_2: '222', back3_1: '333', back3_2: '444', bottom2: '56' },
    { date: '01/07/2026', prize1: '987654', top3: '321', top2: '54', front3_1: '555', front3_2: '666', back3_1: '777', back3_2: '888', bottom2: '99' },
  ];
  const historyRoutes = [];
  elements['hist-search'].value = '';
  sandbox.api = async route => { historyRoutes.push(route); return { data: historyRows }; };
  await sandbox.loadHistory();
  let historyHtml = elements['hist-tbody'].innerHTML;
  check('history requests the selected count', historyRoutes[0] === 'history?n=50');
  check('history preserves newest-first API order', historyHtml.indexOf('16/07/2026') < historyHtml.indexOf('01/07/2026'));
  check('history preserves leading-zero lottery numbers as strings', historyHtml.includes('012345'));
  check('history result count is announced through a live status region',
    elements['hist-status'].textContent === 'แสดงผลย้อนหลัง 2 รายการ');
  if (!securityCase || securityCase === 'history-fields') {
    const unsafe = '<img src=x onerror=alert(1)>';
    const maliciousRow = { date: unsafe, prize1: unsafe, top3: unsafe, top2: unsafe, front3_1: unsafe, front3_2: unsafe, back3_1: unsafe, back3_2: unsafe, bottom2: unsafe };
    sandbox.api = async () => ({ data: [maliciousRow] });
    await sandbox.loadHistory();
    historyHtml = elements['hist-tbody'].innerHTML;
    check('all history API fields are escaped before HTML rendering',
      !historyHtml.includes('<img') && historyHtml.split('&lt;img src=x onerror=alert(1)&gt;').length - 1 === 9);
    sandbox.api = async () => ({ data: historyRows });
    await sandbox.loadHistory();
  }
  const statusBeforeSearch = elements['hist-status'].textContent;
  elements['hist-search'].value = 'not-present';
  sandbox.filterHistory();
  check('history table filters immediately while its live announcement waits',
    elements['hist-tbody'].innerHTML.includes('ไม่พบผลย้อนหลัง') && elements['hist-status'].textContent === statusBeforeSearch);
  elements['hist-search'].value = '012345';
  sandbox.filterHistory();
  check('rapid history search changes keep only the latest announcement timer', fakeTimers.size === 1);
  flushTimers();
  check('debounced history status announces the final filtered count', elements['hist-status'].textContent === 'แสดงผลย้อนหลัง 1 รายการ');
  historyHtml = elements['hist-tbody'].innerHTML;
  check('history search matches a leading-zero number and filters other rows', historyHtml.includes('012345') && !historyHtml.includes('987654'));
  elements['hist-search'].value = 'not-present';
  sandbox.filterHistory();
  check('no-match history search displays an explicit empty result', elements['hist-tbody'].innerHTML.includes('ไม่พบผลย้อนหลัง'));
  flushTimers();
  check('no-match history search is announced through a live status region', elements['hist-status'].textContent === 'ไม่พบผลย้อนหลัง');

  let resolveHistory30, resolveHistory50;
  sandbox.api = route => new Promise(resolve => {
    if (route === 'history?n=30') resolveHistory30 = resolve;
    else if (route === 'history?n=50') resolveHistory50 = resolve;
    else throw new Error('unexpected history route: ' + route);
  });
  elements['hist-search'].value = '';
  elements['hist-n'].value = '30';
  const olderHistoryRequest = sandbox.loadHistory();
  check('history loading is announced while results are pending', elements['hist-status'].textContent === 'กำลังโหลดผลย้อนหลัง...');
  elements['hist-search'].value = '012345';
  sandbox.filterHistory();
  check('filtering during a pending history request keeps the loading announcement',
    elements['hist-status'].textContent === 'กำลังโหลดผลย้อนหลัง...');
  check('filtering during a pending history request does not show stale rows',
    elements['hist-tbody'].innerHTML.includes('กำลังโหลดผลย้อนหลัง...') && !elements['hist-tbody'].innerHTML.includes('012345'));
  elements['hist-n'].value = '50';
  elements['hist-search'].value = '';
  const latestHistoryRequest = sandbox.loadHistory();
  resolveHistory50({ data: [{ date: 'latest-selection', prize1: '505050' }] });
  await latestHistoryRequest;
  resolveHistory30({ data: [{ date: 'stale-selection', prize1: '303030' }] });
  await olderHistoryRequest;
  check('late history response cannot overwrite the latest selected request',
    elements['hist-tbody'].innerHTML.includes('505050') && !elements['hist-tbody'].innerHTML.includes('303030'));

  let resolveTop3, resolveBottom2;
  sandbox.api = route => new Promise(resolve => {
    if (route.includes('col=top3')) resolveTop3 = resolve;
    else if (route.includes('col=bottom2')) resolveBottom2 = resolve;
    else throw new Error('unexpected frequency route: ' + route);
  });
  elements['freq-col'].value = 'top3';
  const olderFreqRequest = sandbox.loadFreq();
  check('frequency loading is announced while results are pending', elements['freq-status'].textContent === 'กำลังโหลดตารางความถี่...');
  elements['freq-col'].value = 'bottom2';
  const latestFreqRequest = sandbox.loadFreq();
  resolveBottom2({ data: [{ 'เลข': '98', 'จำนวนครั้ง': 3, 'อัตรา (%)': 10 }], never: ['00'] });
  await latestFreqRequest;
  resolveTop3({ data: [{ 'เลข': '123', 'จำนวนครั้ง': 7, 'อัตรา (%)': 20 }], never: ['999'] });
  await olderFreqRequest;
  check('late frequency response cannot overwrite the latest selected field',
    elements['freq-tbody'].innerHTML.includes('98') && !elements['freq-tbody'].innerHTML.includes('123'));

  const narrowStart = cssSrc.indexOf('@media(max-width:900px){');
  const narrowEnd = cssSrc.indexOf('@media(max-width:640px){', narrowStart);
  const narrowCss = narrowStart >= 0 && narrowEnd > narrowStart ? cssSrc.slice(narrowStart, narrowEnd) : '';
  const mobileFooterStyle = narrowCss.match(/\.sidebar-footer\{([^}]*)\}/)?.[1] || '';
  const mobileThemeStyle = narrowCss.match(/\.theme-toggle-btn\{([^}]*)\}/)?.[1] || '';
  check('responsive bottom navigation keeps a visible theme-toggle slot',
    /display:flex/.test(mobileFooterStyle) && /flex:0 0 52px/.test(mobileFooterStyle) && /width:44px/.test(mobileThemeStyle) && /height:44px/.test(mobileThemeStyle) && /flex:0 0 44px/.test(mobileThemeStyle) && /#sidebar-draw-date\{display:none!important\}/.test(narrowCss) && !/\.logo,\.sidebar-footer\{display:none\}/.test(narrowCss));
  const historyStatusTag = indexSrc.match(/<div[^>]*id="hist-status"[^>]*>/)?.[0] || '';
  check('history status region is polite, atomic, and screen-reader available',
    historyStatusTag.includes('class="sr-only"') && historyStatusTag.includes('role="status"') && historyStatusTag.includes('aria-live="polite"') && historyStatusTag.includes('aria-atomic="true"'));
  const srOnlyRule = cssSrc.match(/\.sr-only\{([^}]*)\}/)?.[1] || '';
  check('live status regions are visually clipped, not removed from accessibility tree',
    /position:absolute/.test(srOnlyRule) && /clip:rect\(0,0,0,0\)/.test(srOnlyRule) && !/display:none/.test(srOnlyRule));
  const navTags = [...indexSrc.matchAll(/<div class="nav-item[^>]*data-page="[^"]+"[^>]*>/g)].map(match => match[0]);
  check('all seven navigation items expose button semantics and Enter/Space activation',
    navTags.length === 7 && navTags.every(tag => tag.includes('role="button"') && tag.includes('tabindex="0"') && tag.includes("event.key==='Enter'") && tag.includes("event.key===' '") && tag.includes('showPage(')));
  check('frequency and history controls have associated labels',
    ['freq-col', 'freq-top', 'hist-n', 'hist-search'].every(id => indexSrc.includes(`for="${id}"`) && indexSrc.includes(`id="${id}"`)));
  const themeToggleTag = indexSrc.match(/<button[^>]*id="theme-toggle"[^>]*>/)?.[0] || '';
  check('theme toggle has an accessible name', themeToggleTag.includes('aria-label="สลับโหมดมืด/สว่าง"'));
  check('theme toggle exposes its default pressed state', themeToggleTag.includes('aria-pressed="false"'));
  const themeSyncOpen = '<script id="theme-toggle-state-sync">';
  const themeSyncStart = indexSrc.indexOf(themeSyncOpen);
  const themeSyncClose = indexSrc.indexOf('</script>', themeSyncStart);
  const themeSyncSource = themeSyncStart >= 0 && themeSyncClose > themeSyncStart
    ? indexSrc.slice(themeSyncStart + themeSyncOpen.length, themeSyncClose) : '';
  const themeSyncIndex = indexSrc.indexOf('id="theme-toggle-state-sync"');
  check('theme boot state sync runs after the control exists and before app initialization',
    !!themeSyncSource && indexSrc.indexOf('id="theme-toggle"') < themeSyncIndex && themeSyncIndex < indexSrc.indexOf('static/app.js?v='));
  const bootThemeButton = { attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); } };
  const bootThemeSandbox = { document: { documentElement: { dataset: { theme: 'dark' } }, getElementById: id => id === 'theme-toggle' ? bootThemeButton : null } };
  if (themeSyncSource) vm.runInNewContext(themeSyncSource, bootThemeSandbox);
  check('theme boot state sync exposes saved dark mode', bootThemeButton.attributes['aria-pressed'] === 'true');
  bootThemeSandbox.document.documentElement.dataset.theme = 'light';
  if (themeSyncSource) vm.runInNewContext(themeSyncSource, bootThemeSandbox);
  check('theme boot state sync exposes default light mode', bootThemeButton.attributes['aria-pressed'] === 'false');

  const themeValues = new Map();
  const themeButton = { textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); } };
  const themeSandbox = {
    document: { documentElement: { dataset: {} }, getElementById: id => id === 'theme-toggle' ? themeButton : null },
    localStorage: { getItem: key => themeValues.get(key) ?? null, setItem: (key, value) => themeValues.set(key, String(value)) },
  };
  vm.createContext(themeSandbox);
  vm.runInContext([
    "const _THEME_KEY='lottery_theme';",
    extractFunction(appSrc, '_applyTheme'), extractFunction(appSrc, 'getTheme'), extractFunction(appSrc, 'toggleTheme'),
  ].join(testNewline), themeSandbox);
  themeSandbox._applyTheme('dark');
  check('theme selection persists and exposes the active dark mode', themeSandbox.document.documentElement.dataset.theme === 'dark' && themeValues.get('lottery_theme') === 'dark' && themeButton.attributes['aria-pressed'] === 'true');
  themeSandbox.toggleTheme();
  check('theme toggle restores light mode, exposes its state, and persists it', themeSandbox.document.documentElement.dataset.theme === 'light' && themeValues.get('lottery_theme') === 'light' && themeButton.attributes['aria-pressed'] === 'false');

  const dateIds = ['shared-draw-date', 'pred-date', 'f-target-date', 'dc-date', 'dc-date-old', 'dash-date'];
  const dateControls = Object.fromEntries(dateIds.map(id => [id, {
    value: '2026-07-01', options: [{ value: '2026-07-01' }], add(option) { this.options.push(option); },
  }]));
  const dateSandbox = {
    document: { getElementById: id => dateControls[id] || null },
    Option: function (label, value) { return { label, value }; },
    fmtDate: value => 'fixture ' + value,
  };
  dateSandbox.window = dateSandbox;
  vm.createContext(dateSandbox);
  vm.runInContext([
    'let _sharedDateSyncing=false;',
    astraSource,
    extractFunction(appSrc, '_setSelectValueKeepingOptions'), extractFunction(appSrc, 'syncSharedDrawDate'),
  ].join(testNewline), dateSandbox);
  dateSandbox.syncSharedDrawDate('2026-08-16', false);
  check('non-user shared date synchronization invalidates astra without initializing it', vm.runInContext('_astraRequestId===1&&!_astraStarted', dateSandbox));
  check('shared draw date synchronizes all six date controls',
    dateIds.every(id => dateControls[id].value === '2026-08-16' && dateControls[id].options.some(option => option.value === '2026-08-16')));

  console.log(`PASS: ${passed} checks`);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
