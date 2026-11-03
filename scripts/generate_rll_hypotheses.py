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

OUT = ROOT / '.scratch' / 'rll-llm-formula' / 'hypotheses.json'
BASE = os.environ.get('RLL_BASE_URL', 'https://api.commandcode.ai/provider/v1')
MODEL = os.environ.get('RLL_MODEL', 'deepseek/deepseek-v4.1-flash')

SCHEMA = """Each hypothesis is a JSON object:
{"name":"short-slug","k":10,"claim":"one sentence",
 "positions":[[term,term],[term,term],[term,term]]}
A term is {"op":"freq|gap|markov|weekday","source":"pool|prize1","window":30|60|120,"weight":-3..3}
- positions has exactly 3 lists (tail position 0,1,2)
- the score for digit d at position p = sum(weight * feature)
- higher score = more preferred digit; the top digits are assembled round-robin into 10 distinct
  three-digit candidates
- features are computed from PRIOR draws only. There is no way to see the target; do not try.
- freq = how often the digit appears in that position (pool = all 66 prize 1-4 numbers of a draw)
- gap = how many draws since it last appeared there
- markov = P(digit | previous draw's digit in that position), from prize-1 tails
- weekday = freq restricted to draws on the target's weekday
"""

ROUND_PROMPTS = [
    ("purist", "Give 40 SINGLE-FEATURE hypotheses: each position uses ONE term (optionally the same "
               "term at all three positions, or one term per position). Vary op/source/window/weight."),
    ("blend", "Give 40 BLENDED hypotheses: 2-4 terms per position mixing freq and gap, or freq and "
              "markov, with explicit weights. Some should use window 30, some 60, some 120."),
    ("contrarian", "Give 40 CONTRARIAN hypotheses: negative weights (pick the cold/rare digit), "
                   "weekday-scoped features, and markov on prize1 tails. Include a few that mix a "
                   "positive freq term with a negative gap term."),
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
            positions = item['positions']
            if not name or len(positions) != 3:
                raise ValueError('shape')
            clean = []
            for terms in positions:
                kept = []
                for term in terms:
                    if term.get('op') not in ('freq', 'gap', 'markov', 'weekday'):
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
            if not any(clean):
                raise ValueError('all weights zero')
            good.append({'name': name, 'k': 10, 'claim': str(item.get('claim', ''))[:220],
                         'positions': clean})
        except (KeyError, TypeError, ValueError) as exc:
            dropped.append({'reason': str(exc), 'item': str(item)[:120]})
    return good, dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-round', type=int, default=40)
    args = ap.parse_args()
    hypotheses, runs = [], []
    seen = set()
    if OUT.exists():
        try:
            prior = json.loads(OUT.read_text(encoding='utf-8'))
            hypotheses = prior.get('hypotheses', [])
            seen = {json.dumps(h['positions'], sort_keys=True) for h in hypotheses}
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
            key = json.dumps(hyp['positions'], sort_keys=True)
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
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'generated_at': datetime.now().isoformat(timespec='seconds'),
                               'model': MODEL, 'runs': runs, 'hypotheses': hypotheses},
                              ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'hypotheses={len(hypotheses)} -> {OUT}')


if __name__ == '__main__':
    main()
