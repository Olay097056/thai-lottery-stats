var LotteryApi = (() => {
function normalizeApiFailure(payload,status){
  const code=payload?.error_code||(status===422?'validation_failed':status===404?'not_found':status>=500?'server_failed':'request_failed');
  const message=typeof payload?.error==='string'?payload.error:
    status===422?'ค่าที่ส่งไม่ถูกต้อง ตรวจงวดและตัวเลือกแล้วลองใหม่':
    status===404?'ไม่พบข้อมูลหรือบริการที่ขอ':status>=500?'ระบบคำนวณไม่สำเร็จ กรุณาลองใหม่':'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่';
  return {...(payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:{}),
    ok:false,error:message,error_code:code,http_status:status,retryable:payload?.retryable??status>=500};
}
// ─── API ──────────────────────────────────────────────────────────────────────
let _apiInFlight=0,_apiAnnouncingInFlight=0,_lastApiErrToast=0;
async function api(path,options={}){
  const queryToken=typeof LotteryQueries!=='undefined'?LotteryQueries.begin(path,options.method||'GET'):null;
  const spinner=document.getElementById('api-spinner');
  _apiInFlight++;
  if(!options.suppressSpinnerAnnouncement)_apiAnnouncingInFlight++;
  if(_apiInFlight===1)spinner.classList.add('active');
  if(_apiAnnouncingInFlight===0)spinner.setAttribute('aria-hidden','true');
  else spinner.removeAttribute('aria-hidden');
  try{
    const r=await fetch('/api/'+path,options.method?{method:options.method,headers:options.headers,body:options.body}:undefined);
    const payload=await r.json();
    if(options.requireOk){
      if(!r.ok){
        const failure=normalizeApiFailure(payload,r.status);
        if(queryToken)LotteryQueries.finish(queryToken,failure);
        return failure;
      }
      if(queryToken){LotteryQueries.finish(queryToken,payload);if(options.method&&options.method!=='GET'&&payload?.ok!==false&&typeof payload?.error!=='string')LotteryQueries.invalidate();}
      return payload;
    }
    if(!r.ok||typeof payload?.error==='string'||payload?.ok===false||payload?.detail){
      const failure=normalizeApiFailure(payload,r.status);
      if(queryToken)LotteryQueries.finish(queryToken,failure);
      return failure;
    }
    if(queryToken){LotteryQueries.finish(queryToken,payload);if(options.method&&options.method!=='GET')LotteryQueries.invalidate();}
    return payload;
  }catch(e){
    // แจ้งผู้ใช้เมื่อโหลดล้มเหลว (throttle 5 วิ กันสแปมตอน server ล่มแล้วยิงหลาย call พร้อมกัน)
    const now=Date.now();
    if(!options.suppressNetworkToast&&typeof toast==='function'&&now-(_lastApiErrToast||0)>5000){
      _lastApiErrToast=now;
      toast('เชื่อมต่อ server ไม่ได้ — ลองรีเฟรชหรือเช็กว่า server ยังรันอยู่','error');
    }
    const failure={ok:false,error:'เชื่อมต่อบริการหรืออ่านคำตอบไม่ได้ กรุณาลองใหม่',error_code:'network_or_response_failed',retryable:true};
    if(queryToken)LotteryQueries.finish(queryToken,failure);
    return failure;
  }finally{
    _apiInFlight=Math.max(0,_apiInFlight-1);
    if(!options.suppressSpinnerAnnouncement)_apiAnnouncingInFlight=Math.max(0,_apiAnnouncingInFlight-1);
    if(_apiInFlight===0)spinner.classList.remove('active');
    if(_apiAnnouncingInFlight===0)spinner.setAttribute('aria-hidden','true');
    else spinner.removeAttribute('aria-hidden');
  }
}

return Object.freeze({request:api,normalizeFailure:normalizeApiFailure});
})();
function api(path,options={}){return LotteryApi.request(path,options);}
