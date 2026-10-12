"""astra-v1: an experimental, fixed-constant, category-specific ranker.

Inference is pure and uses supplied records only. The separate CSV loader is
read-only; it never imports a scraper or fetches/repairs missing result data.
Synthetic verification proves the implementation, not predictive accuracy.
"""

from collections.abc import Mapping
from datetime import date, datetime, timedelta, timezone
from math import inf, log, nextafter, ulp
from pathlib import Path
import csv
import re

THAILAND_TZ = timezone(timedelta(hours=7))
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class AstraInputError(ValueError):
    """Invalid prediction target, generation time, or supplied history."""


class AstraCacheError(RuntimeError):
    """The existing local CSV cannot be safely read."""


def _generation_time(generated_at):
    if generated_at is None:
        return datetime.now(THAILAND_TZ)
    if not isinstance(generated_at, datetime) or generated_at.utcoffset() is None:
        raise AstraInputError("เวลาสร้างรายงานต้องระบุเขตเวลา")
    return generated_at.astimezone(THAILAND_TZ)


def validate_astra_target_date(
    target_date: str, *, generated_at: datetime | None = None
) -> date:
    """Require canonical YYYY-MM-DD strictly after the Thailand generation day."""
    generated = _generation_time(generated_at)
    if not isinstance(target_date, str) or not _DATE.fullmatch(target_date):
        raise AstraInputError("วันที่เป้าหมายต้องอยู่ในรูป YYYY-MM-DD")
    try:
        target = date.fromisoformat(target_date)
    except ValueError:
        raise AstraInputError("วันที่เป้าหมายไม่ถูกต้อง") from None
    if target <= generated.date():
        raise AstraInputError("วันที่เป้าหมายต้องอยู่หลังวันปัจจุบันของประเทศไทย")
    return target


_SETTINGS = (
    ("max_draws", 200), ("min_valid_draws", 20), ("half_life_draws", 24),
    ("weight_floor", 0.5), ("positional_prior", 1), ("pair_backoff_strength", 10),
    ("positional_log_weight", 0.5), ("conditional_log_weight", 0.5),
    ("stale_days", 35),
)
_CATEGORIES = (
    ("prize1", "รางวัลที่ 1", 6, 5),
    ("front3", "เลขหน้า 3 ตัว", 3, 2),
    ("back3", "เลขท้าย 3 ตัวทางการ", 3, 2),
    ("bottom2", "เลขท้าย 2 ตัว", 2, 1),
    ("prize2", "รางวัลที่ 2", 6, 5),
    ("prize3", "รางวัลที่ 3", 6, 5),
    ("prize4", "รางวัลที่ 4", 6, 5),
)


def _history_date(value):
    # Accept the cache's date and timezone-naive ISO midnight spellings only.
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T]00:00:00)?", value
    ):
        raise AstraInputError("รูปแบบวันที่ในประวัติไม่ถูกต้อง")
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        raise AstraInputError("วันที่ในประวัติไม่ถูกต้อง") from None


def _history_window(history, target, generation_day):
    if isinstance(history, (str, bytes, Mapping)):
        raise AstraInputError("ประวัติต้องเป็นรายการข้อมูลงวด")
    try:
        rows = iter(history)
    except TypeError:
        raise AstraInputError("ประวัติต้องเป็นรายการข้อมูลงวด") from None
    dated, seen = [], set()
    for row in rows:
        if not isinstance(row, Mapping):
            raise AstraInputError("รายการประวัติไม่ถูกต้อง")
        draw_date = _history_date(row.get("date"))
        if draw_date in seen:
            raise AstraInputError("ประวัติมีวันที่งวดซ้ำ")
        if draw_date > generation_day:
            raise AstraInputError("ประวัติมีวันที่ในอนาคต")
        seen.add(draw_date)
        if draw_date < target:
            dated.append((draw_date, dict(row)))
    return sorted(dated, key=lambda item: item[0], reverse=True)[:200]


def _category_values(row, key, digits):
    if key in ("prize1", "bottom2"):
        values = [row.get(key)]
    elif key in ("front3", "back3"):
        values = [row.get(f"{key}_{i}") for i in range(1, 3)]
    elif key in ("prize2", "prize3"):
        slots = 5 if key == "prize2" else 10
        values = [row.get(f"{key}_{i}") for i in range(1, slots + 1)]
    else:  # prize4 is a whitespace-separated complete fifty-result list.
        field = row.get("prize4")
        if not isinstance(field, str):
            return None
        values = field.split()
        if len(values) != 50:
            return None
    if not all(isinstance(value, str) and re.fullmatch(rf"[0-9]{{{digits}}}", value)
               for value in values):
        return None
    if key in ("prize2", "prize3", "prize4") and len(set(values)) != len(values):
        return None
    return tuple(values)


def _build_model(draws, digits):
    """Count validated slots with one fixed total weight per overall draw age."""
    positions = [[0.0] * 10 for _ in range(digits)]
    pairs = [[[0.0] * 10 for _ in range(10)] for _ in range(digits - 1)]
    total_weight = 0.0
    for age, numbers in draws:
        weight = 0.5 + 0.5 * 2 ** (-age / 24)
        total_weight += weight
        slot_weight = weight / len(numbers)
        for number in numbers:
            # Only individual digit indices are numeric; number strings stay intact.
            indices = [ord(digit) - ord("0") for digit in number]
            for j, digit in enumerate(indices):
                positions[j][digit] += slot_weight
                if j:
                    pairs[j - 1][indices[j - 1]][digit] += slot_weight
    q = [[(count + 1) / (total_weight + 10) for count in position]
         for position in positions]
    conditional = [
        [[(pairs[j - 1][a][b] + 10 * q[j][b]) / (positions[j - 1][a] + 10)
          for b in range(10)] for a in range(10)] for j in range(1, digits)
    ]
    return {"q": q, "t": conditional, "total_weight": total_weight}


