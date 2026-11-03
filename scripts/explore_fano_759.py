"""Bounded Fano-inspired exact-prize walk-forward exploration (max 10,000 variants).

This script reads the existing cache only. Every forecast for target i uses
history strictly before i. It intentionally evaluates all 759 targets by
allowing sparse/uniform-smoothed Fano priors for early targets; the production
formula's 20-draw live minimum is not changed. Selecting the best of these
variants on the same 759 targets is exploratory and is not an independent
estimate of future performance.
"""
from __future__ import annotations

from datetime import date, datetime
from itertools import combinations
import argparse
import hashlib
import json
import random
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

RUN_DATE = datetime.now(astra.THAILAND_TZ).date().isoformat()
GENERATION_DAY = date.fromisoformat(RUN_DATE)
TARGET_HITS_FOR_10_PERCENT = 76  # strict >10% of 759 targets
MAX_ROUNDS = 10_000
FANO_LINES = fano.FANO_LINES
RANK_PAIRS = tuple(combinations(range(10), 2))
OMITTED_POINTS = tuple(combinations(range(7), 2))
CODEBOOKS_PER_RANK_PAIR = 7 * len(OMITTED_POINTS)
LEGACY_CONFIG_SPACE = len(RANK_PAIRS) * CODEBOOKS_PER_RANK_PAIR
CONFIG_SEED = 20261015


def _load_draws():
    history = astra.load_existing_astra_history()
    dated = []
    for row in history:
        values = astra._category_values(row, "prize1", 6)
        if values is None:
            continue
        draw_date = astra._history_date(row["date"])
        dated.append((draw_date, values[0]))
    dated.sort()
    if len(dated) != 759:
        raise RuntimeError(f"Expected 759 valid prize-1 draws; found {len(dated)}")
    if len({draw_date for draw_date, _ in dated}) != len(dated):
        raise RuntimeError("Valid prize-1 history has duplicate target dates")
    return history, dated


