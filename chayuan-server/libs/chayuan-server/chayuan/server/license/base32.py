"""Crockford Base32 解码 + mod-37 校验符。与 website server/license/base32.js 字节兼容。"""

_ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CHECK = _ENC + "*~$=U"
_DEC = {c: i for i, c in enumerate(_ENC)}
_DEC["O"] = 0
_DEC["I"] = 1
_DEC["L"] = 1


def decode(s: str) -> bytes:
    bits = 0
    value = 0
    out = bytearray()
    for raw in s.upper():
        if raw == "-":
            continue
        v = _DEC.get(raw)
        if v is None:
            raise ValueError(f"invalid base32 symbol: {raw}")
        value = (value << 5) | v
        bits += 5
        if bits >= 8:
            out.append((value >> (bits - 8)) & 0xFF)
            bits -= 8
            value &= (1 << bits) - 1
    return bytes(out)


def check_char(buf: bytes) -> str:
    n = 0
    for b in buf:
        n = (n * 256 + b) % 37
    return _CHECK[n]
