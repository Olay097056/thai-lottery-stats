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

const context = {
  document: { getElementById: () => null },
  copyPredNumber: () => {},
};
vm.createContext(context);
vm.runInContext([
  'escHtml',
  'predictConfidence',
  'predictionFormulaSupport',
  'copyPredButton',
  'copyPredActionButton',
  'predDetailHtml',
].map(extractFunction).join('\n'), context);

const malicious = "');globalThis.__predictionXss = true;//";
const html = context.predDetailHtml({
  num: malicious,
  col: 'prize1',
  row: {},
  rank: 1,
  score: 1,
  maxScore: 1,
});
const failures = [];
const inlineHandler = html.match(/onclick="([^"]*)"/);
if (inlineHandler) {
  // HTML parsing decodes character references before compiling inline handlers.
  const handlerSource = inlineHandler[1].replace(/&#39;/g, "'");
  vm.runInContext(handlerSource, context);
  if (context.__predictionXss) failures.push('prediction text executes through an HTML-escaped inline handler');
}
if (/onclick="copyPredNumber\('/.test(source)) {
  failures.push('one or more prediction copy buttons interpolate data into inline JavaScript');
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} prediction XSS check(s)`);
  failures.forEach(message => console.error(` - ${message}`));
  process.exit(1);
}

const dataAttribute = html.match(/data-copy-number="([^"]*)"/);
if (!dataAttribute) throw new Error('secure prediction copy button must keep its value in data-copy-number');
const decodedValue = dataAttribute[1].replace(/&#39;/g, "'");
if (decodedValue !== malicious) throw new Error('prediction copy value changed while escaping its HTML attribute');
console.log('PASS: prediction copy actions keep untrusted values out of executable HTML contexts');