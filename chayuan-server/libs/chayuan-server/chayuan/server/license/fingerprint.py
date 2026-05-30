"""机器指纹:持久化一个稳定机器ID,hex(sha256(id))[:16](8 字节)。单机绑定用。"""
import hashlib
import uuid
from pathlib import Path


def _stable_machine_id(root: Path) -> str:
    f = root / "license" / "machine.id"
    try:
        if f.exists():
            s = f.read_text().strip()
            if s:
                return s
    except Exception:
        pass
    mid = ""
    try:
        mid = Path("/etc/machine-id").read_text().strip()  # Linux
    except Exception:
        mid = ""
    if not mid:
        try:
            import winreg  # type: ignore
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\\Microsoft\\Cryptography")
            mid = winreg.QueryValueEx(k, "MachineGuid")[0]
        except Exception:
            mid = ""
    if not mid:
        mid = uuid.uuid4().hex  # 兜底:随机一次,落盘后稳定
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(mid)
    except Exception:
        pass
    return mid


def fingerprint(root: Path) -> str:
    return hashlib.sha256(_stable_machine_id(root).encode()).hexdigest()[:16]


def fingerprint_bytes(root: Path) -> bytes:
    return bytes.fromhex(fingerprint(root))
