"""Walk-forward Fano joint pair-cover portfolios under rolling histories."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import astra
import explore_fano_759 as base
import fano

if not hasattr(fano, "build_v3"):
    raise SystemExit(
        "explore_fano_paircover_windows_759.py scored the retired v3 builder; "
        "ADR-0008 deleted it. Run this against a pre-ADR-0008 checkout."
    )

WINDOWS = (24, 60, 120, 240, 480, None)
CHECKPOINT_EVERY = 25


def _load():
    _, dated = base._load_draws()
    return dated


def _forecast_window(dated, target, window):
    prior = dated[:target]
    if window is not None:
        prior = prior[-window:]
    valid_draws = [(draw_date, (actual,)) for draw_date, actual in prior]
    fingerprint = base._actuals_fingerprint(prior)
    return fano.build_v3(valid_draws, dated[target][0].isoformat(), fingerprint)[0]


def _main():
    started = time.perf_counter()
    dated = _load()
    original_min = fano.MIN_VALID_DRAWS
    fano.MIN_VALID_DRAWS = 0  # research-only sparse-history scoring
    out_dir = ROOT / ".scratch" / "fano-adaptive-759"
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = out_dir / "paircover-progress.json"
    result_path = out_dir / f"results-{base.RUN_DATE}-stage-3.json"
    fingerprint = base._actuals_fingerprint(dated)
    if checkpoint_path.exists():
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if checkpoint.get("actuals_sha256") != fingerprint:
            raise RuntimeError("Pair-cover checkpoint belongs to a different draw cache")
    else:
        checkpoint = {
            "actuals_sha256": fingerprint,
            "window_index": 0,
            "target_index": 0,
            "current_hits": [],
            "completed": [],
        }
        checkpoint_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        for window_index in range(checkpoint["window_index"], len(WINDOWS)):
            window = WINDOWS[window_index]
            current_hits = list(checkpoint["current_hits"]) if window_index == checkpoint["window_index"] else []
            target_start = checkpoint["target_index"] if window_index == checkpoint["window_index"] else 0
            for target in range(target_start, len(dated)):
                actual = dated[target][1]
                numbers = _forecast_window(dated, target, window)
                if (len(numbers) != 5 or len(set(numbers)) != 5
                        or any(len(n) != 6 or not n.isascii() or not n.isdigit() for n in numbers)):
                    raise RuntimeError(f"Invalid forecast at {dated[target][0]}: {numbers}")
                if actual in numbers:
                    current_hits.append({
                        "target_date": dated[target][0].isoformat(),
                        "actual": actual,
                        "predicted": numbers,
                    })
                if (target + 1) % CHECKPOINT_EVERY == 0 or target + 1 == len(dated):
                    checkpoint.update({
                        "window_index": window_index,
                        "target_index": target + 1,
                        "current_hits": current_hits,
                    })
                    checkpoint_path.write_text(
                        json.dumps(checkpoint, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    print(
                        f"pair-cover window={window or 'all'}: {target + 1}/{len(dated)} targets; "
                        f"hits={len(current_hits)}",
                        flush=True,
                    )

            window_result = {
                "window": window,
                "draws": len(dated),
                "hits": len(current_hits),
                "hit_rate_pct": round(100 * len(current_hits) / len(dated), 8),
                "hit_rows": current_hits,
            }
            checkpoint["completed"] = [
                row for row in checkpoint["completed"] if row["window"] != window
            ] + [window_result]
            checkpoint["window_index"] = window_index + 1
            checkpoint["target_index"] = 0
            checkpoint["current_hits"] = []
            checkpoint_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2), encoding="utf-8")

        best = max(checkpoint["completed"], key=lambda row: row["hits"])
        prior_report_path = ROOT / ".scratch" / "fano-759-loop" / "results-2026-10-15-1000000.json"
        prior_report = json.loads(prior_report_path.read_text(encoding="utf-8"))
        if prior_report["actuals_sha256"] != fingerprint:
            raise RuntimeError("Baseline report belongs to different target outcomes")
        result = {
            "run_date": base.RUN_DATE,
            "draw_count": len(dated),
            "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
            "actuals_sha256": fingerprint,
            "target": "exact six-digit first-prize match; five distinct candidates",
            "walk_forward": "each target used only the immediately prior 24/60/120/240/480 draws or all prior draws",
            "formula_family": "Fano v3 joint weighted pair-cover portfolio optimized independently per target",
            "windows_tested": ["all" if window is None else window for window in WINDOWS],
            "threshold_hits_required": base.TARGET_HITS_FOR_10_PERCENT,
            "threshold_met": best["hits"] >= base.TARGET_HITS_FOR_10_PERCENT,
            "baseline_v4": prior_report["baseline_v4"],
            "best": best,
            "all_windows": checkpoint["completed"],
            "interpretation": "Post-hoc comparison across windows on the same 759 target outcomes; exploratory, not an independent future edge. No production formula was promoted.",
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "checkpoint_file": str(checkpoint_path.relative_to(ROOT)),
        }
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({
            "windows_tested": result["windows_tested"],
            "best_window": best["window"],
            "best_hits": best["hits"],
            "best_rate_pct": best["hit_rate_pct"],
            "threshold_met": result["threshold_met"],
            "result_file": str(result_path),
            "elapsed_seconds": result["elapsed_seconds"],
        }, ensure_ascii=False), flush=True)
    finally:
        fano.MIN_VALID_DRAWS = original_min


if __name__ == "__main__":
    _main()
