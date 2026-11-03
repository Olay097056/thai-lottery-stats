// Server/query views own API data; feature controllers own writes to their view.
// Underlying values are private. Drafts, filters and target selections are excluded.
var LotteryServerData = LotteryServerData || (() => {
  const initial={"formula": {"history": [], "backtestRows": [], "backtestFieldCheck": null, "testedDraws": 0, "backtestPartial": false, "backtestRetryable": false}, "decision": {"history": []}, "legacyDecision": {"history": []}, "mix": {"history": [], "predictions": []}, "buyplan": {"history": null, "sources": null}, "history": {"rows": []}, "predict": {"rows": []}, "health": {"report": null}};
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
