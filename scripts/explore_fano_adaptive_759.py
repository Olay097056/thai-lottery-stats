"""Walk-forward search of an adaptive Fano-inspired rank-code family.

Unlike the fixed-rank-pair sweep, each target uses a rank order recomputed from
strictly prior draws. A configuration chooses, per digit position, both a
history signal and two ranks from that signal, then maps those pairs through a
five-word punctured Fano incidence codebook. This is an exploratory research
runner; it does not update or promote a production formula.
"""
from __future__ import annotations

from datetime import datetime
from hashlib import sha256
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

RUN_DATE = base.RUN_DATE
DRAW_COUNT = 759
TARGET_HITS = base.TARGET_HITS_FOR_10_PERCENT
MAX_ROUNDS_PER_STAGE = 1_000_000
BATCH_SIZE = 10_000
SIGNALS = (
    ("all-history", None),
    ("rolling-24", 24),
    ("rolling-60", 60),
    ("rolling-120", 120),
    ("rolling-240", 240),
    ("ewm-half-life-24", 24),
    ("ewm-half-life-96", 96),
    ("previous-digit-transition", None),
)
RANK_PAIR_COUNT = len(base.RANK_PAIRS)
SIGNAL_COUNT = len(SIGNALS)
POSITION_OPTION_COUNT = SIGNAL_COUNT * RANK_PAIR_COUNT
CODEBOOK_COUNT = 7 * len(base.OMITTED_POINTS)
CONFIG_SPACE = POSITION_OPTION_COUNT ** 6 * CODEBOOK_COUNT
PAIR_COMPONENTS = np.asarray(base.RANK_PAIRS, dtype=np.uint8)
OMITTED_ARRAY = np.asarray(base.OMITTED_POINTS, dtype=np.uint8)
BIT_WEIGHTS = np.left_shift(np.uint8(1), np.arange(6, dtype=np.uint8))


def _load_actuals():
    _, dated = base._load_draws()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid draws, found {len(dated)}")
    actuals = np.asarray([[int(c) for c in value] for _, value in dated], dtype=np.uint8)
    return dated, actuals


def _rank_by_score(scores, tie_scores=None):
    if tie_scores is None:
        return np.asarray(
            [sorted(range(10), key=lambda d: (-float(scores[d]), d))],
            dtype=np.uint8,
        )[0]
    return np.asarray(
        [sorted(range(10), key=lambda d: (-float(scores[d]), -float(tie_scores[d]), d))],
        dtype=np.uint8,
    )[0]


def _rank_signal_bank(actuals):
    """Return [signal,target,position,rank] digit rankings using prior draws only."""
    draw_count = len(actuals)
    bank = np.empty((SIGNAL_COUNT, draw_count, 6, 10), dtype=np.uint8)
    for target in range(draw_count):
        prior = actuals[:target]
        global_counts = np.zeros((6, 10), dtype=np.float64)
        for draw in prior:
            for pos, digit in enumerate(draw):
                global_counts[pos, int(digit)] += 1.0
        for pos in range(6):
            bank[0, target, pos] = _rank_by_score(global_counts[pos])

        for signal_index, window in ((1, 24), (2, 60), (3, 120), (4, 240)):
            recent = prior[-window:]
            counts = np.zeros((6, 10), dtype=np.float64)
            for draw in recent:
                for pos, digit in enumerate(draw):
                    counts[pos, int(digit)] += 1.0
            for pos in range(6):
                bank[signal_index, target, pos] = _rank_by_score(counts[pos])

        for signal_index, half_life in ((5, 24), (6, 96)):
            weighted = np.zeros((6, 10), dtype=np.float64)
            if target:
                ages = np.arange(target - 1, -1, -1, dtype=np.float64)
                weights = np.exp2(-ages / half_life)
                for draw_index, draw in enumerate(prior):
                    for pos, digit in enumerate(draw):
                        weighted[pos, int(digit)] += weights[draw_index]
            for pos in range(6):
                bank[signal_index, target, pos] = _rank_by_score(weighted[pos])

        transition_counts = np.zeros((6, 10), dtype=np.float64)
        if target >= 2:
            context = actuals[target - 1]
            for draw_index in range(1, target):
                previous = actuals[draw_index - 1]
                current = actuals[draw_index]
                for pos in range(6):
                    if previous[pos] == context[pos]:
                        transition_counts[pos, int(current[pos])] += 1.0
            for pos in range(6):
                prior_prob = (global_counts[pos] + 1.0) / (target + 10.0)
                smoothed = transition_counts[pos] + 5.0 * prior_prob
                bank[7, target, pos] = _rank_by_score(smoothed, global_counts[pos])
        else:
            for pos in range(6):
                bank[7, target, pos] = _rank_by_score(global_counts[pos])

    inverse = np.empty_like(bank)
    for signal in range(SIGNAL_COUNT):
        for target in range(draw_count):
            for pos in range(6):
                inverse[signal, target, pos, bank[signal, target, pos]] = np.arange(10, dtype=np.uint8)
    return bank, inverse


