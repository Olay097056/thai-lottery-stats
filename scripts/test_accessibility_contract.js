const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.css'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const formulaEngine = fs.readFileSync(path.join(__dirname, '..', 'static', 'formula-engine.js'), 'utf8');
let checks = 0;
const failures = [];
function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}
function ruleBlock(selector) {
  const escaped = selector.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const matches = [...css.matchAll(re)];
  return matches.length ? matches[matches.length - 1][1] : '';
}
function declarations(block) {
  return Object.fromEntries(block.split(';').map(part => {
    const i = part.indexOf(':');
    return i < 0 ? null : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(Boolean));
}
function vars(selector) {
  return declarations(ruleBlock(selector));
}
function resolve(value, tokens) {
  const key = String(value || '').match(/var\((--[\w-]+)/)?.[1];
  return key ? tokens[key] : value;
}
function colorRgb(value) {
  const m = String(value).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function luminance(rgb) {
  const channels = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(fg, bg) {
  const f = colorRgb(fg), b = colorRgb(bg);
  if (!f || !b) return 0;
  const l1 = luminance(f), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const themes = {
  light: vars(':root'),
  dark: vars("[data-theme='dark']"),
};
const primary = declarations(ruleBlock('.btn-primary'));
const formulaBadge = declarations(ruleBlock('.formula-card .num-badge'));
const staticPageHeadings = [...index.matchAll(/<h1\b[^>]*class="page-title"/g)];
const semanticSectionHeadings = [...`${index}\n${app}`.matchAll(/<div class="section-h"[^>]*>/g)].map(m => m[0]);
check(staticPageHeadings.length === 7, 'all seven top-level views have semantic page headings');
check(!/<div\b[^>]*class="page-title"/u.test(index), 'page titles are not styled-only divs');
check(semanticSectionHeadings.length > 0 && semanticSectionHeadings.every(tag => tag.includes('role="heading"') && tag.includes('aria-level="2"')), 'section titles expose level-two heading semantics');
const dashboardRowTags = ['dash-hot-row', 'dash-recent-item'].map(name => app.match(new RegExp(`<div class="${name}"[^>]*>`))?.[0] || '');
check(dashboardRowTags.every(tag => tag.includes('role="button"') && tag.includes('tabindex="0"')) && app.includes("event.key!=='Enter'") && app.includes("event.key!==' '") && app.includes("showPage(row.classList.contains('dash-hot-row')?'frequency':'history')") && app.includes('.dash-hot-row,.dash-recent-item'), 'dashboard click rows expose button semantics and Enter/Space activation');
const pointerOnlyPredictionTags = [...app.matchAll(/<(?:span|div)[^>]*class="[^"]*(?:predict-copy|pred-num|predict-spotlight-num)[^"]*"[^>]*onclick=/g)];
check(pointerOnlyPredictionTags.length === 0 && app.includes('function copyPredButton(') && app.includes("document.addEventListener?.('click'"), 'prediction copy chips are focusable buttons with delegated activation');
const sortHeaderTag = app.match(/<th scope="col"[^>]*>/)?.[0] || '';
check(sortHeaderTag.includes('aria-sort=') && !sortHeaderTag.includes('onclick=') && app.includes('class="bt-sort-btn"') && app.includes('onclick="btSort('), 'backtest sorting uses keyboard buttons and exposes sorted header state');
const labelledControls = ['predict-search', 'predict-group-filter', 'formula-search', 'formula-target-filter', 'bp-budget-input'];
const labelledDynamicControls = ['bp-add-num', 'bp-add-type', 'bp-add-stake', 'bp-add-ticket-num', 'bp-add-ticket-qty'];
const hasVisibleLabel = (source, id) => new RegExp(`<label[^>]*for="${id}"[^>]*>[^<\\s]`).test(source) || new RegExp(`<label[^>]*for="${id}"[^>]*>[\\s\\S]*?</label>`).test(source);
check(labelledControls.every(id => hasVisibleLabel(index, id)), 'Predict, Formula, and Buy Plan primary controls have visible associated labels');
check(labelledDynamicControls.every(id => hasVisibleLabel(app, id)), 'Buy Plan generated add-number forms label every input and select');
const bpDeleteTags = [...app.matchAll(/<button class="bp-del"[^>]*>/g)].map(m => m[0]);
check(bpDeleteTags.length === 3 && bpDeleteTags.every(tag => tag.includes('aria-label=')), 'Buy Plan delete actions expose descriptive accessible names');
const predViewGroup = index.match(/<div class="pred-page-tabs"[^>]*>/)?.[0] || '';
const predViewButtons = [...index.matchAll(/<button[^>]*id="pred-main-btn-[^"]+"[^>]*>/g)].map(m => m[0]);
const predViews = ['predict', 'formula', 'decision', 'oldver'];
check(predViewGroup.includes('role="group"') && predViewButtons.length === predViews.length && predViews.every(view => predViewButtons.some(tag => tag.includes(`id="pred-main-btn-${view}"`) && tag.includes(`aria-controls="pred-main-tab-${view}"`) && tag.includes('aria-pressed='))) && app.includes("setAttribute('aria-pressed'"), 'All four Predict subviews expose a synchronized pressed state and their exact panel relationship');
const formulaViewGroup = index.match(/<div class="ftab-nav"[^>]*>/)?.[0] || '';
const astraFormulaButton = index.match(/<button[^>]*id="ftab-btn-ASTRA"[^>]*>/)?.[0] || '';
check(astraFormulaButton.includes('aria-pressed="false"') && astraFormulaButton.includes('aria-controls="formula-results-ASTRA"') && astraFormulaButton.includes('data-ftab="ASTRA"') && !index.includes('id="pred-main-btn-astra"'), 'Astra is an accessible Formula subview, not a separate Predict view');
const brokenLabelRefs = [...index.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1]).filter(id => !new RegExp(`id="${id}"`).test(index));
check(formulaViewGroup.includes('role="group"') && !formulaViewGroup.includes('role="tablist"') && !formulaViewGroup.includes('onkeydown=') && !/role="tab"/.test(index) && brokenLabelRefs.length === 0, 'Formula controls use valid group semantics without missing tab relationships');
const formulaGroupSelect = index.match(/<select id="ftab-group-select"[^>]*>/)?.[0] || '';
check(formulaGroupSelect.includes('aria-controls="formula-results-A"') && formulaEngine.includes("setAttribute('aria-controls','formula-results-'+tab)") && formulaEngine.includes("setAttribute('aria-pressed'"), 'Formula group selector exposes the active results panel and button state');
const bpModeGroup = index.match(/<div class="bp-mode-toggle"[^>]*>/)?.[0] || '';
const bpModeButtons = [...index.matchAll(/<button[^>]*class="bp-mode-btn[^\"]*"[^>]*>/g)].map(m => m[0]);
const bpRiskButtons = [...index.matchAll(/<button[^>]*class="bp-risk-btn[^\"]*"[^>]*>/g)].map(m => m[0]);
const bpQuickButtons = [...index.matchAll(/<button[^>]*class="bp-budget-quick[^\"]*"[^>]*>/g)].map(m => m[0]);
const bpSyncSource = app.match(/function bpSyncControls\(prefs\)\{[\s\S]*?\n\}/)?.[0] || '';
check(bpModeGroup.includes('role="group"') && bpModeButtons.length === 2 && bpModeButtons.every(tag => tag.includes('aria-pressed=')) && bpModeButtons.some(tag => tag.includes('data-mode="perNumber"') && tag.includes('aria-pressed="true"')) && bpModeButtons.some(tag => tag.includes('data-mode="ticket"') && tag.includes('aria-pressed="false"')) && bpSyncSource.includes("'.bp-mode-btn'") && bpSyncSource.includes("'.bp-risk-btn'") && bpSyncSource.includes("'.bp-budget-quick'") && bpSyncSource.includes("setAttribute('aria-pressed',String(on))"), 'Buy Plan mode, risk, and budget presets expose synchronized pressed state');
const bpConfigToggle = index.match(/<button[^>]*onclick="bpToggleConfig\(\)"[^>]*>/)?.[0] || '';
const bpConfigPanel = index.match(/<div id="bp-config-panel"[^>]*>/)?.[0] || '';
check(bpConfigToggle.includes('aria-expanded="false"') && bpConfigToggle.includes('aria-controls="bp-config-panel"') && bpConfigPanel.includes('hidden') && app.includes("setAttribute('aria-expanded',String(open))") && app.includes('el.hidden=!open'), 'Buy Plan settings toggle exposes and synchronizes expanded state');
const navItems = [...index.matchAll(/<div class="nav-item[^\"]*"[^>]*data-page="[^"]+"[^>]*>/g)].map(m => m[0]);
check(navItems.length === 7 && navItems.some(tag => tag.includes('data-page="dashboard"') && tag.includes('aria-current="page"')) && app.includes("setAttribute('aria-current','page')") && app.includes("removeAttribute('aria-current')"), 'Sidebar navigation exposes the active page state');
const dynamicStatusIds = ['dash-data-status', 'predict-status', 'formula-status', 'formula-bt-status', 'decision-status', 'oldver-status', 'backtest-status', 'mix-status'];
const statusTag = id => index.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] || '';
const statusCallIds = ['predict-status', 'decision-status', 'oldver-status', 'backtest-status', 'mix-status'];
check(dynamicStatusIds.every(id => {
  const tag=statusTag(id);
  return tag.includes('role="status"') && tag.includes('aria-live="polite"') && tag.includes('aria-atomic="true"');
}) && app.includes('function setPageStatus(') && statusCallIds.every(id => app.includes(`setPageStatus('${id}'`)) && formulaEngine.includes("setPageStatus('formula-status'") && formulaEngine.includes("setPageStatus('formula-bt-status'"), 'Dashboard, Predict, Formula, Decision, Mix, and Backtest announce concise status changes');
const deleteButton = declarations(ruleBlock('.bp-del'));
check(deleteButton.width === '44px' && deleteButton.height === '44px', 'Buy Plan delete actions meet the 44px touch-target advisory');
const formulaTabState = declarations(ruleBlock('.ftab-btn[data-color].active'));
check(formulaTabState.color === 'var(--text)' && formulaTabState['border-bottom-color'] === 'var(--accent)', 'Formula group tabs use theme-readable text and a shared active-state indicator');
const toastFunction = app.match(/function toast\(msg, type='', options=\{\}\)\{[\s\S]*?\n\}/)?.[0] || '';
check(toastFunction.includes("options?.announce===false") && toastFunction.includes("setAttribute('aria-hidden','true')") && app.includes('announce:false') && formulaEngine.includes('announce:false'), 'Page-local statuses suppress duplicate screen-reader toast announcements while retaining visible feedback');

for (const [theme, tokens] of Object.entries(themes)) {
  const surface = resolve('var(--surface)', tokens);
  const accent = resolve('var(--accent)', tokens);
  const text = resolve('var(--text)', tokens);
  const primaryText = resolve(primary.color, tokens);
  const badgeText = resolve(formulaBadge.color, tokens);
  check(contrast(primaryText, accent) >= 4.5, `${theme}: primary button text contrast is at least 4.5:1`);
  check(contrast(tokens['--gold2'], surface) >= 4.5, `${theme}: number badge text contrast is at least 4.5:1`);
  check(badgeText === text && contrast(badgeText, surface) >= 4.5, `${theme}: formula number badge uses readable theme text`);
}

if (failures.length) {
  console.error(`FAIL: ${failures.length}/${checks} checks`);
  failures.forEach(message => console.error(` - ${message}`));
  process.exit(1);
}
console.log(`PASS: ${checks} accessibility contrast checks`);
