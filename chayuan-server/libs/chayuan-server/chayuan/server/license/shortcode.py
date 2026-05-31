"""B1 截断 HMAC 短码验签。与 website server/license/shortcode.js 字节兼容。"""
import hmac
import hashlib
from datetime import timedelta

from .base32 import decode, check_char
from .codec import unpack, issue_to_date, to_iso


def verify_shortcode(serial: str, machine_fp: bytes, hmac_keys: dict) -> dict:
    norm = serial.replace("-", "").upper()
    if len(norm) != 24:
        return {"valid": False, "reason": "length"}
    try:
        body = decode(norm[:23])
    except ValueError:
        return {"valid": False, "reason": "decode"}
    if len(body) != 14:
        return {"valid": False, "reason": "decode"}
    if check_char(body) != norm[23]:
        return {"valid": False, "reason": "checksum"}

    header = body[:6]
    given_tag = body[6:14]
    fields = unpack(header)

    key = hmac_keys.get(fields["ver"])
    if not key:
        return {"valid": False, "reason": "unknown-key"}

    tag = hmac.new(key, header + machine_fp, hashlib.sha256).digest()[:8]
    if not hmac.compare_digest(tag, given_tag):
        return {"valid": False, "reason": "signature"}

    # kind=0 时长:计算到期;kind=1 次数:无到期(value 即次数 n,由调用方处理)。
    if fields["kind"] == 0:
        expire = issue_to_date(fields["issueDate"]) + timedelta(days=fields["value"])
        return {"valid": True, "fields": fields, "expireAt": to_iso(expire)}
    return {"valid": True, "fields": fields}
