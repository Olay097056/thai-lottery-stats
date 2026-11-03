"""Stage 51: prior-only rank-copula dependence with a Fano codebook.

Hypothesis: after each digit position is transformed to its prequential
probability-integral rank, stable cross-position dependence may remain even
when raw positional frequencies are weak. A shrunk Gaussian copula models that
dependence; a punctured Fano-plane codebook selects five high-scoring tickets.
All PIT residuals, marginals, and copula parameters use only earlier draws.
"""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from statistics import NormalDist

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
HALF_LIFE = 180.0
CORRELATION_SHRINKAGE = 0.65
MIN_RESIDUALS_FOR_COPULA = 24
NORMAL = NormalDist()


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


def _marginals(counts, prior_draws):
    denominator = prior_draws + 10.0
    return [[(counts[position][digit] + 1.0) / denominator for digit in range(10)]
            for position in range(6)]


def _rank_score_transform(probabilities, digits):
    residual = []
    for position, digit in enumerate(digits):
        row = probabilities[position]
        lower_mass = sum(row[:digit])
        u = min(1.0 - 1e-9, max(1e-9, lower_mass + 0.5 * row[digit]))
        residual.append(NORMAL.inv_cdf(u))
    return residual


def _correlation(residuals, target_index):
    identity = [[float(i == j) for j in range(6)] for i in range(6)]
    if len(residuals) < MIN_RESIDUALS_FOR_COPULA:
        return identity
    weights = [2.0 ** (-(target_index - index) / HALF_LIFE)
               for index in range(len(residuals))]
    total = sum(weights)
    means = [sum(weight * row[pos] for weight, row in zip(weights, residuals)) / total
             for pos in range(6)]
    covariance = [[0.0] * 6 for _ in range(6)]
    for i in range(6):
        for j in range(6):
            covariance[i][j] = sum(
                weight * (row[i] - means[i]) * (row[j] - means[j])
                for weight, row in zip(weights, residuals)
            ) / total
    variances = [max(covariance[i][i], 1e-12) for i in range(6)]
    result = [[float(i == j) for j in range(6)] for i in range(6)]
    for i in range(6):
        for j in range(i):
            raw = covariance[i][j] / math.sqrt(variances[i] * variances[j])
            value = (1.0 - CORRELATION_SHRINKAGE) * max(-0.95, min(0.95, raw))
            result[i][j] = result[j][i] = value
    return result


def _cholesky(matrix):
    lower = [[0.0] * 6 for _ in range(6)]
    for i in range(6):
        for j in range(i + 1):
            value = matrix[i][j] - sum(lower[i][k] * lower[j][k] for k in range(j))
            if i == j:
                if value <= 1e-12:
                    raise RuntimeError("Shrunk copula correlation is not positive definite")
                lower[i][j] = math.sqrt(value)
            else:
                lower[i][j] = value / lower[j][j]
    return lower


def _copula_log_density(z, lower):
    whitened = []
    for i in range(6):
        whitened.append((z[i] - sum(lower[i][j] * whitened[j] for j in range(i))) / lower[i][i])
    log_determinant = 2.0 * sum(math.log(lower[i][i]) for i in range(6))
    quadratic_delta = sum(value * value for value in whitened) - sum(value * value for value in z)
    return -0.5 * log_determinant - 0.5 * quadratic_delta


def _ticket_log_score(number, probabilities, lower):
    digits = [ord(char) - 48 for char in number]
    z = _rank_score_transform(probabilities, digits)
    marginal_log_probability = sum(math.log(probabilities[pos][digit])
                                   for pos, digit in enumerate(digits))
    return marginal_log_probability + _copula_log_density(z, lower)


def _fano_slate(probabilities, lower):
    top_digits = [sorted(range(10), key=lambda d: (-probabilities[pos][d], d))[:2]
                  for pos in range(6)]
    choices = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        tickets = []
        for point in range(7):
            digits = [top_digits[position][int(point in fano.FANO_LINES[line])]
                      for position, line in enumerate(retained_lines)]
            ticket = "".join(str(digit) for digit in digits)
            tickets.append((ticket, _ticket_log_score(ticket, probabilities, lower)))
        if len({ticket for ticket, _ in tickets}) != 7:
            raise RuntimeError("Fano point codewords were not distinct")
        slate = sorted(tickets, key=lambda item: (-item[1], item[0]))[:TICKET_COUNT]
        maximum = max(score for _, score in slate)
        log_mass = maximum + math.log(sum(math.exp(score - maximum) for _, score in slate))
        choices.append((log_mass, puncture, slate))
    _, puncture, selected = max(choices, key=lambda item: (item[0], -item[1]))
    numbers = [ticket for ticket, _ in selected]
    if len(numbers) != TICKET_COUNT or len(set(numbers)) != TICKET_COUNT:
        raise RuntimeError("Fano copula decoder must return five distinct tickets")
    return numbers, puncture + 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    counts = [[0] * 10 for _ in range(6)]
    residuals = []
    hits = 0
    hit_dates = []
    forecasts = []

    for target_index, (target_date, actual) in enumerate(dated):
        probabilities = _marginals(counts, target_index)
        correlation = _correlation(residuals, target_index)
        lower = _cholesky(correlation)
        candidates, puncture = _fano_slate(probabilities, lower)
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
            "copula_residual_count": len(residuals),
            "correlation_shrinkage": CORRELATION_SHRINKAGE,
        })

        # Current result enters PIT residual history only after scoring its target.
        actual_digits = [ord(char) - 48 for char in actual]
        residuals.append(_rank_score_transform(probabilities, actual_digits))
        for position, digit in enumerate(actual_digits):
            counts[position][digit] += 1
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT or [r["prior_valid_draws"] for r in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Forecast chronology audit failed")
    if recomputed_hits != hits or any(len(r["candidates"]) != TICKET_COUNT
                                      or len(set(r["candidates"])) != TICKET_COUNT
                                      for r in forecasts):
        raise RuntimeError("Forecast candidate or hit-count audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 draws; exactly five distinct candidates per draw",
        "walk_forward": "positional Dirichlet marginals and all PIT copula residuals use only prior draws; each actual is appended after its candidates are scored",
        "model_family": "prequential Gaussian rank-copula dependence over six positions with a punctured Fano incidence codebook",
        "copula_half_life_draws": HALF_LIFE,
        "copula_correlation_shrinkage": CORRELATION_SHRINKAGE,
        "minimum_prior_residuals": MIN_RESIDUALS_FOR_COPULA,
        "fano_decoder": "for each punctured Fano codebook, rank the seven point codewords by copula-adjusted joint score; return the five highest-scoring codewords from the best codebook",
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates, "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True, "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation; candidate family was created after inspecting prior stage results, so this is not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-51-rank-copula.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates, "minimum_hits": 10,
                      "met": hits >= 10, "data_fingerprint": fingerprint,
                      "result_file": str(output), "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
