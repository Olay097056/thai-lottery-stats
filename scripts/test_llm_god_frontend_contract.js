// LLM GOD frontend contract — the card must quote the set it is showing, and carry the honest ceiling.
// Run with: node scripts/test_llm_god_frontend_contract.js
//
// Written with indexOf + brace matching rather than regex escaping: the RLL effort lost several rounds to
// escaping bugs in this exact kind of test.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, 'static', f), 'utf8');

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error('FAIL: ' + label);
  console.log('OK: ' + label);
  passed++;
}

function block(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  let depth = 0, i = source.indexOf('{', start);
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

const calc = read('formula-calculators.js');
const engine = read('formula-engine.js');
const evaluation = read('formula-evaluation.js');
const buyplan = read('buyplan-ui.js');
const decision = read('decision-center.js');
const index = fs.readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');

// 1. the chance figure is computed from the tickets on screen, never a constant
const chanceBlock = block(calc, '_llmGodChance');
check('chance is computed from the set', /new Set\(set\)\.size/.test(chanceBlock));
check('chance uses the 168-number pool constant', /LLMGOD_POOL_SIZE/.test(chanceBlock));
check('pool constant is 168', /const LLMGOD_POOL_SIZE=168;/.test(calc));
check('expected-hits fallback is 0.3796', /const LLMGOD_EXPECTED_HITS=0\.3796;/.test(calc));
check('corpus fallback is 452 draws', /const LLMGOD_USABLE_DRAWS=452;/.test(calc));
// The figure must come from the response, not the literal: that literal is exactly what shipped wrong.
check('card reads expected_hits from the response', /response\.expected_hits\?\?LLMGOD_EXPECTED_HITS/.test(calc));
check('card reads corpus_draws from the response', /response\.corpus_draws\?\?LLMGOD_USABLE_DRAWS/.test(calc));
check('chance uses the measured pool size', /_llmGodChance\(response\.numbers,response\.pool_mean_size\)/.test(calc));

// 2. the card carries the honesty lines
const cardBlock = block(calc, '_llmGodCards');
check('card quotes the expected hits', /LLMGOD_EXPECTED_HITS/.test(cardBlock));
check('card names the corpus the expectation is over', /LLMGOD_USABLE_DRAWS/.test(cardBlock));
check('card states every ticket has equal odds', /โอกาสเท่ากันในทุกชั้นรางวัล/.test(cardBlock));
check('card refuses the better-odds claim', /ไม่ใช่โอกาสที่ดีกว่า/.test(cardBlock));
check('card carries the ทดลอง badge', /'ทดลอง'/.test(cardBlock));
check('card shows the stage statuses', /s\.stage.*s\.status/.test(cardBlock));

// 3. the render seam handles every state without rendering a blank card
const seam = calc.slice(calc.indexOf('llm-god/formula?date='), calc.indexOf("document.getElementById('formula-results-LLMGOD')"));
check('seam calls the llm-god endpoint', seam.includes('llm-god/formula?date='));
check('seam handles pending', /stage==='pending'/.test(seam));
check('seam handles running', /stage==='running'/.test(seam));
check('seam handles unavailable with a stage name', /stage==='unavailable'/.test(seam) && /response\?\.reason/.test(seam));
check('seam validates five six-digit tickets', /numbersOk/.test(seam) && /length===5/.test(seam));
check('panel is written', index.includes('id="formula-results-LLMGOD"'));

// 4. group registration everywhere a group has to exist
const godKeyAt = engine.indexOf("if(s.startsWith('LLM GOD'))return 'LLMGOD';");
const letterFallbackAt = engine.indexOf("if(s.startsWith('A.'))return 'A';");
check('group key branch exists', godKeyAt >= 0);
check('group key resolves before the single-letter fallback',
  godKeyAt >= 0 && letterFallbackAt >= 0 && godKeyAt < letterFallbackAt);
check('group selector knows the key', engine.includes("'FANO','RLL','LLMGOD'"));
check('summary counts the cards', /LLMGOD:llmGodCards/.test(engine) && /llmGodCards=0/.test(engine));
check('summary row exists', engine.includes('LLM GOD · 5 ชุด pool 1-5'));
check('target label exists', engine.includes("if(title.startsWith('LLM GOD'))return 'Target: Pool 1-5 (168 เลข)'"));
check('group colour map has the key', evaluation.includes("'LLMGOD':['LLM GOD · 5 ชุด Pool 1-5','#a78bfa']"));
check('buy plan mirror has the key', buyplan.includes("LLMGOD: ['LLM GOD · 5 ชุด Pool 1-5', '#a78bfa']"));
check('buy plan resolves the multi-word source',
  buyplan.includes("(upper.startsWith('LLM GOD')||upper.startsWith('LLMGOD'))?'LLMGOD':"));
check('selector option exists', index.includes('value="LLMGOD"'));

// 5. the backtest row is pushed on pool6, keyed by the group KEY (RLL's row passes the label and misses)
check('prospective row is pushed', evaluation.includes("name:'LLM GOD · 5 ชุด Pool 1-5',group:'LLMGOD'"));
check('prospective row uses the pool6 field', evaluation.includes("field:'pool6',typeLabel:'Pool 6หลัก',board:'Pool 1-5'"));
check('prospective expectation uses 168 numbers', evaluation.includes('expectedHits:llmGodDraws*5*168/1e6'));

// 6. the Picks allow-list is keyed on the explicit group
check('picks gate allows the group', decision.includes("fr.group==='LLMGOD'"));

// 7. behaviour of the pure helper
const sandbox = {Number, Math, Set, console};
vm.createContext(sandbox);
vm.runInContext(
  'const LLMGOD_POOL_SIZE=168;' + block(calc, '_llmGodChance') + '; this.f=_llmGodChance;',
  sandbox);
const five = sandbox.f(['111111', '222222', '333333', '444444', '555555']);
check('five tickets give one distinct count', five && five.k === 5);
check('per-draw chance is 5x168/1e6 within rounding',
  Math.abs(five.pct - (1 - Math.pow(1 - 168 / 1e6, 5)) * 100) < 1e-9);
check('duplicates collapse the count', sandbox.f(['111111', '111111']).k === 1);
check('no numbers means no figure', sandbox.f([]) === null);

console.log('\n' + passed + ' checks passed');
