"""Prequential slate-level Bayesian mixture over all saved Fano v7 families."""
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
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
UNIFORM_MIX = 0.001


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _load_reports():
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    reports = []
    for path in sorted(folder.glob("results-*-stage-*.json")):
        report = json.loads(path.read_text(encoding="utf-8"))
        forecasts = report.get("v7", {}).get("forecasts")
        if not isinstance(forecasts, list) or len(forecasts) != DRAW_COUNT:
            raise RuntimeError(f"Invalid forecast array in {path.name}")
        if report.get("actuals_sha256") != "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145":
            raise RuntimeError(f"Data fingerprint mismatch in {path.name}")
        for index, row in enumerate(forecasts):
            candidates = row.get("candidates")
            if row.get("prior_valid_draws", row.get("prior_draws")) != index:
                raise RuntimeError(f"Prior count mismatch in {path.name} at {index}")
            if (not isinstance(candidates, list) or len(candidates) != 5
                    or len(set(candidates)) != 5
                    or any(not isinstance(number, str) or len(number) != 6
                           or not number.isascii() or not number.isdigit()
                           for number in candidates)):
                raise RuntimeError(f"Invalid slate in {path.name} at {index}")
        reports.append({"file": path.name,
                        "name": report.get("model_family", path.stem),
                        "forecasts": forecasts})
    if not reports:
        raise RuntimeError("No saved stage reports found")
    dates = [row["target_date"] for row in reports[0]["forecasts"]]
    for report in reports[1:]:
        if [row["target_date"] for row in report["forecasts"]] != dates:
            raise RuntimeError(f"Target dates differ in {report['file']}")
    return reports


def run():
    started = time.perf_counter()
    reports = _load_reports()
    source_count = len(reports)
    log_weights = [0.0] * source_count
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    forecasts = []
    for target_index in range(DRAW_COUNT):
        weights = _normalize(log_weights)
        source_rows = [report["forecasts"][target_index] for report in reports]
        actual = source_rows[0]["actual"]
        if any(row["actual"] != actual for row in source_rows):
            raise RuntimeError(f"Target actuals differ at index {target_index}")
        candidate_scores = {}
        expert_actual_probabilities = []
        hit_experts = 0
        for index, row in enumerate(source_rows):
            slate = set(row["candidates"])
            hit_experts += int(actual in slate)
            expert_actual_probabilities.append(
                UNIFORM_MIX / 1_000_000
                + ((1.0 - UNIFORM_MIX) / 5.0 if actual in slate else 0.0))
            for number in slate:
                candidate_scores[number] = candidate_scores.get(number, 0.0) + weights[index] * (
                    (1.0 - UNIFORM_MIX) / 5.0 + UNIFORM_MIX / 1_000_000)
        ranked = sorted(candidate_scores, key=lambda number: (-candidate_scores[number], number))
        candidates = ranked[:5]
        if len(candidates) != 5 or len(set(candidates)) != 5:
            raise RuntimeError("Slate meta-portfolio failed to generate five unique tickets")
        actual_probability = sum(weights[index] * expert_actual_probabilities[index]
                                 for index in range(source_count))
        loss = -math.log(max(actual_probability, 1e-300))
        loss_sum += loss
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(source_rows[0]["target_date"])
        forecasts.append({
            "target_date": source_rows[0]["target_date"],
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": candidates,
            "hit": hit,
            "mixture_log_loss": loss,
            "mixture_probability_mass_of_slate": sum(candidate_scores[number]
                                                       for number in candidates),
            "prior_hit_expert_count": hit_experts,
            "top_expert_weights_before_target": sorted(
                ((reports[index]["file"], weights[index]) for index in range(source_count)),
                key=lambda row: -row[1])[:8],
        })
        log_weights = [log_weights[index] + math.log(expert_actual_probabilities[index])
                       for index in range(source_count)]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    final_weights = _normalize(log_weights)
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "source forecast slates are fixed before each target; meta-weights update only after scoring each target",
        "model_family": "slate-level online Bayesian mixture over all saved Fano v7 experimental families with 0.1% uniform smoothing",
        "source_family_count": source_count,
        "source_files": [report["file"] for report in reports],
        "uniform_smoothing_probability": UNIFORM_MIX,
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "final_source_weights": sorted(
            ((reports[index]["file"], final_weights[index]) for index in range(source_count)),
            key=lambda row: -row[1])[:20],
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory evaluation; the source-family library was curated after inspecting this same history, so this mixture is not an untouched validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    output = folder / f"results-{report['run_date']}-stage-45-all-slate-meta.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "source_family_count": source_count,
                      "final_top_source_weights": report["final_source_weights"][:5],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
