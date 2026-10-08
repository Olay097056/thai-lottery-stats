"""Freeze one pre-draw /api/predict/all snapshot without refreshing results."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import analyzer
import main as app
import scraper

THAILAND_TZ = timezone(timedelta(hours=7))
TOP_N = 10
PRESET = "optimized"
BEAM_WIDTH = 500
K_BACK = 100
FIELD_SPECS = {
    "front3_1": 3,
    "front3_2": 3,
    "back3_1": 3,
    "back3_2": 3,
    "bottom2": 2,
}
COMPONENT_ORDER = tuple(analyzer.PREDICT_NUMBERS_COMPONENT_NAMES)
SNAPSHOT_PATH = ROOT / ".scratch" / "predict-all-tuning-2026-10-07" / "reports" / "predictions.jsonl"


class DuplicateTargetSnapshotError(ValueError):
    """Raised when a target date already has a frozen prediction record."""


def load_existing_local_cache(cache_path: Path | None = None) -> pd.DataFrame:
    """Read and normalize the existing local cache; never scrape or write it."""
    path = Path(cache_path) if cache_path is not None else Path(scraper.CACHE_FILE)
    try:
        source = path.open("rb")
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"local history cache is missing at {path}; refusing to download or create it"
        ) from exc

    with source:
        df = pd.read_csv(
            source,
            encoding="utf-8",
            dtype={col: str for col in scraper.ALL_LOTTERY_COLS},
            parse_dates=["date"],
        )

    required = set(scraper.LOTTERY_WIDTHS) | {"date", "year", "month", "day", "weekday"}
    missing = sorted(required - set(df.columns))
    if missing:
        raise RuntimeError(f"local history cache is missing required columns: {', '.join(missing)}")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    for col, width in scraper.LOTTERY_WIDTHS.items():
        df[col] = df[col].apply(scraper._fix_num, width=width)
    for col in scraper.SANOOK_COLS:
        if col not in df.columns:
            df[col] = ""
        else:
            df[col] = df[col].apply(scraper._fix_num, width=6)
    for col in scraper.SANOOK_MULTI_COLS:
        if col not in df.columns:
            df[col] = ""
        else:
            df[col] = df[col].fillna("").astype(str).replace("nan", "")
    return scraper._enforce_prize1_identity(df)


def _parse_target_date(value: str) -> date:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise ValueError("target date must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ValueError("target date must use canonical YYYY-MM-DD")
    return parsed


def _number_token(value: object, width: int) -> str:
    token = str(value)
    if len(token) != width or not token.isascii() or not token.isdigit():
        raise ValueError(f"predictor returned a non-{width}-digit string token")
    return token


def _ranked_candidate(row: pd.Series, rank: int, width: int) -> dict:
    score = float(row["คะแนนรวม"])
    lag_factor = float(row["lag_factor"])
    components = [float(row[f"component_{name}"]) for name in COMPONENT_ORDER]
    values = [score, lag_factor, *components]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("predictor returned a non-finite score component")
    return {
        "number": _number_token(row["เลข"], width),
        "rank": rank,
        "score": score,
        "components": components,
        "lag_factor": lag_factor,
    }


def build_snapshot(
    df: pd.DataFrame,
    target_date: str,
    code_commit: str,
    *,
    captured_at: datetime | None = None,
) -> dict:
    """Build the immutable payload from supplied history; no I/O or outcome lookup."""
    target_day = _parse_target_date(target_date)
    captured = captured_at or datetime.now(THAILAND_TZ)
    if captured.tzinfo is None or captured.utcoffset() is None:
        raise ValueError("capture time must include a timezone")
    if captured.date() >= target_day:
        raise ValueError("snapshot must be captured before the target draw date")
    if not re.fullmatch(r"[0-9a-f]{40}", code_commit):
        raise ValueError("code commit must be a full 40-character lowercase Git SHA")
    if df is None or df.empty or "date" not in df.columns:
        raise ValueError("training history must contain dated rows")

    parsed_dates = pd.to_datetime(df["date"], errors="coerce")
    if parsed_dates.isna().any():
        raise ValueError("training history contains invalid dates")
    cutoff_values = parsed_dates.dropna()
    if cutoff_values.empty:
        raise ValueError("training history has no valid dates")
    cutoff_day = cutoff_values.max().date()
    if cutoff_day >= target_day:
        raise ValueError("training history must end before target draw date")
    if cutoff_day >= captured.date():
        raise ValueError("training history must end before capture date")

    required = {"year", "month", "day", "weekday", "prize1", "top3", *FIELD_SPECS}
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"training history is missing predictor columns: {', '.join(missing)}")

    target = datetime.combine(target_day, datetime.min.time())
    fields = {}
    weights = dict(app.PREDICT_ALL_SHARED_WEIGHTS)
    for field, width in FIELD_SPECS.items():
        ranked_df = analyzer.predict_numbers(
            df,
            field,
            target,
            top_n=None,
            weights=weights,
            include_components=True,
        )
        expected_count = 10**width
        if ranked_df is None or len(ranked_df) != expected_count:
            raise ValueError(f"{field} prediction did not return all {expected_count} candidates")
        ranked = [
            _ranked_candidate(row, rank, width)
            for rank, (_, row) in enumerate(ranked_df.iterrows(), start=1)
        ]
        fields[field] = {"top10": ranked[:TOP_N], "ranked": ranked}

    preset_key, preset_kwargs = app._p1_preset_kwargs(PRESET)
    prize1_df = analyzer.predict_prize1_ultimate(
        df,
        target,
        top_n=TOP_N,
        beam_width=BEAM_WIDTH,
        k_back=K_BACK,
        **preset_kwargs,
    )
    if prize1_df is None or len(prize1_df) < TOP_N:
        raise ValueError("Prize 1 predictor did not return the canonical Top-10")
    prize1 = []
    for rank, (_, row) in enumerate(prize1_df.head(TOP_N).iterrows(), start=1):
        score = float(row["คะแนนรวม"])
        if not math.isfinite(score):
            raise ValueError("Prize 1 predictor returned a non-finite score")
        prize1.append({
            "number": _number_token(row["เลข"], 6),
            "rank": rank,
            "score": score,
        })

    return {
        "schema_version": 1,
        "target_date": target_day.isoformat(),
        "captured_at": captured.isoformat(timespec="seconds"),
        "code_commit": code_commit,
        "training_cutoff_date": cutoff_day.isoformat(),
        "settings": {
            "top_n": TOP_N,
            "preset": preset_key,
            "beam_width": BEAM_WIDTH,
            "k_back": K_BACK,
            "shared_weights": weights,
            "component_order": list(COMPONENT_ORDER),
            "score_scale": analyzer.PREDICT_NUMBERS_SCORE_SCALE,
            "score_round_digits": analyzer.PREDICT_NUMBERS_SCORE_DECIMALS,
            "score_formula": (
                "round(sum(component[i] * shared_weights[component_order[i]]) * "
                "lag_factor * score_scale, score_round_digits)"
            ),
            "prize1_internal_ranker": "frozen-default",
            "prize1_preset_parameters": preset_kwargs,
        },
        "fields": fields,
        "prize1": {"top10": prize1},
    }


def append_snapshot(snapshot: dict, output_path: Path) -> None:
    """Append one JSONL record; serialize writers and reject duplicate target dates."""
    path = Path(output_path)
    target = snapshot.get("target_date")
    if not isinstance(target, str):
        raise ValueError("snapshot is missing a target date")
    target_day = _parse_target_date(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = Path(str(path) + ".lock")
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise RuntimeError(f"snapshot writer lock already exists: {lock_path}") from exc

    try:
        if path.exists():
            with path.open("rb") as existing_bytes:
                existing_bytes.seek(0, os.SEEK_END)
                existing_size = existing_bytes.tell()
                if existing_size:
                    existing_bytes.seek(-1, os.SEEK_END)
                    if existing_bytes.read(1) != b"\n":
                        raise ValueError(
                            "existing JSONL must end with a newline; refusing append"
                        )
            with path.open("r", encoding="utf-8") as existing:
                for line_number, line in enumerate(existing, start=1):
                    if not line.strip():
                        raise ValueError(f"blank JSONL record at line {line_number}; refusing append")
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise ValueError(f"invalid JSONL record at line {line_number}; refusing append") from exc
                    if not isinstance(record, dict):
                        raise ValueError(f"invalid JSONL object at line {line_number}; refusing append")
                    existing_target = record.get("target_date")
                    if not isinstance(existing_target, str):
                        raise ValueError(f"missing target date at JSONL line {line_number}; refusing append")
                    try:
                        existing_target_day = _parse_target_date(existing_target)
                    except ValueError as exc:
                        raise ValueError(
                            f"invalid or noncanonical target date at JSONL line {line_number}"
                        ) from exc
                    if existing_target_day == target_day:
                        raise DuplicateTargetSnapshotError(
                            f"target date {target} already has a snapshot; records are append-only"
                        )
        serialized = json.dumps(
            snapshot,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ) + "\n"
        with path.open("a", encoding="utf-8", newline="\n") as destination:
            destination.write(serialized)
            destination.flush()
            os.fsync(destination.fileno())
    finally:
        os.close(lock_fd)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def _clean_commit(root: Path) -> str:
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if status.strip():
        raise RuntimeError("commit a clean source tree before capturing a prediction")
    return subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-date", required=True, help="future draw date in YYYY-MM-DD format")
    args = parser.parse_args(argv)
    try:
        target_day = _parse_target_date(args.target_date)
        captured = datetime.now(THAILAND_TZ)
        if captured.date() >= target_day:
            raise ValueError("snapshot must be captured before the target draw date")
        commit = _clean_commit(ROOT)
        history = load_existing_local_cache()
        snapshot = build_snapshot(history, target_day.isoformat(), commit, captured_at=captured)
        append_snapshot(snapshot, SNAPSHOT_PATH)
    except Exception as exc:
        print(f"snapshot refused: {exc}", file=sys.stderr)
        return 2

    print(f"snapshot appended for {snapshot['target_date']} ({commit[:12]})")
    print(f"record: {SNAPSHOT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
