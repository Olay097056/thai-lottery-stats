"""Stage 52: shrinkage model of Fano-line three-position interactions.

Unlike the earlier raw pairwise MRF or Gaussian rank copula, this model uses
the four three-coordinate hyperedges induced by each punctured Fano incidence
code. Smoothed empirical triple distributions are divided by their independent
marginal products to isolate prior-only interaction factors. Five high-scoring
codewords form each walk-forward slate.
"""
from __future__ import annotations

from datetime import datetime
from itertools import combinations
import hashlib
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
TRIPLE_PRIOR_STRENGTH = 1000.0
INTERACTION_STRENGTH = 0.5
TRIPLES = tuple(combinations(range(6), 3))


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid prize1 draws, got {len(dated)}")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Dataset fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _fano_factor_sets():
    """Map Fano concurrency triples to six ticket positions for each puncture."""
    factors_by_puncture = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        line_position = {line: pos for pos, line in enumerate(retained_lines)}
        factors = []
        for point in range(7):
            if point in fano.FANO_LINES[puncture]:
                continue
            positions = tuple(sorted(line_position[line]
                                     for line in retained_lines
                                     if point in fano.FANO_LINES[line]))
            if len(positions) != 3:
                raise RuntimeError("A non-punctured Fano point must define one triple")
            factors.append(positions)
        if len(factors) != 4:
            raise RuntimeError("Each puncture must leave four complete Fano triples")
        factors_by_puncture.append(tuple(factors))
    return factors_by_puncture


def _marginals(position_counts, prior_draws):
    denominator = prior_draws + 10.0
    return [[(position_counts[pos][digit] + 1.0) / denominator for digit in range(10)]
            for pos in range(6)]


def _triple_log_factor(positions, digits, probabilities, triple_counts, prior_draws):
    a, b, c = positions
    da, db, dc = digits[a], digits[b], digits[c]
    pa, pb, pc = probabilities[a][da], probabilities[b][db], probabilities[c][dc]
    independent = pa * pb * pc
    cell = da * 100 + db * 10 + dc
    smoothed_joint = (triple_counts[positions][cell]
                      + TRIPLE_PRIOR_STRENGTH * independent)
    smoothed_joint /= prior_draws + TRIPLE_PRIOR_STRENGTH
    return math.log(smoothed_joint) - math.log(pa) - math.log(pb) - math.log(pc)


def _ticket_score(digits, probabilities, triple_counts, prior_draws, factors):
    score = sum(math.log(probabilities[pos][digit]) for pos, digit in enumerate(digits))
    interaction = sum(_triple_log_factor(factor, digits, probabilities,
                                         triple_counts, prior_draws)
                      for factor in factors)
    return score + INTERACTION_STRENGTH * interaction


def _decode_fano(probabilities, triple_counts, prior_draws, factors_by_puncture):
    top_digits = [sorted(range(10), key=lambda d: (-probabilities[pos][d], d))[:2]
                  for pos in range(6)]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        codewords = []
        for point in range(7):
            digits = [top_digits[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(retained_lines)]
            number = "".join(str(digit) for digit in digits)
            codewords.append((number, digits, _ticket_score(
                digits, probabilities, triple_counts, prior_draws,
                factors_by_puncture[puncture])))
        if len({row[0] for row in codewords}) != 7:
            raise RuntimeError("Fano incidence codewords must be distinct")
        selected = sorted(codewords, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        max_score = max(row[2] for row in selected)
        portfolio_score = max_score + math.log(sum(math.exp(row[2] - max_score)
                                                    for row in selected))
        choice = (portfolio_score, -puncture, selected)
        if best is None or choice[:2] > best[:2]:
            best = choice
    _, neg_puncture, selected = best
    numbers = [row[0] for row in selected]
    if len(numbers) != TICKET_COUNT or len(set(numbers)) != TICKET_COUNT:
        raise RuntimeError("Fano triple decoder must return five distinct candidates")
    return numbers, -neg_puncture + 1, [round(row[2], 8) for row in selected]


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    factors_by_puncture = _fano_factor_sets()
    position_counts = [[0] * 10 for _ in range(6)]
    triple_counts = {triple: [0] * 1000 for triple in TRIPLES}
    hits = 0
    hit_dates = []
    forecasts = []

    for target_index, (target_date, actual) in enumerate(dated):
        probabilities = _marginals(position_counts, target_index)
        candidates, puncture, scores = _decode_fano(
            probabilities, triple_counts, target_index, factors_by_puncture)
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": candidates,
            "hit": hit,
            "punctured_line": puncture,
            "candidate_joint_scores": scores,
            "prior_triple_observations": target_index,
        })

        # Only after scoring the target do its digits update marginals and triples.
        digits = [ord(char) - 48 for char in actual]
        for pos, digit in enumerate(digits):
            position_counts[pos][digit] += 1
        for triple in TRIPLES:
            a, b, c = triple
            triple_counts[triple][digits[a] * 100 + digits[b] * 10 + digits[c]] += 1
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT or [r["prior_valid_draws"] for r in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Forecast chronology audit failed")
    if recomputed_hits != hits or any(len(r["candidates"]) != TICKET_COUNT
                                      or len(set(r["candidates"])) != TICKET_COUNT
                                      for r in forecasts):
        raise RuntimeError("Forecast candidates or recomputed hit count failed audit")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 draws; exactly five distinct candidates per draw",
        "walk_forward": "positional marginals and smoothed Fano-line triple interactions use only earlier results; current target is appended after scoring",
        "model_family": "Fano-plane hypergraph log-linear score with four prior-only three-position interaction factors per punctured codebook",
        "fano_factor_sets_by_puncture": [[[p + 1 for p in factor] for factor in factors]
                                          for factors in factors_by_puncture],
        "triple_prior_strength": TRIPLE_PRIOR_STRENGTH,
        "interaction_strength": INTERACTION_STRENGTH,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates, "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True, "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation; the geometric interaction was proposed after reviewing earlier results, so this is not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-52-fano-triple-interactions.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates, "minimum_hits": 10, "met": hits >= 10,
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
