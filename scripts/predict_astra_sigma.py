"""Compute one future Astra-Σ report from an existing read-only local cache.

No refresh, backtest, result writes, or output-file side effects.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main(argv: list[str] | None = None, *, cache_path: Path | None = None,
         generated_at: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Astra-Σ v0.1 next-draw inference from an existing read-only cache"
    )
    parser.add_argument("--target-date", required=True, help="future Thailand date YYYY-MM-DD")
    args = parser.parse_args(argv)

    import astra
    import astra_sigma

    captured = generated_at if generated_at is not None else datetime.now(astra.THAILAND_TZ)
    try:
        astra.validate_astra_target_date(args.target_date, generated_at=captured)
        history = astra.load_existing_astra_history(cache_path)
        report = astra_sigma.build_astra_sigma_report(
            history, args.target_date, generated_at=captured
        )
    except astra.AstraInputError:
        print("Astra-Σ: invalid future target or dated history; no report generated", file=sys.stderr)
        return 2
    except astra.AstraCacheError:
        print("Astra-Σ: local cache missing or unreadable; no refresh attempted", file=sys.stderr)
        return 3
    report["source"] = "existing_local_cache"
    print(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
