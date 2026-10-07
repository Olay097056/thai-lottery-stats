const assert = require('assert');
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

const panel = {
  innerHTML: '',
  classList: { add() {}, remove() {} },
};
const sandbox = {
  document: { getElementById: id => id === 'predict-final' ? panel : null },
  predictionSupportMap: () => new Map(),
  predDetailHtml: ({ num }) => String(num),
  copyPredActionButton: () => '<button>copy</button>',
  copyPredButton: num => `[support:${num}]`,
  numChip: num => `[${num}]`,
  loadPredictModeCompare() {},
  escHtml: value => String(value ?? ''),
  Math,
};
vm.createContext(sandbox);
vm.runInContext([
  extractFunction('predScoreKey'),
  extractFunction('predScore'),
  extractFunction('predNum'),
  extractFunction('p1Front'),
  extractFunction('p1Back'),
  extractFunction('topRows'),
  extractFunction('renderPredictFinalPanel'),
].join('\n\n'), sandbox);

sandbox.renderPredictFinalPanel({
  prize1: { numbers: [
    { 'เลข': '010045', 'คะแนนรวม': 80 },
    { 'เลข': '444444', 'คะแนนรวม': 30 },
    { 'เลข': '123007', 'คะแนนรวม': 90 },
    { 'เลข': '987654', 'คะแนนรวม': 100 },
    { 'เลข': '000112', 'คะแนนรวม': 70 },
    { 'เลข': '999321', 'คะแนนรวม': 60 },
    { 'เลข': '555555', 'คะแนนรวม': 50 },
    { 'เลข': '111222', 'คะแนนรวม': 40 },
  ] },
  front3_1: { numbers: [{ 'เลข': '045' }, { 'เลข': '111' }, { 'เลข': '112' }] },
  front3_2: { numbers: [{ 'เลข': '222' }, { 'เลข': '223' }, { 'เลข': '224' }] },
  bottom2: { numbers: [] },
});

assert.match(panel.innerHTML, /3 ตัวบน \/ หน้า/);
const fieldChips = [...panel.innerHTML.matchAll(/\[(\d{3})\]/g)].map(match => match[1]);
assert.deepStrictEqual(fieldChips, ['045', '111', '112', '222', '223', '224', '654', '007']);
console.log('PASS: Panel dedupes, score-ranks prize1-derived top3, preserves leading zeroes, and caps combined output at eight');
