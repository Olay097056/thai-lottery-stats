// Astra-Σ UI contract: synthetic payloads only; no real cache or outcome access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'static/app.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'static/app.js'), 'utf8')
  .replace(/^startCountdown\(\);\s*$/m, '').replace(/^init\(\);\s*$/m, '');
const engine = fs.readFileSync(path.join(root, 'static/formula-engine.js'), 'utf8');
const specs = [
  ['prize1', 'รางวัลที่ 1', 6, 5], ['front3', 'เลขหน้า 3 ตัว', 3, 2],
  ['back3', 'เลขท้าย 3 ตัวทางการ', 3, 2], ['bottom2', 'เลขท้าย 2 ตัว', 2, 1],
  ['prize2', 'รางวัลที่ 2', 6, 5], ['prize3', 'รางวัลที่ 3', 6, 5], ['prize4', 'รางวัลที่ 4', 6, 5],
];
const weights = {A:0.50,H:0.10,D:0.10,N:0.12,L:0.08,B:0.10};
const settings = {
  max_draws:200, min_valid_draws:20, signal_window_valid_draws:24, overdue_cap_valid_draws:24,
  hot_definition:'position_digit_fraction; equal weight per draw then slot',
  overdue_definition:'valid category draws since same-position appearance; capped at 24',
  numerology:'digit-sum modulo 9; circular distance on residues 0..8',
  lucky_digits:'fraction of digits equal to 8 or 9',
  balance:'mean of odd-even, low-high (0-4/5-9), and distinct-digit balance',
  tie_break:'descending unrounded score, then ascending digit string',
  weights,
};
function report(target='2026-10-16') {
  const categories = Object.fromEntries(specs.map(([key,label,digits,count]) => [key, {
    label,digits,requested_count:count,status:'ok',valid_draws:24,invalid_draws:0,
    training_cutoff_date:'2026-10-01',
    numbers:Array.from({length:count},(_,i)=>{
      const components={A:0.90-i*0.01,H:0.50,D:0.40,N:0.75,L:0.20,B:0.60};
      const score=Object.keys(weights).reduce((sum,k)=>sum+weights[k]*components[k],0);
      return {number:String(i).padStart(digits,'0'),rank:i+1,score,base_score:-1-i,components};
    }),
  }]));
  return {schema_version:1,formula:'astra',version:'astra-sigma-v0.1',trust:'ทดลอง',
    target_date:target,generated_at:'2026-10-08T12:00:00+07:00',training_cutoff_date:'2026-10-01',
    source:'supplied_history',window_draws:24,settings,warnings:[],categories};
}
function element(id) {
  const attrs=new Map(),classes=new Set();
  return {id,value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,style:{},dataset:{},
    options:[],children:[],classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle(n,on){on?classes.add(n):classes.delete(n);}},
    setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),
    add(){},appendChild(){},addEventListener(){},remove(){},querySelectorAll:()=>[]};
}
function harness(fetchImpl) {
  const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],element(m[1])]));
  const requests=[];
  const sandbox={console,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},
    Option:function(text,value){this.text=text;this.value=value;},
    addEventListener(){},
    document:{getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],
      createElement:()=>element(''),addEventListener(){},documentElement:{dataset:{theme:'light'}}},
    localStorage:{getItem:()=>null,setItem(){throw new Error('no storage writes');}},
    fetch:async route=>{requests.push(route);return fetchImpl?fetchImpl(route):{ok:true,json:async()=>report()};}};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(engine,sandbox);vm.runInContext(app,sandbox);
  for(const name of ['_computeFormulasBatch','runFormulaBacktest','dcComputeFormulaResults','_mixCompute','loadMixPage','loadBuyPlan','dcRecommendedNumbers','renderPageSnapshots'])
    sandbox[name]=()=>{throw new Error('Astra-Σ must not enter '+name);};
  elements['shared-draw-date'].value='2026-10-16';
  return {sandbox,elements,requests};
}
function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};}
function response(payload){return{ok:true,json:async()=>payload};}