def _legacy_variant_config(round_index):
    # A deterministic, evenly spaced sweep through the Fano codebook family:
    # 45 ranked digit-pairs x 7 punctures x 21 choices of five codewords.
    config_index = round_index * (LEGACY_CONFIG_SPACE // 100)
    rank_pair_index, codebook_index = divmod(config_index, CODEBOOKS_PER_RANK_PAIR)
    puncture, omit_index = divmod(codebook_index, len(OMITTED_POINTS))
    rank_pair = RANK_PAIRS[rank_pair_index]
    return {
        "rank_pair": rank_pair,
        "rank_pairs": [rank_pair] * 6,
        "punctured_line": puncture,
        "omitted_points": OMITTED_POINTS[omit_index],
    }


def _config_key(config):
    return (
        tuple(tuple(pair) for pair in config["rank_pairs"]),
        config["punctured_line"],
        tuple(config["omitted_points"]),
    )


def _variant_configs(rounds):
    if not 1 <= rounds <= MAX_ROUNDS:
        raise ValueError(f"rounds must be between 1 and {MAX_ROUNDS}")
    configs = [_legacy_variant_config(index) for index in range(min(rounds, 100))]
    seen = {_config_key(config) for config in configs}
    rng = random.Random(CONFIG_SEED)
    while len(configs) < rounds:
        config = {
            "rank_pairs": [tuple(sorted(rng.sample(range(10), 2))) for _ in range(6)],
            "punctured_line": rng.randrange(7),
            "omitted_points": tuple(sorted(rng.sample(range(7), 2))),
        }
        key = _config_key(config)
        if key in seen:
            continue
        seen.add(key)
        configs.append(config)
    return configs


def _candidate_numbers(rankings, config):
    retained_lines = [
        line_index for line_index in range(len(FANO_LINES))
        if line_index != config["punctured_line"]
    ]
    omitted = set(config["omitted_points"])
    numbers = []
    for point in range(7):
        if point in omitted:
            continue
        digits = []
        for position, line_index in enumerate(retained_lines):
            bit = int(point in FANO_LINES[line_index])
            rank = config["rank_pairs"][position][bit]
            digits.append(str(rankings[position][rank]))
        numbers.append("".join(digits))
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano codebook did not produce five distinct six-digit candidates")
    return numbers


def _history_rankings(position_counts):
    return [
        sorted(range(10), key=lambda digit: (-position_counts[pos][digit], digit))
        for pos in range(6)
    ]


def _rankings_for_all_targets(dated):
    position_counts = [[0] * 10 for _ in range(6)]
    rankings = []
    for _, actual in dated:
        rankings.append(_history_rankings(position_counts))
        for position, char in enumerate(actual):
            position_counts[position][int(char)] += 1
    return rankings


def _run_v4_baseline(history, dated):
    baseline = []
    # Research-only sparse prior: smoothing and deterministic tie-breaking make
    # the existing Fano v4 builder defined even for the earliest targets.
    original_minimum = fano.MIN_VALID_DRAWS
    fano.MIN_VALID_DRAWS = 0
    try:
        for index, (target, actual) in enumerate(dated):
            target_iso = target.isoformat()
            forecast = fano._formula_forecast_from_history(
                history, target_iso, target, GENERATION_DAY, allow_insufficient=True
            )
            predicted = forecast.get("numbers")
            if (not isinstance(predicted, list) or len(predicted) != 5
                    or len(set(predicted)) != 5
                    or any(len(n) != 6 or not n.isascii() or not n.isdigit() for n in predicted)):
                raise RuntimeError(f"Invalid Fano v4 forecast at {target_iso}")
            baseline.append({
                "target_date": target_iso,
                "actual": actual,
                "predicted": predicted,
                "prior_valid_draws": forecast["provenance"]["valid_draws"],
                "hit": actual in predicted,
            })
            if (index + 1) % 50 == 0:
                print(f"baseline: {index + 1}/759", flush=True)
    finally:
        fano.MIN_VALID_DRAWS = original_minimum
    return baseline


def _run_variant_sweep(dated, rankings_by_target, configs, prior_results=None, checkpoint_path=None):
    results = list(prior_results or [])
    all_hit_rows = [
        {"round": result["round"], "target_date": target_date}
        for result in results for target_date in result.get("hit_dates", [])
    ]
    for round_index in range(len(results), len(configs)):
        config = configs[round_index]
        hit_dates = []
        hit_rows = []
        prediction_hash = hashlib.sha256()
        for (target, actual), rankings in zip(dated, rankings_by_target):
            target_iso = target.isoformat()
            predicted = _candidate_numbers(rankings, config)
            prediction_hash.update(
                f"{target_iso}|{','.join(predicted)}\n".encode("ascii")
            )
            if actual in predicted:
                hit_dates.append(target_iso)
                hit_rows.append({
                    "round": round_index + 1,
                    "target_date": target_iso,
                    "actual": actual,
                    "predicted": predicted,
                })
        hits = len(hit_dates)
        result = {
            "round": round_index + 1,
            "rank_pair": list(config["rank_pair"]) if "rank_pair" in config else None,
            "rank_pairs_by_position": [list(pair) for pair in config["rank_pairs"]],
            "punctured_line": config["punctured_line"] + 1,
            "omitted_points": [point + 1 for point in config["omitted_points"]],
            "draws": len(dated),
            "hits": hits,
            "hit_rate_pct": round(100 * hits / len(dated), 8),
            "hit_dates": hit_dates,
            "forecast_sha256": prediction_hash.hexdigest(),
        }
        results.append(result)
        all_hit_rows.extend(hit_rows)
        if (round_index + 1) % 100 == 0 or hits > 0:
            print(f"round {round_index + 1}/{len(configs)}: {hits}/{len(dated)} exact hits ({result['hit_rate_pct']:.5f}%)", flush=True)
        if checkpoint_path and (round_index + 1) % 250 == 0:
            checkpoint_path.write_text(json.dumps({
                "rounds_completed": len(results),
                "best_hits": max((item["hits"] for item in results), default=0),
                "variants": results,
            }, ensure_ascii=False), encoding="utf-8")
        if result["hit_rate_pct"] > 10.0:
            break
    return results, all_hit_rows


def _actuals_fingerprint(dated):
    material = "\n".join(
        f"{draw.isoformat()}|{actual}" for draw, actual in dated
    ).encode("ascii")
    return hashlib.sha256(material).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rounds", type=int, default=100)
    parser.add_argument("--resume", type=Path, help="resume from a prior result JSON without rerunning its baseline")
    args = parser.parse_args()
    started = time.perf_counter()
    if not 1 <= args.rounds <= MAX_ROUNDS:
        parser.error(f"--rounds must be between 1 and {MAX_ROUNDS}")
    history, dated = _load_draws()
    print(
        f"cache verified: {len(dated)} valid unique draws, "
        f"{dated[0][0].isoformat()} through {dated[-1][0].isoformat()}",
        flush=True,
    )
    actuals_sha256 = _actuals_fingerprint(dated)
    previous_report = None
    previous_results = []
    if args.resume:
        previous_report = json.loads(args.resume.read_text(encoding="utf-8"))
        if (previous_report.get("draw_count") != len(dated)
                or previous_report.get("actuals_sha256") != actuals_sha256
                or previous_report.get("date_range") != [dated[0][0].isoformat(), dated[-1][0].isoformat()]):
            parser.error("resume result does not match the current 759-draw cache")
        previous_results = previous_report.get("search", {}).get("variants", [])
        if ([item.get("round") for item in previous_results]
                != list(range(1, len(previous_results) + 1))):
            parser.error("resume result must contain a consecutive variant sequence")
        if len(previous_results) >= args.rounds:
            parser.error("--rounds must exceed the number of rounds already completed")
        baseline = previous_report.get("baseline", {}).get("per_draw", [])
        if len(baseline) != len(dated):
            parser.error("resume result does not contain the full 759-draw baseline")
        print(f"resuming at round {len(previous_results) + 1}; baseline reused", flush=True)
    else:
        baseline = _run_v4_baseline(history, dated)
    baseline_hits = sum(row["hit"] for row in baseline)
    configs = _variant_configs(args.rounds)
    rankings_by_target = _rankings_for_all_targets(dated)
    checkpoint_path = ROOT / ".scratch" / "fano-759-loop" / f"checkpoint-{RUN_DATE}.json"
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    variants, hit_rows = _run_variant_sweep(
        dated, rankings_by_target, configs,
        prior_results=previous_results,
        checkpoint_path=checkpoint_path,
    )
    best = min(variants, key=lambda item: (-item["hits"], item["round"]))
    hit_threshold_met = best["hit_rate_pct"] > 10.0
    if previous_report:
        report = previous_report
    else:
        report = {
            "run_date": RUN_DATE,
            "data_source": "existing lottery_cache.csv only; no refresh or external data",
            "draw_count": len(dated),
            "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
            "actuals_sha256": actuals_sha256,
            "target": "exact six-digit prize1; one hit maximum per draw; five distinct candidates per forecast",
            "walk_forward": "every forecast used only cache rows strictly earlier than its target date; all accessible valid prior draws were used",
            "sparse_history_policy": "research-only zero-count smoothed prior for targets with fewer than 20 prior valid draws; production minimum remains 20",
            "baseline": {
                "formula": fano.VERSION,
                "draws": len(baseline),
                "hits": baseline_hits,
                "hit_rate_pct": round(100 * baseline_hits / len(baseline), 8),
                "uniform_expected_hits": len(baseline) * 5 / 1_000_000,
                "per_draw": baseline,
            },
            "selection_warning": "The best variant was selected using the same 759 outcomes it was scored on; this is a post-hoc exploratory result, not an independent backtest or evidence of future advantage.",
        }
    report["search"] = {
        "method": "Fano incidence-codebook variants; first 100 preserve the original global rank-pair sweep; later variants select a ranked digit-pair independently at each of six positions; all use full strictly-prior history, a punctured Fano line, and five of seven code points",
        "configuration_seed": CONFIG_SEED,
        "maximum_rounds": args.rounds,
        "rounds_completed": len(variants),
        "threshold": ">10% exact hit rate",
        "threshold_hits_required": TARGET_HITS_FOR_10_PERCENT,
        "threshold_met": hit_threshold_met,
        "best_round": best["round"],
        "best_hits": best["hits"],
        "best_hit_rate_pct": best["hit_rate_pct"],
        "best_configuration": {
            "rank_pair": best.get("rank_pair"),
            "rank_pairs_by_position": best.get("rank_pairs_by_position"),
            "punctured_line": best["punctured_line"],
            "omitted_points": best["omitted_points"],
        },
        "best_hit_dates": best["hit_dates"],
        "variants": variants,
        "hit_rows": report.get("search", {}).get("hit_rows", []) + [
            {"round": row["round"], "target_date": row["target_date"],
             "actual": row["actual"], "predicted": row["predicted"]}
            for row in hit_rows if "actual" in row
        ],
    }
    run_seconds = round(time.perf_counter() - started, 3)
    report["elapsed_seconds_this_run"] = run_seconds
    if previous_report:
        report["elapsed_seconds_total_estimated"] = round(
            previous_report.get("elapsed_seconds_total_estimated",
                                previous_report.get("elapsed_seconds", 0)) + run_seconds,
            3,
        )
    else:
        report["elapsed_seconds_total_estimated"] = run_seconds
    report["elapsed_seconds"] = report["elapsed_seconds_total_estimated"]
    output = ROOT / ".scratch" / "fano-759-loop" / f"results-{RUN_DATE}-{args.rounds}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if checkpoint_path.exists():
        checkpoint_path.unlink()
    print(json.dumps({
        "baseline_hits": baseline_hits,
        "rounds_completed": len(variants),
        "best_round": best["round"],
        "best_hits": best["hits"],
        "best_hit_rate_pct": best["hit_rate_pct"],
        "threshold_met": hit_threshold_met,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
