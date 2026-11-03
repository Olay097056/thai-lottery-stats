// Formula server forecasts must belong to the selected draw before they can become visible.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'formula-calculators.js'), 'utf8');
function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'm').exec(source);
  assert(match, `missing function ${name}`);
  let i = match.index + match[0].length, depth = 1;
  while (i < source.length && depth) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unterminated function ${name}`);
  return source.slice(match.index, i);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunction('_formulaResponseTargetMatches'), sandbox);
vm.runInContext(extractFunction('_formulaResponseHasValidCandidates'), sandbox);
assert.equal(sandbox._formulaResponseTargetMatches({ target_date: '2026-11-01' }, '2026-11-01'), true);
assert.equal(sandbox._formulaResponseTargetMatches({ target_date: '2026-10-16' }, '2026-11-01'), false);
assert.equal(sandbox._formulaResponseTargetMatches({ numbers: ['000001'] }, '2026-11-01'), false);
assert.equal(sandbox._formulaResponseTargetMatches({ target_date: 20261101 }, '2026-11-01'), false);
assert.equal(sandbox._formulaResponseHasValidCandidates({ numbers: ['000001', '000002', '000003', '000004', '000005'] }), true);
assert.equal(sandbox._formulaResponseHasValidCandidates({ numbers: ['000001', '000002', '000003', '000004', '000001'] }), false);
assert.equal(sandbox._formulaResponseHasValidCandidates({ numbers: ['000001', '000002', '000003', '000004', '12345'] }), false);
assert.equal(sandbox._formulaResponseHasValidCandidates({ numbers: ['000001', '000002', '000003', '000004', 5] }), false);
assert.equal(sandbox._formulaResponseHasValidCandidates({ numbers: ['000001', '000002', '000003', '000004'] }), false);

assert.equal((source.match(/const targetMatches=_formulaResponseTargetMatches\(response,predDateStr\);/g) || []).length, 2,
  'Fano v4 and Fano v5 must both validate the selected target');
assert.equal((source.match(/\|\|!targetMatches\)/g) || []).length, 2,
  'both formula result branches must reject mismatched targets');
assert.equal((source.match(/!_formulaResponseHasValidCandidates\(response\)/g) || []).length, 2,
  'both formula result branches must reject malformed and duplicate candidates');
console.log('PASS: formula target matcher and Fano v4/Fano v5 guards');
