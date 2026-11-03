"""Prequential ticket-level mixture over prior Fano formula slates."""
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
sys.path.insert(0, str(ROOT / "scripts"))

import astra
import fano
import explore_fano_v7_unified_ensemble_759 as unified

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
UNIFORM_SHARE_VALUES = (0.99, 0.999, 0.9999, 0.99999)
UNIFORM_PROBABILITY = 1.0 / 1_000_000
REPORT_FILES = {
    "stage28-recurrent": ".scratch/fano-v7-walk-forward/results-2026-10-15-stage-28-unified-plus-recurrent.json",
    "stage30-calendar-recurrent": ".scratch/fano-v7-walk-forward/results-2026-10-15-stage-30-unified-plus-calendar-recurrent.json",
    "stage31-autoregressive": ".scratch/fano-v7-walk-forward/results-2026-10-15-stage-31-autoregressive-fano.json",
    "stage32-joint-decoder": ".scratch/fano-v7-walk-forward/results-2026-10-15-stage-32-joint-decoder-ensemble.json",
    "stage33-variable-context": ".scratch/fano-v7-walk-forward/results-2026-10-15-stage-33-variable-context.json",
}


def _v5_candidates(prior):
    chronological = [
        [ord(char) - 48 for char in number]
        for _, number in prior
    ]
    rankings = fano._v5_signal_rankings(chronological)
    retained_lines = [line for line in range(7) if line != fano.V5_PUNCTURED_LINE - 1]
    retained_points = [point for point in range(7)
                       if point + 1 not in fano.V5_OMITTED_POINTS]
    numbers = []
    for point in retained_points:
        digits = []
        for position, line in enumerate(retained_lines):
            bit = int(point in fano.FANO_LINES[line])
            rank_index = fano.V5_RANK_PAIRS_BY_POSITION[position][bit]
            signal = fano.V5_SIGNAL_BY_POSITION[position]
            digits.append(str(rankings[signal][position][rank_index]))
        numbers.append("".join(digits))
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano v5 slate must contain five unique candidates")
    return numbers


def _load_slates(dated):
    sources = {"fano-v5-million-search": []}
    reports = {}
    for name, relative_path in REPORT_FILES.items():
        report = json.loads((ROOT / relative_path).read_text(encoding="utf-8"))
        forecasts = report["v7"]["forecasts"]
        if len(forecasts) != DRAW_COUNT:
            raise RuntimeError(f"{name} does not contain {DRAW_COUNT} forecasts")
        reports[name] = forecasts
        sources[name] = []

    for index, (target_date, _) in enumerate(dated):
        sources["fano-v5-million-search"].append(_v5_candidates(dated[:index]))
        for name, forecasts in reports.items():
            forecast = forecasts[index]
            if (forecast["target_date"] != target_date.isoformat() or
                    forecast["prior_valid_draws"] != index):
                raise RuntimeError(f"{name} forecast order is not aligned to target history")
            sources[name].append(forecast["candidates"])
    return sources


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _model_probability(candidate, slate, uniform_share):
    if slate is None:
        return UNIFORM_PROBABILITY
    probability = uniform_share * UNIFORM_PROBABILITY
    if candidate in slate:
        probability += (1.0 - uniform_share) / 5.0
    return probability


def run():
    started = time.perf_counter()
    dated = unified._load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    sources = _load_slates(dated)
    experts = [(source, share) for source in sources for share in UNIFORM_SHARE_VALUES]
    experts.append(("uniform-baseline", 1.0))
    log_weights = [0.0] * len(experts)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    selected_mass_sum = 0.0
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        weights = _normalize(log_weights)
        current_slates = {
            source: slates[target_index] for source, slates in sources.items()
        }
        candidate_union = sorted({number for slate in current_slates.values()
                                  for number in slate})
        candidate_probability = {}
        for number in candidate_union:
            candidate_probability[number] = sum(
                weights[index] * _model_probability(
                    number,
                    current_slates.get(source),
                    share,
                )
                for index, (source, share) in enumerate(experts)
            )
        selected = sorted(candidate_union,
                          key=lambda number: (-candidate_probability[number], number))[:5]
        if len(selected) != 5 or len(set(selected)) != 5:
            raise RuntimeError("Slate meta-selector must produce exactly five unique candidates")
        hit = actual in selected
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        model_probabilities = [
            _model_probability(actual, current_slates.get(source), share)
            for source, share in experts
        ]
        actual_probability = sum(weights[index] * model_probabilities[index]
                                 for index in range(len(experts)))
        loss = -math.log(actual_probability)
        loss_sum += loss
        selected_mass = sum(candidate_probability[number] for number in selected)
        selected_mass_sum += selected_mass
        source_weights = {}
        for index, (source, _) in enumerate(experts):
            source_weights[source] = source_weights.get(source, 0.0) + weights[index]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": selected,
            "hit": hit,
            "five_candidate_probability_mass": selected_mass,
            "log_loss": loss,
            "family_weights_before_target": source_weights,
            "top_expert_weights_before_target": sorted(
                ((f"{source}:uniform-share-{share:g}", weights[index])
                 for index, (source, share) in enumerate(experts)),
                key=lambda row: -row[1]
            )[:10],
        })
        log_weights = [log_weights[index] + math.log(model_probabilities[index])
                       for index in range(len(experts))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    final_weights = _normalize(log_weights)
    final_source_weights = {}
    for index, (source, _) in enumerate(experts):
        final_source_weights[source] = final_source_weights.get(source, 0.0) + final_weights[index]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "all source slates are target-date aligned and prior-only; a Bayesian portfolio over ticket-level slate distributions updates after each target, using only the newly observed outcome",
        "model_family": "ticket-level mixture of Fano v5, recurrent, autoregressive, variable-context, and uniform experts with explicit uniform smoothing",
        "expert_count": len(experts),
        "family_model_counts": {source: len(UNIFORM_SHARE_VALUES) for source in sources} | {"uniform-baseline": 1},
        "slate_sources": list(sources),
        "uniform_share_values": list(UNIFORM_SHARE_VALUES),
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(selected_mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "family_weight_after_last_target": final_source_weights,
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory evaluation; slate sources were selected after reviewing same-sample results, including post-hoc Fano v5 search results; strict per-target timing does not make this model pool an independent holdout",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-34-slate-meta.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "final_source_weights": final_source_weights,
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
