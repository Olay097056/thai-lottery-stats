const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'static');
const source = fs.readFileSync(path.join(root, 'formula-calculators.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'formula-engine.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stages = [
  "setFormulaLoading('ขั้น 1/4 · กำลังคำนวณสูตรพื้นฐานจากข้อมูลอ้างอิง...')",
  "setFormulaLoading('ขั้น 2/4 · ตรวจสูตรพื้นฐานแล้ว กำลังคำนวณระนาบฟาโน v4...')",
  "setFormulaLoading('ขั้น 3/4 · ตรวจระนาบฟาโน v4 แล้ว กำลังคำนวณ v5...')",
  "setFormulaLoading('ขั้น 4/4 · คำนวณส่วนหลักแล้ว กำลังจัดทำผลรวมและข้อมูลอ้างอิง...')",
];
const positions = stages.map(stage => source.indexOf(stage));
assert(positions.every(position => position >= 0), 'all four progress stages must be present');
assert(positions.every((position, index) => index === 0 || position > positions[index - 1]), 'progress stages must follow calculation order');

const fanoV4Request = source.indexOf("api(`fano/formula?date=${encodeURIComponent(predDateStr)}`");
const fanoV5Request = source.indexOf("version=fano-v5-adaptive-rank-codebook");
const summaryRender = source.indexOf('_renderFormulaSummary({grouped');
assert(positions[1] < fanoV4Request && positions[2] < fanoV5Request && positions[3] < summaryRender,
  'stage announcements must precede their corresponding work');
assert(engine.includes("setPageStatus('formula-status',msg)"), 'stage updates must use the existing announced Formula status');
assert(html.includes('id="formula-status"') && html.includes('role="status"'), 'Formula status must remain accessible');
console.log('PASS: Formula progress stages remain ordered and use the accessible status region');
