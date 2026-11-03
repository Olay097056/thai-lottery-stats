"""Continue the bounded Fano-inspired 759-draw search through 1,000,000 variants.

The first 10,000 rounds and Fano v4 baseline are reused from the prior report.
New variants are a seeded, non-repeating affine walk through a large Fano
incidence-codebook configuration space. NumPy tests exact hits by mapping each
actual draw's ranked digits to its Fano incidence word; hit rows are stored as
compressed sparse records, while batch digests cover every zero-hit variant.
"""
from __future__ import annotations

from datetime import datetime
from gzip import open as gzip_open
from hashlib import sha256
from itertools import islice
import json
import math
from pathlib import Path
import random
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import explore_fano_759 as base

MAX_ROUNDS = 1_000_000
INITIAL_ROUNDS = 10_000
BATCH_SIZE = 10_000
RANK_PAIR_COUNT = len(base.RANK_PAIRS)
CODEBOOK_COUNT = 7 * len(base.OMITTED_POINTS)
CONFIG_SPACE = (RANK_PAIR_COUNT ** 6) * CODEBOOK_COUNT
RANK_PAIR_TO_INDEX = {pair: index for index, pair in enumerate(base.RANK_PAIRS)}
OMITTED_ARRAY = np.asarray(base.OMITTED_POINTS, dtype=np.uint8)
PAIR_COMPONENTS = np.asarray(base.RANK_PAIRS, dtype=np.uint8)
POSITION_SHIFTS = np.left_shift(np.uint8(1), np.arange(6, dtype=np.uint8))


def _old_config_index(result):
    rank_pairs = result.get("rank_pairs_by_position")
    if rank_pairs is None:
        rank_pair = tuple(result["rank_pair"])
        rank_pairs = [rank_pair] * 6
    rank_code = 0
    for pair in rank_pairs:
        rank_code = rank_code * RANK_PAIR_COUNT + RANK_PAIR_TO_INDEX[tuple(pair)]
    omitted = tuple(point - 1 for point in result["omitted_points"])
    omitted_index = base.OMITTED_POINTS.index(omitted)
    puncture = result["punctured_line"] - 1
    return rank_code * CODEBOOK_COUNT + puncture * len(base.OMITTED_POINTS) + omitted_index


def _decode_config_index(config_index):
    rank_code, codebook_index = divmod(int(config_index), CODEBOOK_COUNT)
    puncture, omitted_index = divmod(codebook_index, len(base.OMITTED_POINTS))
    rank_indices = [0] * 6
    for position in range(5, -1, -1):
        rank_indices[position] = rank_code % RANK_PAIR_COUNT
        rank_code //= RANK_PAIR_COUNT
    return {
        "rank_pair_indices": rank_indices,
        "rank_pairs": [base.RANK_PAIRS[index] for index in rank_indices],
        "punctured_line": puncture,
        "omitted_index": omitted_index,
        "omitted_points": base.OMITTED_POINTS[omitted_index],
    }


def _lookup_tables():
    point_by_mask = np.full((7, 64), -1, dtype=np.int8)
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        for point in range(7):
            mask = 0
            for position, line in enumerate(retained_lines):
                if point in base.FANO_LINES[line]:
                    mask |= 1 << position
            point_by_mask[puncture, mask] = point
    return point_by_mask


def _prepare_history(dated):
    rankings = np.asarray(base._rankings_for_all_targets(dated), dtype=np.uint8)
    inverse = np.empty_like(rankings)
    for draw_index in range(len(dated)):
        for position in range(6):
            for rank, digit in enumerate(rankings[draw_index, position]):
                inverse[draw_index, position, digit] = rank
    actual_digits = np.asarray(
        [[int(char) for char in actual] for _, actual in dated], dtype=np.uint8
    )
    return rankings, inverse, actual_digits


