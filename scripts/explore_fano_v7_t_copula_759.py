"""Stage 65: prior-only Student-t copula with Fano slate decoding."""
from __future__ import annotations

from datetime import datetime
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
import numpy as np

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
DEGREES_OF_FREEDOM = 4.0
HALF_LIFE = 180.0
CORRELATION_SHRINKAGE = 0.65
MIN_RESIDUALS_FOR_COPULA = 24
def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("Draw history is not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("First-prize values must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Dataset fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _marginals(counts, prior_draws):
    denominator = prior_draws + 10.0
    return (counts + 1.0) / denominator


def _student_t_quantile(probability):
    probability = min(1.0 - 1e-9, max(1e-9, float(probability)))
    if probability == 0.5:
        return 0.0
    low, high = -1.0, 1.0
    for _ in range(60):
        middle = (low + high) / 2.0
        cdf = 0.5 + 0.75 * (middle - middle ** 3 / 3.0)
        if cdf < probability:
            low = middle
        else:
            high = middle
    ratio = (low + high) / 2.0
    return math.sqrt(DEGREES_OF_FREEDOM) * ratio / math.sqrt(1.0 - ratio * ratio)


def _pit(probabilities, digits):
    values = []
    for position, digit in enumerate(digits):
        row = probabilities[position]
        lower_mass = float(np.sum(row[:digit]))
        values.append(min(1.0 - 1e-9, max(1e-9, lower_mass + 0.5 * row[digit])))
    return values


def _correlation(residuals, target_index):
    identity = np.eye(6, dtype=np.float64)
    if len(residuals) < MIN_RESIDUALS_FOR_COPULA:
        return identity
    matrix = np.asarray(residuals, dtype=np.float64)
    ages = target_index - np.arange(len(matrix), dtype=np.float64)
    weights = np.exp2(-ages / HALF_LIFE)
    total = float(weights.sum())
    means = np.einsum("n,np->p", weights, matrix, optimize=True) / total
    centered = matrix - means
    covariance = np.einsum("n,ni,nj->ij", weights, centered, centered, optimize=True) / total
    variances = np.maximum(np.diag(covariance), 1e-12)
    scales = np.sqrt(variances)
    raw = covariance / np.outer(scales, scales)
    result = identity.copy()
    for i in range(6):
        for j in range(i):
            value = (1.0 - CORRELATION_SHRINKAGE) * float(np.clip(raw[i, j], -0.95, 0.95))
            result[i, j] = result[j, i] = value
    return result


def _cholesky(matrix):
    lower = np.zeros((6, 6), dtype=np.float64)
    for i in range(6):
        for j in range(i + 1):
            value = matrix[i, j] - float(lower[i, :j] @ lower[j, :j])
            if i == j:
                if value <= 1e-12:
                    raise RuntimeError("Shrunk Student-t copula correlation is not positive definite")
                lower[i, j] = math.sqrt(value)
            else:
                lower[i, j] = value / lower[j, j]
    return lower


def _t_copula_log_density(values, lower):
    whitened = np.empty(6, dtype=np.float64)
    for i in range(6):
        whitened[i] = (values[i] - float(lower[i, :i] @ whitened[:i])) / lower[i, i]
    log_det = 2.0 * sum(math.log(float(lower[i, i])) for i in range(6))
    quadratic = float(whitened @ whitened)
    nu = DEGREES_OF_FREEDOM
    dimensions = 6.0
    log_multivariate = (
        math.lgamma((nu + dimensions) / 2.0) - math.lgamma(nu / 2.0)
        - dimensions / 2.0 * math.log(nu * math.pi) - 0.5 * log_det
        - (nu + dimensions) / 2.0 * math.log1p(quadratic / nu))
    log_univariate_total = sum(
        math.lgamma((nu + 1.0) / 2.0) - math.lgamma(nu / 2.0)
        - 0.5 * math.log(nu * math.pi)
        - (nu + 1.0) / 2.0 * math.log1p(float(value * value) / nu)
        for value in values)
    return log_multivariate - log_univariate_total


def _ticket_log_score(number, probabilities, t_quantiles, lower):
    digits = [ord(char) - 48 for char in number]
    values = np.asarray([t_quantiles[pos][digit] for pos, digit in enumerate(digits)],
                        dtype=np.float64)
    marginal = sum(math.log(float(probabilities[pos, digit]))
                   for pos, digit in enumerate(digits))
    return marginal + _t_copula_log_density(values, lower)


def _fano_slate(probabilities, lower):
    top_digits = [sorted(range(10), key=lambda digit: (-probabilities[pos, digit], digit))[:2]
                  for pos in range(6)]
    t_quantiles = []
    for position in range(6):
        values = []
        for digit in range(10):
            lower_mass = float(np.sum(probabilities[position, :digit]))
            pit_value = lower_mass + 0.5 * float(probabilities[position, digit])
            values.append(_student_t_quantile(pit_value))
        t_quantiles.append(values)

    choices = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        tickets = []
        for point in range(7):
            digits = [top_digits[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(retained_lines)]
            ticket = "".join(str(digit) for digit in digits)
            tickets.append((ticket, _ticket_log_score(ticket, probabilities,
                                                       t_quantiles, lower)))
        if len({ticket for ticket, _ in tickets}) != 7:
            raise RuntimeError("Fano point codewords were not distinct")
        selected = sorted(tickets, key=lambda item: (-item[1], item[0]))[:TICKET_COUNT]
        maximum = max(score for _, score in selected)
        slate_log_mass = maximum + math.log(sum(math.exp(score - maximum)
                                                for _, score in selected))
        choices.append((slate_log_mass, puncture, selected))
    _, puncture, selected = max(choices, key=lambda item: (item[0], -item[1]))
    candidates = [number for number, _ in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("Fano Student-t slate needs five unique candidates")
    return candidates, puncture + 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    counts = np.zeros((6, 10), dtype=np.float64)
    residuals = []
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        probabilities = _marginals(counts, target_index)
        correlation = _correlation(residuals, target_index)
        lower = _cholesky(correlation)
        candidates, puncture = _fano_slate(probabilities, lower)
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        actual_digits = [ord(char) - 48 for char in actual]
        loss_sum += -sum(math.log(float(probabilities[pos, digit]))
                         for pos, digit in enumerate(actual_digits))
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": candidates,
            "hit": hit,
            "punctured_line": puncture,
            "copula_residual_count": len(residuals),
            "digit_probabilities": np.round(probabilities, 12).tolist(),
        })

        # PIT ranks and digit counts enter only after the current slate is scored.
        pit_values = _pit(probabilities, actual_digits)
        residuals.append([_student_t_quantile(value) for value in pit_values])
        for position, digit in enumerate(actual_digits):
            counts[position, digit] += 1.0
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count audit failed")
    if [row["target_date"] for row in forecasts] != [day.isoformat() for day, _ in dated]:
        raise RuntimeError("Forecast chronology audit failed")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior-count audit failed")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hit count differs from candidate lists")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           for row in forecasts):
        raise RuntimeError("Five-distinct-candidates audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "marginals, PIT residuals, and copula correlation use only earlier draws; each actual is assimilated after forecast scoring",
        "model_family": "prequential Student-t rank-copula dependence over six digit positions with punctured Fano decoding",
        "degrees_of_freedom": DEGREES_OF_FREEDOM,
        "copula_half_life_draws": HALF_LIFE,
        "correlation_shrinkage": CORRELATION_SHRINKAGE,
        "minimum_prior_residuals": MIN_RESIDUALS_FOR_COPULA,
        "fano_decoder": "rank seven codewords per punctured Fano codebook by Student-t-copula-adjusted score and return the top five from the best codebook",
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_marginal_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation only; model family was chosen after prior-stage results and is not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-65-student-t-copula.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates,
                      "mean_marginal_log_loss": report["v7"]["mean_marginal_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "minimum_hits": 10, "met": hits >= 10,
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
