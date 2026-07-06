// Regression check for _codexPool coefficient parameterization (ISSUE-3).
// Run with: node scripts/test_codexpool_coeffs.js
// Verifies:
// 1. Calling _codexPool with no coeffs (or CODEX_DEFAULT_COEFFS explicitly) produces identical output.
// 2. Passing different coefficients actually changes the ranked pool (wiring is live, not ignored).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'formula-engine.js'), 'utf8');

function extract(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found: ' + name);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

const coeffsMatch = /const CODEX_DEFAULT_COEFFS=(\{[^}]*\});/.exec(src);
if (!coeffsMatch) throw new Error('CODEX_DEFAULT_COEFFS not found in formula-engine.js');

const code = [
  extract('_codexDateParts'),
  extract('_freqMap'),
  'const CODEX_DEFAULT_COEFFS=' + coeffsMatch[1] + ';',
  extract('_codexPool'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _codexPool, CODEX_DEFAULT_COEFFS } = sandbox;

const rows = [];
for (let i = 0; i < 30; i++) {
  const day = (i % 28) + 1, month = ((i * 3) % 12) + 1;
  rows.push({
    bottom2: String((i * 7) % 100).padStart(2, '0'),
    date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/2567`,
  });
}
const targetIso = '2568-01-01';

const defaultResult = _codexPool(rows, 'bottom2', 2, targetIso, 10);
const explicitDefault = _codexPool(rows, 'bottom2', 2, targetIso, 10, CODEX_DEFAULT_COEFFS);
const assertEqual = JSON.stringify(defaultResult) === JSON.stringify(explicitDefault);
if (!assertEqual) throw new Error('FAIL: default call and explicit-default-coeffs call diverged');
console.log('OK: default call matches explicit CODEX_DEFAULT_COEFFS call');

const overdueHeavy = { sameDay: 14, sameMonth: 4, count: 1.4, f80: 4, f24: 5, overdue: 5.0, lastNumDecay: 0.7 };
const overdueResult = _codexPool(rows, 'bottom2', 2, targetIso, 10, overdueHeavy);
const assertDiffers = JSON.stringify(defaultResult) !== JSON.stringify(overdueResult);
if (!assertDiffers) throw new Error('FAIL: different coefficients produced identical ranking (wiring not live)');
console.log('OK: alternate coefficients produce a different ranked pool (wiring is live)');
