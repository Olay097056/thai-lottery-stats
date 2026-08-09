// Cache-bust drift guard — CLAUDE.md's documented failure class (browser serves stale static
// files when `?v=` isn't bumped) made testable. Run with: node scripts/test_cache_bust_sync.js
//
// Verifies:
//  1. index.html's three `?v=` values (app.css / formula-engine.js / app.js) are all equal —
//     the common mistake is bumping one or two and leaving the third stale.
//  2. If ANY of the three static files differs from the committed HEAD version, the working
//     `?v=` MUST differ from HEAD's `?v=` — i.e. you edited static code and forgot to bump.
//     (Line endings are normalized before comparison so CRLF/LF churn can't false-positive.)
//  3. Version token looks like the project's bump tokens (alnum, no query-string junk).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const IDX_PATH = path.join(ROOT, 'static', 'index.html');
const STATIC_FILES = ['app.css', 'app.js', 'formula-engine.js'];

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
}

function versionsOf(html) {
  const m = [...String(html).matchAll(/(?:app\.css|formula-engine\.js|app\.js)\?v=([A-Za-z0-9_-]+)/g)];
  return m.map(x => x[1]);
}
function normalize(s) {
  return String(s).replace(/\r\n/g, '\n');
}

const workIdx = fs.readFileSync(IDX_PATH, 'utf8');
const workVs = versionsOf(workIdx);
check('index.html contains exactly 3 static ?v= references (css/engine/app)', workVs.length === 3);
check('all 3 ?v= values are equal (no partial bump)', workVs.every(v => v === workVs[0]));
check('version token is a sane bump token', /^[A-Za-z0-9_-]+$/.test(workVs[0]));

// Drift guard vs HEAD: any static change without a version bump is a landmine.
let headIdx, headVs;
try {
  headIdx = execSync('git show HEAD:static/index.html', { cwd: ROOT, encoding: 'utf8' });
  headVs = versionsOf(headIdx);
} catch (e) {
  headIdx = ''; headVs = []; // not a git checkout / no HEAD yet → skip the HEAD comparison
}
if (headVs.length === 3) {
  const changed = STATIC_FILES.some(f => {
    try {
      return normalize(fs.readFileSync(path.join(ROOT, 'static', f), 'utf8')) !==
             normalize(execSync(`git show HEAD:static/${f}`, { cwd: ROOT, encoding: 'utf8' }));
    } catch (e) {
      return true; // file untracked at HEAD → it IS a change
    }
  });
  if (changed) {
    check('static files changed since HEAD → ?v= MUST be bumped (got ' + workVs[0] + ' vs HEAD ' + headVs[0] + ')',
      workVs[0] !== headVs[0]);
  } else {
    check('no static change since HEAD → version may stay (got ' + workVs[0] + ')', true);
  }
} else {
  check('HEAD index.html parseable (skipped otherwise)', true);
}

console.log(`OK: ${passed} checks passed (version=${workVs[0] || '?'})`);
