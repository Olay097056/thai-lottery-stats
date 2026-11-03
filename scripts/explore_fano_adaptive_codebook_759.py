"""Walk-forward tests for prior-only, target-adaptive Fano codebook selection."""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import explore_fano_759 as base
import explore_fano_adaptive_759 as adaptive

ALPHA = 0.5
WINDOWS = (24, 60, 120, 240, None)
PAIR_POSITIONS = tuple((left, right) for left in range(6) for right in range(left + 1, 6))


def _actual_digits(dated):
    return np.asarray([[int(c) for c in actual] for _, actual in dated], dtype=np.uint8)


def _candidate_for_point(rank_pairs, rankings, puncture, point):
    retained = [line for line in range(7) if line != puncture]
    return "".join(
        str(int(rankings[pos, rank_pairs[pos][int(point in base.FANO_LINES[line])]]))
        for pos, line in enumerate(retained)
    )


def _target_score_stats(actuals, target):
    prior = actuals[:target]
    counts = np.zeros((6, 10), dtype=np.float64)
    for row in prior:
        for pos, digit in enumerate(row):
            counts[pos, int(digit)] += 1.0
    total = len(prior)
    marginal = np.log((counts + ALPHA) / (total + 10 * ALPHA))
    pair_log = np.zeros((len(PAIR_POSITIONS), 100), dtype=np.float64)
    for pair_index, (left, right) in enumerate(PAIR_POSITIONS):
        pair_counts = np.zeros(100, dtype=np.float64)
        for row in prior:
            pair_counts[int(row[left]) * 10 + int(row[right])] += 1.0
        pair_log[pair_index] = np.log((pair_counts + ALPHA) / (total + 100 * ALPHA))
    exact_counts = Counter("".join(str(int(d)) for d in row) for row in prior)
    transition = np.empty((6, 10), dtype=np.float64)
    for pos in range(6):
        transition_counts = np.zeros(10, dtype=np.float64)
        denominator = 0
        if target >= 2:
            context_digit = int(actuals[target - 1, pos])
            for index in range(1, target):
                if int(actuals[index - 1, pos]) == context_digit:
                    transition_counts[int(actuals[index, pos])] += 1.0
                    denominator += 1
        transition[pos] = np.log((transition_counts + ALPHA) / (denominator + 10 * ALPHA))
    return prior, {
        "marginal": marginal,
        "pair": pair_log,
        "exact": exact_counts,
        "transition": transition,
    }


def _score_candidate(number, score_name, stats):
    digits = [int(c) for c in number]
    if score_name == "marginal-log-probability":
        return float(sum(stats["marginal"][pos, digit] for pos, digit in enumerate(digits)))

    if score_name.startswith("pair-log-probability"):
        return float(sum(
            stats["pair"][pair_index, digits[left] * 10 + digits[right]]
            for pair_index, (left, right) in enumerate(PAIR_POSITIONS)
        ))

    if score_name == "exact-number-count":
        return float(np.log(stats["exact"].get(number, 0) + ALPHA))

    if score_name == "previous-digit-transition":
        return float(sum(stats["transition"][pos, digit] for pos, digit in enumerate(digits)))

    raise ValueError(f"Unknown score method: {score_name}")


def _select_dynamic_codebook(rank_pairs, rankings, score_name, stats):
    best = None
    for puncture in range(7):
        scored = []
        for point in range(7):
            number = _candidate_for_point(rank_pairs, rankings, puncture, point)
            score = _score_candidate(number, score_name, stats)
            scored.append((score, point, number))
        # Keep five points with the highest prior-only score; stable point-order ties.
        selected = sorted(scored, key=lambda item: (-item[0], item[1]))[:5]
        candidate = (sum(item[0] for item in selected), puncture, selected)
        if best is None or candidate[0] > best[0] or (
            candidate[0] == best[0] and candidate[1] < best[1]
        ):
            best = candidate
    return best


def _forecast_for_fixed_book(rank_pairs, rankings, puncture, omitted):
    points = [point for point in range(7) if point not in omitted]
    return [_candidate_for_point(rank_pairs, rankings, puncture, point) for point in points]


