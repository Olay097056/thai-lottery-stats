"""Timezone helpers for Thai lottery draw dates."""

from datetime import datetime, timedelta, timezone

THAILAND_TZ = timezone(timedelta(hours=7), name="Asia/Bangkok")


def thailand_now_naive() -> datetime:
    """Return Thailand wall time as a naive datetime for legacy lottery calculations."""
    return datetime.now(THAILAND_TZ).replace(tzinfo=None)


def to_thailand_naive(value: datetime) -> datetime:
    """Convert an aware instant to Thailand wall time for legacy lottery calculations."""
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("value must be a timezone-aware datetime")
    return value.astimezone(THAILAND_TZ).replace(tzinfo=None)
