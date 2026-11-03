"""Joint-probability Fano codebook search with four ranked digits per position."""
from __future__ import annotations

from datetime import datetime
import hashlib
import itertools
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
import explore_fano_v7_position_order_markov_759 as positions

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
MODELS = tuple(model for model in positions.MODELS
               if model["half_life"] is None and model["alpha"] == 50.0)
LINE_PAIRS = tuple(itertools.combinations(range(7), 2))
INITIAL_LINE_PAIRS = ((0, 1), (2, 3), (4, 5), (0, 6), (1, 4), (2, 5))


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid first-prize draws, found {len(dated)}")
    if len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Valid first-prize history contains duplicate dates")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("A first-prize result is not a six-character ASCII number")
    if any(dated[index - 1][0] >= dated[index][0] for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize history is not strictly chronological")
    return dated


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _best_slate(chains, weights, rankings, line_pairs, cache):
    candidates = []
    for point in range(7):
        digits = []
        for position, (left, right) in enumerate(line_pairs):
            code = (int(point in fano.FANO_LINES[left]) * 2
                    + int(point in fano.FANO_LINES[right]))
            digits.append(rankings[position][code])
        number = "".join(str(digit) for digit in digits)
        if number not in cache:
            cache[number] = sum(weights[index] * positions._joint_probability(chain, number)
                                for index, chain in enumerate(chains))
        candidates.append((point, number, cache[number]))
    if len({row[1] for row in candidates}) != 7:
        return None
    chosen = sorted(candidates, key=lambda row: (-row[2], row[0]))[:5]
    return {"numbers": [row[1] for row in chosen],
            "mass": sum(row[2] for row in chosen),
            "points": [row[0] + 1 for row in chosen]}


def _optimize_codebook(chains, weights):
    individual_marginals = [positions._model_marginals(chain) for chain in chains]
    marginals = [
        [sum(weights[index] * individual_marginals[index][position][digit]
             for index in range(len(chains))) for digit in range(10)]
        for position in range(6)
    ]
    rankings = [sorted(range(10), key=lambda digit: (-marginals[pos][digit], digit))[:4]
                for pos in range(6)]
    cache = {}
    line_pairs = list(INITIAL_LINE_PAIRS)
    selected = _best_slate(chains, weights, rankings, line_pairs, cache)
    if selected is None:
        raise RuntimeError("Initial joint 4-ary Fano projections must yield seven distinct words")
    for _ in range(8):
        changed = False
        for position in range(6):
            best_pair, best_slate = line_pairs[position], selected
            for pair in LINE_PAIRS:
                if pair == best_pair:
                    continue
                proposal = list(line_pairs)
                proposal[position] = pair
                slate = _best_slate(chains, weights, rankings, proposal, cache)
                if slate is not None and slate["mass"] > best_slate["mass"] + 1e-18:
                    best_pair, best_slate = pair, slate
            if best_pair != line_pairs[position]:
                line_pairs[position] = best_pair
                selected = best_slate
                changed = True
        if not changed:
            break
    selected["line_pairs"] = [[left + 1, right + 1] for left, right in line_pairs]
    selected["rankings"] = [[str(digit) for digit in row] for row in rankings]
    return selected


def run():
    if len(MODELS) != 8:
        raise RuntimeError(f"Expected eight selected order models, got {len(MODELS)}")
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    expert_losses = [0.0] * len(MODELS)
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        chains = [positions._fit(prior, model) for model in MODELS]
        weights = _normalize(log_weights)
        slate = _optimize_codebook(chains, weights)
        hit = actual in slate["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        actual_probability = sum(weights[index] * positions._joint_probability(chain, actual)
                                 for index, chain in enumerate(chains))
        loss = -math.log(max(actual_probability, 1e-300))
        loss_sum += loss
        mass_sum += slate["mass"]
        losses = [positions._joint_loss(chain, actual) for chain in chains]
        expert_losses = [expert_losses[index] + losses[index]
                         for index in range(len(MODELS))]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": slate["numbers"],
            "hit": hit,
            "five_candidate_joint_probability_mass": slate["mass"],
            "joint_log_loss": loss,
            "line_pairs": slate["line_pairs"],
            "rankings": slate["rankings"],
            "selected_points": slate["points"],
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:5],
        })
        log_weights = [log_weights[index] - losses[index]
                       for index in range(len(MODELS))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [{"name": MODELS[index]["name"],
                      "mean_joint_log_loss": round(expert_losses[index] / DRAW_COUNT, 8)}
                     for index in range(len(MODELS))]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "joint model fitting, online expert weights, four-rank mapping and Fano projection selection use only strictly prior draws",
        "model_family": "prequential mixture of eight Bayesian position-order Markov joint models with a four-rank Fano projection codebook optimized on joint ticket probability",
        "expert_count": len(MODELS),
        "experts": [{"family": "position-order-joint-markov", **dict(model)}
                    for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_joint_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_joint_log_loss": math.log(1_000_000),
               "mean_five_candidate_joint_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory evaluation; four-rank joint Fano projection was designed after reviewing earlier outcomes and is not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-38-joint-quaternary.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
                      "uniform_joint_log_loss": report["v7"]["uniform_joint_log_loss"],
                      "best_fixed_model": min(fixed_results,
                                               key=lambda row: row["mean_joint_log_loss"]),
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
