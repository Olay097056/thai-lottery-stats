// Client state only: controls, request generations, navigation and draft artifacts.
// Each feature exposes one fixed UI-store surface; backing values stay private.
var LotteryUiState = LotteryUiState || (() => {
  const initial={"notifications": {"node": null, "timer": null}, "navigation": {"page": "dashboard", "predictionTab": "predict", "restoringPageLocation": false, "sharedDateSyncing": false}, "buyplan": {"workingPlan": null, "workingPlanTouched": false, "loadRequestId": 0, "mixIntent": false, "mixIntentPending": false, "historyReadError": null, "configReadError": null, "sourceStale": false}, "frequency": {"freqLoadRequestId": 0}, "decision": {"lastSnapshot": null, "loadRequestId": 0}, "legacyDecision": {"lastSnapshotOld": null, "loadRequestId": 0}, "formula": {"filled": false, "autoFillRequestId": 0, "autoFillPending": false, "activeTab": "A", "hasRun": false, "sourceStale": false, "consensusFilter": "all", "sortKey": "edge", "sortAsc": false, "running": false}, "history": {"loadError": false, "loadPending": false, "loadRequestId": 0, "statusTimer": null, "statusAnnouncementId": 0}, "mix": {"loadRequestId": 0, "snapshotReadError": null, "sourceStale": false}, "predict": {"lastPredCol": "", "lastPredDate": "", "lastPredictSnapshot": null, "lastPredictStatus": "", "isLoading": false, "sourceStale": false, "requestId": 0, "luckyNewsRequestId": 0, "luckyNewsDate": ""}, "health": {"requestId": 0, "dataEpoch": 0}};
  const values=JSON.parse(JSON.stringify(initial)),facade={};
  for(const [feature,fields] of Object.entries(initial)){
    const view={};
    for(const field of Object.keys(fields))Object.defineProperty(view,field,{
      enumerable:true,get:()=>values[feature][field],set:value=>{values[feature][field]=value;}
    });
    facade[feature]=Object.freeze(view);
  }
  return Object.freeze(facade);
})();
