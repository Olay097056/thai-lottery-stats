// Dashboard renders only synthetic API data; this guards every HTML sink.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
function extractFunction(name) {
  const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(source);
  if (!start) throw new Error('missing function: ' + name);
  let i = start.index + start[0].length, depth = 1;
  while (i < source.length && depth) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  if (depth) throw new Error('unterminated function: ' + name);
  return source.slice(start.index, i);
}
const elements = Object.create(null);
const unsafe = '<img src=x onerror=alert(1)>';
const maliciousRow = {
  date: unsafe, prize1: unsafe, top3: unsafe, top2: unsafe,
  front3_1: unsafe, front3_2: unsafe, back3_1: unsafe, back3_2: unsafe, bottom2: unsafe,
};
const sandbox = {
  document: { getElementById(id) {
    if (!elements[id]) elements[id] = { innerHTML: '', textContent: '', classList: { remove() {} } };
    return elements[id];
  } },
  window: { _p1WidgetLoaded: true },
  api: async () => ({
    total_draws: 1, date_min: 'old', date_max: 'new', cache_info: {},
    latest: maliciousRow,
    hot_top3: [{ number: unsafe, count: 1 }],
    recent_draws: [maliciousRow],
  }),
  fmtDate: value => String(value ?? ''),
  loadDashboardFormulaPicks() {},
  loadP1Widget() {},
  toast() {},
};
vm.createContext(sandbox);
vm.runInContext(['setPageStatus', 'escHtml', 'dashNum', 'dashCount', 'renderLatestItem', 'loadDashboard'].map(extractFunction).join('\n'), sandbox);
(async () => {
  const item = sandbox.renderLatestItem('fixture', unsafe);
  if (item.includes('<img') || !item.includes('&lt;img')) throw new Error('FAIL: latest-item field must be HTML-escaped');
  await sandbox.loadDashboard();
  if (!String(elements['dash-data-status']?.textContent || '').includes('พร้อมใช้งาน')) throw new Error('FAIL: Dashboard readiness is announced in its page status');
  const cases = [
    ['latest result cards', elements['latest-draw-detail'].innerHTML],
    ['hot-number list', elements['hot-list'].innerHTML],
    ['recent-draw cards', elements['recent-compact'].innerHTML],
    ['recent-draw table', elements['recent-tbody'].innerHTML],
    ['prize1 digit badges', elements['s-prize1'].innerHTML],
  ];
  for (const [label, html] of cases) {
    if (html.includes('<img') || !html.includes('&lt;')) throw new Error(`FAIL: ${label} must escape API-provided HTML`);
  }
  console.log(`PASS: ${cases.length + 2} dashboard HTML/status checks`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
