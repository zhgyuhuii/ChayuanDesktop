"""6/7 字节头解包 + 日期。与 website server/license/codec.js 一致。
v1: 6 字节头,modules=8bit; v2: 7 字节头,modules=16bit。"""
from datetime import datetime, timedelta, timezone

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
COUNT_VALID_DAYS = 30  # 次数型授权自签发日起有效天数(三端一致)
_ORDER = ["ver", "kind", "modules", "value", "issueDate", "nonce"]
_WIDTHS_V1 = {"ver": 4, "kind": 1, "modules": 8, "value": 14, "issueDate": 13, "nonce": 8}
_WIDTHS_V2 = {"ver": 4, "kind": 1, "modules": 16, "value": 14, "issueDate": 13, "nonce": 8}

# seat 短码(网络版部署授权 #16):8 字节头,与 v1/v2 靠长度区分,kind=2。
# ver(4) kind(4) maxUsers(16) durDays(14) issueDate(13) nonce(13) = 64bit / 8 字节。
SEAT_KIND = 2
_ORDER_SEAT = ["ver", "kind", "maxUsers", "durDays", "issueDate", "nonce"]
_WIDTHS_SEAT = {"ver": 4, "kind": 4, "maxUsers": 16, "durDays": 14, "issueDate": 13, "nonce": 13}


def unpack(buf: bytes) -> dict:
    if len(buf) == 8:
        order, widths = _ORDER_SEAT, _WIDTHS_SEAT
    else:
        order = _ORDER
        widths = _WIDTHS_V2 if len(buf) == 7 else _WIDTHS_V1
    v = int.from_bytes(buf, "big")
    out = {}
    for k in reversed(order):
        w = widths[k]
        out[k] = v & ((1 << w) - 1)
        v >>= w
    return out


def issue_to_date(n: int) -> datetime:
    return EPOCH + timedelta(days=n)


def to_iso(dt: datetime) -> str:
    """与 JS Date.toISOString() 同形:毫秒 + Z。"""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
