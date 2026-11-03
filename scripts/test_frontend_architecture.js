// Actual isolated files: verify public contracts, private state and network ownership.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..','static');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts.json'),'utf8'));
const files=[...manifest.engine,...manifest.app];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const owners={formula:['formula-engine.js','formula-calculators.js','formula-evaluation.js'],decision:'decision-center.js',legacyDecision:'decision-legacy.js',
  buyplan:'buyplan-ui.js',history:'history-ui.js',predict:'prediction-ui.js',mix:'mix-ui.js',health:'report-core.js'};
for(const file of files){
  const source=read(file);
  if(file!=='shared/api-client.js')assert.doesNotMatch(source,/\bfetch\s*\(/,file+' bypasses the API client');
  if(file!=='astra-ui.js')assert.doesNotMatch(source,/\b_astra(?:RequestId|Started|SelectedVersion|SigmaRequestId|SigmaStarted)\b/,file+' reads private Astra state');
  if(file!=='shared/charts.js')assert.doesNotMatch(source,/\b_charts\b/,file+' reads private chart registry');
  for(const match of source.matchAll(/LotteryServerData\.(\w+)\.\w+\s*=(?!=)/g)){
    assert([owners[match[1]]].flat().includes(file),file+' writes a different feature data view');
  }
}
const uiOwners={navigation:['app.js'],notifications:['app.js'],formula:['formula-engine.js','formula-calculators.js','formula-evaluation.js'],buyplan:['buyplan-ui.js'],history:['history-ui.js'],predict:['prediction-ui.js','dashboard-ui.js'],mix:['mix-ui.js','mix-support.js'],decision:['decision-center.js'],legacyDecision:['decision-legacy.js'],frequency:['dashboard-ui.js'],health:['report-core.js']};
for(const file of files){
  const source=read(file);
  for(const match of source.matchAll(/LotteryUiState\.(\w+)\.\w+\s*(?:=(?!=)|\+\+|--|\+=|-=)|(?:\+\+|--)LotteryUiState\.(\w+)\.\w+/g)){
    assert(uiOwners[match[1]||match[2]]?.includes(file),file+' writes a different feature UI store');
  }
  if(!file.startsWith('shared/'))assert.doesNotMatch(source,/^let /m,file+' introduces loose global UI state');
}
const sandbox={window:{}};
vm.createContext(sandbox);
for(const file of ['shared/server-data.js','shared/ui-state.js','shared/queries.js','shared/api-client.js','shared/charts.js','shared/reports.js','astra-ui.js']){
  vm.runInContext(read(file),sandbox,{filename:file});
}
for(const name of ['_apiInFlight','_apiAnnouncingInFlight','_lastApiErrToast','_charts','_sysFont','_astraRequestId','_astraSelectedVersion','currentPage','currentPredTab','_bpWorkingPlan','_histLoadError','ui','values']){
  assert.equal(vm.runInContext('typeof '+name,sandbox),'undefined',name+' leaked into global scope');
}
assert.equal(sandbox.window.getSelectedAstraVersion(),'astra-v1');
assert(Object.isFrozen(sandbox.AstraFeature));
assert(Object.isFrozen(sandbox.LotteryReports));
assert(Object.isFrozen(sandbox.LotteryCharts));
assert(Object.isFrozen(sandbox.LotteryApi));
assert(Object.isFrozen(sandbox.window.getAstraUiState()));
const query=sandbox.LotteryQueries;
const first=query.begin('history?n=50&col=prize1');
const second=query.begin('history?col=prize1&n=50');
query.finish(second,{data:[{number:'000001'}]});
query.finish(first,{data:[{number:'999999'}]});
assert.equal(query.read('history?n=50&col=prize1').data.data[0].number,'000001');
assert(Object.isFrozen(query.read('history?n=50&col=prize1').data.data));
const pending=query.begin('summary');query.invalidate();query.finish(pending,{latest:{date:'2026-10-01'}});
assert.equal(query.read('summary'),null);
const domain=query.begin('astra/automation');query.finish(domain,{phase:'error',error:'cache_missing'});
assert.equal(query.read('astra/automation').status,'ready','domain errors are valid automation states');
const failure=query.begin('predict/all');query.finish(failure,{ok:false,error:'fixture failure'});
assert.equal(query.read('predict/all').status,'error');
assert.equal(query.read('predict/all').data,null);
async function transportContracts(){
  const calls=[];
  let destroyed=0;
  sandbox.Chart=function(){this.destroy=()=>{destroyed++;};};
  sandbox.document={getElementById:()=>({getContext:()=>({}),classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){}})};
  sandbox.LotteryCharts.mkChart('fixture',{});
  sandbox.LotteryCharts.mkChart('fixture',{});
  sandbox.LotteryCharts.destroyChart('fixture');
  assert.equal(destroyed,2,'chart lifecycle stays inside its owner');
  const payload={data:[{number:'000001'}]};
  sandbox.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>payload};};
  assert.equal(calls.length,0,'loading architecture modules must not prefetch predictions');
  const result=await sandbox.LotteryApi.request('history?n=50');
  result.data[0].number='999999';
  assert.equal(query.read('history?n=50').data.data[0].number,'000001','UI mutations cannot change the canonical query response');
  await sandbox.LotteryApi.request('refresh',{method:'POST'});
  assert.equal(calls.at(-1).options.method,'POST');
  assert.equal(query.read('history?n=50'),null,'successful mutation invalidates response records');
  await sandbox.LotteryApi.request('history?n=50');
  await sandbox.LotteryApi.request('refresh',{method:'POST',requireOk:true});
  assert.equal(query.read('history?n=50'),null,'strict successful mutation also invalidates queries');
  sandbox.fetch=async()=>({ok:false,status:422,json:async()=>({detail:[]})});
  const invalid=await sandbox.LotteryApi.request('predict/all');
  assert.equal(invalid.error_code,'validation_failed');
  assert.equal(query.read('predict/all').status,'error');
  assert.equal(sandbox.LotteryUiState.history.rows,undefined,'server rows do not belong to the UI store');
  assert.equal(sandbox.LotteryServerData.buyplan.workingPlan,undefined,'editable drafts do not belong to server state');
  sandbox.LotteryServerData.buyplan.history=[{prize1:'000001'}];
  sandbox.LotteryUiState.buyplan.workingPlan={rows:[{num:'123456',stake:20}]};
  sandbox.LotteryUiState.buyplan.workingPlan.rows[0].stake=40;
  assert.equal(sandbox.LotteryServerData.buyplan.history[0].prize1,'000001');
  console.log('PASS architecture ownership, isolated state, transport/query contracts, UI separation and races');
}
transportContracts().catch(error=>{console.error(error);process.exitCode=1;});
