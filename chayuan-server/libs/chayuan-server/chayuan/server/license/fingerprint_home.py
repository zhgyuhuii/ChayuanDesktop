"""home 路径派生指纹:与 chayuan-wps fingerprint.js 的 normalizeHome/computeFpHome 字节级一致。
纯离线下,纯 WPS 端拿不到 OS 标识时,用主目录路径作两端同源桥。
"""
import hashlib
import os
import re


def normalize_home(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    if s[:7].lower() == "file://":
        s = s[7:]
    s = s.replace("\\", "/")
    s = re.sub(r"/{2,}", "/", s)
    s = s.rstrip("/")
    s = re.sub(r"^/([A-Za-z]):", lambda m: m.group(1).lower() + ":", s)
    s = re.sub(r"^([A-Za-z]):", lambda m: m.group(1).lower() + ":", s)
    return s


def fp_home(home: str = "") -> str:
    h = home or os.path.expanduser("~")
    norm = normalize_home(h)
    if not norm:
        return ""
    return hashlib.sha256(("chayuan-fp-home:v1:" + norm).encode("utf-8")).hexdigest()[:16]
