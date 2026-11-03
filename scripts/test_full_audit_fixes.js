const fs=require('fs'),vm=require('vm'),assert=require('assert');
const context={window:{},console,Date,Intl};vm.createContext(context);
vm.runInContext(fs.readFileSync('static/shared/reports.js','utf8'),context);
const reports=context.LotteryReports;
assert.equal(reports.latestEligibleDate([{date:'20/07/2026'},{date:'09/08/2026'},{date:'2026-10-16'}],'2026-10-16'),'2026-08-09');
assert.equal(reports.canonicalReportDate('31/02/2026'),null);
assert.equal(reports.canonicalReportDate('2026-02-29'),null);
assert.equal(reports.latestEligibleDate([{date:'2026-10-16'}],'2026-10-16'),null);
async function checkFailure(file,name,feature,snapshot,partial=false){
 const source=fs.readFileSync(file,'utf8');
 const body=source.match(new RegExp('async function '+name+'\\(\\)\\{[\\s\\S]*?\\n\\}'))?.[0];
 assert(body,'controller exists');
 let saves=0;const root={className:'',textContent:''};
 const ctx={console,document:{getElementById:id=>id.includes('date')?{options:[{}],value:'2026-10-16'}:root},LotteryUiState:{[feature]:{loadRequestId:0,[snapshot]:{date:'old'}}},api:async path=>partial?(path.startsWith('summary')?{latest:{prize1:'000001'}}:path.startsWith('prize-history')?{data:[{date:'01/10/2026'}]}:{report_status:'partial',categories:{prize1:{numbers:[{number:'000001'}]}}}):({ok:false,error:'synthetic failure'}),setPageStatus(){},toast(){},nextDrawInfo:()=>({iso:'2026-10-16'}),dcAutoSaveSnapshot:()=>saves++,dcAutoSaveSnapshotOld:()=>saves++};
 vm.createContext(ctx);vm.runInContext(body,ctx);await ctx[name]();
 assert.equal(saves,0);assert.equal(ctx.LotteryUiState[feature][snapshot],null);assert(root.textContent.includes('ยังไม่บันทึก'));
}
(async()=>{await checkFailure('static/decision-center.js','loadDecisionCenter','decision','lastSnapshot');await checkFailure('static/decision-legacy.js','loadDecisionCenterOld','legacyDecision','lastSnapshotOld');await checkFailure('static/decision-center.js','loadDecisionCenter','decision','lastSnapshot',true);await checkFailure('static/decision-legacy.js','loadDecisionCenterOld','legacyDecision','lastSnapshotOld',true);console.log('PASS date normalization and both API-failure snapshot guards');})().catch(e=>{console.error(e);process.exit(1)});
