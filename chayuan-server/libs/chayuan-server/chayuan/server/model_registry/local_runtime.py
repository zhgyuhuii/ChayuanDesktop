"""本地 LLM runtime 管理 (vendor 进集成版的 llama-server.exe)。

职责:
- 启动 / 停止 / 重启 vendor/services/llama-server/llama-server.exe 子进程
- 健康检查:轮询 /health,失败重试
- 状态写入 <CHAYUAN_ROOT>/runtime.json (前端读)
- 配置持久化到 <CHAYUAN_ROOT>/model_registry/local_runtime.yaml

设计:整个 chayuan-server 进程内一个 manager 单例,通过 get_manager() 拿。
sidecar lifespan shutdown 必须 await manager.stop() 级联关停 llama-server。
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Literal, Optional

import yaml

from chayuan.server.model_registry import process_args  # noqa: E402 — 供 monkeypatch 拦截

logger = logging.getLogger(__name__)

# 启动等 /health 200 的总超时(秒)。单元测试可 monkeypatch。
HEALTH_READY_TIMEOUT_SEC: float = 60.0
HEALTH_PROBE_INTERVAL_SEC: float = 0.5


# ───────────────────────── 配置 / 状态 dataclass ─────────────────────────

@dataclasses.dataclass
class LocalRuntimeSettings:
    """本地 runtime 用户可配项,持久化到 local_runtime.yaml"""
    preload_on_startup: bool = True
    host: str = "127.0.0.1"
    port: int = 62582
    api_key: str = ""
    expose_lan: bool = False
    default_chat_model: str = ""
    # Plan 3B 多 capability:
    preload_embedding: bool = False
    preload_rerank: bool = False
    default_embedding_model: str = ""
    default_rerank_model: str = ""
    # Plan 3C ASR:
    preload_asr: bool = False
    default_asr_model: str = ""
    # Plan 3D 图像嵌入:
    preload_image_embedding: bool = False
    default_image_embedding_model: str = ""

    @classmethod
    def load(cls, path: Path) -> "LocalRuntimeSettings":
        if not path.is_file():
            return cls()
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            return cls()
        return cls(**{
            k: data[k]
            for k in dataclasses.asdict(cls()).keys()
            if k in data
        })

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.safe_dump(dataclasses.asdict(self), allow_unicode=True),
            encoding="utf-8",
        )


@dataclasses.dataclass
class RuntimeStatus:
    """RuntimeManager 实时状态,序列化给 API 返回。"""
    state: Literal["stopped", "starting", "ready", "failed", "restarting"]
    endpoint: Optional[str] = None
    pid: Optional[int] = None
    model_id: Optional[str] = None
    model_path: Optional[str] = None
    started_at: Optional[datetime] = None
    last_health_at: Optional[datetime] = None
    last_error: Optional[str] = None

    def to_dict(self) -> dict:
        d = dataclasses.asdict(self)
        for k in ("started_at", "last_health_at"):
            if d[k] is not None:
                d[k] = d[k].isoformat()
        return d


# ─────────────────────── manager ─────────────────────────

# 装机后 services 二进制可能的路径(按优先级排;集成版 / dev / 自定义)
def _default_install_services_dirs() -> list[Path]:
    """运行时定位 services 二进制目录。

    集成版装机后:
      Windows:  <install_dir>\\services\\
      Mac:      <install_dir>/Contents/Resources/services/
      Linux:    <install_dir>/services/

    Tauri 会把 bundle.resources 中的 services/** 解压到运行时
    可执行文件旁边的 resources/ 子目录。我们扫几个常见位置取并集。
    """
    candidates: list[Path] = []
    import sys
    # PyInstaller frozen 时 sys.executable = sidecar exe;
    # exe 同目录里的 services/ 是 Tauri install dir 的 services/
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).parent / "services")
        candidates.append(Path(sys.executable).parent.parent / "services")
        # Linux AppImage / Tauri Linux 解包:exe 旁的 lowercase resources/
        candidates.append(Path(sys.executable).parent / "resources" / "services")
        candidates.append(Path(sys.executable).parent.parent / "resources" / "services")
        # Mac .app bundle 结构
        candidates.append(Path(sys.executable).parent.parent / "Resources" / "services")
    # dev mode:从仓库 vendor/services/ 找
    candidates.append(Path(__file__).resolve().parents[5] / "vendor" / "services")
    # 兜底:CHAYUAN_ROOT/services
    return candidates


_INSTALL_SERVICES_DIRS: list[Path] | None = None  # 单元测试可 monkeypatch 覆盖


def _platform_subdir_candidates() -> list[str]:
    """当前 OS / 架构按优先级的 vendor 预编译子目录候选列表。

    `find_server_exe` 依次走这个列表,选第一个真存在 binary 的子目录。

    可通过 env var ``CHAYUAN_VENDOR_PLATFORM`` 强制覆盖(单值);常见用法:
      * Win 老 CPU 没 AVX2:``CHAYUAN_VENDOR_PLATFORM=win-x64-noavx``
      * Win 新 Xeon 想用 AVX-512:``CHAYUAN_VENDOR_PLATFORM=win-x64-avx512``

    默认按 OS / 架构推:
      Win x64   → [win-x64, win-x64-avx, win-x64-noavx]   (默认 AVX2,自动 fallback)
      Win arm64 → [win-arm64]
      macOS ARM → [macos-arm64]
      macOS Intel → [macos-x64]
      Linux x64 → [linux-x64]
      Linux arm64 → [linux-arm64]

    返回空列表表示不识别此平台 — 调用方会 fallback 到扁平 layout(install 脚本现写现拷)。
    """
    import platform as _platform
    override = os.environ.get("CHAYUAN_VENDOR_PLATFORM", "").strip()
    if override:
        return [override]
    machine = _platform.machine().lower()
    if sys.platform == "win32":
        if machine in ("arm64", "aarch64"):
            return ["win-arm64"]
        # x86_64:默认 AVX2 → 老 CPU 没 AVX2 自动 fallback 到 win-x64-noavx
        # (win-x64-avx 是中间档,2011 年 Sandy Bridge ~ 2013 年 Haswell 之间的极少数 CPU 才需要)
        return ["win-x64", "win-x64-noavx"]
    if sys.platform == "darwin":
        return ["macos-arm64"] if machine in ("arm64", "aarch64") else ["macos-x64"]
    if sys.platform.startswith("linux"):
        return ["linux-arm64"] if machine in ("aarch64", "arm64") else ["linux-x64"]
    return []


def _platform_subdir() -> str:
    """Deprecated single-value variant. 新代码用 :func:`_platform_subdir_candidates`。"""
    cands = _platform_subdir_candidates()
    return cands[0] if cands else ""


async def _probe_health(url: str, *, timeout: float = 2.0) -> "object":
    """探一次 /health。返回类 httpx.Response 的对象 (有 .status_code)。

    单元测试 monkeypatch 这个函数。
    """
    import httpx
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.get(url)


def _resolve_args_for(
    capability: str,
    *,
    engine: str = "llama",
    n_ctx: int | None = None,
    n_threads: int | None = None,
):
    """调对应 engine 的 process_args.resolve_*,返回 (resolution, model_path)。

    Plan 3D 起 engine 派发:
      * engine='llama'    → resolve_llamacpp_args(透传 n_ctx/n_threads)
      * engine='whisper'  → resolve_whisper_args(透传 n_threads)
      * engine='infinity' → resolve_image_embedding_args(透传 n_threads;
                            不是 Plan 1 老 resolve_infinity_args)
    """
    if engine == "llama":
        kwargs: dict = {"capability": capability}
        if n_ctx is not None:
            kwargs["n_ctx"] = n_ctx
        if n_threads is not None:
            kwargs["n_threads"] = n_threads
        r = process_args.resolve_llamacpp_args(**kwargs)
    elif engine == "whisper":
        kwargs = {"capability": capability}
        if n_threads is not None:
            kwargs["n_threads"] = n_threads
        r = process_args.resolve_whisper_args(**kwargs)
    elif engine == "infinity":
        kwargs = {"capability": capability}
        if n_threads is not None:
            kwargs["n_threads"] = n_threads
        r = process_args.resolve_image_embedding_args(**kwargs)
    else:
        raise ValueError(f"Unknown engine: {engine!r}")

    if r.missing:
        return r, None
    try:
        i = r.args.index("--model")
        return r, r.args[i + 1]
    except (ValueError, IndexError):
        return r, None


# 旧名兼容(Plan 1 测试用过 _resolve_chat_args);保留 alias 直到 Task 5 后清扫
def _resolve_chat_args(**kw):
    return _resolve_args_for("chat", **kw)


class SidecarRuntimeManager:
    """通用 sidecar (llama / whisper) 生命周期管理。

    Plan 3C 起从 LlamaRuntimeManager 改名,加 ``engine`` 参数:
      * ``engine='llama'``   → spawn llama-server (chat/embedding/rerank)
      * ``engine='whisper'`` → spawn whisper-server (asr)

    Plan 3B 已有的 ``capability`` / ``port_offset`` 等仍兼容。
    """

    def __init__(
        self,
        *,
        chayuan_root: Path,
        engine: Literal["llama", "whisper"] = "llama",
        capability: str = "chat",
        port_offset: int = 0,
    ) -> None:
        self.chayuan_root = chayuan_root
        self.engine = engine
        self.capability = capability
        self.port_offset = port_offset
        self.settings_path = chayuan_root / "model_registry" / "local_runtime.yaml"
        self.status_path = chayuan_root / "runtime.json"
        self._settings = LocalRuntimeSettings.load(self.settings_path)
        self._status = RuntimeStatus(state="stopped")
        self._process = None  # subprocess.Popen 持有处

    @property
    def settings(self) -> LocalRuntimeSettings:
        return self._settings

    @property
    def status(self) -> RuntimeStatus:
        return self._status

    def find_server_exe(self) -> Optional[Path]:
        """跨平台找 vendor 进集成版的 sidecar 二进制。

        Plan 3D 起按 self.engine 选 binary 名和子目录:
          * engine='llama'    → services/llama-server/llama-server[.exe]
          * engine='whisper'  → services/whisper-server/whisper-server[.exe]
          * engine='infinity' → Python 解释器 sys.executable(Python -m 拉 sidecar)

        给路由 (/runtime/llama/install-info) 和 start() 共用。
        """
        if self.engine == "infinity":
            # Python sidecar: 直接用当前解释器拉 `-m chayuan.server.image_source.infinity_server`
            return Path(sys.executable)

        global _INSTALL_SERVICES_DIRS
        dirs = _INSTALL_SERVICES_DIRS if _INSTALL_SERVICES_DIRS is not None else _default_install_services_dirs()
        bin_name = f"{self.engine}-server"
        names = [f"{bin_name}.exe", bin_name]
        cands = _platform_subdir_candidates()
        for d in dirs:
            server_dir = d / bin_name
            # 优先 platform 子目录(预编译 binary 提交进 git 时的布局)
            # 按 candidate 列表顺序找(Win x64 默认 AVX2,缺时退到 noavx)
            for plat in cands:
                for name in names:
                    p = server_dir / plat / name
                    if p.is_file():
                        return p
            # 兜底:扁平布局(install 脚本现拉现写的旧落点)
            for name in names:
                p = server_dir / name
                if p.is_file():
                    return p
        return None

    def find_llama_server_exe(self) -> Optional[Path]:
        """Deprecated: Plan 3C 起改用 find_server_exe();此 alias 留作向后兼容。"""
        return self.find_server_exe()

    def _allocate_port(self, *, preferred: int) -> int:
        """从 preferred 开始往上找空闲端口 (上限 +20)"""
        import socket
        for offset in range(21):
            port = preferred + offset
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("127.0.0.1", port))
                    return port
                except OSError:
                    continue
        raise RuntimeError(f"没找到空闲端口 (从 {preferred} bump 了 20 次都被占)")

    async def start(self, *, model_id: str | None = None) -> RuntimeStatus:
        """spawn llama-server.exe。失败时返回 state=failed 的 RuntimeStatus。"""
        if self._status.state in ("starting", "ready"):
            return self._status

        self._status = RuntimeStatus(state="starting")

        exe = self.find_llama_server_exe()
        if exe is None:
            self._status = RuntimeStatus(
                state="failed",
                last_error="llama-server.exe 不在 vendor/services/llama-server/ 里;集成版未带,或开发环境没跑 install-llama-server.ps1",
            )
            self._persist_status()
            return self._status

        resolution, model_path = _resolve_args_for(self.capability, engine=self.engine)
        if resolution.missing or not model_path:
            self._status = RuntimeStatus(
                state="failed",
                last_error=f"{self.capability} 模型未就绪:{resolution.reason or f'no {self.capability} default'}",
            )
            self._persist_status()
            return self._status

        port = self._allocate_port(preferred=self._settings.port + self.port_offset)
        host = "0.0.0.0" if self._settings.expose_lan else self._settings.host

        args = [str(exe), "--host", host, "--port", str(port), "--log-disable"]
        args.extend(resolution.args)
        if self._settings.api_key:
            args.extend(["--api-key", self._settings.api_key])
        if "--threads" not in resolution.args:
            args.extend(["--threads", str(min(8, os.cpu_count() or 4))])

        # 动态链接的 vendor binary(如 Docker 提取的 whisper-server / linux-arm64
        # llama-server)依赖同目录 .so / .dylib;loader 默认不看 exe 旁路径,需要
        # LD_LIBRARY_PATH(Linux)或 DYLD_LIBRARY_PATH(macOS)显式注入。
        # Win 没此问题(DLL search 默认包含 exe 同目录)。infinity engine 用 sys.executable
        # 跑 Python module,不需要这个。
        proc_env = None
        if self.engine != "infinity" and sys.platform != "win32":
            proc_env = os.environ.copy()
            exe_dir = str(exe.parent)
            var = "DYLD_LIBRARY_PATH" if sys.platform == "darwin" else "LD_LIBRARY_PATH"
            existing = proc_env.get(var, "")
            proc_env[var] = f"{exe_dir}:{existing}" if existing else exe_dir

        try:
            self._process = subprocess.Popen(
                args,
                # stdout / stderr 都走 PIPE — llama-server 启动期 fatal(model load
                # failure / OOM / arch mismatch / 不存在的 GGUF 文件等)可能打 stdout
                # 或 stderr,不固定。原来 stdout=DEVNULL 把 stdout 吞了,导致
                # last_error 空白拿不到任何诊断。两边都 PIPE,死时合并读一次。
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=proc_env,
                # Windows 下 CREATE_NO_WINDOW = 0x08000000,避免弹黑框
                creationflags=0x08000000 if sys.platform == "win32" else 0,
            )
        except Exception as e:
            self._status = RuntimeStatus(state="failed", last_error=f"spawn failed: {e}")
            self._persist_status()
            return self._status

        proc = self._process  # snapshot:外部 stop() 会把 self._process 抢成 None,本地引用还能干净退出

        # 等 health 200(最长 HEALTH_READY_TIMEOUT_SEC 秒)。
        # 引擎不同 health endpoint 也不同:
        #   - llama-server (llama.cpp): GET /health 200 = 模型加载完成,可服务
        #   - whisper-server (whisper.cpp): 没有 /health,GET / 返 HTML UI 200
        #     (whisper-server 启动即加载模型,/ 200 等价于就绪)
        #   - infinity (Python sidecar): /health 200
        endpoint = f"http://{host if host != '0.0.0.0' else '127.0.0.1'}:{port}"
        health_path = "/" if self.engine == "whisper" else "/health"
        ready = False
        deadline = datetime.now().timestamp() + HEALTH_READY_TIMEOUT_SEC
        while datetime.now().timestamp() < deadline:
            if self._process is not proc:
                # stop() 已经被 await 过,我们不要再覆盖它写的 stopped 状态
                return self._status
            if proc.poll() is not None:
                # 合并 stdout + stderr,llama-server 早期 fatal 打哪边不固定。
                # 截最后 800 字节避免 last_error 字段被超长堆栈撑爆。
                out_bytes = proc.stdout.read() if proc.stdout else b""
                err_bytes = proc.stderr.read() if proc.stderr else b""
                merged = (out_bytes + err_bytes).decode("utf-8", errors="replace").strip()
                tail = merged[-800:] if merged else f"(无 stdout/stderr 输出,退出码 {proc.returncode})"
                self._status = RuntimeStatus(
                    state="failed",
                    last_error=f"llama-server 启动时退出:{tail}",
                )
                self._process = None
                self._persist_status()
                return self._status
            try:
                resp = await _probe_health(f"{endpoint}{health_path}", timeout=2.0)
                if getattr(resp, "status_code", None) == 200:
                    ready = True
                    break
            except Exception:
                pass
            await asyncio.sleep(HEALTH_PROBE_INTERVAL_SEC)

        if not ready:
            if self._process is not proc:
                return self._status
            # 超时也 kill 掉别留尸
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                pass
            self._process = None
            self._status = RuntimeStatus(
                state="failed",
                last_error=f"启动 {HEALTH_READY_TIMEOUT_SEC}s 内 {health_path} 没返 200",
            )
            self._persist_status()
            return self._status

        if self._process is not proc:
            return self._status
        self._status = RuntimeStatus(
            state="ready",
            endpoint=endpoint,
            pid=proc.pid,
            model_id=resolution.resolved_models.get("chat"),
            model_path=model_path,
            started_at=datetime.now(),
            last_health_at=datetime.now(),
        )
        self._persist_status()
        return self._status

    async def stop(self, *, timeout: float = 10.0) -> None:
        if self._process is None:
            self._status = RuntimeStatus(state="stopped")
            self._persist_status()
            return
        proc_local = self._process  # snapshot too,defensive
        try:
            proc_local.terminate()
            proc_local.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc_local.kill()
        except Exception as e:
            logger.warning("[local-runtime] stop terminate/wait error: %r", e)
        finally:
            self._process = None
        self._status = RuntimeStatus(state="stopped")
        self._persist_status()

    async def restart(self, *, model_id: str | None = None) -> RuntimeStatus:
        """等价于 stop + start;先写 state=restarting 让观察者看到过渡态。"""
        self._status = RuntimeStatus(state="restarting")
        self._persist_status()
        await self.stop()
        return await self.start(model_id=model_id)

    def set_config(self, update: dict) -> LocalRuntimeSettings:
        """部分更新设置 + 持久化 yaml。返回更新后的 settings。

        注意:不立即重启 llama-server,需要前端追一次 /runtime/llama/restart。
        """
        cur = dataclasses.asdict(self._settings)
        for k, v in update.items():
            if k in cur:
                cur[k] = v
        self._settings = LocalRuntimeSettings(**cur)
        self._settings.save(self.settings_path)
        return self._settings

    def _persist_status(self) -> None:
        """状态写 runtime.json,前端读。

        多 capability 共用同一文件,按 capability 分 key:
          {"llama": {"chat": {...}, "embedding": {...}, "rerank": {...}}}
        本 manager 只写自己 capability 那一段,其它段从磁盘 merge 不动。
        """
        try:
            self.status_path.parent.mkdir(parents=True, exist_ok=True)
            existing: Dict[str, Any] = {}
            if self.status_path.is_file():
                try:
                    existing = json.loads(self.status_path.read_text(encoding="utf-8")) or {}
                except Exception:
                    existing = {}
            llama_section = existing.get("llama") if isinstance(existing.get("llama"), dict) else {}
            # Plan 1 兼容: 旧版本 runtime.json 是 {"llama": {state, endpoint, ...}} 直接展平,
            # 没有 chat/embedding/rerank 分层;检测到这种 shape 时清空重写 (chat 接管)。
            if "state" in llama_section and "chat" not in llama_section:
                llama_section = {}
            llama_section[self.capability] = self._status.to_dict()
            existing["llama"] = llama_section
            self.status_path.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass  # 状态写不进去不致命


# ─────────────────────── 进程内单例 ─────────────────────────

_singleton: Optional[LlamaRuntimeManager] = None  # 保留兼容 monkeypatch (Plan 1 测试用)


def get_manager() -> LlamaRuntimeManager:
    """进程内单例 = registry.get('chat')。

    Plan 1 老调用方拿到 chat manager;Plan 3B 多 capability 调用方
    用 get_registry().get(cap) 取对应 manager。
    """
    global _singleton
    if _singleton is not None:
        # monkeypatch 路径:Plan 1 测试直接给 _singleton 赋值,优先用
        return _singleton
    from chayuan.server.model_registry.local_runtime_registry import get_registry
    return get_registry().get("chat")


# Plan 3C: Plan 1+2+3B 已有 42 个引用都叫 LlamaRuntimeManager。
# 保留同名 thin alias,默认 engine='llama',旧代码零改动。
class LlamaRuntimeManager(SidecarRuntimeManager):
    """Back-compat alias(Plan 3C 起 SidecarRuntimeManager 的 engine='llama' 子类)。"""

    def __init__(self, **kw):
        kw.setdefault("engine", "llama")
        super().__init__(**kw)
