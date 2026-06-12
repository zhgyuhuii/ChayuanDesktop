"""机器指纹:持久化一个稳定机器ID,hex(sha256(id))[:16](8 字节)。单机绑定用。

为与 WPS 加载项(chayuan-wps)同机指纹一致,优先使用与 CHAYUAN_ROOT 无关的
固定共享文件 ~/.chayuan/machine.id(两端同读同写)。
"""
import hashlib
import os
import uuid
from pathlib import Path

from .fingerprint_home import fp_home


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
    # 1) 固定共享文件:最高优先,已是真源,直接返回(不重写)
    mid = _read_id(fixed)
    if mid:
        return mid
    # 2) 兼容老安装:旧路径值来源不明(可能是随机),不主动提升到 fixed,
    #    避免把随机值固化成跨端真源污染 WPS;指纹值仍用它,不变
    mid = _read_id(legacy)
    deterministic = False
    # 3) OS 硬件标识(machine-id / MachineGuid):确定性,可作跨端真源写 fixed
    if not mid:
        mid = _os_raw_id()
        if mid:
            deterministic = True
    # 4) 兜底随机:不写 fixed(避免污染跨端)
    if not mid:
        mid = uuid.uuid4().hex
    # 落盘:仅确定性 OS 标识写固定共享文件;legacy 始终写,保自身重启稳定
    if deterministic:
        _write_id(fixed, mid)
    _write_id(legacy, mid)
    return mid


def fingerprint(root: Path) -> str:
    return hashlib.sha256(_stable_machine_id(root).encode()).hexdigest()[:16]


def fingerprint_bytes(root: Path) -> bytes:
    return bytes.fromhex(fingerprint(root))


def candidate_fingerprints(root: Path) -> list:
    """激活验签用的候选指纹集:主(OS标识/固定文件派生) + home派生 + 纯OS标识派生,去重。"""
    out: list = []

    def add(v: str) -> None:
        s = str(v or "").strip().lower()
        if len(s) == 16 and all(c in "0123456789abcdef" for c in s) and s not in out:
            out.append(s)

    add(fingerprint(root))                                  # 主:固定文件/OS标识派生
    add(fp_home())                                          # home派生同源桥
    os_raw = _os_raw_id()                                   # 纯OS标识派生(固定文件是随机时补一个)
    if os_raw:
        add(hashlib.sha256(os_raw.encode()).hexdigest()[:16])
    return out