def _run_method(dated, actuals, rank_bank, target_stats, signal_index, *, kind, parameter):
    hits = []
    forecast_hash = sha256()
    for target, (draw_date, actual) in enumerate(dated):
        _, stats = target_stats[target]
        signal_ranks = rank_bank[signal_index, target]
        rank_pairs = [(0, 1)] * 6
        if kind == "fixed":
            puncture, omitted_index = parameter
            numbers = _forecast_for_fixed_book(
                rank_pairs, signal_ranks, puncture, set(base.OMITTED_POINTS[omitted_index])
            )
        elif kind == "adaptive-score":
            _, _, selected = _select_dynamic_codebook(
                rank_pairs, signal_ranks, parameter, stats,
            )
            numbers = [item[2] for item in selected]
        else:
            raise ValueError(kind)
        if len(numbers) != 5 or len(set(numbers)) != 5:
            raise RuntimeError(f"Invalid candidate set at {draw_date}: {numbers}")
        forecast_hash.update((draw_date.isoformat() + ":" + ",".join(numbers) + "\n").encode())
        if actual in numbers:
            hits.append({"target_date": draw_date.isoformat(), "actual": actual})
    return {
        "signal": adaptive.SIGNALS[signal_index][0],
        "kind": kind,
        "selection": parameter,
        "draws": len(dated),
        "hits": len(hits),
        "hit_rate_pct": round(100 * len(hits) / len(dated), 8),
        "hit_dates": hits,
        "forecast_sha256": forecast_hash.hexdigest(),
    }


def main():
    dated, actuals = adaptive._load_actuals()
    rank_bank, _ = adaptive._rank_signal_bank(actuals)
    target_stats = [_target_score_stats(actuals, target) for target in range(len(dated))]
    fixed_results = []
    dynamic_results = []
    for signal_index in range(adaptive.SIGNAL_COUNT):
        for puncture in range(7):
            for omitted_index in range(len(base.OMITTED_POINTS)):
                fixed_results.append(_run_method(
                    dated, actuals, rank_bank, target_stats, signal_index,
                    kind="fixed", parameter=(puncture, omitted_index),
                ))
        for score_name in (
            "marginal-log-probability",
            "pair-log-probability",
            "exact-number-count",
            "previous-digit-transition",
        ):
            dynamic_results.append(_run_method(
                dated, actuals, rank_bank, target_stats, signal_index,
                kind="adaptive-score", parameter=score_name,
            ))

    fixed_results.sort(key=lambda row: (-row["hits"], row["signal"], row["selection"]))
    dynamic_results.sort(key=lambda row: (-row["hits"], row["signal"], row["selection"]))
    all_results = fixed_results + dynamic_results
    best = max(all_results, key=lambda row: row["hits"])
    prior_path = ROOT / ".scratch" / "fano-759-loop" / "results-2026-10-15-1000000.json"
    prior_report = json.loads(prior_path.read_text(encoding="utf-8"))
    if prior_report["actuals_sha256"] != base._actuals_fingerprint(dated):
        raise RuntimeError("Baseline report belongs to different target outcomes")
    out = {
        "run_date": adaptive.RUN_DATE,
        "draw_count": len(dated),
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": base._actuals_fingerprint(dated),
        "target": "exact first-prize six-digit hit; five unique candidates per target",
        "walk_forward": "every forecast used only strictly prior target outcomes; adaptive codebook uses only the target's prior history",
        "signals": [name for name, _ in adaptive.SIGNALS],
        "adaptive_codebook_methods": [
            "marginal-log-probability", "pair-log-probability",
            "exact-number-count", "previous-digit-transition",
        ],
        "fixed_codebook_methods_tested": len(fixed_results),
        "adaptive_selection_methods_tested": len(dynamic_results),
        "threshold_hits_required": adaptive.TARGET_HITS,
        "threshold_met": best["hits"] >= adaptive.TARGET_HITS,
        "baseline_v4": prior_report["baseline_v4"],
        "best": best,
        "best_20_fixed_codebooks": fixed_results[:20],
        "all_fixed_codebook_results": fixed_results,
        "all_adaptive_selection_results": dynamic_results,
        "interpretation": "Research-only and post-hoc selection: method selection uses the same historical outcomes; no production formula is promoted.",
    }
    path = ROOT / ".scratch" / "fano-adaptive-759" / f"results-{adaptive.RUN_DATE}-stage-2.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "fixed_methods": len(fixed_results),
        "dynamic_methods": len(dynamic_results),
        "best_hits": best["hits"],
        "best_rate_pct": best["hit_rate_pct"],
        "best_method": {k: best[k] for k in ("signal", "kind", "selection", "hit_dates")},
        "threshold_met": out["threshold_met"],
        "result_file": str(path),
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
