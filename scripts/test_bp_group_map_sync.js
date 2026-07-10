// Drift-guard (backlog M2, PRD-buy-plan-explainability): static/app.js's BP_GROUP_MAP is a MANUAL
// mirror of static/formula-engine.js's function-local _GRP (app.js has no build step and cannot
// import a function-local const, so it copies the group letter → [label, color] map by hand). If a
// formula group is ever added, removed, relabeled, or recolored in _GRP without the same change to
// BP_GROUP_MAP, the จัดชุดซื้อ explainability dots silently render with wrong/missing colors. This
// test fails first when they drift apart.
//
// Run with: node scripts/test_bp_group_map_sync.js
//
// Self-contained: both objects are regex-extracted from their source files (like the _GRP extract in
// test_tycoon_formula.js) and eval'd in a throwaway vm context — no need to boot app.js (DOM/network).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'static', 'formula-engine.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');

// Extract `NAME = { ... }` (values are [label,color] arrays — no nested braces, so [^}]* is safe;
// the negated class also spans newlines, so BP_GROUP_MAP's multi-line literal is matched whole).
function extractObject(src, name) {
  const re = new RegExp(name + '\\s*=\\s*(\\{[^}]*\\})');
  const m = re.exec(src);
  if (!m) throw new Error('FAIL: ' + name + ' object literal not found in source');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('this.__v = ' + m[1], sandbox);
  return sandbox.__v;
}

const grp = extractObject(engineSrc, 'const _GRP');
const bpMap = extractObject(appSrc, 'const BP_GROUP_MAP');

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

const gk = Object.keys(grp).sort();
const bk = Object.keys(bpMap).sort();
check('_GRP is non-empty (extraction sanity)', gk.length > 0);
check('BP_GROUP_MAP has exactly the same set of group-letter keys as _GRP',
  JSON.stringify(gk) === JSON.stringify(bk));
gk.forEach(k => {
  check(`group "${k}": BP_GROUP_MAP entry is a [label,color] pair`,
    Array.isArray(bpMap[k]) && bpMap[k].length === 2);
  check(`group "${k}": label matches _GRP (_GRP="${grp[k][0]}" vs BP="${bpMap[k] && bpMap[k][0]}")`,
    bpMap[k] && grp[k][0] === bpMap[k][0]);
  check(`group "${k}": color matches _GRP (_GRP="${grp[k][1]}" vs BP="${bpMap[k] && bpMap[k][1]}")`,
    bpMap[k] && grp[k][1] === bpMap[k][1]);
});
// Belt-and-suspenders: the two objects serialize identically once key order is normalized.
const norm = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
check('_GRP and BP_GROUP_MAP are deep-equal (order-normalized)', norm(grp) === norm(bpMap));

console.log(`OK: BP_GROUP_MAP in sync with formula-engine _GRP (${passed} checks, ${gk.length} groups)`);
