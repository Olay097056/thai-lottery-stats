// ─── HyperUI theme (light-first) — storage 'lottery_theme' ─────────────────────
const _THEME_KEY='lottery_theme';
function _applyTheme(t){
  document.documentElement.dataset.theme=t;
  if(typeof LotteryCharts!=='undefined')LotteryCharts.syncTheme();
  try{localStorage.setItem(_THEME_KEY,t);}catch(e){}
  const b=document.getElementById('theme-toggle');
  if(b){b.textContent=(t==='dark')?'☀️':'🌙';b.setAttribute('aria-pressed',String(t==='dark'));}
}
function getTheme(){
  try{const s=localStorage.getItem(_THEME_KEY);if(s==='light'||s==='dark')return s;}catch(e){}
  return document.documentElement.dataset.theme==='dark'?'dark':'light';
}
function toggleTheme(){_applyTheme(getTheme()==='dark'?'light':'dark');}
window.toggleTheme=toggleTheme;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init(){
  _applyTheme(getTheme()); // sync toggle icon to persisted theme (no-FOUC already set attribute)
  // Populate selects
  [['pred-col','ALL'],
  ].forEach(([id,type])=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = type==='ALL' ? ALL_OPTS : NO_P1_OPTS;
  });
  // freq-col ใช้ opts ปกติ + Sanook extra
  const freqEl = document.getElementById('freq-col');
  if(freqEl){ freqEl.innerHTML = ALL_OPTS + SANOOK_FREQ_OPTS; freqEl.value='top3'; }

  if(typeof loadDataStatus==='function')loadDataStatus();

  // Latest draw date in sidebar
  api('summary').then(s=>{
    const d=s.latest?.date||s.date_max||'';
    if(d){
      document.getElementById('sidebar-draw-date-val').textContent=d;
      document.getElementById('sidebar-draw-date').style.display='block';
    }
  });

  // Next draws — generated client-side (Bangkok time, cutoff 16:00)
  const drawOpts = clientDraws().map(d=>`<option value="${d.date}">${d.label}</option>`).join('');
  ['shared-draw-date','pred-date','dc-date','dc-date-old','dash-date','f-target-date'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.innerHTML = drawOpts;
  });
  syncSharedDrawDate(document.getElementById('shared-draw-date')?.value||'');

  // pred-col change wires prize1 section
  const _toggleP1 = () => {
    const predCol = document.getElementById('pred-col');
    const prize1Section = document.getElementById('prize1-section');
    if(!predCol || !prize1Section) return;
    prize1Section.style.display = predCol.value==='prize1'?'block':'none';
  };
  document.getElementById('pred-col')?.addEventListener('change', _toggleP1);
  _toggleP1(); // trigger on init so prize1 section shows on first load

  await loadDashboard();
  renderPageSnapshots('predict');
  renderPageSnapshots('formula');
  restorePageLocation();
}
