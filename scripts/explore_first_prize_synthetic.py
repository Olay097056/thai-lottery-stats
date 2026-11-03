"""Fixed synthetic walk-forward controls, never reads lottery history."""
import json
import math
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import astra

SEED=int(sys.argv[1]) if len(sys.argv)>1 else 20261014
rng=np.random.default_rng(SEED)
report={'kind':'synthetic_only','seed':SEED,'protocol':'three predeclared scenarios; 40 warmup + 160 evaluated draws; k=5; unchanged Astra v1','scenarios':[]}
for scenario in ('iid_uniform','stationary_position_bias','serial_copy_signal'):
    rows=[]
    for i in range(200):
        digits=rng.integers(0,10,6)
        if scenario=='stationary_position_bias':
            for j in range(6):
                if rng.random()<0.45: digits[j]=j
        if scenario=='serial_copy_signal' and rows:
            for j in range(6):
                if rng.random()<0.7: digits[j]=int(rows[-1][j])
        rows.append(''.join(map(str,digits)))
    losses=[];hits=0;mass=[];matched=[]
    for i in range(40,len(rows)):
        valid=[(age,(n,)) for age,n in enumerate(reversed(rows[max(0,i-200):i]))]
        model=astra._build_model(valid,6)
        forward=list(model['q'][0])
        for j in range(1,6):
            forward=[sum(forward[a]*math.sqrt(model['q'][j][b]*model['t'][j-1][a][b]) for a in range(10)) for b in range(10)]
        logz=math.log(sum(forward))
        def score(number):
            d=list(map(int,number))
            return math.log(model['q'][0][d[0]])+sum(.5*math.log(model['q'][j][d[j]])+.5*math.log(model['t'][j-1][d[j-1]][d[j]]) for j in range(1,6))
        top=[n for n,_ in astra._top_k(model,5)]
        losses.append(logz-score(rows[i]))
        hits+=rows[i] in top
        mass.append(sum(math.exp(score(n)-logz) for n in top))
        matched.append(max(sum(a==b for a,b in zip(n,rows[i])) for n in top))
    delta=math.log(1000000)-np.array(losses)
    boot=np.mean(rng.choice(delta,size=(2000,len(delta)),replace=True),axis=1)
    result={'scenario':scenario,'evaluated_draws':len(losses),'exact_hits':hits,'uniform_expected_hits':len(losses)*5/1000000,'mean_log_loss':float(np.mean(losses)),'posthoc_fixed_uniform_mixture_alpha_0_25_log_loss':float(np.mean(-np.log(.25*np.exp(-np.array(losses))+.75/1000000))),'uniform_log_loss':math.log(1000000),'improvement_in_log_loss':float(np.mean(delta)),'exploratory_bootstrap_95_percent':list(map(float,np.quantile(boot,[.025,.975]))),'mean_model_top5_mass':float(np.mean(mass)),'mean_best_matching_positions':float(np.mean(matched)),'caution':'synthetic controls only; bootstrap assumes independent draws and is not valid confirmatory evidence for serial scenario'}
    report['scenarios'].append(result)
    print(json.dumps(result),flush=True)
output=Path('.scratch/first-prize-backtest')
output.mkdir(parents=True,exist_ok=True)
(output/f'synthetic-results-{SEED}.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
