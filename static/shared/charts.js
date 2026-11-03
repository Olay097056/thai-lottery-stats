var LotteryCharts = (() => {
// ─── Chart registry ───────────────────────────────────────────────────────────
const _charts = {};
let _chartLibraryPromise = null;
function ensureChartLibrary(){
  if(typeof window.Chart === 'function')return Promise.resolve();
  if(_chartLibraryPromise)return _chartLibraryPromise;
  _chartLibraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.async=true;
    script.onload=()=>{
      if(typeof window.Chart==='function')resolve();
      else{_chartLibraryPromise=null;reject(new Error('Chart.js did not expose Chart'));}
    };
    script.onerror=()=>{_chartLibraryPromise=null;reject(new Error('Chart.js could not be loaded'));};
    document.head.appendChild(script);
  });
  return _chartLibraryPromise;
}
function showChartLoadFailure(id){
  const canvas=document.getElementById(id),container=canvas?.parentElement;
  if(!container||container.querySelector('.chart-load-status'))return;
  const status=document.createElement('p');
  status.className='chart-load-status';
  status.setAttribute('role','status');
  status.textContent='โหลดกราฟไม่สำเร็จ กรุณารีเฟรชข้อมูล';
  container.appendChild(status);
}
function destroyChart(id){
  if(_charts[id]){_charts[id].destroy();delete _charts[id];}
}
function mkChart(id, cfg){
  const el = document.getElementById(id);
  if(!el) return;
  if(typeof window.Chart !== 'function'){
    return ensureChartLibrary().then(()=>{
      const chart=mkChart(id,cfg);
      syncTheme();
      return chart;
    }).catch(()=>showChartLoadFailure(id));
  }
  if(_charts[id]){ _charts[id].destroy(); }
  for(const dataset of cfg.data?.datasets||[])applyDatasetTheme(dataset);
  _charts[id] = new window.Chart(el.getContext('2d'), cfg);
  return _charts[id];
}

// ─── Chart defaults ───────────────────────────────────────────────────────────
// ธีม macOS แท้ (design-system.md): grid --border2, label --text3 ฟอนต์ระบบ,
// tooltip พื้น surface ทึบ radius 8. อ่านค่าจาก CSS variables จริงตอน runtime
const _sysFont="'Noto Sans Thai','Segoe UI',sans-serif";
function _cssVar(name,fallback){
  const v=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement).getPropertyValue(name).trim():'';
  return v||fallback;
}
function chartOpts(yLabel='',legend=false){
  const tick=_cssVar('--text3','#8e8e93'), grid=_cssVar('--border2','#e5e7eb'), title=_cssVar('--text3','#8e8e93');
  const surf=_cssVar('--surface2','#28282c'), border=_cssVar('--border','#d1d5db'), txt=_cssVar('--text','#f5f5f7');
  return{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:legend,labels:{color:tick,font:{family:_sysFont,size:12}}},
      tooltip:{backgroundColor:surf,borderColor:border,borderWidth:1,cornerRadius:8,padding:9,
        titleColor:txt,bodyColor:txt,titleFont:{family:_sysFont},bodyFont:{family:_sysFont},
        callbacks:{label:ctx=>` ${ctx.parsed.y??ctx.parsed.x}`}}},
    scales:{x:{ticks:{color:tick,font:{family:_sysFont,size:12}},grid:{color:grid}},
      y:{ticks:{color:tick,font:{family:_sysFont,size:12}},grid:{color:grid},title:{display:!!yLabel,text:yLabel,color:title,font:{family:_sysFont}}}}};
}


function applyDatasetTheme(dataset){
  if(dataset.themeColor){const value=_cssVar(dataset.themeColor,'#b45309');dataset.borderColor=value;dataset.backgroundColor=dataset.themeFill?_cssVar(dataset.themeFill,value):value;}
}
function syncTheme(){
  for(const chart of Object.values(_charts)){
    for(const dataset of chart.data?.datasets||[])applyDatasetTheme(dataset);
    for(const scale of Object.values(chart.options?.scales||{})){
      if(scale.ticks)scale.ticks.color=_cssVar('--text3','#6b7280');
      if(scale.grid)scale.grid.color=_cssVar('--border2','#e5e7eb');
      if(scale.title)scale.title.color=_cssVar('--text3','#6b7280');
    }
    const tooltip=chart.options?.plugins?.tooltip;
    if(tooltip)Object.assign(tooltip,{backgroundColor:_cssVar('--surface2','#f3f4f6'),borderColor:_cssVar('--border','#d1d5db'),bodyColor:_cssVar('--text','#111827'),titleColor:_cssVar('--text','#111827')});
    const labels=chart.options?.plugins?.legend?.labels;if(labels)labels.color=_cssVar('--text3','#6b7280');
    chart.update();
  }
}
return Object.freeze({mkChart,chartOpts,destroyChart,syncTheme});
})();
Object.assign(window,LotteryCharts);
