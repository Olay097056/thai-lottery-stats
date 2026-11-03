"""Stage 86: prior-only BIC structure learning for a categorical DAG."""
from __future__ import annotations

from datetime import datetime
from itertools import combinations, permutations
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
DIGIT_COUNT = 6
DIGIT_CARDINALITY = 10
TICKET_COUNT = 5
MAX_PARENTS = 2
LAPLACE_ALPHA = 1.0
PARENT_SETS = tuple(
    ((),) + tuple(combinations([other for other in range(DIGIT_COUNT)
                                if other != child], 1))
    + tuple(combinations([other for other in range(DIGIT_COUNT)
                          if other != child], 2))
    for child in range(DIGIT_COUNT)
)


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", DIGIT_COUNT)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _new_conditional_counts():
    counts = []
    for child in range(DIGIT_COUNT):
        child_tables = {}
        for parents in PARENT_SETS[child]:
            state_count = DIGIT_CARDINALITY ** len(parents)
            child_tables[parents] = [[0] * DIGIT_CARDINALITY
                                     for _ in range(state_count)]
        counts.append(child_tables)
    return counts


def _parent_state(parents, digits):
    state = 0
    for parent in parents:
        state = state * DIGIT_CARDINALITY + digits[parent]
    return state


def _local_bic_scores(conditional_counts, prior_draws):
    scores = {}
    penalty_scale = 0.5 * math.log(prior_draws) if prior_draws > 1 else 0.0
    for child in range(DIGIT_COUNT):
        for parents in PARENT_SETS[child]:
            log_likelihood = 0.0
            for row in conditional_counts[child][parents]:
                total = sum(row)
                if total:
                    log_likelihood += sum(
                        count * math.log(count / total)
                        for count in row if count
                    )
            degrees = (DIGIT_CARDINALITY - 1) * (
                DIGIT_CARDINALITY ** len(parents))
            scores[child, parents] = log_likelihood - penalty_scale * degrees
    return scores


def _learn_structure(local_scores):
    best_score = -math.inf
    best_parents = None
    best_order = None
    for order in permutations(range(DIGIT_COUNT)):
        selected = {}
        total = 0.0
        for index, child in enumerate(order):
            earlier = order[:index]
            options = [()]
            options.extend(combinations(earlier, 1))
            options.extend(combinations(earlier, 2))
            local_best = -math.inf
            local_parent_set = ()
            # Options are in stable size/lexicographic order; ties keep first.
            for parents in options:
                score = local_scores[child, tuple(sorted(parents))]
                if score > local_best + 1e-12:
                    local_best = score
                    local_parent_set = tuple(sorted(parents))
            selected[child] = local_parent_set
            total += local_best
        if total > best_score + 1e-12:
            best_score = total
            best_parents = selected
            best_order = order
    if best_parents is None or best_order is None:
        raise RuntimeError("BIC search did not produce a valid directed acyclic graph")
    return best_score, best_parents, best_order


def _conditional_probabilities(conditional_counts, parents_by_child):
    conditionals = {}
    for child, parents in parents_by_child.items():
        table = conditional_counts[child][parents]
        conditionals[child] = [
            [(count + LAPLACE_ALPHA) / (sum(row) + DIGIT_CARDINALITY * LAPLACE_ALPHA)
             for count in row]
            for row in table
        ]
    return conditionals


def _log_probability(number, parents_by_child, conditionals):
    digits = [ord(char) - 48 for char in number]
    log_probability = 0.0
    for child in range(DIGIT_COUNT):
        parents = parents_by_child[child]
        state = _parent_state(parents, digits)
        log_probability += math.log(conditionals[child][state][digits[child]])
    return log_probability


def _fano_codebooks(position_counts, prior_draws):
    marginals = [
        [(position_counts[position][digit] + LAPLACE_ALPHA)
         / (prior_draws + DIGIT_CARDINALITY * LAPLACE_ALPHA)
         for digit in range(DIGIT_CARDINALITY)]
        for position in range(DIGIT_COUNT)
    ]
    top_two = [sorted(range(DIGIT_CARDINALITY), key=lambda digit: (
        -marginals[position][digit], digit))[:2]
        for position in range(DIGIT_COUNT)]
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[position][int(point in fano.FANO_LINES[line])])
                for position, line in enumerate(retained_lines)
            )
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, parents_by_child, conditionals):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = [(point, number,
                   math.exp(_log_probability(number, parents_by_child, conditionals)))
                  for point, number in words]
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected slate must have five unique six-digit tickets")
    return {"candidates": candidates, "punctured_line": puncture + 1,
            "selected_points": [row[0] + 1 for row in selected],
            "candidate_probabilities": [row[2] for row in selected],
            "five_ticket_predictive_mass": mass}


def _update_counts(conditional_counts, digits):
    for child in range(DIGIT_COUNT):
        for parents in PARENT_SETS[child]:
            state = _parent_state(parents, digits)
            conditional_counts[child][parents][state][digits[child]] += 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    position_counts = [[0] * DIGIT_CARDINALITY for _ in range(DIGIT_COUNT)]
    conditional_counts = _new_conditional_counts()
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        local_scores = _local_bic_scores(conditional_counts, target_index)
        bic_score, parents_by_child, topological_order = _learn_structure(local_scores)
        conditionals = _conditional_probabilities(conditional_counts, parents_by_child)
        slate = _select_slate(_fano_codebooks(position_counts, target_index),
                              parents_by_child, conditionals)
        actual_log_probability = _log_probability(actual, parents_by_child, conditionals)
        log_loss_sum -= actual_log_probability
        mass_sum += slate["five_ticket_predictive_mass"]
        hit = actual in slate["candidates"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": slate["candidates"],
            "hit": hit,
            "topological_order": [position + 1 for position in topological_order],
            "parents_by_position": {
                str(child + 1): [parent + 1 for parent in parents_by_child[child]]
                for child in range(DIGIT_COUNT)
            },
            "prior_bic_score": bic_score,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": math.exp(actual_log_probability),
        })

        # Update all conditional count tables only after scoring this target.
        digits = [ord(char) - 48 for char in actual]
        for position, digit in enumerate(digits):
            position_counts[position][digit] += 1
        _update_counts(conditional_counts, digits)
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT or [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward must contain all targets in date order")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior counts must run from 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
                  for number in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Every target must have five unique six-digit candidates")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hit count does not match candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "BIC structure search and conditional tables use only draws before each target; the target updates counts after scoring",
        "model_family": "BIC-learned categorical Bayesian network with indegree at most two and punctured-Fano slate decoding",
        "maximum_parents_per_position": MAX_PARENTS,
        "conditional_laplace_alpha": LAPLACE_ALPHA,
        "bic_parameter_count": "9 * 10^parent_count per position",
        "structure_search": "exact enumeration of all 720 topological orders; independent best BIC parent set of size at most two among earlier nodes per order",
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(1_000_000),
            "mean_five_ticket_predictive_mass": round(mass_sum / DRAW_COUNT, 12),
            "forecasts": forecasts,
        },
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts),
                       "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "retrospective exploratory evaluation only; no evidence of independent or prospective predictive advantage",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = (ROOT / ".scratch" / "fano-v7-walk-forward" /
              f"results-{run_date}-stage-86-bayesian-network-structure.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_dates": hit_dates,
                      "minimum_hits": 10, "met": hits >= 10,
                      "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
