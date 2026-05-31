# chayuan-server 启动优化(A 埋点 + B 懒加载 + C 并发/fire-and-forget)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。每步 `python -m py_compile` + 尽量 import-smoke 守底(改 boot 高风险,本机无法跑 frozen)。

**Goal:** 把 chayuan-server 启动从「import 时同步阻塞 + startup handler 串行」优化为「埋点可观测 + 重活懒加载/后台 + 非关键并发 fire-and-forget」,缩短就绪时间,不改业务语义。

**Architecture:** A 加启动分段计时(stdout+log,绕过 logging 配置);B 把 `create_app()` 里 import 时同步跑的 `ensure_nltk_data`/`register_builtin_plugins`/`init_tracing` 移到后台 startup task;C 把 `first_launch`/`modality recovery`/`framework_wiring` 改 fire-and-forget,`run_migrations` 走 `to_thread`,unix 上 uvicorn 用 uvloop+httptools。

**Tech Stack:** Python/FastAPI/uvicorn。改 `chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py` + 新增 `_startup_timing.py`。

---

## ⚠ 本机可验证边界
- ✅:`py_compile`、`import chayuan.server.api_server.server_app`(若依赖齐;不齐则 py_compile)、`_startup_timing` 纯逻辑单测。
- ❌ `[RUN-VERIFY]`:真实启动耗时下降、frozen sidecar 行为、uvloop 生效 —— 需用户重建 + 跑 sidecar 看 `[startup-timing]` 日志验证。

> **关键纪律**:保留每个 handler 的 try/except 语义;fire-and-forget 改造**不得**吞掉本应阻塞就绪的关键步骤(migrations + admin bootstrap 仍阻塞);改完务必让用户重建后看启动日志的 `[startup-timing]` 行确认真热点 + 真收益。

---

## 文件结构
- `chayuan-server/libs/chayuan-server/chayuan/server/api_server/_startup_timing.py`(建):`phase(name)` ctx mgr。
- `chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py`(改):埋点 + 懒加载 + fire-and-forget + uvloop。
- `chayuan-server/libs/chayuan-server/tests/unit_tests/test_startup_timing.py`(建)。

---

## Task A: 启动分段计时埋点(可观测,先量再调)

**Files:**
- Create `chayuan-server/libs/chayuan-server/chayuan/server/api_server/_startup_timing.py`
- Modify `server_app.py`(在 `create_app` 末尾几处 eager 工作 + lifespan 完成处包计时)
- Test `chayuan-server/libs/chayuan-server/tests/unit_tests/test_startup_timing.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/unit_tests/test_startup_timing.py
import time
from chayuan.server.api_server._startup_timing import phase, _format_ms

def test_format_ms():
    assert _format_ms(0.0) == "0 ms"
    assert _format_ms(0.0123) == "12 ms"

def test_phase_logs(capsys):
    with phase("unit-test-phase"):
        time.sleep(0.001)
    out = capsys.readouterr().out
    assert "[startup-timing] unit-test-phase took" in out
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest libs/chayuan-server/tests/unit_tests/test_startup_timing.py -v`

- [ ] **Step 3: 实现 _startup_timing.py**
```python
"""启动分段计时 —— stdout 直写(绕过 logging 配置,frozen sidecar 也可见)+ logger。

用法:
    with phase("nltk-bootstrap"):
        ensure_nltk_data()
→ 启动日志出现:[startup-timing] nltk-bootstrap took 1234 ms
"""
from __future__ import annotations

import logging
import sys
import time
from contextlib import contextmanager

_log = logging.getLogger("chayuan.startup.timing")


def _format_ms(seconds: float) -> str:
    return f"{seconds * 1000:.0f} ms"


@contextmanager
def phase(name: str):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        msg = f"[startup-timing] {name} took {_format_ms(time.perf_counter() - t0)}"
        try:
            sys.stdout.write(msg + "\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass
        try:
            _log.info(msg)
        except Exception:  # noqa: BLE001
            pass
```

- [ ] **Step 4: 跑通**
Run: `cd chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest libs/chayuan-server/tests/unit_tests/test_startup_timing.py -v`
Expected: 2 passed

- [ ] **Step 5: 在 server_app.py 加埋点**
顶部加 import:`from chayuan.server.api_server._startup_timing import phase`
在 `create_app` 末尾的 eager 工作处(line ~590-609)分别包:
```python
    with phase("init-tracing"):
        try:
            from chayuan.server.observability import init_tracing
            init_tracing(app)
        except Exception:  # noqa: BLE001
            pass
    with phase("nltk-bootstrap"):
        try:
            from chayuan.server.file_rag.nltk_bootstrap import ensure_nltk_data
            ensure_nltk_data()
        except Exception:  # noqa: BLE001
            pass
    with phase("register-builtin-plugins"):
        try:
            from chayuan.server.file_rag.plugins import register_builtin_plugins
            register_builtin_plugins()
        except Exception:  # noqa: BLE001
            pass
```
> Task B 会把这三块移走;本 Task 先只加 `with phase(...)` 包住,产出可量化基线。