def _decode_config_batch(config_indices):
    config_indices = np.asarray(config_indices, dtype=np.uint64)
    codebook_indices = config_indices % CODEBOOK_COUNT
    rank_codes = config_indices // CODEBOOK_COUNT
    rank_indices = np.empty((len(config_indices), 6), dtype=np.uint8)
    for position in range(5, -1, -1):
        rank_indices[:, position] = rank_codes % RANK_PAIR_COUNT
        rank_codes //= RANK_PAIR_COUNT
    punctures = (codebook_indices // len(base.OMITTED_POINTS)).astype(np.uint8)
    omitted_indices = (codebook_indices % len(base.OMITTED_POINTS)).astype(np.uint8)
    return rank_indices, punctures, omitted_indices


def _score_batch(config_indices, dated, rankings, inverse, actual_digits,
                 point_by_mask, *, collect_events):
    indices = np.asarray(config_indices, dtype=np.uint64)
    rank_indices, punctures, omitted_indices = _decode_config_batch(indices)
    rank_values = PAIR_COMPONENTS[rank_indices]
    omitted_points = OMITTED_ARRAY[omitted_indices]
    hit_counts = np.zeros(len(indices), dtype=np.uint16)
    hit_events = {}

    for target_index, (target_date, actual) in enumerate(dated):
        actual_ranks = inverse[
            target_index, np.arange(6), actual_digits[target_index]
        ]
        left_match = rank_values[:, :, 0] == actual_ranks[None, :]
        right_match = rank_values[:, :, 1] == actual_ranks[None, :]
        all_digits_available = (left_match | right_match).all(axis=1)
        # POSITION_SHIFTS contains bit weights (1, 2, 4, 8, 16, 32), not
        # shift amounts. Multiply so high positions are not shifted out of uint8.
        bit_masks = (right_match.astype(np.uint8) * POSITION_SHIFTS).sum(
            axis=1, dtype=np.uint8
        )
        points = point_by_mask[punctures, bit_masks]
        hits = (
            all_digits_available
            & (points >= 0)
            & (points != omitted_points[:, 0])
            & (points != omitted_points[:, 1])
        )
        hit_counts += hits
        if collect_events and hits.any():
            for local_index in np.flatnonzero(hits):
                decoded = _decode_config_index(indices[local_index])
                config = {
                    "rank_pairs": decoded["rank_pairs"],
                    "punctured_line": decoded["punctured_line"],
                    "omitted_points": decoded["omitted_points"],
                }
                predicted = base._candidate_numbers(
                    rankings[target_index].tolist(), config
                )
                if actual not in predicted:
                    raise RuntimeError("Vectorized Fano hit failed exact-string verification")
                key = int(local_index)
                hit_events.setdefault(key, []).append({
                    "target_date": target_date.isoformat(),
                    "actual": actual,
                    "matched_candidate": actual,
                })
    return hit_counts, hit_events


def _affine_parameters(seed):
    rng = random.Random(seed)
    offset = rng.randrange(CONFIG_SPACE)
    step = rng.randrange(1, CONFIG_SPACE)
    while math.gcd(step, CONFIG_SPACE) != 1:
        step = rng.randrange(1, CONFIG_SPACE)
    return offset, step


def _next_unique_indices(count, sequence_index, offset, step, prior_indices):
    indices = []
    while len(indices) < count:
        config_index = (offset + sequence_index * step) % CONFIG_SPACE
        sequence_index += 1
        if config_index in prior_indices:
            continue
        indices.append(config_index)
    return indices, sequence_index


def _write_sparse_batch(path, first_round, indices, hit_counts, hit_events):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with gzip_open(temporary, "wt", encoding="utf-8", newline="\n") as stream:
        for local_index, count in enumerate(hit_counts):
            if not count:
                continue
            decoded = _decode_config_index(indices[local_index])
            record = {
                "round": first_round + local_index,
                "config_index": int(indices[local_index]),
                "rank_pair_indices": decoded["rank_pair_indices"],
                "punctured_line": decoded["punctured_line"] + 1,
                "omitted_points": [point + 1 for point in decoded["omitted_points"]],
                "hits": int(count),
                "hit_events": hit_events.get(local_index, []),
            }
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
    temporary.replace(path)


def _read_or_create_progress(progress_path, actuals_sha256, old_report, prior_indices,
                             offset, step):
    if progress_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        if (progress.get("actuals_sha256") != actuals_sha256
                or progress.get("offset") != offset
                or progress.get("step") != step
                or progress.get("starting_report_rounds") != INITIAL_ROUNDS):
            raise RuntimeError("Existing million-round checkpoint does not match this run")
        return progress

    old_variants = old_report["search"]["variants"]
    histogram = {}
    for variant in old_variants:
        key = str(variant["hits"])
        histogram[key] = histogram.get(key, 0) + 1
    progress = {
        "actuals_sha256": actuals_sha256,
        "starting_report_rounds": INITIAL_ROUNDS,
        "next_round": INITIAL_ROUNDS + 1,
        "sequence_index": 0,
        "offset": offset,
        "step": step,
        "rounds_with_hits": sum(count for hits, count in ((int(k), v) for k, v in histogram.items()) if hits > 0),
        "exact_hits_total": sum(int(k) * v for k, v in histogram.items()),
        "hit_histogram": histogram,
        "best_round": old_report["search"]["best_round"],
        "best_hits": old_report["search"]["best_hits"],
        "best_hit_rate_pct": old_report["search"]["best_hit_rate_pct"],
        "best_hit_dates": old_report["search"]["best_hit_dates"],
        "best_configuration": old_report["search"]["best_configuration"],
        "batches": [],
        "threshold_met": False,
        "prior_unique_configs": len(prior_indices),
    }
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")
    return progress


def main():
    started = time.perf_counter()
    prior_path = ROOT / ".scratch" / "fano-759-loop" / "results-2026-10-15-10000.json"
    prior_report = json.loads(prior_path.read_text(encoding="utf-8"))
    history, dated = base._load_draws()
    actuals_sha256 = base._actuals_fingerprint(dated)
    if (len(dated) != 759 or prior_report.get("actuals_sha256") != actuals_sha256
            or prior_report["search"].get("rounds_completed") != INITIAL_ROUNDS):
        raise RuntimeError("The 10,000-round result does not match the current 759-draw cache")

    old_variants = prior_report["search"]["variants"]
    prior_indices = {_old_config_index(variant) for variant in old_variants}
    if len(prior_indices) != INITIAL_ROUNDS:
        raise RuntimeError("The first 10,000 configurations are not unique")

    rankings, inverse, actual_digits = _prepare_history(dated)
    point_by_mask = _lookup_tables()

    # Validate the fast exact-match test against every previously recorded round.
    old_hits = []
    old_config_indices = []
    for variant in old_variants:
        old_hits.append(variant["hits"])
        old_config_indices.append(_old_config_index(variant))
    for offset in range(0, INITIAL_ROUNDS, BATCH_SIZE):
        stop = min(offset + BATCH_SIZE, INITIAL_ROUNDS)
        computed, _ = _score_batch(
            old_config_indices[offset:stop], dated, rankings, inverse, actual_digits,
            point_by_mask, collect_events=False,
        )
        if computed.tolist() != old_hits[offset:stop]:
            raise RuntimeError(f"Exact-hit validation failed for prior rounds {offset + 1}-{stop}")
    print("validated vectorized scorer against all 10,000 prior round counts", flush=True)

    offset, step = _affine_parameters(base.CONFIG_SEED + 1)
    out_dir = ROOT / ".scratch" / "fano-759-loop" / "million-rounds"
    out_dir.mkdir(parents=True, exist_ok=True)
    progress_path = ROOT / ".scratch" / "fano-759-loop" / "progress-1000000.json"
    progress = _read_or_create_progress(
        progress_path, actuals_sha256, prior_report, prior_indices, offset, step
    )
    if progress["next_round"] > MAX_ROUNDS:
        print("million-round run is already complete", flush=True)
        return
    if progress["next_round"] == INITIAL_ROUNDS + 1:
        print("resuming at round 10001; baseline and first 10,000 rounds reused", flush=True)
    else:
        print(f"resuming at round {progress['next_round']}; prior checkpoints reused", flush=True)

    while progress["next_round"] <= MAX_ROUNDS:
        first_round = progress["next_round"]
        batch_size = min(BATCH_SIZE, MAX_ROUNDS - first_round + 1)
        indices, sequence_index = _next_unique_indices(
            batch_size, progress["sequence_index"], offset, step, prior_indices
        )
        hit_counts, hit_events = _score_batch(
            indices, dated, rankings, inverse, actual_digits, point_by_mask,
            collect_events=True,
        )
        last_round = first_round + batch_size - 1
        chunk_name = f"hits-{first_round:07d}-{last_round:07d}.jsonl.gz"
        chunk_path = out_dir / chunk_name
        _write_sparse_batch(chunk_path, first_round, indices, hit_counts, hit_events)

        digest_rows = np.empty(batch_size, dtype=np.dtype([("config_index", ">u8"), ("hits", ">u2")]))
        digest_rows["config_index"] = np.asarray(indices, dtype=np.uint64)
        digest_rows["hits"] = hit_counts
        batch_digest = sha256(digest_rows.tobytes()).hexdigest()
        histogram = np.bincount(hit_counts.astype(np.int64))
        for hit_count, quantity in enumerate(histogram):
            if quantity:
                key = str(hit_count)
                progress["hit_histogram"][key] = progress["hit_histogram"].get(key, 0) + int(quantity)
        progress["rounds_with_hits"] += int(np.count_nonzero(hit_counts))
        progress["exact_hits_total"] += int(hit_counts.sum())
        progress["batches"].append({
            "rounds": [first_round, last_round],
            "sparse_hit_records": int(np.count_nonzero(hit_counts)),
            "exact_hits": int(hit_counts.sum()),
            "max_hits_in_variant": int(hit_counts.max(initial=0)),
            "config_hit_digest_sha256": batch_digest,
            "artifact": str(chunk_path.relative_to(ROOT)),
        })
        batch_best_hits = int(hit_counts.max(initial=0))
        if batch_best_hits > progress["best_hits"]:
            local_best = int(np.flatnonzero(hit_counts == batch_best_hits)[0])
            best_index = indices[local_best]
            best_config = _decode_config_index(best_index)
            progress["best_round"] = first_round + local_best
            progress["best_hits"] = batch_best_hits
            progress["best_hit_rate_pct"] = round(100 * batch_best_hits / len(dated), 8)
            progress["best_hit_dates"] = [
                event["target_date"] for event in hit_events.get(local_best, [])
            ]
            progress["best_configuration"] = {
                "config_index": int(best_index),
                "rank_pairs_by_position": [list(pair) for pair in best_config["rank_pairs"]],
                "punctured_line": best_config["punctured_line"] + 1,
                "omitted_points": [point + 1 for point in best_config["omitted_points"]],
            }
        if batch_best_hits >= base.TARGET_HITS_FOR_10_PERCENT:
            crossing_local = int(np.flatnonzero(hit_counts >= base.TARGET_HITS_FOR_10_PERCENT)[0])
            progress["threshold_met"] = True
            progress["threshold_round"] = first_round + crossing_local
        progress["next_round"] = last_round + 1
        progress["sequence_index"] = sequence_index
        progress["elapsed_seconds_this_run"] = round(time.perf_counter() - started, 3)
        progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")

        print(
            f"rounds {first_round}-{last_round}/{MAX_ROUNDS}: "
            f"{int(hit_counts.sum())} exact hits in this batch; "
            f"best {progress['best_hits']}/{len(dated)}",
            flush=True,
        )
        if progress["threshold_met"]:
            break

    progress["complete"] = progress["next_round"] > MAX_ROUNDS or progress["threshold_met"]
    progress["total_unique_variants"] = progress["next_round"] - 1
    progress["elapsed_seconds_this_run"] = round(time.perf_counter() - started, 3)
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "run_date": base.RUN_DATE,
        "draw_count": len(dated),
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": actuals_sha256,
        "target": "exact six-digit prize1; five distinct candidates; one hit maximum per draw",
        "walk_forward": "strictly pre-target history; all accessible valid prior draws; every one of 759 target dates scored",
        "sparse_history_policy": "research-only smoothed prior for the first targets with fewer than 20 prior draws; production minimum remains 20",
        "reused_initial_report": str(prior_path.relative_to(ROOT)),
        "baseline_v4": {
            "draws": prior_report["baseline"]["draws"],
            "hits": prior_report["baseline"]["hits"],
            "hit_rate_pct": prior_report["baseline"]["hit_rate_pct"],
        },
        "search": {
            "maximum_rounds": MAX_ROUNDS,
            "rounds_completed": progress["total_unique_variants"],
            "new_rounds_completed": progress["total_unique_variants"] - INITIAL_ROUNDS,
            "unique_configurations": progress["total_unique_variants"],
            "configuration_space_size": CONFIG_SPACE,
            "configuration_sequence": {
                "method": "seeded affine permutation modulo the configuration-space size; duplicate prior 10,000 configurations skipped",
                "seed": base.CONFIG_SEED + 1,
                "offset": offset,
                "step": step,
                "coprime_step": math.gcd(step, CONFIG_SPACE) == 1,
                "next_sequence_index": progress["sequence_index"],
            },
            "threshold": ">10% exact-hit rate",
            "hits_required": base.TARGET_HITS_FOR_10_PERCENT,
            "threshold_met": progress["threshold_met"],
            "threshold_round": progress.get("threshold_round"),
            "best_round": progress["best_round"],
            "best_hits": progress["best_hits"],
            "best_hit_rate_pct": progress["best_hit_rate_pct"],
            "best_hit_dates": progress["best_hit_dates"],
            "best_configuration": progress["best_configuration"],
            "variants_with_at_least_one_hit": progress["rounds_with_hits"],
            "total_exact_hits_across_variants": progress["exact_hits_total"],
            "hit_count_histogram": progress["hit_histogram"],
            "batch_digests_and_hit_artifacts": progress["batches"],
        },
        "interpretation": "The selected historical winner is post-hoc because the same 759 outcomes were searched and scored; it is not independent evidence of future advantage and is not promoted to the live formula.",
        "elapsed_seconds_this_run": progress["elapsed_seconds_this_run"],
        "progress_file": str(progress_path.relative_to(ROOT)),
    }
    output = ROOT / ".scratch" / "fano-759-loop" / f"results-{base.RUN_DATE}-1000000.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "rounds_completed": progress["total_unique_variants"],
        "best_round": progress["best_round"],
        "best_hits": progress["best_hits"],
        "best_hit_rate_pct": progress["best_hit_rate_pct"],
        "variants_with_hits": progress["rounds_with_hits"],
        "threshold_met": progress["threshold_met"],
        "result_file": str(output),
        "elapsed_seconds": progress["elapsed_seconds_this_run"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