def _retain_prefixes(candidates, count, collapse_bound):
    """Prune only after k other prefixes dominate for every common suffix.

    Floating addition is monotone, not strictly monotone. A lexically smaller
    prefix remains relevant when future rounding might erase its score deficit.
    The bound controls pruning only: it never changes scores or defines a tie.
    """
    ranked = sorted(candidates, key=lambda item: (-item[1], item[0]))
    if not collapse_bound:
        return ranked[:count]
    kept = []
    for prefix, score in ranked:
        dominators = 0
        for better_prefix, better_score in kept:
            # Every earlier candidate has >= score. A smaller string therefore
            # wins even if rounding collapses the scores; a larger one needs a
            # strictly positive final gap. Round the gap down to certify that.
            if (better_prefix <= prefix
                    or nextafter(better_score - score, -inf) > collapse_bound):
                dominators += 1
                if dominators == count:
                    break
        if dominators < count:
            kept.append((prefix, score))
    return kept


def _top_k(model, count):
    """k-best DP with conservative binary64 tie-collapse guards per digit state.

    Normally k prefixes suffice. Near a rounding boundary retain additional
    undominated prefixes, preserving the frozen raw-score/string ordering.
    """
    q, conditional = model["q"], model["t"]
    states = [[(str(d), log(q[0][d]))] for d in range(10)]
    increments = [
        [[0.5 * log(q[j][b]) + 0.5 * log(conditional[j - 1][a][b])
          for b in range(10)] for a in range(10)] for j in range(1, len(q))
    ]
    # Outward-rounded magnitude bound covers every intermediate score. Each
    # remaining addition can close a pair's gap by at most one ulp of this
    # bound (two half-ulp rounding errors). No score is rounded by this guard.
    magnitude = max(abs(state[0][1]) for state in states)
    for step in increments:
        magnitude = nextafter(magnitude + max(abs(x) for row in step for x in row), inf)
    rank_key = lambda item: (-item[1], item[0])
    for j in range(1, len(q)):
        remaining = len(q) - j - 1
        collapse_bound = nextafter(remaining * ulp(magnitude), inf) if remaining else 0.0
        next_states = []
        for b in range(10):
            candidates = []
            for a in range(10):
                increment = increments[j - 1][a][b]
                candidates.extend((prefix + str(b), score + increment)
                                  for prefix, score in states[a])
            next_states.append(_retain_prefixes(candidates, count, collapse_bound))
        states = next_states
    return sorted((item for state in states for item in state), key=rank_key)[:count]


def build_astra_report(
    history, target_date: str, *, generated_at: datetime | None = None
) -> dict:
    """Return the experimental report without accessing files or the network."""
    generated = _generation_time(generated_at)
    target = validate_astra_target_date(target_date, generated_at=generated)
    window = _history_window(history, target, generated.date())
    cutoff = window[0][0] if window else None
    warnings = []
    if cutoff is None:
        warnings.append("ไม่มีข้อมูลก่อนวันที่เป้าหมาย")
    elif (generated.date() - cutoff).days > 35:
        warnings.append("ข้อมูลล่าสุดเก่ากว่า 35 วัน โปรดตรวจสอบวันที่ข้อมูล")
    categories = {}
    for key, label, digits, count in _CATEGORIES:
        valid = []
        last_valid = None
        for age, (draw_date, row) in enumerate(window):
            values = _category_values(row, key, digits)
            if values is not None:
                valid.append((age, values))
                if last_valid is None:
                    last_valid = draw_date.isoformat()
        enough = len(valid) >= 20
        ranked = _top_k(_build_model(valid, digits), count) if enough else []
        categories[key] = {
            "label": label, "digits": digits, "requested_count": count,
            "status": "ok" if enough else "insufficient_data", "valid_draws": len(valid),
            "invalid_draws": len(window) - len(valid),
            "training_cutoff_date": last_valid,
            "numbers": [{"number": number, "rank": rank, "log_score": score}
                        for rank, (number, score) in enumerate(ranked, 1)],
        }
    return {
        "schema_version": 1, "formula": "astra", "version": "astra-v1",
        "trust": "ทดลอง", "target_date": target.isoformat(),
        "generated_at": generated.isoformat(),
        "training_cutoff_date": cutoff.isoformat() if cutoff else None,
        "source": "supplied_history", "window_draws": len(window),
        "settings": dict(_SETTINGS), "warnings": warnings,
        "categories": categories,
    }


def load_existing_astra_history(cache_path: Path | str | None = None) -> list[dict]:
    """Read strings from the existing CSV only; never fetch, create, or repair it."""
    try:
        path = (Path(cache_path) if cache_path is not None
                else Path(__file__).with_name("lottery_cache.csv"))
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream, strict=True)
            header = next(reader, None)
            if (not header or "date" not in header or len(header) != len(set(header))
                    or any(not name or name != name.strip() or "\x00" in name for name in header)):
                raise AstraCacheError("โครงสร้างหัวตารางข้อมูลไม่ถูกต้อง")
            rows = []
            for values in reader:
                if len(values) != len(header) or any("\x00" in value for value in values):
                    raise AstraCacheError("โครงสร้างแถวข้อมูลไม่ถูกต้อง")
                rows.append(dict(zip(header, values)))
            return rows
    except (OSError, UnicodeError, csv.Error, TypeError, ValueError):
        # No path contents or OS error text is exposed by the API/CLI.
        raise AstraCacheError("ไม่สามารถอ่านไฟล์ข้อมูลเดิมได้ หรือไฟล์ CSV ไม่ถูกต้อง") from None
