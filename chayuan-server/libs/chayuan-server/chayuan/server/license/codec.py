"""6 字节头解包 + 日期。与 website server/license/codec.js 一致。"""
from datetime import datetime, timedelta, timezone

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
_WIDTHS = {"ver": 4, "app": 6, "durDays": 14, "issueDate": 14, "nonce": 8}
_ORDER = ["ver", "app", "durDays", "issueDate", "nonce"]


def unpack(buf: bytes) -> dict:
    v = int.from_bytes(buf, "big") >> 2  # 丢低 2 保留位
    out = {}
    for k in reversed(_ORDER):
        w = _WIDTHS[k]
        out[k] = v & ((1 << w) - 1)
        v >>= w
    return out


def issue_to_date(n: int) -> datetime:
    return EPOCH + timedelta(days=n)


def to_iso(dt: datetime) -> str:
    """与 JS Date.toISOString() 同形:毫秒 + Z。"""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
