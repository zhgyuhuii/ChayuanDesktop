"""B1 截断 HMAC 短码验签。与 website server/license/shortcode.js 字节兼容。
v1: 24 字符(6字节头+8字节tag); v2: 25 字符(7字节头+8字节tag)。"""
import hmac
import hashlib
from datetime import timedelta

from .base32 import decode, check_char
from .codec import unpack, issue_to_date, to_iso, COUNT_VALID_DAYS


def verify_shortcode(serial: str, machine_fp: bytes, hmac_keys: dict) -> dict:
    norm = serial.replace("-", "").upper()
    # v1: 24 字符(6字节头+8字节tag); v2: 25 字符(7字节头+8字节tag)
    header_len = 6 if len(norm) == 24 else 7 if len(norm) == 25 else 0
    if not header_len:
        return {"valid": False, "reason": "length"}
    body_len = header_len + 8
    try:
        body = decode(norm[:-1])
    except ValueError:
        return {"valid": False, "reason": "decode"}
    if len(body) != body_len:
        return {"valid": False, "reason": "decode"}
    if check_char(body) != norm[-1]:
        return {"valid": False, "reason": "checksum"}

    header = body[:header_len]
    given_tag = body[header_len:body_len]
    fields = unpack(header)

    key = hmac_keys.get(fields["ver"])
    if not key:
        return {"valid": False, "reason": "unknown-key"}

    tag = hmac.new(key, header + machine_fp, hashlib.sha256).digest()[:8]
    if not hmac.compare_digest(tag, given_tag):
        return {"valid": False, "reason": "signature"}

    if fields["kind"] == 0:
        expire = issue_to_date(fields["issueDate"]) + timedelta(days=fields["value"])
        return {"valid": True, "fields": fields, "expireAt": to_iso(expire)}
    # kind=1 次数:自签发日起 COUNT_VALID_DAYS 天到期(P3,合并保留)
    expire = issue_to_date(fields["issueDate"]) + timedelta(days=COUNT_VALID_DAYS)
    return {"valid": True, "fields": fields, "expireAt": to_iso(expire)}