def _point_by_mask():
    table = np.full((7, 64), -1, dtype=np.int8)
    for puncture in range(7):
        retained = [line for line in range(7) if line != puncture]
        for point in range(7):
            mask = sum(
                (1 << position)
                for position, line in enumerate(retained)
                if point in base.FANO_LINES[line]
            )
            table[puncture, mask] = point
    return table


def _decode_batch(config_indices):
    indices = np.asarray(config_indices, dtype=np.uint64)
    codebook_indices = indices % CODEBOOK_COUNT
    code_codes = indices // CODEBOOK_COUNT
    signals = np.empty((len(indices), 6), dtype=np.uint8)
    pair_indices = np.empty((len(indices), 6), dtype=np.uint8)
    for pos in range(5, -1, -1):
        option = code_codes % POSITION_OPTION_COUNT
        signals[:, pos] = option // RANK_PAIR_COUNT
        pair_indices[:, pos] = option % RANK_PAIR_COUNT
        code_codes //= POSITION_OPTION_COUNT
    punctures = (codebook_indices // len(base.OMITTED_POINTS)).astype(np.uint8)
    omitted_indices = (codebook_indices % len(base.OMITTED_POINTS)).astype(np.uint8)
    return signals, pair_indices, punctures, omitted_indices


def _score_batch(config_indices, dated, actuals, inverse, point_table):
    indices = np.asarray(config_indices, dtype=np.uint64)
    signals, pair_indices, punctures, omitted_indices = _decode_batch(indices)
    pairs = PAIR_COMPONENTS[pair_indices]
    omitted = OMITTED_ARRAY[omitted_indices]
    hit_counts = np.zeros(len(indices), dtype=np.uint16)
    hit_dates = {}
    positions = np.arange(6)
    for target, (target_date, _) in enumerate(dated):
        actual_ranks = inverse[
            signals,
            target,
            positions[None, :],
            actuals[target][None, :],
        ]
        left = pairs[:, :, 0] == actual_ranks
        right = pairs[:, :, 1] == actual_ranks
        available = (left | right).all(axis=1)
        masks = (right.astype(np.uint8) * BIT_WEIGHTS).sum(axis=1, dtype=np.uint8)
        points = point_table[punctures, masks]
        hits = available & (points >= 0) & (points != omitted[:, 0]) & (points != omitted[:, 1])
        hit_counts += hits
        if hits.any():
            hit_dates[target] = np.flatnonzero(hits)
    return hit_counts, hit_dates


def _decode_one(index):
    signals, pair_indices, puncture, omitted = _decode_batch([index])
    return {
        "signals_by_position": [SIGNALS[int(signal)][0] for signal in signals[0]],
        "rank_pairs_by_position": [list(base.RANK_PAIRS[int(pair)]) for pair in pair_indices[0]],
        "punctured_line": int(puncture[0]) + 1,
        "omitted_points": [point + 1 for point in base.OMITTED_POINTS[int(omitted[0])]],
    }


def _main():
    started = time.perf_counter()
    dated, actuals = _load_actuals()
    actuals_sha = base._actuals_fingerprint(dated)
    prior_report_path = ROOT / ".scratch" / "fano-759-loop" / "results-2026-10-15-1000000.json"
    prior_report = json.loads(prior_report_path.read_text(encoding="utf-8"))
    if prior_report["actuals_sha256"] != actuals_sha:
        raise RuntimeError("Existing backtest history fingerprint changed")

    out_dir = ROOT / ".scratch" / "fano-adaptive-759"
    out_dir.mkdir(parents=True, exist_ok=True)
    progress_path = out_dir / "progress.json"
    result_path = out_dir / f"results-{RUN_DATE}-stage-1.json"
    if progress_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        if progress.get("actuals_sha256") != actuals_sha or progress.get("stage") != 1:
            raise RuntimeError("Adaptive Fano checkpoint does not match this data/stage")
    else:
        seed = 20261016
        rng = random.Random(seed)
        offset = rng.randrange(CONFIG_SPACE)
        step = rng.randrange(1, CONFIG_SPACE)
        while math.gcd(step, CONFIG_SPACE) != 1:
            step = rng.randrange(1, CONFIG_SPACE)
        progress = {
            "stage": 1,
            "actuals_sha256": actuals_sha,
            "rounds_completed": 0,
            "sequence_index": 0,
            "offset": offset,
            "step": step,
            "seed": seed,
            "best_round": None,
            "best_hits": 0,
            "best_hit_dates": [],
            "best_config_index": None,
            "best_configuration": None,
            "variants_with_hits": 0,
            "total_exact_hits": 0,
            "histogram": {},
            "threshold_met": False,
            "batches": [],
        }
        progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")

    rankings, inverse = _rank_signal_bank(actuals)
    if rankings.shape != (SIGNAL_COUNT, DRAW_COUNT, 6, 10):
        raise RuntimeError("Unexpected signal-bank shape")
    # Confirm that every signal ranking is a permutation and inspect the causal boundary.
    if any(sorted(row.tolist()) != list(range(10)) for row in rankings[0, :, 0, :]):
        raise RuntimeError("Signal ranking contains duplicate/missing digits")
    point_table = _point_by_mask()

    while progress["rounds_completed"] < MAX_ROUNDS_PER_STAGE and not progress["threshold_met"]:
        first_round = progress["rounds_completed"] + 1
        count = min(BATCH_SIZE, MAX_ROUNDS_PER_STAGE - progress["rounds_completed"])
        seq = progress["sequence_index"]
        start = (progress["offset"] + seq * progress["step"]) % CONFIG_SPACE
        indices = []
        current = start
        for _ in range(count):
            indices.append(current)
            current += progress["step"]
            if current >= CONFIG_SPACE:
                current %= CONFIG_SPACE
        progress["sequence_index"] += count
        hit_counts, hit_dates_by_target = _score_batch(indices, dated, actuals, inverse, point_table)
        rounds = np.arange(first_round, first_round + count, dtype=np.uint32)
        progress["rounds_completed"] += count
        progress["variants_with_hits"] += int(np.count_nonzero(hit_counts))
        progress["total_exact_hits"] += int(hit_counts.sum())
        for hits, quantity in enumerate(np.bincount(hit_counts.astype(np.int64))):
            if quantity:
                key = str(hits)
                progress["histogram"][key] = progress["histogram"].get(key, 0) + int(quantity)
        batch_best = int(hit_counts.max(initial=0))
        if batch_best > progress["best_hits"]:
            local = int(np.flatnonzero(hit_counts == batch_best)[0])
            chosen_index = int(indices[local])
            progress["best_round"] = int(rounds[local])
            progress["best_hits"] = batch_best
            progress["best_config_index"] = chosen_index
            progress["best_configuration"] = _decode_one(chosen_index)
            progress["best_hit_dates"] = [
                dated[target][0].isoformat()
                for target, matching_rounds in hit_dates_by_target.items()
                if local in matching_rounds
            ]
        if batch_best >= TARGET_HITS:
            crossing = int(np.flatnonzero(hit_counts >= TARGET_HITS)[0])
            progress["threshold_met"] = True
            progress["threshold_round"] = first_round + crossing
        digest = sha256(
            np.column_stack((np.asarray(indices, dtype=np.uint64), hit_counts.astype(np.uint64))).tobytes()
        ).hexdigest()
        progress["batches"].append({
            "rounds": [first_round, first_round + count - 1],
            "exact_hits": int(hit_counts.sum()),
            "best_hits": batch_best,
            "digest_sha256": digest,
        })
        progress["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            f"adaptive Fano rounds {first_round}-{first_round + count - 1}/"
            f"{MAX_ROUNDS_PER_STAGE}: batch hits {int(hit_counts.sum())}; "
            f"best {progress['best_hits']}/{DRAW_COUNT}",
            flush=True,
        )

    result = {
        "run_date": RUN_DATE,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": actuals_sha,
        "target": "exact six-digit prize1; five distinct Fano-incidence candidates per target",
        "walk_forward": "each target ranking uses only prior valid draws; all 759 target dates scored, including research-only sparse history",
        "adaptive_signal_bank": [{"name": name, "window_or_half_life": window} for name, window in SIGNALS],
        "configuration": "for each of six positions, select one of eight target-adaptive signals and one ranked digit pair; map through a punctured Fano codebook retaining five of seven points",
        "baseline_v4": {
            "draws": prior_report["baseline_v4"]["draws"],
            "hits": prior_report["baseline_v4"]["hits"],
            "hit_rate_pct": prior_report["baseline_v4"]["hit_rate_pct"],
        },
        "search": {
            "stage": progress["stage"],
            "rounds_completed": progress["rounds_completed"],
            "unique_configurations": progress["rounds_completed"],
            "configuration_space_size": CONFIG_SPACE,
            "signals": [{"name": name, "window_or_half_life": window} for name, window in SIGNALS],
            "threshold": ">10% exact-hit rate",
            "hits_required": TARGET_HITS,
            "threshold_met": progress["threshold_met"],
            "threshold_round": progress.get("threshold_round"),
            "best_round": progress["best_round"],
            "best_hits": progress["best_hits"],
            "best_hit_rate_pct": round(100 * progress["best_hits"] / DRAW_COUNT, 8),
            "best_hit_dates": progress["best_hit_dates"],
            "best_configuration": progress["best_configuration"],
            "variants_with_at_least_one_hit": progress["variants_with_hits"],
            "total_exact_hits_across_variants": progress["total_exact_hits"],
            "hit_count_histogram": progress["histogram"],
            "seed": progress["seed"],
            "offset": progress["offset"],
            "step": progress["step"],
            "coprime_step": math.gcd(progress["step"], CONFIG_SPACE) == 1,
            "batches": progress["batches"],
        },
        "interpretation": "Exploratory retrospective tuning: every individual forecast is walk-forward, but the winning configuration is selected from the same 759 outcomes and is not independent evidence. Not promoted to the production formula.",
        "elapsed_seconds": progress.get("elapsed_seconds"),
        "progress_file": str(progress_path.relative_to(ROOT)),
    }
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "rounds_completed": progress["rounds_completed"],
        "best_round": progress["best_round"],
        "best_hits": progress["best_hits"],
        "best_hit_rate_pct": round(100 * progress["best_hits"] / DRAW_COUNT, 8),
        "threshold_met": progress["threshold_met"],
        "result_file": str(result_path),
        "elapsed_seconds": progress.get("elapsed_seconds"),
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    _main()