- [ ] **Step 6: py_compile + import smoke**
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/_startup_timing.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py`
Run(依赖齐则验,不齐跳过):`cd chayuan-server && PYTHONPATH="libs/chayuan-server" python -c "import chayuan.server.api_server._startup_timing; print('ok')"`

- [ ] **Step 7: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/_startup_timing.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_startup_timing.py
git commit -m "perf(startup): 加启动分段计时埋点 _startup_timing.phase(先量再调)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B: import 时同步重活 → 后台 startup task(懒加载)

**Files:** `server_app.py`

> `app = create_app()` 在模块顶层(line 627)即执行 → `ensure_nltk_data`/`register_builtin_plugins`/`init_tracing` 在 **import 时同步阻塞**。`register_builtin_plugins`(ColBERT 等)可能 import torch/transformers,是 boot 期潜在最大单块。改成后台 startup task,import 不再阻塞。

- [ ] **Step 1: 把 Task A 包好的三块从 create_app 末尾删除,改成一个后台 startup handler**
删 create_app 末尾那三块 `with phase(...)`,在其它 `@app.on_event("startup")` 旁加:
```python
    @app.on_event("startup")
    async def _deferred_import_time_work() -> None:
        """原本在 import 时同步跑的非关键初始化,改后台执行,不阻塞就绪信号。
        tracing/nltk/检索插件失败都不影响主链路,故 fire-and-forget。"""
        import asyncio

        def _run() -> None:
            with phase("init-tracing"):
                try:
                    from chayuan.server.observability import init_tracing
                    init_tracing(app)
                except Exception:  # noqa: BLE001
                    pass
            with phase("nltk-bootstrap"):
                try:
                    from chayuan.server.file_rag.nltk_bootstrap import ensure_nltk_data
                    ensure_nltk_data()
                except Exception:  # noqa: BLE001
                    pass
            with phase("register-builtin-plugins"):
                try:
                    from chayuan.server.file_rag.plugins import register_builtin_plugins
                    register_builtin_plugins()
                except Exception:  # noqa: BLE001
                    pass

        asyncio.create_task(asyncio.to_thread(_run))
```
> 注意:`init_tracing(app)` 移到首请求前的后台 task,极早期的几个请求可能漏 span(可接受,tracing 本就 best-effort try/except)。`register_builtin_plugins` 延后 → 首次用 ColBERT 检索时若插件还没注册,需保证调用方有"未就绪回退/重试"——**READ `file_rag/plugins.py` 确认注册是幂等且调用方容忍未注册**;若不容忍,改为"首次检索用时按需注册(lazy)"而非后台 task。报告这一点。

- [ ] **Step 2: py_compile + import smoke**
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py`

- [ ] **Step 3: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py
git commit -m "perf(startup): nltk/检索插件/tracing 从 import 时同步改后台 startup task(懒加载)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C: 非关键 handler fire-and-forget + 同步重活 to_thread + uvloop

**Files:** `server_app.py`

> 仍阻塞就绪但**可后台**的:`first_launch 扫描`(209)、`modality recovery`(242)、`framework_wiring`(261)。**必须保持阻塞**的:`run_migrations`+`bootstrap_default_admin`(190,DB 就绪是服务前提)——但 `run_migrations` 同步,用 `to_thread` 不卡 event loop。

- [ ] **Step 1: `_model_first_launch`(209)body 改后台**
把其 body 包进 `asyncio.create_task(asyncio.to_thread(...))`(scan 是同步重活):
```python
    @app.on_event("startup")
    async def _model_first_launch() -> None:
        import asyncio, logging
        log = logging.getLogger("chayuan.startup")

        def _run() -> None:
            with phase("first-launch-hooks"):
                try:
                    from chayuan.server.model_registry.first_launch import run_first_launch_hooks
                    r = run_first_launch_hooks()
                    if r.promoted:
                        log.info("[first_launch] auto-promoted defaults: %s", r.promoted)
                    if r.manuals_md or r.manuals_docx:
                        log.info("[first_launch] deployed manuals: md=%s docx=%s", r.manuals_md, r.manuals_docx)
                except Exception:  # noqa: BLE001
                    log.exception("run_first_launch_hooks failed")

        asyncio.create_task(asyncio.to_thread(_run))
```

