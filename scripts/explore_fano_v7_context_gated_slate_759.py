"""Stage 61: context-gated expert slate voting with prior-only outcomes."""
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

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
EXPERT_STAGES = (1, 4, 5, 6, 7, 8, 9, 10, 12, 13, 16, 17, 19, 20,
                 25, 26, 27, 31, 36, 39, 41, 46, 47, 49, 51, 52, 53,
                 55, 56, 57, 58, 59, 60)
KERNEL_BANDWIDTH = 0.25
BETA_PRIOR_STRENGTH = 20.0
UNIFORM_SLATE_RATE = TICKET_COUNT / 1_000_000
PRIOR_ALPHA = BETA_PRIOR_STRENGTH * UNIFORM_SLATE_RATE
PRIOR_BETA = BETA_PRIOR_STRENGTH - PRIOR_ALPHA


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


def _context_features(number):
    digits = [ord(char) - 48 for char in number]
    return [sum(digits) / 54.0,
            sum(digit % 2 for digit in digits) / 6.0,
            len(set(digits)) / 6.0,
            sum(digits[i] == digits[i - 1] for i in range(1, 6)) / 5.0,
            float(digits[0] == digits[-1])]


def _load_experts(dated):
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    expected_dates = [day.isoformat() for day, _ in dated]
    expected_actuals = [number for _, number in dated]
    experts = []
    for stage in EXPERT_STAGES:
        paths = list(folder.glob(f"results-2026-10-15-stage-{stage}-*.json"))
        if len(paths) != 1:
            raise RuntimeError(f"Expected one source report for Stage {stage}, found {len(paths)}")
        path = paths[0]
        report = json.loads(path.read_text(encoding="utf-8"))
        if report.get("actuals_sha256") != EXPECTED_FINGERPRINT:
            raise RuntimeError(f"Fingerprint mismatch in {path.name}")
        forecasts = report.get("v7", {}).get("forecasts")
        if not isinstance(forecasts, list) or len(forecasts) != DRAW_COUNT:
            raise RuntimeError(f"Invalid forecast count in {path.name}")
        hit_vector = []
        for index, row in enumerate(forecasts):
            candidates = row.get("candidates")
            if (row.get("target_date") != expected_dates[index]
                    or row.get("actual") != expected_actuals[index]
                    or row.get("prior_valid_draws", row.get("prior_draws")) != index
                    or not isinstance(candidates, list) or len(candidates) != TICKET_COUNT
                    or len(set(candidates)) != TICKET_COUNT
                    or any(not isinstance(value, str) or len(value) != 6
                           or not value.isascii() or not value.isdigit()
                           for value in candidates)):
                raise RuntimeError(f"Invalid prior-only slate in {path.name} at draw {index}")
            hit_vector.append(expected_actuals[index] in candidates)
        if sum(hit_vector) != report["v7"].get("hits"):
            raise RuntimeError(f"Source hit total mismatch in {path.name}")
        experts.append({"stage": stage, "file": path.name,
                        "forecasts": forecasts, "hits": hit_vector})
    return experts


def _expert_weights(target_index, target_context, past_contexts, experts):
    valid_indices = [index for index in range(target_index)
                     if past_contexts[index] is not None]
    if target_context is None or not valid_indices:
        propensities = [UNIFORM_SLATE_RATE] * len(experts)
        return [value / sum(propensities) for value in propensities], 0.0

    distances = []
    for index in valid_indices:
        prior_context = past_contexts[index]
        squared_distance = sum((prior_context[feature] - target_context[feature]) ** 2
                               for feature in range(5)) / 5.0
        distances.append(math.exp(-0.5 * squared_distance / (KERNEL_BANDWIDTH ** 2)))
    weight_sum = sum(distances)
    propensities = []
    for expert in experts:
        weighted_hits = sum(weight * expert["hits"][index]
                            for weight, index in zip(distances, valid_indices))
        propensity = (PRIOR_ALPHA + weighted_hits) / (BETA_PRIOR_STRENGTH + weight_sum)
        propensities.append(propensity)
    total = sum(propensities)
    return [value / total for value in propensities], weight_sum


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    experts = _load_experts(dated)
    past_contexts = [None] + [_context_features(number) for _, number in dated[:-1]]
    hits = 0
    hit_dates = []
    forecasts = []

    for target_index, (target_date, actual) in enumerate(dated):
        target_context = None if target_index == 0 else _context_features(dated[target_index - 1][1])
        weights, effective_context_mass = _expert_weights(
            target_index, target_context, past_contexts, experts)
        scores = {}
        for expert, weight in zip(experts, weights):
            source_row = expert["forecasts"][target_index]
            for number in source_row["candidates"]:
                scores[number] = scores.get(number, 0.0) + weight / TICKET_COUNT
        candidates = sorted(scores, key=lambda number: (-scores[number], number))[:TICKET_COUNT]
        if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
            raise RuntimeError("Context-gated Fano slate must contain five unique candidates")

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
            "prior_context_features": target_context,
            "effective_context_mass": round(effective_context_mass, 8),
            "top_expert_weights_before_target": [
                {"stage": experts[index]["stage"], "weight": round(weights[index], 12)}
                for index in sorted(range(len(experts)), key=lambda i: -weights[i])[:8]
            ],
        })
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
        "target": "at least 10 exact six-digit first-prize hits across 759 targets, using five distinct candidates per draw",
        "walk_forward": "expert weights use only earlier hit/miss outcomes in contexts derived from the preceding draw; source slate for current target is scored before any update",
        "model_family": "context-conditioned Bayesian gate over prior-only Fano expert slates",
        "source_expert_count": len(experts),
        "source_stages": [expert["stage"] for expert in experts],
        "context_features": ["digit_sum", "odd_digit_count", "distinct_digit_count",
                             "adjacent_repeat_count", "first_last_equal"],
        "gaussian_kernel_bandwidth": KERNEL_BANDWIDTH,
        "beta_prior": {"alpha": PRIOR_ALPHA, "beta": PRIOR_BETA,
                       "strength": BETA_PRIOR_STRENGTH,
                       "prior_exact_hit_rate": UNIFORM_SLATE_RATE},
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates, "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits,
                       "source_fingerprints_match": True},
        "interpretation": "historical exploratory evaluation; source mechanisms were chosen after prior review of these same outcomes, so this is not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-61-context-gated-slates.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates, "minimum_hits": 10, "met": hits >= 10,
                      "source_expert_count": len(experts), "source_stages": report["source_stages"],
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
