"""Walk-forward meta-selector trained on prior hits from a million Fano slates."""
from __future__ import annotations

from datetime import datetime
import gzip
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
import explore_fano_759 as search

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
HIT_HALF_LIFE = 120.0


def _load_draws():
    _, dated = search._load_draws()
    return dated


def _v5_fallback(prior):
    chronological = [[ord(char) - 48 for char in number] for _, number in prior]
    rankings = fano._v5_signal_rankings(chronological)
    lines = [line for line in range(7) if line != fano.V5_PUNCTURED_LINE - 1]
    points = [point for point in range(7) if point + 1 not in fano.V5_OMITTED_POINTS]
    numbers = []
    for point in points:
        digits = []
        for position, line in enumerate(lines):
            bit = int(point in fano.FANO_LINES[line])
            rank = fano.V5_RANK_PAIRS_BY_POSITION[position][bit]
            signal = fano.V5_SIGNAL_BY_POSITION[position]
            digits.append(str(rankings[signal][position][rank]))
        numbers.append("".join(digits))
    return numbers


def _load_past_hit_events(dated):
    date_index = {day.isoformat(): index for index, (day, _) in enumerate(dated)}
    events_by_target = [[] for _ in dated]
    configurations = {}
    files = sorted((ROOT / ".scratch" / "fano-759-loop" / "million-rounds").glob("hits-*.jsonl.gz"))
    if len(files) != 99:
        raise RuntimeError(f"Expected 99 compressed hit batches, found {len(files)}")
    for path in files:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            for line in stream:
                record = json.loads(line)
                config_id = str(record["config_index"])
                pairs = [search.RANK_PAIRS[index]
                         for index in record["rank_pair_indices"]]
                configuration = {
                    "rank_pairs": pairs,
                    "punctured_line": int(record["punctured_line"]) - 1,
                    "omitted_points": tuple(int(value) - 1
                                             for value in record["omitted_points"]),
                    "hit_indices": [],
                }
                if config_id in configurations:
                    raise RuntimeError(f"Duplicate million-search configuration {config_id}")
                configurations[config_id] = configuration
                for event in record["hit_events"]:
                    index = date_index.get(event["target_date"])
                    if index is None or dated[index][1] != event["actual"]:
                        raise RuntimeError("Sparse hit event does not match the verified draw cache")
                    events_by_target[index].append((config_id, event["matched_candidate"]))
    return configurations, events_by_target, len(files)


def _candidate_support(active, configurations, rankings, target_index):
    support = {}
    for config_id, hit_indices in active.items():
        age_weights = [2.0 ** (-(target_index - index) / HIT_HALF_LIFE)
                       for index in hit_indices]
        weight = sum(age_weights)
        config = configurations[config_id]
        try:
            candidates = search._candidate_numbers(rankings, config)
        except RuntimeError as error:
            raise RuntimeError(
                f"Active variant {config_id} failed at target index {target_index}: {config}"
            ) from error
        for number in candidates:
            support[number] = support.get(number, 0.0) + weight
    return support


def run():
    started = time.perf_counter()
    dated = _load_draws()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} draws, got {len(dated)}")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    configurations, events_by_target, batch_count = _load_past_hit_events(dated)
    rankings_by_target = search._rankings_for_all_targets(dated)
    active = {}
    hits = 0
    hit_dates = []
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        rankings = rankings_by_target[target_index]
        support = _candidate_support(active, configurations, rankings, target_index)
        if support:
            selected = sorted(support,
                              key=lambda number: (-support[number], number))[:5]
            source = "previous-hit-million-variant-pool"
        else:
            selected = _v5_fallback(dated[:target_index])
            source = "fano-v5-fallback"
            support = {number: 0.0 for number in selected}
        if len(selected) != 5 or len(set(selected)) != 5:
            raise RuntimeError("Hit-archive selector must produce five unique tickets")
        hit = actual in selected
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": selected,
            "hit": hit,
            "active_successful_variants_before_target": len(active),
            "selected_candidate_support": [round(support[number], 10) for number in selected],
            "selection_source": source,
        })
        # Only after scoring this target are its million-search hit events activated.
        for config_id, matched_candidate in events_by_target[target_index]:
            if matched_candidate != actual:
                raise RuntimeError("Sparse event's matched string differs from the actual result")
            active.setdefault(config_id, []).append(target_index)
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits, active={len(active)}",
                  flush=True)

    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "a configuration enters the active pool only after one of its exact hits has already occurred; future hit events are not activated until after the corresponding target forecast is scored",
        "model_family": "recency-weighted voting among Fano codebooks that hit earlier draws in the predeclared one-million-variant universe, with v5 fallback before any prior hit",
        "variant_universe_size": 1_000_000,
        "activated_variant_count": len(configurations),
        "compressed_hit_batches": batch_count,
        "hit_recency_half_life_draws": HIT_HALF_LIFE,
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "forecasts": forecasts},
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory meta-model. The one-million-variant pool was evaluated on the same 759 outcomes; its successful variants are activated online only after past hits, but this does not remove selection bias from the pool design",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-35-hit-archive-meta.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "hit_dates": hit_dates,
                      "variant_universe_size": report["variant_universe_size"],
                      "activated_variant_count": report["activated_variant_count"],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
