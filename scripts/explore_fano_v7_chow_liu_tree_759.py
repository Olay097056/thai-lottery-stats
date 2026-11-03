"""Stage 85: prior-only adaptive Chow-Liu tree over six digit positions."""
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

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
DIGIT_COUNT = 6
DIGIT_CARDINALITY = 10
TICKET_COUNT = 5
PAIR_SHRINKAGE = 100.0


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


def _fit_tree(position_counts, pair_counts, prior_draws):
    marginals = [
        [(position_counts[position][digit] + 1.0) / (prior_draws + 10.0)
         for digit in range(DIGIT_CARDINALITY)]
        for position in range(DIGIT_COUNT)
    ]
    pair_tables = {}
    mutual_information = {}
    for left in range(DIGIT_COUNT):
        for right in range(left + 1, DIGIT_COUNT):
            table = [
                [(pair_counts[left][right][a][b]
                  + PAIR_SHRINKAGE * marginals[left][a] * marginals[right][b])
                 / (prior_draws + PAIR_SHRINKAGE)
                 for b in range(DIGIT_CARDINALITY)]
                for a in range(DIGIT_CARDINALITY)
            ]
            pair_tables[left, right] = table
            pair_left_marginal = [sum(row) for row in table]
            pair_right_marginal = [
                sum(table[a][b] for a in range(DIGIT_CARDINALITY))
                for b in range(DIGIT_CARDINALITY)
            ]
            mi = 0.0
            for a in range(DIGIT_CARDINALITY):
                for b in range(DIGIT_CARDINALITY):
                    mass = table[a][b]
                    mi += mass * math.log(
                        mass / (pair_left_marginal[a] * pair_right_marginal[b]))
            mutual_information[left, right] = mi

    # Kruskal maximum spanning tree; edge tuple breaks equal-MI ties.
    parent = list(range(DIGIT_COUNT))

    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    edges = []
    ordered_edges = sorted(mutual_information,
                           key=lambda edge: (-mutual_information[edge], edge[0], edge[1]))
    for left, right in ordered_edges:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left
            edges.append((left, right))
            if len(edges) == DIGIT_COUNT - 1:
                break
    if len(edges) != DIGIT_COUNT - 1:
        raise RuntimeError("Chow-Liu structure must be a spanning tree")

    adjacency = [[] for _ in range(DIGIT_COUNT)]
    for left, right in edges:
        adjacency[left].append(right)
        adjacency[right].append(left)
    oriented = []
    order = [0]
    visited = {0}
    for node in order:
        for child in sorted(adjacency[node]):
            if child in visited:
                continue
            visited.add(child)
            order.append(child)
            oriented.append((node, child))

    conditionals = {}
    for node, child in oriented:
        left, right = sorted((node, child))
        table = pair_tables[left, right]
        if node == left:
            joint = table
        else:
            joint = [[table[b][a] for b in range(DIGIT_CARDINALITY)]
                     for a in range(DIGIT_CARDINALITY)]
        parent_marginal = [sum(row) for row in joint]
        conditionals[node, child] = [
            [joint[parent_digit][child_digit] / parent_marginal[parent_digit]
             for child_digit in range(DIGIT_CARDINALITY)]
            for parent_digit in range(DIGIT_CARDINALITY)
        ]

    tree_marginals = [None] * DIGIT_COUNT
    tree_marginals[0] = marginals[0][:]
    for node, child in oriented:
        conditional = conditionals[node, child]
        tree_marginals[child] = [
            sum(tree_marginals[node][parent_digit]
                * conditional[parent_digit][digit]
                for parent_digit in range(DIGIT_CARDINALITY))
            for digit in range(DIGIT_CARDINALITY)
        ]
    if any(probability is None or not math.isclose(
            sum(probability), 1.0, rel_tol=0.0, abs_tol=1e-10)
           for probability in tree_marginals):
        raise RuntimeError("Tree marginals must normalize at every position")
    return {
        "root_marginal": marginals[0],
        "marginals": tree_marginals,
        "edges": edges,
        "oriented_edges": oriented,
        "conditionals": conditionals,
        "edge_mutual_information": {
            f"{left}-{right}": mutual_information[left, right]
            for left, right in edges
        },
    }


def _log_probability(number, model):
    digits = [ord(char) - 48 for char in number]
    log_probability = math.log(model["root_marginal"][digits[0]])
    for parent, child in model["oriented_edges"]:
        log_probability += math.log(
            model["conditionals"][parent, child][digits[parent]][digits[child]])
    return log_probability


def _fano_codebooks(marginals):
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


def _select_slate(codebooks, model):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = [(point, number, math.exp(_log_probability(number, model)))
                  for point, number in words]
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must contain five unique tickets")
    return {"candidates": candidates, "punctured_line": puncture + 1,
            "selected_points": [row[0] + 1 for row in selected],
            "candidate_probabilities": [row[2] for row in selected],
            "five_ticket_predictive_mass": mass}


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    position_counts = [[0] * DIGIT_CARDINALITY for _ in range(DIGIT_COUNT)]
    pair_counts = [[[[0] * DIGIT_CARDINALITY for _ in range(DIGIT_CARDINALITY)]
                    for _ in range(DIGIT_COUNT)] for _ in range(DIGIT_COUNT)]
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        model = _fit_tree(position_counts, pair_counts, target_index)
        slate = _select_slate(_fano_codebooks(model["marginals"]), model)
        actual_log_probability = _log_probability(actual, model)
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
            "learned_tree_edges": [[left + 1, right + 1]
                                    for left, right in model["edges"]],
            "edge_mutual_information": model["edge_mutual_information"],
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": math.exp(actual_log_probability),
        })

        # Pair counts and marginals are updated only after target scoring.
        digits = [ord(char) - 48 for char in actual]
        for position, digit in enumerate(digits):
            position_counts[position][digit] += 1
        for left in range(DIGIT_COUNT):
            for right in range(left + 1, DIGIT_COUNT):
                pair_counts[left][right][digits[left]][digits[right]] += 1
                pair_counts[right][left][digits[right]][digits[left]] += 1
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
        raise RuntimeError("Reported hit count differs from candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "pair tables, marginals, mutual information, and tree structure use only draws before each target; updates occur after scoring",
        "model_family": "prequential Chow-Liu maximum-mutual-information tree over six digit positions with Fano slate decoding",
        "pair_table_shrinkage_draws": PAIR_SHRINKAGE,
        "tree_root_position": 1,
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
              f"results-{run_date}-stage-85-chow-liu-tree.json")
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
