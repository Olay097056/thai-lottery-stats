// Regression check for Group F coefficient presets (ISSUE-4).
// Run with: node scripts/test_codexpool_presets.js
// Verifies:
// 1. CODEX_COEFF_PRESETS has 5 entries (baseline + 4 alternates) with distinct labels
//    starting with "X" so they map to the "F · Codex" group badge (name[0] === 'X').
// 2. Presets with different coefficients produce different ranked pools for a
//    fixture where signal values diverge meaningfully (recency vs overdue).
// 3. The baseline preset's coeffs are exactly CODEX_DEFAULT_COEFFS (no drift from
//    the live production formula).
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
if (!coeffsMatch) throw new Error('CODEX_DEFAULT_COEFFS not found');
const presetsMatch = /const CODEX_COEFF_PRESETS=(\[[\s\S]*?\n\]);/.exec(src);
if (!presetsMatch) throw new Error('CODEX_COEFF_PRESETS not found');

const code = [
  extract('_codexDateParts'),
  extract('_freqMap'),
  // `var` (not `const`) so these attach as enumerable sandbox properties in the vm context
  'var CODEX_DEFAULT_COEFFS=' + coeffsMatch[1] + ';',
  'var CODEX_COEFF_PRESETS=' + presetsMatch[1] + ';',
  extract('_codexPool'),
].join('\n\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { _codexPool, CODEX_DEFAULT_COEFFS, CODEX_COEFF_PRESETS } = sandbox;

// --- 1. shape checks ---
if (CODEX_COEFF_PRESETS.length < 5) throw new Error(`FAIL: expected >=5 presets, got ${CODEX_COEFF_PRESETS.length}`);
for (const p of CODEX_COEFF_PRESETS) {
  if (p.key !== 'baseline' && !p.label.startsWith('X')) {
    throw new Error(`FAIL: preset "${p.label}" doesn't start with "X" — won't map to F group badge (name[0] lookup)`);
  }
}
console.log(`OK: ${CODEX_COEFF_PRESETS.length} presets defined, all non-baseline labels start with "X"`);

// --- 2. baseline preset matches production default exactly ---
const baseline = CODEX_COEFF_PRESETS.find(p => p.key === 'baseline');
if (JSON.stringify(baseline.coeffs) !== JSON.stringify(CODEX_DEFAULT_COEFFS)) {
  throw new Error('FAIL: baseline preset coeffs diverge from CODEX_DEFAULT_COEFFS');
}
console.log('OK: baseline preset coeffs === CODEX_DEFAULT_COEFFS (no drift)');

// --- 3. presets produce genuinely different rankings ---
const rows = [];
for (let i = 0; i < 40; i++) {
  const day = (i % 28) + 1, month = ((i * 3) % 12) + 1;
  rows.push({
    bottom2: String((i * 7) % 100).padStart(2, '0'),
    date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/2567`,
  });
}
const targetIso = '2568-01-01';

const results = CODEX_COEFF_PRESETS.map(p => ({
  label: p.label,
  pool: _codexPool(rows, 'bottom2', 2, targetIso, 10, p.coeffs),
}));

const uniqueRankings = new Set(results.map(r => JSON.stringify(r.pool)));
if (uniqueRankings.size < 2) {
  throw new Error('FAIL: all presets produced identical rankings — coefficients not actually wired through');
}
console.log(`OK: ${uniqueRankings.size}/${results.length} distinct rankings across presets`);
results.forEach(r => console.log(`  ${r.label}: ${r.pool.slice(0, 5).join(' ')}`));