(async()=>{
  assert.match(html,/id="astra-version-v1"/);
  assert.match(html,/id="astra-version-sigma"/);
  assert.match(html,/id="astra-sigma-content"/);
  assert.match(html,/id="astra-sigma-heading">Astra-Σ </);
  assert.match(html,/Astra-Σ v0\.1 · ทดลอง/);
  assert.match(css,/#astra-sigma-categories \.astra-grid-prizes \.astra-numbers\{grid-template-columns:minmax\(0,1fr\);gap:0\}/);
  assert.match(css,/#astra-sigma-categories \.astra-grid-prizes \.astra-numbers li\{display:grid;grid-template-columns:max-content max-content minmax\(0,1fr\)/);
  assert.match(css,/#astra-sigma-categories \.astra-grid-prizes \.astra-components\{grid-column:1\/-1/);
  const h=harness();
  assert.equal(typeof h.sandbox.selectAstraVersion,'function');
  assert.equal(typeof h.sandbox.loadAstraSigma,'function');
  await h.sandbox.selectAstraVersion('astra-sigma');
  assert.deepEqual(h.requests,['/api/predict/astra-sigma?date=2026-10-16']);
  assert.equal(h.elements['astra-v1-content'].hidden,true);
  assert.equal(h.elements['astra-sigma-content'].hidden,false);
  assert.equal(h.elements['astra-version-sigma'].getAttribute('aria-pressed'),'true');
  assert.equal(h.elements['astra-version-v1'].getAttribute('aria-pressed'),'false');
  const htmlBodies=specs.map(([key])=>h.elements['astra-sigma-body-'+key].innerHTML).join('\n');
  assert.equal((htmlBodies.match(/class="astra-number"/g)||[]).length,25);
  assert.match(htmlBodies,/>000000<\/span>/);
  assert.match(htmlBodies,/คะแนนจัดอันดับ/);
  assert.doesNotMatch(htmlBodies,/ความน่าจะเป็น|โอกาสถูกรางวัล/);
  assert.match(h.elements['astra-sigma-meta'].innerHTML,/astra-sigma-v0\.1/);
  assert.match(h.elements['astra-sigma-status'].textContent,/25/);

  const automatic=harness();
  automatic.sandbox.setAstraAutomaticTarget('2026-11-01');
  await automatic.sandbox.showAstraAutomaticTarget();
  await automatic.sandbox.selectAstraVersion('astra-sigma');
  assert.ok(automatic.requests.includes('/api/predict/astra-sigma?date=2026-10-16'));
  assert.match(automatic.elements['astra-sigma-target-label'].textContent,/2026-10-16/);

  const invalidated=harness();
  await invalidated.sandbox.selectAstraVersion('astra-sigma');
  invalidated.sandbox.syncSharedDrawDate('2026-11-01',false);
  assert.equal(invalidated.elements['astra-sigma-results'].dataset.state,'idle');
  assert.equal((specs.map(([key])=>invalidated.elements['astra-sigma-body-'+key].innerHTML).join('').match(/class="astra-number"/g)||[]).length,0);
  assert.equal(invalidated.requests.length,1);

  const invalid=report();
  invalid.categories.prize1.numbers[0].number='<img src=x onerror=1>';
  const bad=harness(async()=>response(invalid));
  await bad.sandbox.selectAstraVersion('astra-sigma');
  assert.equal(bad.elements['astra-sigma-results'].dataset.state,'error');
  const badBodies=specs.map(([key])=>bad.elements['astra-sigma-body-'+key].innerHTML).join('\n');
  assert.doesNotMatch(badBodies,/class="astra-number"|<img/);
  assert.match(bad.elements['astra-sigma-status'].textContent,/ไม่สำเร็จ/);

  const first=deferred(),second=deferred();let calls=0;
  const race=harness(()=> (++calls===1?first.promise:second.promise));
  const oldRequest=race.sandbox.loadAstraSigma();
  race.elements['shared-draw-date'].value='2026-11-01';
  const newRequest=race.sandbox.loadAstraSigma();
  second.resolve(response(report('2026-11-01')));await newRequest;
  first.resolve(response(report('2026-10-16')));await oldRequest;
  assert.match(race.elements['astra-sigma-meta'].innerHTML,/2026-11-01/);
  assert.doesNotMatch(race.elements['astra-sigma-meta'].innerHTML,/2026-10-16/);
  console.log('OK: Astra-Σ UI synthetic contracts, validation, rendering, and stale-request race');
})().catch(error=>{console.error(error);process.exitCode=1;});
