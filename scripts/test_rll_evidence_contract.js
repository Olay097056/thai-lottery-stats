// Contract test for the hypothesis-search evidence strip (ADR-0010).
// The strip is a frozen research result rendered inside the RLL card: it must degrade to nothing
// when the endpoint is missing, and it must never invent a state the CSS does not style.
// Run with: node scripts/test_rll_evidence_contract.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'static', 'formula-calculators.js'), 'utf8');

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  console.log('OK: ' + label);
  passed++;
}

const start = src.indexOf("let _rllEvidenceCache=''");
const end = src.indexOf('function _rllCards(response)');
if (start < 0 || end < 0) throw new Error('evidence block not found in formula-calculators.js');
const block = src.slice(start, end);

function makeRunner(payload) {
  const calls = { count: 0 };
  const sandbox = {
    console,
    api: async () => {
      calls.count++;
      if (payload instanceof Error) throw payload;
      return payload;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.evidence = _rllEvidenceHtml; this.reset = () => { _rllEvidenceLoaded=false; _rllEvidenceCache=""; };', sandbox);
  return { sandbox, calls };
}

const OK_PAYLOAD = {
  ok: true,
  available: true,
  protocol: 'hs-v3',
  hypotheses: 587,
  usable_draws: 464,
  best: { z: 3.0 },
  gate: 3.99,
  p_value: 0.567,
  alert: false,
};

(async () => {
  // 1. the normal state renders every fact the brief fixes
  {
    const { sandbox } = makeRunner(OK_PAYLOAD);
    const html = await sandbox.evidence();
    check('renders the wrap class', html.includes('class="rll-evidence"'));
    check('tags the protocol', html.includes('data-rll-evidence="hs-v3"'));
    check('normal state is data-state="null"', html.includes('data-state="null"'));
    check('five facts', (html.match(/<li>/g) || []).length === 5);
    ['สมมติฐานที่ทดสอบ', '587', 'งวดที่ใช้ตัดสิน', '464',
     'ผลดีที่สุด (z)', '+3.00', 'เกณฑ์ตรวจจับ (z)', '3.99', 'p-value', '0.567'].forEach(fragment => {
      check('fact: ' + fragment, html.includes(fragment));
    });
    check('head copy', html.includes('หลักฐานจากการค้นหาสมมติฐาน'));
    check('null note', html.includes('ไม่พบอะไรเหนือความบังเอิญ · holdout ไม่ถูกแตะ'));
    check('no english prose', !/no signal|evidence strip/i.test(html));
  }

  // 2. alert state swaps the note and the attribute, nothing else
  {
    const { sandbox } = makeRunner({ ...OK_PAYLOAD, alert: true });
    const html = await sandbox.evidence();
    check('alert state', html.includes('data-state="alert"'));
    check('alert note', html.includes('มีสมมติฐานผ่านเกณฑ์ — ต้องตรวจสอบก่อนใช้'));
    check('alert keeps the facts', (html.match(/<li>/g) || []).length === 5);
  }

  // 3. unavailable and broken payloads render nothing at all
  for (const [label, payload] of [
    ['available:false', { ok: true, available: false }],
    ['missing numbers', { ok: true, available: true }],
    ['non-numeric z', { ...OK_PAYLOAD, best: { z: null } }],
    ['thrown request', new Error('offline')],
  ]) {
    const { sandbox } = makeRunner(payload);
    const html = await sandbox.evidence();
    check('renders nothing for ' + label, html === '');
  }

  // 4. one fetch per page load
  {
    const { sandbox, calls } = makeRunner(OK_PAYLOAD);
    await sandbox.evidence();
    await sandbox.evidence();
    check('fetches once, then caches', calls.count === 1);
    sandbox.reset();
    await sandbox.evidence();
    check('re-fetches after a reset', calls.count === 2);
  }

  // 5. the call site is inside the RLL success branch, after the card
  const callSite = src.indexOf('rllHtml+=await _rllEvidenceHtml();');
  const cardAppend = src.indexOf('if(card){rllHtml+=card;rllCards++;}');
  check('call site exists', callSite > 0);
  check('call site follows the card append', callSite > cardAppend);

  console.log('\n' + passed + ' checks passed');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
