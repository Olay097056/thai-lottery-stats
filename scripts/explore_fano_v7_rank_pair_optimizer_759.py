"""Walk-forward Fano v7 with prior-only rank-pair coordinate optimization."""
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


def _load_draws():
    history = astra.load_existing_astra_history()
    dated = []
    for row in history:
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


def _optimize_fano_codebook(chains, weights):
    marginal_sets = [positions._model_marginals(chain) for chain in chains]
    marginals = [
        [sum(weights[index] * marginal_sets[index][pos][digit]
             for index in range(len(chains))) for digit in range(10)]
        for pos in range(6)
    ]
    ranked = [sorted(range(10), key=lambda digit: (-marginals[pos][digit], digit))[:5]
              for pos in range(6)]
    rank_pairs = [tuple(ranked[pos][:2]) for pos in range(6)]
    probability_cache = {}

    def candidate_probability(number):
        if number not in probability_cache:
            probability_cache[number] = sum(
                weights[index] * positions._joint_probability(chain, number)
                for index, chain in enumerate(chains)
            )
        return probability_cache[number]

    def choose(pairs):
        best = None
        for puncture in range(7):
            lines = [line for line in range(7) if line != puncture]
            words = []
            for point in range(7):
                number = "".join(
                    str(pairs[pos][int(point in fano.FANO_LINES[line])])
                    for pos, line in enumerate(lines)
                )
                words.append((point, number, candidate_probability(number)))
            chosen = sorted(words, key=lambda row: (-row[2], row[0]))[:5]
            score = sum(row[2] for row in chosen)
            key = (score, -puncture, tuple(-row[0] for row in chosen))
            if best is None or key > best[0]:
                best = (key, chosen, puncture)
        _, chosen, puncture = best
        numbers = [row[1] for row in chosen]
        if len(numbers) != 5 or len(set(numbers)) != 5:
            raise RuntimeError("Fano optimized codebook must contain five distinct candidates")
        return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
                "punctured_line": puncture + 1,
                "selected_points": [row[0] + 1 for row in chosen]}

    selected = choose(rank_pairs)
    # Coordinate ascent changes only prior-ranked digit pairs; each proposal
    # is scored against the full joint model, never against the target result.
    for _ in range(2):
        any_change = False
        for position in range(6):
            best_pair = rank_pairs[position]
            best_result = selected
            for first in ranked[position]:
                for second in ranked[position]:
                    if first == second:
                        continue
                    proposal = list(rank_pairs)
                    proposal[position] = (first, second)
                    result = choose(proposal)
                    if result["mass"] > best_result["mass"] + 1e-18:
                        best_pair = (first, second)
                        best_result = result
            if best_pair != rank_pairs[position]:
                rank_pairs[position] = best_pair
                selected = best_result
                any_change = True
        if not any_change:
            break
    selected["rank_pairs"] = [[str(digit) for digit in pair] for pair in rank_pairs]
    selected["search"] = "coordinate ascent, two sweeps max, ordered pairs drawn from top five prior-ranked digits per position"
    return selected


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(positions.MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        chains = [positions._fit(prior, model) for model in positions.MODELS]
        weights = _normalize(log_weights)
        selected = _optimize_fano_codebook(chains, weights)
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        mixture_probability = sum(
            weights[index] * positions._joint_probability(chain, actual)
            for index, chain in enumerate(chains)
        )
        loss = -math.log(max(mixture_probability, 1e-300))
        loss_sum += loss
        mass_sum += selected["mass"]
        model_losses = [positions._joint_loss(chain, actual) for chain in chains]
        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": len(prior),
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_joint_probability_mass": selected["mass"],
            "joint_log_loss": loss,
            "rank_pairs": selected["rank_pairs"],
            "search": selected["search"],
            "model_weights_before_target": {
                model["name"]: weights[index]
                for index, model in enumerate(positions.MODELS)
            },
            "punctured_line": selected["punctured_line"],
            "selected_points": selected["selected_points"],
        })
        log_weights = [log_weights[index] - model_losses[index]
                       for index in range(len(positions.MODELS))]
        if (target_index + 1) % 50 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "joint-model experts and rank-pair search use only prior draws; expert weights update after each target is scored",
        "model_family": "prequential mixture of alternative position-order Markov joint models with prior-probability Fano rank-pair coordinate optimization",
        "models": [dict(model) for model in positions.MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_joint_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical research only; the rank-pair optimizer is a new same-sample hypothesis and not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-18-rank-pair-optimizer.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold_met"],
                      "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "mean_five_candidate_joint_probability_mass": report["v7"]["mean_five_candidate_probability_mass"],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
