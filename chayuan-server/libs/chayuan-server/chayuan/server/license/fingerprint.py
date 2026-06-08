"""机器指纹:持久化一个稳定机器ID,hex(sha256(id))[:16](8 字节)。单机绑定用。

为与 WPS 加载项(chayuan-wps)同机指纹一致,优先使用与 CHAYUAN_ROOT 无关的
固定共享文件 ~/.chayuan/machine.id(两端同读同写)。
"""
import hashlib
import os
import uuid
from pathlib import Path


def _fixed_id_path() -> Path:
    return Path(os.path.expanduser("~")) / ".chayuan" / "machine.id"


def _read_id(p: Path) -> str:
    try:
        if p.exists():
            s = p.read_text().strip()
            if s:
                return s
    except Exception:
        pass
    return ""


def _os_raw_id() -> str:
    try:
        v = Path("/etc/machine-id").read_text().strip()  # Linux
        if v:
            return v
    except Exception:
        pass
    try:
        import winreg  # type: ignore
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Cryptography")
        v = winreg.QueryValueEx(k, "MachineGuid")[0]
        if v:
            return str(v).strip()
    except Exception:
        pass
    return ""


def _write_id(p: Path, mid: str) -> None:
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(mid)
    except Exception:
        pass


def _stable_machine_id(root: Path) -> str:
    fixed = _fixed_id_path()
    legacy = root / "license" / "machine.id"
    # 1) 固定共享文件(与 CHAYUAN_ROOT 无关;WPS 同读)——最高优先,保证两端一致
    mid = _read_id(fixed)
    if mid:
        return mid
    # 2) 兼容老安装:旧版把 id 存在 <root>/license/machine.id(迁移到固定文件,指纹不变)
    mid = _read_id(legacy)
    # 3) OS 硬件标识(machine-id / MachineGuid)
    if not mid:
        mid = _os_raw_id()
    # 4) 兜底随机(落盘后稳定)
    if not mid:
        mid = uuid.uuid4().hex
    # 落盘:固定共享文件 + 旧路径(保持兼容)
    _write_id(fixed, mid)
    _write_id(legacy, mid)
    return mid


def fingerprint(root: Path) -> str:
    return hashlib.sha256(_stable_machine_id(root).encode()).hexdigest()[:16]


def fingerprint_bytes(root: Path) -> bytes:
    return bytes.fromhex(fingerprint(root))
