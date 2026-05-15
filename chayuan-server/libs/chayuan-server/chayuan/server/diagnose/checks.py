"""所有 diagnose check 函数。每个函数纯函数化,无 IO 副作用 (除了读盘 / 网络)。

约定:任何函数都不允许抛异常,内部用 try/except 包好;失败时返回
severity=fail + detail 描述。
"""
from __future__ import annotations

import shutil
import yaml
from pathlib import Path

from chayuan.server.diagnose.types import DiagnoseCheck
from chayuan.server.model_registry.local_index import get_local_index
from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager


def check_sidecar_healthz() -> DiagnoseCheck:
    """sidecar 进程跑起来就视为 ok (路由调用本函数 = 路由可达 = healthz 一定通)。

    单独保留这个 check 是给报告里留个明确正信号:用户看到「sidecar.healthz: ✓」
    就知道至少 HTTP 层是通的,后面其它 check 失败可以锁定到具体子系统。
    """
    return DiagnoseCheck(
        name="sidecar.healthz",
        ok=True,
        severity="ok",
        detail="sidecar HTTP 层就绪 (routing layer responsive)",
    )


def check_vendor_llama_server_binary() -> DiagnoseCheck:
    """检查 vendor/services/llama-server/llama-server(.exe) 是否存在 + 读 VERSION。"""
    try:
        # 复用 manager 的查找逻辑;chayuan_root 这里只是占位,find_llama_server_exe
        # 不依赖 chayuan_root
        mgr = LlamaRuntimeManager(chayuan_root=Path("/tmp"))
        exe = mgr.find_llama_server_exe()
    except Exception as e:
        return DiagnoseCheck(
            name="vendor.llama-server.binary",
            ok=False,
            severity="fail",
            detail=f"查找二进制时异常:{type(e).__name__}: {e}",
        )

    if exe is None:
        return DiagnoseCheck(
            name="vendor.llama-server.binary",
            ok=False,
            severity="fail",
            detail="未找到 llama-server 二进制;检查集成版是否完整 / 开发机是否跑过 install-llama-server",
        )

    version = "unknown"
    version_file = exe.parent / "VERSION"
    if version_file.is_file():
        try:
            version = version_file.read_text(encoding="utf-8").splitlines()[0].strip()
        except Exception:
            pass

    try:
        size_mb = exe.stat().st_size / 1024 / 1024
    except Exception:
        size_mb = 0.0

    return DiagnoseCheck(
        name="vendor.llama-server.binary",
        ok=True,
        severity="ok",
        detail=f"{exe} ({version}, {size_mb:.1f} MB)",
        context={"path": str(exe), "version": version, "size_bytes": exe.stat().st_size},
    )


def check_bundled_models_chat() -> DiagnoseCheck:
    """bundled_models 是否至少有 1 个 chat .gguf 模型 (local_index 扫得到)。"""
    try:
        idx = get_local_index()
        cands = idx.by_capability("chat")
    except Exception as e:
        return DiagnoseCheck(
            name="vendor.bundled_models.chat",
            ok=False,
            severity="fail",
            detail=f"local_index 查询失败:{type(e).__name__}: {e}",
        )

    if not cands:
        return DiagnoseCheck(
            name="vendor.bundled_models.chat",
            ok=False,
            severity="fail",
            detail="bundled_models/ 下未扫到任何 chat 模型",
        )

    names = ", ".join(getattr(c, "model_id", "<?>") for c in cands[:3])
    more = "" if len(cands) <= 3 else f" 等 {len(cands)} 个"
    return DiagnoseCheck(
        name="vendor.bundled_models.chat",
        ok=True,
        severity="ok",
        detail=f"{len(cands)} 个 chat 模型: {names}{more}",
        context={"count": len(cands), "model_ids": [getattr(c, "model_id", None) for c in cands]},
    )


def check_chayuan_root_writable(chayuan_root: Path) -> DiagnoseCheck:
    """尝试在 chayuan_root 创建 + 删除 .diagnose-test 文件"""
    if not chayuan_root.is_dir():
        return DiagnoseCheck(
            name="chayuan_root.writable",
            ok=False,
            severity="fail",
            detail=f"chayuan_root 不存在: {chayuan_root}",
        )
    probe = chayuan_root / ".diagnose-test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except Exception as e:
        return DiagnoseCheck(
            name="chayuan_root.writable",
            ok=False,
            severity="fail",
            detail=f"无法写入 {chayuan_root}: {type(e).__name__}: {e}",
        )
    return DiagnoseCheck(
        name="chayuan_root.writable",
        ok=True,
        severity="ok",
        detail=f"可写: {chayuan_root}",
    )


def check_runtime_json_writable(status_path: Path) -> DiagnoseCheck:
    """检查 runtime.json 父目录可写 (LlamaRuntimeManager._persist_status 写它)。"""
    parent = status_path.parent
    try:
        parent.mkdir(parents=True, exist_ok=True)
        probe = parent / ".diagnose-runtime-json-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except Exception as e:
        return DiagnoseCheck(
            name="runtime_json.writable",
            ok=False,
            severity="fail",
            detail=f"runtime.json 父目录不可写 ({parent}): {type(e).__name__}: {e}",
        )
    return DiagnoseCheck(
        name="runtime_json.writable",
        ok=True,
        severity="ok",
        detail=f"可写: {status_path}",
    )


def check_local_runtime_yaml_readable(yaml_path: Path) -> DiagnoseCheck:
    """local_runtime.yaml 不存在不算 fail (= 用默认),存在则解析必须成功。"""
    if not yaml_path.is_file():
        return DiagnoseCheck(
            name="local_runtime_yaml.readable",
            ok=True,
            severity="ok",
            detail=f"{yaml_path} 不存在,使用默认配置",
        )
    try:
        with open(yaml_path, "rb") as f:
            raw = f.read()
        yaml.safe_load(raw.decode("utf-8", errors="strict"))
    except Exception as e:
        return DiagnoseCheck(
            name="local_runtime_yaml.readable",
            ok=False,
            severity="warn",
            detail=f"yaml 解析失败 ({yaml_path}): {type(e).__name__}: {e}",
        )
    return DiagnoseCheck(
        name="local_runtime_yaml.readable",
        ok=True,
        severity="ok",
        detail=f"{yaml_path} 解析成功",
    )


def check_disk_free_gb(chayuan_root: Path) -> DiagnoseCheck:
    """磁盘剩余空间:>= 2 GB ok / 500MB-2GB warn / < 500MB fail"""
    try:
        du = shutil.disk_usage(chayuan_root if chayuan_root.exists() else chayuan_root.parent)
    except Exception as e:
        return DiagnoseCheck(
            name="disk.chayuan_root.free_gb",
            ok=False,
            severity="warn",
            detail=f"无法查询磁盘空间:{type(e).__name__}: {e}",
        )
    free_gb = du.free / 2**30
    if free_gb < 0.5:
        sev: str = "fail"
        ok = False
    elif free_gb < 2.0:
        sev = "warn"
        ok = True
    else:
        sev = "ok"
        ok = True
    return DiagnoseCheck(
        name="disk.chayuan_root.free_gb",
        ok=ok,
        severity=sev,  # type: ignore[arg-type]
        detail=f"{free_gb:.1f} GB 可用",
        context={"free_bytes": du.free, "total_bytes": du.total},
    )
