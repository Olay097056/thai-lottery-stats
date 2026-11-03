const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {readFrontend,prepareContext}=require('./frontend_source');
const source=readFrontend('app.js');
const reportSource=fs.readFileSync(path.join(__dirname,'..','static','shared','reports.js'),'utf8');
function definition(name,next){return source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));}
const stores=new Map(),messages=[],downloads=[],readLog=[],clipboardWrites=[],readFailures=new Set(),writeFailures=new Set(),removeFailures=new Set(),elements=new Map();
let confirmCalls=0,deleteCalls=0,confirmResult=true;
const anchor={href:'',download:'',click(){downloads.push(this.download);},remove(){}};
const localStorage={
  getItem(key){readLog.push(key);if(readFailures.has(key))throw new Error('synthetic storage read failure');return stores.has(key)?stores.get(key):null;},
  setItem(key,value){if(writeFailures.has(key))throw new Error('synthetic storage quota failure');stores.set(key,String(value));},
  removeItem(key){if(removeFailures.has(key))throw new Error('synthetic storage removal failure');stores.delete(key);},
};
const context={Date,Math,JSON,Map,crypto:{randomUUID:()=>String(stores.get('lottery_predict_snapshots')||'').length},
  document:{getElementById:id=>elements.get(id)||null,createElement:()=>({...anchor}),body:{appendChild() {}}},
  window:{setTimeout:fn=>fn()},URL:{createObjectURL:blob=>{downloads.push(blob.parts[0]);return 'blob:backup';},revokeObjectURL(){}},
  Blob:class{constructor(parts,settings){this.parts=parts;this.settings=settings;}},localStorage,
  navigator:{clipboard:{writeText:value=>{clipboardWrites.push(value);return Promise.resolve();}}},
  toast:(message,type)=>messages.push([message,type]),confirm:()=>{confirmCalls++;return confirmResult;},
  deleteWithUndo:(key,_message,mutate,render)=>{deleteCalls++;localStorage.getItem(key);if(mutate()===false)return false;if(typeof render==='function')render();return true;},
  dcSnapshots:()=>JSON.parse(stores.get('lottery_dc_snapshots')||'[]'),fmtDate:value=>String(value||''),
  predNum:row=>String(typeof row==='string'?row:(row?.num??row?.number??'')),
  escHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
for(const key of ['predict','formula']){
  elements.set(`${key}-snapshot-list`,{innerHTML:''});
  elements.set(`${key}-snapshot-count`,{textContent:''});
}
prepareContext(context);
vm.runInContext(reportSource,context,{filename:'static/shared/reports.js'});
vm.runInContext(definition('dcAutoSaveSnapshot','dcTrackStatusBadge'),context);
const reports=context.LotteryReports;
const fingerprint='0123456789abcdef'.repeat(4);
const provenanceHtml=reports.reportProvenanceHtml({method:'statistical',engine_version:'v1',generated_at:'2026-10-16T08:12:00Z',history_cutoff:'2026-10-01',source:'loaded_history',data_version:fingerprint,data_version_scope:'eligible_dataframe'});
assert.match(provenanceHtml,/<dl class="report-lineage">[\s\S]*<\/dl><details class="report-digest">/,'the fingerprint is separated from the visible report facts in a disclosure');
assert.match(provenanceHtml,/<summary>ลายนิ้วมือข้อมูล · ข้อมูลก่อนงวดเป้าหมาย<\/summary>/,'the disclosure names the fingerprint scope');
assert(provenanceHtml.includes(`<code class="report-digest-value">${fingerprint}</code>`),'the full fingerprint remains available when expanded');
assert.match(provenanceHtml,/onclick="copyReportFingerprint\(this\.dataset\.fingerprint\)"/,'the fingerprint has an explicit copy action');
assert.doesNotMatch(provenanceHtml,/<details class="report-digest"[^>]*open/,'the fingerprint starts collapsed');
const original={id:'fixture',date:'2026-10-16',items:[{num:'000001'}],provenance:{engine_version:'v1'}};
assert.equal(reports.savePageSnapshot('predict',original),undefined);
original.items[0].num='000002';reports.savePageSnapshot('predict',original);
const saved=reports.pageSnapshots('predict');
assert.equal(saved.length,2);assert.notEqual(saved[0].id,saved[1].id);
assert.equal(saved[1].items[0].num,'000001');assert.equal(saved[1].schema_version,2);
stores.set('lottery_predict_snapshots',JSON.stringify([{id:'partial',date:'2026-10-16',mode:'optimized',items:[{num:'000001'}],report:{report_status:'partial',categories:{prize1:{label:'รางวัลที่ 1',numbers:[{num:'000001'}]},bottom2:{label:'ท้าย 2 ตัว',numbers:[],error:'calculation_failed'}}}}]));
reports.renderPageSnapshots('predict');
const partialSnapshotHtml=elements.get('predict-snapshot-list').innerHTML;
assert.match(partialSnapshotHtml,/ไม่ครบทุกหมวด/,'saved Predict list keeps the partial status visible');
assert.match(partialSnapshotHtml,/ผลที่บันทึก · บางหมวดไม่สำเร็จ/,'the expanded saved-report heading does not claim complete categories');
assert.match(partialSnapshotHtml,/ตัวเลขที่แสดงมีเฉพาะหมวดที่สำเร็จ/,'the expanded partial snapshot explains what the saved numbers include');
context.dcAutoSaveSnapshot({date:'2026-10-16',picks:[{num:'000001'}]});
context.dcAutoSaveSnapshot({date:'2026-10-16',picks:[{num:'999999'}]});
assert.equal(context.dcSnapshots().length,1);assert.equal(context.dcSnapshots()[0].picks[0].num,'000001');

const before=stores.get('lottery_predict_snapshots');
writeFailures.add('lottery_predict_snapshots');
assert.equal(reports.savePageSnapshot('predict',original),false);
assert.equal(stores.get('lottery_predict_snapshots'),before);assert.equal(messages.at(-1)[1],'error');
writeFailures.clear();

assert.equal(reports.pageSnapshots('formula').length,0,'missing key is a valid empty list');
stores.set('lottery_formula_snapshots','[]');
assert.equal(reports.pageSnapshots('formula').length,0,'valid empty array remains valid');
stores.set('lottery_formula_snapshots',JSON.stringify([{id:'legacy',date:'2026-01-03'}]));
assert.equal(reports.pageSnapshots('formula').length,1,'legacy object records remain readable');

const rawCorrupt='{"unexpected":"legacy-corrupt-store"}';
stores.set('lottery_predict_snapshots',rawCorrupt);
reports.renderPageSnapshots('predict');
assert.equal(reports.pageSnapshotReadError('predict'),'malformed');
assert.equal(elements.get('predict-snapshot-count').textContent,'อ่านไม่ได้');
assert.match(elements.get('predict-snapshot-list').innerHTML,/role="alert"/);
assert.match(elements.get('predict-snapshot-list').innerHTML,/downloadPageSnapshotBackup\('predict'\)/);
const retryReadStart=readLog.length;
reports.renderPageSnapshots('predict');
assert.deepEqual(readLog.slice(retryReadStart),['lottery_predict_snapshots'],'retry re-reads only the selected snapshot store');
assert.equal(reports.savePageSnapshot('predict',original),false);
assert.equal(stores.get('lottery_predict_snapshots'),rawCorrupt,'save leaves malformed bytes intact');
const confirmBefore=confirmCalls,deleteBefore=deleteCalls;
assert.equal(reports.loadPageSnapshot('predict','fixture'),false);
assert.equal(reports.deletePageSnapshot('predict','fixture'),false);
assert.equal(reports.clearPageSnapshots('predict'),false);
assert.equal(confirmCalls,confirmBefore,'unreadable clear does not show a destructive confirmation');
assert.equal(deleteCalls,deleteBefore,'unreadable delete does not enter the delete flow');
assert.equal(reports.downloadPageSnapshotBackup('predict'),true);
assert(downloads.includes(rawCorrupt));
assert.equal(stores.get('lottery_predict_snapshots'),rawCorrupt,'raw backup does not rewrite the store');

for(const raw of ['{"date":"2026-10-16"}','[null]','[42]','[{"items":"bad"}]','[{"items":[null]}]','[{"report":{"categories":{"prize1":null}}}]']){
  stores.set('lottery_formula_snapshots',raw);
  assert.equal(reports.pageSnapshots('formula'),null,'unexpected snapshot shape is unreadable');
  reports.renderPageSnapshots('formula');
  assert.match(elements.get('formula-snapshot-list').innerHTML,/อ่าน Snapshot สูตรคำนวณ ไม่ได้/);
  assert.equal(stores.get('lottery_formula_snapshots'),raw);
}
const malformedJson='{"broken';
stores.set('lottery_formula_snapshots',malformedJson);
assert.equal(reports.pageSnapshots('formula'),null,'malformed JSON is not treated as empty');
assert.equal(reports.pageSnapshotReadError('formula'),'malformed');
reports.renderPageSnapshots('formula');
assert.equal(stores.get('lottery_formula_snapshots'),malformedJson,'rendering malformed JSON does not rewrite bytes');
readFailures.add('lottery_formula_snapshots');
const unreadableFormulaRaw=stores.get('lottery_formula_snapshots');
assert.equal(reports.pageSnapshots('formula'),null);
assert.equal(reports.pageSnapshotReadError('formula'),'unavailable');
reports.renderPageSnapshots('formula');
assert.match(elements.get('formula-snapshot-list').innerHTML,/เบราว์เซอร์ไม่อนุญาตให้อ่านข้อมูล/);
const readFailureConfirmBefore=confirmCalls,readFailureDeleteBefore=deleteCalls;
assert.equal(reports.downloadPageSnapshotBackup('formula'),false,'backup reports unavailable reads safely');
assert.equal(reports.savePageSnapshot('formula',original),false,'save refuses a store that throws during reads');
assert.equal(reports.loadPageSnapshot('formula','legacy'),false,'load refuses a store that throws during reads');
assert.equal(reports.deletePageSnapshot('formula','legacy'),false);
assert.equal(reports.clearPageSnapshots('formula'),false);
assert.equal(confirmCalls,readFailureConfirmBefore,'read failure blocks clear confirmation until the store is readable');
assert.equal(deleteCalls,readFailureDeleteBefore,'read failure blocks the delete flow');
assert.equal(stores.get('lottery_formula_snapshots'),unreadableFormulaRaw,'read failures never create or mutate the inaccessible store');
assert.equal(reports.pageSnapshotReadError('predict'),'malformed','one tab error does not replace the other tab state');

const malformedMixRaw='{"broken mix bytes';
stores.set('lottery_mix_snapshots',malformedMixRaw);
assert.equal(reports.exportLocalReports(),true,'one or more unreadable stores do not abort the combined download');
const partialExportText=downloads.findLast(value=>typeof value==='string'&&value.includes('"store_errors"'));
const partialExport=JSON.parse(partialExportText);
assert.equal(partialExport.stores.lottery_predict_snapshots,null);
assert.equal(partialExport.store_errors.lottery_predict_snapshots.status,'unexpected_shape');
assert.equal(partialExport.store_errors.lottery_predict_snapshots.raw,rawCorrupt,'unexpected-shape bytes are retained exactly');
assert.equal(partialExport.store_errors.lottery_formula_snapshots.status,'unavailable','read exceptions include a safe per-store status');
assert.equal(partialExport.store_errors.lottery_formula_snapshots.raw,undefined,'read exceptions do not expose exception details');
assert.equal(partialExport.store_errors.lottery_mix_snapshots.status,'malformed_json');
assert.equal(partialExport.store_errors.lottery_mix_snapshots.raw,malformedMixRaw,'malformed JSON bytes are retained exactly');
assert.equal(partialExport.stores.lottery_dc_snapshots.length,1,'readable stores remain in the combined export');
assert(messages.at(-1)[0].includes('3 รายการที่อ่านไม่ได้'),'partial export toast explains how many stores need attention');

readFailures.clear();
for(const key of ['lottery_predict_snapshots','lottery_formula_snapshots','lottery_dc_snapshots','lottery_dc_snapshots_old','lottery_mix_snapshots','lottery_buyplan_history'])stores.set(key,'[]');
const allReadableStart=downloads.length;
assert.equal(reports.exportLocalReports(),true);
const allReadableText=downloads.slice(allReadableStart).find(value=>typeof value==='string'&&value.includes('"schema_version"'));
const allReadableExport=JSON.parse(allReadableText);
assert.equal(Object.prototype.hasOwnProperty.call(allReadableExport,'store_errors'),false,'error metadata stays optional when every store is readable');
assert(Object.values(allReadableExport.stores).every(Array.isArray),'all-readable export retains the existing stores object shape');

stores.set('lottery_predict_snapshots','[]');
reports.renderPageSnapshots('predict');
assert.equal(reports.pageSnapshotReadError('predict'),null,'a successful retry clears the error');
assert.equal(elements.get('predict-snapshot-count').textContent,'0 รายการ');
assert.match(elements.get('predict-snapshot-list').innerHTML,/ยังไม่มี Snapshot/);
assert.equal(reports.reportStoreCanWrite('lottery_predict_snapshots'),true);

const hostileSnapshotId=`id' onclick='alert(1)`;
stores.set('lottery_predict_snapshots',JSON.stringify([
  {id:'first',date:'2026-10-01',title:'first',items:[]},
  {id:hostileSnapshotId,date:'2026-10-16',title:'hostile',items:[]},
  {id:'last',date:'2026-11-01',title:'last',items:[]},
]));
reports.renderPageSnapshots('predict');
const renderedSnapshots=elements.get('predict-snapshot-list').innerHTML;
assert(renderedSnapshots.includes(`data-snapshot-id="${context.escHtml(hostileSnapshotId)}"`),'snapshot IDs are escaped into data attributes');
assert(renderedSnapshots.includes("onclick=\"deletePageSnapshot('predict',this.dataset.snapshotId)\""),'delete action reads its ID from the data attribute');
assert(!renderedSnapshots.includes(`onclick="deletePageSnapshot('predict','${hostileSnapshotId}`),'snapshot IDs never enter inline JavaScript source');
const focusLog=[];
for(const id of ['predict-snapshot-delete-1','predict-snapshot-delete-0','predict-snapshot-empty'])elements.set(id,{focus(){focusLog.push(id);}});
assert.equal(reports.deletePageSnapshot('predict',hostileSnapshotId),true,'hostile but valid legacy IDs remain deletable');
assert.equal(focusLog.at(-1),'predict-snapshot-delete-1','deleting a middle snapshot focuses the next record at its index');
assert.equal(reports.deletePageSnapshot('predict','last'),true);
assert.equal(focusLog.at(-1),'predict-snapshot-delete-0','deleting the final record focuses the remaining record');
assert.equal(reports.deletePageSnapshot('predict','first'),true);
assert.equal(focusLog.at(-1),'predict-snapshot-empty','deleting the last snapshot focuses the empty state');

const clearFocus=[];
elements.set('predict-snapshot-empty',{focus(){clearFocus.push('predict-snapshot-empty');}});
stores.set('lottery_predict_snapshots',JSON.stringify([
  {id:'clear-first',date:'2026-10-01',items:[]},
  {id:'clear-last',date:'2026-10-16',items:[]},
]));
assert.equal(reports.clearPageSnapshots('predict'),true,'clear-all completes after confirmation');
assert.equal(clearFocus.at(-1),'predict-snapshot-empty','clear-all focuses the rendered empty state');
assert.equal(reports.pageSnapshots('predict').length,0,'clear-all removes all saved snapshots');

stores.set('lottery_formula_snapshots',JSON.stringify([{id:'keep',date:'2026-10-16',items:[]}]));
confirmResult=false;
assert.equal(reports.clearPageSnapshots('formula'),false,'canceling clear-all reports no mutation');
assert.equal(stores.get('lottery_formula_snapshots'),JSON.stringify([{id:'keep',date:'2026-10-16',items:[]}]),'canceling clear-all preserves stored snapshots');
assert.equal(clearFocus.length,1,'canceling clear-all does not move focus');
confirmResult=true;
const formulaClearFocus=[];
elements.set('formula-snapshot-empty',{focus(){formulaClearFocus.push('formula-snapshot-empty');}});
assert.equal(reports.clearPageSnapshots('formula'),true,'Formula clear-all completes after confirmation');
assert.equal(formulaClearFocus.at(-1),'formula-snapshot-empty','Formula clear-all focuses its empty state');
assert.equal(reports.pageSnapshots('formula').length,0,'Formula clear-all removes all saved snapshots');

(async()=>{
  assert.equal(await reports.copyReportFingerprint(fingerprint),true,'copy action succeeds through the browser clipboard');
  assert.deepEqual(clipboardWrites,[fingerprint],'copy action preserves the exact fingerprint');
  assert.equal(messages.at(-1)[0],'คัดลอกลายนิ้วมือข้อมูลแล้ว');
  console.log('PASS report snapshots preserve corrupt data, show recovery, gate mutations, and retain valid/legacy behavior');
})().catch(error=>{console.error(error);process.exitCode=1;});
