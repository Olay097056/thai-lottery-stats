// Server responses only. No selected targets, filters, dialogs or editable drafts.
var LotteryQueries = (() => {
  const records=new Map();
  let sequence=0,epoch=0;
  function key(path,method='GET'){
    const [route,query='']=String(path).split('?');
    const params=query.split('&').filter(Boolean).sort((a,b)=>a.split('=')[0].localeCompare(b.split('=')[0]));
    return method+' '+route+(params.length?'?'+params.join('&'):'');
  }
  function immutableCopy(value){
    const copied=JSON.parse(JSON.stringify(value));
    function freeze(item){
      if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}
      return item;
    }
    return freeze(copied);
  }
  function begin(path,method='GET'){
    const token={key:key(path,method),method,id:++sequence,epoch};
    records.set(token.key,Object.freeze({id:token.id,status:'loading',data:null,error:null}));
    if(records.size>32)records.delete(records.keys().next().value);
    return token;
  }
  function finish(token,payload){
    if(token.epoch!==epoch||records.get(token.key)?.id!==token.id)return;
    const failed=payload?.ok===false||typeof payload?.error==='string'&&!payload?.phase;
    records.set(token.key,Object.freeze({id:token.id,status:failed?'error':'ready',
      data:failed?null:immutableCopy(payload),error:failed?immutableCopy(payload):null}));
  }
  function read(path,method='GET'){return records.get(key(path,method))||null;}
  function invalidate(){epoch++;records.clear();}
  return Object.freeze({begin,finish,read,invalidate});
})();
