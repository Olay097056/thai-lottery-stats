"""Ask the LLM for RLL hypotheses as DATA specs (option 3), validate them, write a JSON set.

The model never writes code: it picks operators, sources, windows and weights from a fixed menu,
and the search harness interprets the JSON. No key is printed; the raw response is stored for audit.

Run: python scripts/generate_rll_hypotheses.py [--rounds 3] [--per-round 40]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
import sys
sys.path.insert(0, str(ROOT))
import rll  # noqa: E402  (for _env_key only)

OUT = ROOT / '.scratch' / 'rll-llm-formula' / 'hypotheses-v3.json'
BASE = os.environ.get('RLL_BASE_URL', 'https://api.commandcode.ai/provider/v1')
MODEL = os.environ.get('RLL_MODEL', 'deepseek/deepseek-v4.1-flash')

SCHEMA = """Each hypothesis is a JSON object:
{"name":"short-slug","k":10,"claim":"one sentence",
 "positions":[[term,term],[term,term],[term,term]],
 "joints":[jterm],"shapes":[shtrm],"sums":[sterm],"structs":[structterm],"exclude":[eterm]}
Per-position term: {"op":"freq|gap|markov|markov2|markov3|weekday","source":"pool|prize1","window":30|60|120,"weight":-3..3}
Joint term:        {"op":"pair01|pair02|pair12","source":"pool|prize1","window":30|60|120,"weight":-3..3}
Shape term:        {"op":"pairsum01|pairsum02|pairsum12|diff01|diff02|diff12|summod","source":"pool|prize1","window":30|60|120,"weight":-3..3}
Digit-sum term:    {"source":"pool|prize1","window":30|60|120,"weight":-3..3}
Structure term:    {"name":"repeat|ascending|even","weight":-3..3}
Exclusion term:    {"draws":1|2|3|5,"weight":-3..3}

How it scores: every one of the 1000 possible 3-digit tails gets a score, and the top k are the tickets.
- positions[p] adds weight * feature(digit at position p); markov2/markov3 look 2 or 3 draws back
- joints adds weight * P(exact digit pair) — 100 cells, needs a lot of data
- shapes adds weight * P(pair SUM a+b = 0..18) or P(pair DIFFERENCE mod 10) — only 19/10 cells, much
  better sampled than an exact pair table
- sums adds weight * P(digit sum a+b+c); summod is the same mod 10
- structs adds weight * (0..3 pairwise-equal digits), (1 if ascending), (0..3 even digits) — no history,
  it describes the tail's own shape
- exclude subtracts weight from tails that appeared in the pool of the last `draws` draws
- freq = digit frequency at that position; gap = draws since it last appeared; weekday = freq on the
  target's weekday only; pool = all ~62 prize 1-4 tails of a draw; prize1 = the first prize only
