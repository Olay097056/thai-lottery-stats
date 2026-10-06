const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`FAIL: ${name} — ${error.message}`);
  }
}
function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

check('README opening summaries do not publish contradictory draw counts', () => {
  const english = read('README.md').split(/\r?\n/).slice(0, 30).join('\n');
  const thai = read('README.th.md').split(/\r?\n/).slice(0, 30).join('\n');
  assertNoFixedCount(english, 'README.md');
  assertNoFixedCount(thai, 'README.th.md');
});

check('CLAUDE launch instructions match the checked-in launch configuration', () => {
  const config = JSON.parse(read('.claude/launch.json')).configurations.find((item) => item.name === 'lottery-stats');
  if (!config) throw new Error('lottery-stats configuration is missing');
  const args = config.runtimeArgs.join(' ');
  for (const token of ['uvicorn', 'main:app', '--port', '8509', '--reload']) {
    if (!args.includes(token)) throw new Error(`launch config lacks ${token}`);
  }
  const launchLine = read('CLAUDE.md').split(/\r?\n/).find((line) => line.includes('.claude/launch.json')) || '';
  if (!launchLine.includes('main:app') || !launchLine.includes('8509')) {
    throw new Error('CLAUDE.md must document main:app on port 8509');
  }
  if (/--app-dir\s+lottery_stats/.test(launchLine) && !args.includes('--app-dir lottery_stats')) {
    throw new Error('CLAUDE.md claims an --app-dir that launch.json does not set');
  }
});

check('CLAUDE page count matches the pages in the SPA shell', () => {
  const html = read('static/index.html');
  const actual = [...html.matchAll(/id=["']page-[^"']+["']/g)].length;
  const shellRow = read('CLAUDE.md').split(/\r?\n/).find((line) => /^\|\s*`static\/index\.html`\s*\|/.test(line)) || '';
  const match = shellRow.match(/(\d+)\s+pages?/i);
  if (!match) throw new Error('CLAUDE.md Key Files row does not state a page count for static/index.html');
  if (Number(match[1]) !== actual) throw new Error(`CLAUDE.md Key Files row says ${match[1]} pages; shell has ${actual}`);
});

check('CLAUDE formula-engine description includes current formula families', () => {
  const formulaRow = read('CLAUDE.md').split(/\r?\n/).find((line) => /^\|\s*`static\/formula-engine\.js`\s*\|/.test(line)) || '';
  if (!formulaRow.includes('A–J') || !formulaRow.includes('HM')) {
    throw new Error('CLAUDE.md Key Files formula-engine row is missing A–J or named HM family');
  }
});

check('CONTEXT Edge definition does not use the stale A–I range', () => {
  const edgeLine = read('CONTEXT.md').split(/\r?\n/).find((line) => line.startsWith('A formula\'s backtest accuracy')) || '';
  if (!edgeLine) throw new Error('Edge definition is missing');
  if (/A[–-]I\b/.test(edgeLine)) throw new Error('Edge definition still stops at A–I');
  if (!/same field type/i.test(edgeLine)) throw new Error('Edge definition must preserve same-field comparability');
});

check('DEVELOPMENT_PLAN update date is not older than its latest dated phase', () => {
  const plan = read('DEVELOPMENT_PLAN.md');
  const header = plan.match(/อัปเดตล่าสุด:\s*(\d{4}-\d{2}-\d{2})/);
  if (!header) throw new Error('update date is missing');
  const dates = [...plan.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  const latest = dates.sort().at(-1);
  if (header[1] !== latest) throw new Error(`header date ${header[1]} is older than latest dated content ${latest}`);
});

function assertNoFixedCount(text, file) {
  const match = text.match(/\b(?:777|780)\b/);
  if (match) throw new Error(`${file} opening still hard-codes a draw count (${match[0]})`);
}

if (failures.length) {
  console.error(`${failures.length} documentation contract check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('PASS: 6 documentation contract checks');
}