- [ ] **Step 2: `_modality_task_recovery`(242)改 fire-and-forget**
把 `summary = await task_mgr.resume_unfinished_tasks()` 那段包进 `asyncio.create_task(...)`(它本是 async,直接 create_task 其协程):
```python
    @app.on_event("startup")
    async def _modality_task_recovery() -> None:
        import asyncio, logging
        log = logging.getLogger("chayuan.startup")

        async def _run() -> None:
            with phase("modality-recovery"):
                try:
                    from chayuan.server.modality.router import connectors as _connectors  # noqa: F401
                    from chayuan.server.modality.router.tasks import manager as task_mgr
                    summary = await task_mgr.resume_unfinished_tasks()
                    if summary["resumed"] or summary["orphaned"]:
                        log.info("[modality.recovery] resumed=%d orphaned=%d skipped=%d",
                                 summary["resumed"], summary["orphaned"], summary["skipped"])
                except Exception:  # noqa: BLE001
                    log.exception("modality task recovery failed")

        asyncio.create_task(_run())
```

- [ ] **Step 3: `_lifecycle_install_wiring`(261)改后台**
```python
    @app.on_event("startup")
    async def _lifecycle_install_wiring() -> None:
        import asyncio

        def _run() -> None:
            with phase("framework-wiring"):
                try:
                    from chayuan_runtime.framework_wiring import install_into_lifecycle
                    install_into_lifecycle()
                except Exception:  # noqa: BLE001
                    import logging as _logging
                    _logging.getLogger("chayuan.startup").exception("install framework_wiring into lifecycle failed")

        asyncio.create_task(asyncio.to_thread(_run))
```

- [ ] **Step 4: `_db_migrations_and_auth_bootstrap`(190)同步段 to_thread(仍 await,保持阻塞但不卡 loop)**
```python
    @app.on_event("startup")
    async def _db_migrations_and_auth_bootstrap() -> None:
        import asyncio, logging
        log = logging.getLogger("chayuan.startup")
        with phase("db-migrations"):
            try:
                from chayuan.server.db.migrations import run_migrations
                await asyncio.to_thread(run_migrations)
            except Exception:  # noqa: BLE001
                log.exception("run_migrations failed")
        with phase("admin-bootstrap"):
            try:
                from chayuan.server.auth.service import bootstrap_default_admin
                seed = await asyncio.to_thread(bootstrap_default_admin)
                if seed:
                    username, password = seed
                    log.warning("seeded default admin username=%s password=%s", username, password)
            except Exception:  # noqa: BLE001
                log.exception("bootstrap_default_admin failed")
```
> 保持 await(DB 就绪先于服务),只是挪出 event loop 线程。

- [ ] **Step 5: uvloop + httptools(unix)**
改 `run_api`(line 614):
```python
def run_api(host, port, **kwargs):
    extra = {}
    # unix 上 uvloop + httptools 更快;Windows 无 uvloop,优雅跳过。
    try:
        import uvloop  # noqa: F401
        extra["loop"] = "uvloop"
        extra["http"] = "httptools"
    except Exception:  # noqa: BLE001
        pass
    if kwargs.get("ssl_keyfile") and kwargs.get("ssl_certfile"):
        uvicorn.run(app, host=host, port=port,
                    ssl_keyfile=kwargs["ssl_keyfile"], ssl_certfile=kwargs["ssl_certfile"], **extra)
    else:
        uvicorn.run(app, host=host, port=port, **extra)
```

- [ ] **Step 6: py_compile + import smoke**
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py`

- [ ] **Step 7: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py
git commit -m "perf(startup): 非关键 handler fire-and-forget + migrations to_thread + uvloop/httptools

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task D: 自检 + 推送

- [ ] **Step 1:** `cd chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest libs/chayuan-server/tests/unit_tests/test_startup_timing.py -q`(pass)
- [ ] **Step 2:** `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/_startup_timing.py`
- [ ] **Step 3:**(依赖齐则)`cd chayuan-server && PYTHONPATH="libs/chayuan-server" python -c "import chayuan.server.api_server.server_app as m; print('import ok')"` —— 验 create_app 不再于 import 阻塞 nltk/plugins(应明显更快或不触发网络)
- [ ] **Step 4:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)
- **覆盖**:A 埋点(可量真热点)、B import 时重活后台化、C 非关键 handler 并发 + 同步重活 to_thread + uvloop。
- **不破语义**:migrations+admin 仍阻塞且先于服务;所有 handler try/except 保留;fire-and-forget 仅用于失败不影响主链路的步骤。
- **占位扫描**:无 TBD。`[RUN-VERIFY]` 标的是真实启动耗时/uvloop 生效需重建跑 sidecar。
- **风险**:① `register_builtin_plugins` 延后 → 首次 ColBERT 检索可能未注册(Task B Step1 要求核实调用方容忍/改 lazy)② tracing 延后 → 极早期请求漏 span ③ first_launch 延后 → 装机后"立即可聊"可能晚几秒就绪(可接受,模型本就异步 preload)④ uvloop 仅 unix。**全部需用户重建后看 `[startup-timing]` 日志确认真收益 + 无回归。**