- features come from PRIOR draws only; there is no way to see the target, do not try
- limits: 3 joints, 3 shapes, 2 sums, 2 structs, 2 exclude; leaving a list out means "none"
"""

ROUND_PROMPTS = [
    ("shape", "Give 40 hypotheses that use SHAPE terms: pairsum01/02/12 (pair sums), diff01/02/12 (pair "
              "differences mod 10) or summod, alone or with one joint term. These tables are small, so "
              "they are better sampled than exact pairs — vary source, window and sign."),
    ("struct", "Give 40 hypotheses that use STRUCTURE terms (repeat, ascending, even) alone or combined "
               "with one shape or per-position term. Include the pure-structure controls and negative "
               "weights, plus a few that combine structure with a lag term."),
    ("lag", "Give 40 hypotheses built on LAGGED markov (markov2, markov3) and broader exclusion "
            "(draws 3 and 5), combined with a shape term. Vary window and sign; include a few "
            "pure-lag controls."),
]


def call(prompt, max_tokens=16000):
    key = rll._env_key()
    if not key:
        raise SystemExit('COMMANDCODE_API_KEY missing')
    body = {'model': MODEL, 'messages': [
        {'role': 'system', 'content': 'You output JSON only, no prose.'},
        {'role': 'user', 'content': prompt}],
        'temperature': 0.9, 'max_tokens': max_tokens}
    response = httpx.post(f'{BASE}/chat/completions',
                          headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
                          json=body, timeout=httpx.Timeout(120.0, connect=10.0))
    if response.status_code != 200:
        raise SystemExit(f'provider HTTP {response.status_code}: {response.text[:200]}')
    payload = response.json()
    content = (payload.get('choices') or [{}])[0].get('message', {}).get('content') or ''
    return content, payload.get('usage') or {}, response.text


def extract_json(text):
    text = re.sub(r'^```[a-zA-Z]*\s*', '', text.strip())
    text = re.sub(r'\s*```$', '', text)
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    if start < 0:
        raise ValueError('no JSON')
    return json.loads(text[start:])


def salvage_objects(text):
    """Recover every complete object of the hypothesis array when the array is truncated."""
    marker = text.find('"hypotheses"')
    body = text[text.find('[', marker):] if marker >= 0 else text
    out, depth, start = [], 0, None
    for index, char in enumerate(body):
        if char == '{':
            if depth == 0:
                start = index
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0 and start is not None:
                out.append(body[start:index + 1])
                start = None
    items = []
    for chunk in out:
        try:
            items.append(json.loads(chunk))
        except json.JSONDecodeError:
            continue
    return items


def validate(items):
    good, dropped = [], []
    for item in items:
        try:
            name = str(item['name']).strip()[:60]
            positions = item.get('positions') or []
            if not name or (positions and len(positions) != 3):
                raise ValueError('shape')
            if not positions:
                # a pure joint / sum / exclude hypothesis legitimately has no per-position terms
                positions = [[], [], []]
            clean = []
            for terms in positions:
                kept = []
                for term in terms:
                    if term.get('op') not in ('freq', 'gap', 'markov', 'markov2', 'markov3', 'weekday'):
                        continue
                    if term.get('source') not in ('pool', 'prize1'):
                        continue
                    window = int(term.get('window', 60))
                    if window not in (30, 60, 120):
                        window = 60
                    weight = float(term.get('weight', 0))
                    if weight == 0 or abs(weight) > 3:
                        continue
                    kept.append({'op': term['op'], 'source': term['source'],
                                 'window': window, 'weight': round(weight, 3)})
                clean.append(kept)
            joints = []
            for term in (item.get('joints') or [])[:3]:
                if term.get('op') not in ('pair01', 'pair02', 'pair12'):
                    continue
                if term.get('source') not in ('pool', 'prize1'):
                    continue
                weight = float(term.get('weight', 0))
                if weight == 0 or abs(weight) > 3:
                    continue
                window = int(term.get('window', 60))
                joints.append({'op': term['op'], 'source': term['source'],
                               'window': window if window in (30, 60, 120) else 60,
                               'weight': round(weight, 3)})
            shapes = []
            for term in (item.get('shapes') or [])[:3]:
                if term.get('op') not in ('pairsum01', 'pairsum02', 'pairsum12',
                                          'diff01', 'diff02', 'diff12', 'summod'):
                    continue
                if term.get('source') not in ('pool', 'prize1'):
                    continue
                weight = float(term.get('weight', 0))
                if weight == 0 or abs(weight) > 3:
                    continue
                window = int(term.get('window', 60))
                shapes.append({'op': term['op'], 'source': term['source'],
                               'window': window if window in (30, 60, 120) else 60,
                               'weight': round(weight, 3)})
            structs = []
            for term in (item.get('structs') or [])[:2]:
                if term.get('name') not in ('repeat', 'ascending', 'even'):
                    continue
                weight = float(term.get('weight', 0))
                if weight == 0 or abs(weight) > 3:
                    continue
                structs.append({'name': term['name'], 'weight': round(weight, 3)})
            sums = []
            for term in (item.get('sums') or [])[:2]:
                if term.get('source') not in ('pool', 'prize1'):
                    continue
                weight = float(term.get('weight', 0))
                if weight == 0 or abs(weight) > 3:
                    continue
                window = int(term.get('window', 60))
                sums.append({'source': term['source'], 'window': window if window in (30, 60, 120) else 60,
                             'weight': round(weight, 3)})
            exclude = []
            for term in (item.get('exclude') or [])[:2]:
                draws = int(term.get('draws', 1))
                if draws not in (1, 2, 3):
                    draws = 1
                weight = float(term.get('weight', 0))
                if weight == 0 or abs(weight) > 3:
                    continue
                exclude.append({'draws': draws, 'weight': round(weight, 3)})
            if not any(clean) and not joints and not shapes and not sums and not structs and not exclude:
                raise ValueError('all weights zero')
            good.append({'name': name, 'k': 10, 'claim': str(item.get('claim', ''))[:220],
                         'positions': clean, 'joints': joints, 'shapes': shapes,
                         'sums': sums, 'structs': structs, 'exclude': exclude})
        except (KeyError, TypeError, ValueError) as exc:
            dropped.append({'reason': str(exc), 'item': str(item)[:120]})
    return good, dropped


def spec_key(hyp):
    return json.dumps({k: hyp.get(k) for k in ('positions', 'joints', 'shapes', 'sums', 'structs', 'exclude')},
                      sort_keys=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-round', type=int, default=40)
    ap.add_argument('--out', default=str(OUT))
    args = ap.parse_args()
    out = Path(args.out)
    hypotheses, runs = [], []
    seen = set()
    if out.exists():
        try:
            prior = json.loads(out.read_text(encoding='utf-8'))
            hypotheses = prior.get('hypotheses', [])
            seen = {spec_key(h) for h in hypotheses}
            runs = prior.get('runs', [])
            print(f'merged {len(hypotheses)} hypotheses from the previous run')
        except (OSError, json.JSONDecodeError):
            pass
    for slug, instruction in ROUND_PROMPTS:
        prompt = (
            'You are designing rule-based lottery hypotheses for a research harness. The target field '
            'is the LAST THREE DIGITS of the prize 1-4 pool of a Thai lottery draw: about 62 distinct '
            'three-digit strings out of 1000, so a random set of 10 candidates hits about 47.5% of draws.\n\n'
            + SCHEMA +
            f'\n{instruction}\n'
            f'Output a JSON object {{"hypotheses":[...]}} with exactly {args.per_round} entries. '
            'Names must be unique and descriptive (e.g. "hot60-all-positions").'
        )
        content, usage, raw = call(prompt)
        try:
            payload = extract_json(content)
            items = payload.get('hypotheses', payload) if isinstance(payload, dict) else payload
            if not isinstance(items, list):
                raise ValueError('not a list')
        except (ValueError, json.JSONDecodeError):
            items = salvage_objects(content)
            runs.append({'round': slug, 'salvaged': True, 'usage': usage,
                         'raw_sha256': hashlib.sha256(raw.encode()).hexdigest()})
        good, dropped = validate(items)
        fresh = []
        for hyp in good:
            key = spec_key(hyp)
            if key in seen:
                continue
            seen.add(key)
            hypotheses.append(hyp)
            fresh.append(hyp['name'])
        runs.append({'round': slug, 'returned': len(items), 'valid': len(good),
                     'unique_new': len(fresh), 'dropped': dropped[:3],
                     'usage': usage, 'raw_sha256': hashlib.sha256(raw.encode()).hexdigest()})
        print(f'{slug}: returned={len(items)} valid={len(good)} new={len(fresh)} '
              f'tokens={(usage or {}).get("total_tokens")}')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'generated_at': datetime.now().isoformat(timespec='seconds'),
                               'model': MODEL, 'protocol': 'hs-v3',
                               'runs': runs, 'hypotheses': hypotheses},
                              ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'hypotheses={len(hypotheses)} -> {out}')


if __name__ == '__main__':
    main()
