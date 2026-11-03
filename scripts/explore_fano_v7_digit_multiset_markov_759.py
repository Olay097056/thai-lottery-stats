"""Stage 69: exchangeable digit-multiset Markov model with Fano decoding."""
from __future__ import annotations

from collections import defaultdict
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
NUMBER_SPACE = 1_000_000
TICKET_COUNT = 5
DIGIT_COUNT = 6


def _weak_compositions(total, parts, prefix=()):
    if parts == 1:
        yield prefix + (total,)
        return
    for value in range(total + 1):
        yield from _weak_compositions(total - value, parts - 1, prefix + (value,))


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[index - 1][0] >= dated[index][0]
           for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _multiset(number):
    counts = [0] * 10
    for char in number:
        counts[ord(char) - 48] += 1
    return tuple(counts)


def _distinct_permutations(counts):
    denominator = math.prod(math.factorial(value) for value in counts)
    return math.factorial(DIGIT_COUNT) // denominator


def _predict_multisets(source_bag, transition_counts, all_bags, permutation_counts):
    row = transition_counts.get(source_bag, {}) if source_bag is not None else {}
    row_total = sum(row.values())
    denominator = row_total + 1.0
    probabilities = {
        bag: (row.get(bag, 0) + permutation_counts[bag] / NUMBER_SPACE) / denominator
        for bag in all_bags
    }
    if abs(sum(probabilities.values()) - 1.0) > 1e-10:
        raise RuntimeError("Multiset transition prior does not normalize")
    return probabilities


def _position_marginals(bag_probabilities, all_bags):
    marginals = [0.0] * 10
    for bag in all_bags:
        probability = bag_probabilities[bag]
        for digit, count in enumerate(bag):
            marginals[digit] += probability * count / DIGIT_COUNT
    if abs(sum(marginals) - 1.0) > 1e-10:
        raise RuntimeError("Permutation-marginal digit probabilities do not normalize")
    return [list(marginals) for _ in range(DIGIT_COUNT)]


def _fano_codebooks(digit_probabilities):
    top_two = [sorted(range(10), key=lambda digit: (
        -digit_probabilities[position][digit], digit))[:2]
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
            raise RuntimeError("Each Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, bag_probabilities, permutation_counts):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = []
        for point, number in words:
            bag = _multiset(number)
            probability = bag_probabilities[bag] / permutation_counts[bag]
            ranked.append((point, number, probability, bag))
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))

    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected slate must contain five unique tickets")
    return {
        "candidates": candidates,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
        "candidate_multisets": [list(row[3]) for row in selected],
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    all_bags = tuple(_weak_compositions(DIGIT_COUNT, 10))
    if len(all_bags) != 5005 or sum(map(sum, all_bags)) != 5005 * DIGIT_COUNT:
        raise RuntimeError("Expected the 5,005 six-digit multisets")
    permutation_counts = {bag: _distinct_permutations(bag) for bag in all_bags}
    if sum(permutation_counts.values()) != NUMBER_SPACE:
        raise RuntimeError("Multisets must partition the million ordered tickets")

    transition_counts = defaultdict(dict)
    prior_bags = []
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        source_bag = prior_bags[-1] if prior_bags else None
        bag_probabilities = _predict_multisets(
            source_bag, transition_counts, all_bags, permutation_counts
        )
        digit_probabilities = _position_marginals(bag_probabilities, all_bags)
        codebooks = _fano_codebooks(digit_probabilities)
        slate = _select_slate(codebooks, bag_probabilities, permutation_counts)

        actual_bag = _multiset(actual)
        actual_probability = (bag_probabilities[actual_bag]
                              / permutation_counts[actual_bag])
        log_loss_sum -= math.log(actual_probability)
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
            "source_multiset": list(source_bag) if source_bag is not None else None,
            "actual_multiset": list(actual_bag),
            "actual_multiset_prior_transition_count": (
                transition_counts.get(source_bag, {}).get(actual_bag, 0)
                if source_bag is not None else 0
            ),
            "actual_predictive_probability": actual_probability,
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "candidate_multisets": slate["candidate_multisets"],
            "candidate_probabilities": slate["candidate_probabilities"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # A transition is recorded only after its target has been scored.
        if source_bag is not None:
            row = transition_counts[source_bag]
            row[actual_bag] = row.get(actual_bag, 0) + 1
        prior_bags.append(actual_bag)

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(
        row["actual"] in row["candidates"] for row in forecasts
    )
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count must be exactly 759")
    if [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward forecasts are not chronological")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior draw counts must run from 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
                  for number in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Every target must have five unique six-digit candidates")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hits do not match the candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "multiset transition counts and posterior marginals use only prior draws; ordered permutations are uniform given a multiset; each transition is updated only after scoring",
        "model_family": "first-order Markov prediction over exchangeable six-digit multisets with uniform conditional permutations and Fano codebook decoding",
        "multiset_state_count": len(all_bags),
        "prior_mass_per_multiset": "distinct_permutations / 1000000; total concentration 1",
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / NUMBER_SPACE,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(NUMBER_SPACE),
            "mean_five_ticket_predictive_mass": round(mass_sum / DRAW_COUNT, 12),
            "forecasts": forecasts,
        },
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {
            "forecast_count": len(forecasts),
            "prior_counts_0_to_758": True,
            "five_distinct_candidates_each": True,
            "recomputed_hits": recomputed_hits,
        },
        "interpretation": "retrospective exploratory evaluation only; no evidence of independent or prospective predictive advantage",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = (ROOT / ".scratch" / "fano-v7-walk-forward" /
              f"results-{run_date}-stage-69-digit-multiset-markov.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": hits,
        "hit_dates": hit_dates,
        "minimum_hits": 10,
        "met": hits >= 10,
        "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
        "uniform_log_loss": report["v7"]["uniform_log_loss"],
        "data_fingerprint": fingerprint,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
