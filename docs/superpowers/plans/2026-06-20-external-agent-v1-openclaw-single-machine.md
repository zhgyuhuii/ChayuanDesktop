# External Agent v1 (单机 + OpenClaw + 托管闭环) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在察元单机版里，把 OpenClaw 外部 agent 的「一键安装 / 可视化配置 / 监控 / 全生命期管理」做成一个可视化闭环，并落下 `ExternalAgentConnector` / `AgentInstanceManager` / `HostPolicy` 抽象骨架（v1 只实现 OpenClaw + trusted-local，但接口缝为 Hermes / shared-multitenant 预留）。

**Architecture:** 控制面走 CLI subprocess（argv 白名单，复用 `process_utils`），数据面 v1 暂不接（留 v3）。后端新增 `chayuan/server/agent_connector/` 模块（policy / runner / base / openclaw adapter / registry / manager）+ `api_server/external_agent_routes.py`，由 `EXTERNAL_AGENTS_ENABLED` 总开关 gate。前端新增单页 `AgentHubPage`（仿 `McpPage` 五态）+ `@chayuan/api` 的 `externalAgents` 客户端。所有外部 CLI 交互对一个 **fake openclaw 脚本**做契约测试，不依赖真装。

**Tech Stack:** Python / FastAPI / pytest+TestClient（后端，py312 root conda 环境）；TypeScript / React / @tanstack/react-query / vitest（前端，pnpm workspace）。

**设计依据:** `docs/superpowers/specs/2026-06-20-external-agent-integration-design.md`（§3/§4/§6/§9/§11）。

---

## 路径约定

- 后端根：`/work/chayuan-desktop/chayuan-server/libs/chayuan-server/`（下称 `SRV/`）
- 前端根：`/work/chayuan-desktop/chayuan-client/`（下称 `CLI/`）
- 后端测试命令（py312 root conda，见 memory `reference_py312_test_env`）：
  `cd SRV && PYTHONPATH=. pytest tests/unit_tests/<file> -v`
- 前端校验：`cd CLI && pnpm typecheck && pnpm lint && pnpm test`

## File Structure（v1 新增/修改）

**后端（新增 `SRV/chayuan/server/agent_connector/`）**
- `policy.py` — `HostPolicy` dataclass + `derive_host_policy()`（从 settings 派生）
- `runner.py` — `AgentCliRunner`：argv 白名单 subprocess（同步 + 行流 generator），复用 `process_utils`
- `base.py` — `ExternalAgentConnector` ABC + 数据类（`AgentStatus` / `AgentConfigBundle` / `InstallEvent`）
- `openclaw.py` — `OpenClawAdapter(ExternalAgentConnector)`：映射 openclaw CLI
- `registry.py` — `system_id -> adapter` 注册表
- `manager.py` — `AgentInstanceManager`：trusted-local 单例解析（per-user 缝留 NotImplemented）
- `api_server/external_agent_routes.py` — 路由（list/status/install/config/start/stop/restart/uninstall/logs）

**后端修改**
- `chayuan/settings.py:484` 附近 — 加 `EXTERNAL_AGENTS_ENABLED` / `EXTERNAL_AGENTS_HOST_POLICY`
- `api_server/server_app.py`（import 段 + line 145 后）— 注册 `external_agent_router`

**前端（新增）**
- `CLI/packages/api/src/externalAgents.ts` — API 客户端
- `CLI/packages/app/src/features/agent/AgentHubPage.tsx` — 五态主页
- `CLI/packages/app/src/features/agent/agentStatus.ts` — 纯函数：状态→色调/文案（可单测）

**前端修改（页注册 8 处，见 Task 10）**
- `packages/api/src/index.ts`、`features/shell/page-registry.tsx`、`features/shell/Sidebar.tsx`、
  `features/shell/tab-titles.ts`、`packages/i18n/src/locales/{zh-CN,en,ja,fr,de,ko}.ts`

**测试夹具（新增）**
- `SRV/tests/unit_tests/fakes/fake_openclaw.py` — 假 openclaw CLI（v1 输出契约真源）

---

## Task 1: HostPolicy（从 settings 派生）

**Files:**
- Create: `SRV/chayuan/server/agent_connector/__init__.py`（空）
- Create: `SRV/chayuan/server/agent_connector/policy.py`
- Modify: `SRV/chayuan/settings.py`（AUTH_REQUIRED 定义处 line 484 附近）
- Test: `SRV/tests/unit_tests/test_agent_policy.py`

- [ ] **Step 1: 加 settings 字段**

在 `SRV/chayuan/settings.py` 的 `AUTH_REQUIRED: bool = False`（line 484）之后插入：

```python
    EXTERNAL_AGENTS_ENABLED: bool = False
    """是否开启外部 agent 集成（OpenClaw 等）。单机版默认关，需用户显式开。"""

    EXTERNAL_AGENTS_HOST_POLICY: str = "auto"
    """主机策略：auto（按 AUTH_REQUIRED 派生）/ trusted-local / shared-multitenant。"""
```

- [ ] **Step 2: 写失败测试**

```python
# SRV/tests/unit_tests/test_agent_policy.py
from chayuan.server.agent_connector.policy import HostPolicy, derive_host_policy


def test_auto_without_auth_is_trusted_local():
    p = derive_host_policy(host_policy="auto", auth_required=False)
    assert p.kind == "trusted-local"
    assert p.sandbox_enforced is False
    assert p.multi_instance is False


def test_auto_with_auth_is_shared_multitenant():
    p = derive_host_policy(host_policy="auto", auth_required=True)
    assert p.kind == "shared-multitenant"
    assert p.sandbox_enforced is True
    assert p.multi_instance is True


def test_explicit_override_wins():
    p = derive_host_policy(host_policy="trusted-local", auth_required=True)
    assert p.kind == "trusted-local"
```

- [ ] **Step 3: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_policy.py -v`
Expected: FAIL（ModuleNotFoundError: agent_connector.policy）

- [ ] **Step 4: 实现 policy.py**

```python
# SRV/chayuan/server/agent_connector/policy.py
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class HostPolicy:
    """单机/服务器拓扑策略。单机=退化配置，唯一不随权限放开的是 sandbox。"""
    kind: str               # "trusted-local" | "shared-multitenant"
    multi_instance: bool    # 是否 per-user 多实例
    sandbox_enforced: bool  # 是否强制沙箱（共享主机才 True）
    spawn_local: bool       # spawn 目标是否本机（trusted-local True）


def derive_host_policy(*, host_policy: str, auth_required: bool) -> HostPolicy:
    hp = (host_policy or "auto").strip().lower()
    if hp == "auto":
        hp = "shared-multitenant" if auth_required else "trusted-local"
    if hp == "shared-multitenant":
        return HostPolicy(kind=hp, multi_instance=True, sandbox_enforced=True, spawn_local=False)
    return HostPolicy(kind="trusted-local", multi_instance=False, sandbox_enforced=False, spawn_local=True)
```

- [ ] **Step 5: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_policy.py -v`
Expected: PASS（3 passed）

- [ ] **Step 6: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/ libs/chayuan-server/chayuan/settings.py libs/chayuan-server/tests/unit_tests/test_agent_policy.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): HostPolicy derived from AUTH_REQUIRED"
```

---

## Task 2: AgentCliRunner（argv 白名单 subprocess + 行流）

**Files:**
- Create: `SRV/chayuan/server/agent_connector/runner.py`
- Test: `SRV/tests/unit_tests/test_agent_runner.py`

- [ ] **Step 1: 写失败测试**（用 `python -c` 当被测命令，避免依赖真 CLI）

```python
# SRV/tests/unit_tests/test_agent_runner.py
import sys
import pytest
from chayuan.server.agent_connector.runner import AgentCliRunner, DisallowedCommand


def _runner():
    # 白名单只允许子命令 "echoook"；bin 用当前 python
    return AgentCliRunner(bin_path=sys.executable, allowed_subcommands={"echoook"})


def test_rejects_disallowed_subcommand():
    r = _runner()
    with pytest.raises(DisallowedCommand):
        r.run(["rm", "-rf", "/"])


def test_run_captures_stdout_and_rc():
    r = _runner()
    # 第一个 arg 必须在白名单；其余原样透传给 python
    res = r.run(["echoook", "-c", "print('hi')"])
    assert res.returncode == 0
    assert "hi" in res.stdout


def test_stream_yields_lines():
    r = _runner()
    lines = list(r.stream(["echoook", "-c", "import sys;[print(i) for i in range(3)]"]))
    assert lines == ["0", "1", "2"]
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_runner.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 runner.py**

```python
# SRV/chayuan/server/agent_connector/runner.py
from __future__ import annotations
import subprocess
from dataclasses import dataclass
from typing import Iterable, Iterator, Sequence, Set


class DisallowedCommand(ValueError):
    """子命令不在白名单。"""


@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str


class AgentCliRunner:
    """对外部 agent CLI 的最小封装：argv list、绝不 shell=True、子命令白名单。"""

    def __init__(self, *, bin_path: str, allowed_subcommands: Set[str], timeout: float = 120.0):
        self.bin_path = bin_path
        self.allowed = set(allowed_subcommands)
        self.timeout = timeout

    def _argv(self, args: Sequence[str]) -> list[str]:
        if not args or args[0] not in self.allowed:
            raise DisallowedCommand(f"disallowed subcommand: {args[:1]}")
        return [self.bin_path, *args]

    def run(self, args: Sequence[str], *, timeout: float | None = None) -> RunResult:
        proc = subprocess.run(
            self._argv(args),
            capture_output=True, text=True,
            timeout=timeout or self.timeout,
        )
        return RunResult(proc.returncode, proc.stdout, proc.stderr)

    def stream(self, args: Sequence[str]) -> Iterator[str]:
        """逐行 yield stdout（用于安装/日志 SSE）。行尾换行已去除。"""
        proc = subprocess.Popen(
            self._argv(args),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                yield line.rstrip("\n")
        finally:
            proc.stdout and proc.stdout.close()
            proc.wait()
```

- [ ] **Step 4: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_runner.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/runner.py libs/chayuan-server/tests/unit_tests/test_agent_runner.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): AgentCliRunner with argv whitelist + line stream"
```

---

## Task 3: ExternalAgentConnector 基类与数据类

**Files:**
- Create: `SRV/chayuan/server/agent_connector/base.py`
- Test: `SRV/tests/unit_tests/test_agent_base.py`

- [ ] **Step 1: 写失败测试**（确认抽象方法齐全、数据类可构造）

```python
# SRV/tests/unit_tests/test_agent_base.py
import pytest
from chayuan.server.agent_connector.base import (
    ExternalAgentConnector, AgentStatus, AgentConfigBundle,
)


def test_status_dataclass_defaults():
    s = AgentStatus(installed=False, running=False)
    assert s.version is None and s.uptime_seconds is None and s.pid is None


def test_connector_is_abstract():
    with pytest.raises(TypeError):
        ExternalAgentConnector()  # 抽象类不可实例化


def test_required_methods_present():
    for name in ("status", "install", "start", "stop", "restart",
                 "uninstall", "get_config", "set_config", "stream_logs"):
        assert hasattr(ExternalAgentConnector, name)
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_base.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 base.py**

```python
# SRV/chayuan/server/agent_connector/base.py
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator, Optional


@dataclass
class AgentStatus:
    installed: bool
    running: bool
    version: Optional[str] = None
    uptime_seconds: Optional[int] = None
    pid: Optional[int] = None
    health: str = "unknown"          # ok | degraded | unknown
    detail: str = ""


@dataclass
class AgentConfigBundle:
    raw: str                          # 主配置文本（OpenClaw 是 openclaw.json）
    soul: str = ""                    # SOUL.md 人格文本
    format: str = "json5"             # 给前端选编辑器高亮


@dataclass
class InstallEvent:
    level: str                        # info | warn | error | done
    message: str
    ts: int = 0


class ExternalAgentConnector(ABC):
    """单个外部 agent 系统（OpenClaw/Hermes/…）的统一契约。
    v1 仅实现 OpenClaw + trusted-local；per-user/instance 由 AgentInstanceManager 负责。"""

    system_id: str = ""

    @abstractmethod
    def status(self) -> AgentStatus: ...

    @abstractmethod
    def install(self) -> Iterator[InstallEvent]:
        """流式安装事件（供 SSE）。"""

    @abstractmethod
    def start(self) -> None: ...

    @abstractmethod
    def stop(self) -> None: ...

    @abstractmethod
    def restart(self) -> None: ...

    @abstractmethod
    def uninstall(self) -> None: ...

    @abstractmethod
    def get_config(self) -> AgentConfigBundle: ...

    @abstractmethod
    def set_config(self, bundle: AgentConfigBundle) -> None: ...

    @abstractmethod
    def stream_logs(self) -> Iterator[str]: ...
```

- [ ] **Step 4: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_base.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/base.py libs/chayuan-server/tests/unit_tests/test_agent_base.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): ExternalAgentConnector ABC + status/config dataclasses"
```

---

## Task 4: fake openclaw CLI（v1 输出契约真源）

> OpenClaw 真实命令已核实（`openclaw status/health/config get/set/gateway start|stop|restart/uninstall`），
> 但其精确 `--json` 字段未逐一固定。**v1 以这个 fake 的输出为契约**，OpenClawAdapter 对它编码与测试；
> 真 CLI 字段在最后的 smoke 任务（Task 11）里对齐。

**Files:**
- Create: `SRV/tests/unit_tests/fakes/__init__.py`（空）
- Create: `SRV/tests/unit_tests/fakes/fake_openclaw.py`

- [ ] **Step 1: 写 fake CLI**（无测试，是夹具；下一任务消费它）

```python
# SRV/tests/unit_tests/fakes/fake_openclaw.py
"""最小 fake openclaw：被 OpenClawAdapter 当作 bin 调用。
支持 v1 子命令并打印契约化输出。用环境变量 FAKE_OPENCLAW_RUNNING 控制运行态。"""
import json
import os
import sys


def main() -> int:
    argv = sys.argv[1:]
    running = os.environ.get("FAKE_OPENCLAW_RUNNING") == "1"
    if argv[:1] == ["--version"]:
        print("openclaw 0.22.0")
        return 0
    if argv[:1] == ["status"] and "--json" in argv:
        print(json.dumps({"running": running, "version": "0.22.0",
                          "pid": 4242 if running else None,
                          "uptimeMs": 60000 if running else 0,
                          "health": "ok" if running else "unknown"}))
        return 0
    if argv[:2] == ["config", "get"]:
        print(json.dumps({"agents": {"defaults": {"model": "local"}}}))
        return 0
    if argv[:2] == ["config", "set"]:
        return 0
    if argv[:1] == ["onboard"]:
        for line in ("resolving install", "downloading", "installed daemon"):
            print(line)
        return 0
    if argv[:2] in (["gateway", "start"], ["gateway", "stop"], ["gateway", "restart"]):
        return 0
    if argv[:1] == ["uninstall"]:
        return 0
    print(f"unknown args: {argv}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/tests/unit_tests/fakes/
git -C /work/chayuan-desktop/chayuan-server commit -m "test(agent): fake openclaw CLI as v1 output contract"
```

---

## Task 5: OpenClawAdapter

**Files:**
- Create: `SRV/chayuan/server/agent_connector/openclaw.py`
- Test: `SRV/tests/unit_tests/test_openclaw_adapter.py`

- [ ] **Step 1: 写失败测试**（用 fake 当 bin，python 解释器执行它）

```python
# SRV/tests/unit_tests/test_openclaw_adapter.py
import os
import sys
import pytest
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

FAKE = os.path.join(os.path.dirname(__file__), "fakes", "fake_openclaw.py")


def _adapter(running: bool = False) -> OpenClawAdapter:
    # runner 的 bin 是 python；把 fake 脚本作为「子命令前缀」注入
    runner = AgentCliRunner(bin_path=sys.executable,
                            allowed_subcommands={FAKE})
    ad = OpenClawAdapter(runner=runner, argv_prefix=[FAKE])
    if running:
        os.environ["FAKE_OPENCLAW_RUNNING"] = "1"
    else:
        os.environ.pop("FAKE_OPENCLAW_RUNNING", None)
    return ad


def test_status_when_stopped():
    s = _adapter(running=False).status()
    assert s.installed is True and s.running is False
    assert s.version == "0.22.0" and s.pid is None


def test_status_when_running():
    s = _adapter(running=True).status()
    assert s.running is True and s.pid == 4242 and s.uptime_seconds == 60
    assert s.health == "ok"


def test_install_streams_events_ending_done():
    events = list(_adapter().install())
    assert events[-1].level == "done"
    assert any("installed" in e.message for e in events)


def test_get_config_returns_text():
    bundle = _adapter().get_config()
    assert "agents" in bundle.raw and bundle.format == "json5"
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_openclaw_adapter.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 openclaw.py**

```python
# SRV/chayuan/server/agent_connector/openclaw.py
from __future__ import annotations
import json
from typing import Iterator, Sequence
from chayuan.server.agent_connector.base import (
    ExternalAgentConnector, AgentStatus, AgentConfigBundle, InstallEvent,
)
from chayuan.server.agent_connector.runner import AgentCliRunner


class OpenClawAdapter(ExternalAgentConnector):
    """映射 openclaw CLI。argv_prefix 让测试可把 fake 脚本插在子命令前。"""
    system_id = "openclaw"

    def __init__(self, *, runner: AgentCliRunner, argv_prefix: Sequence[str] = ()):
        self.runner = runner
        self.prefix = list(argv_prefix)

    def _args(self, *parts: str) -> list[str]:
        return [*self.prefix, *parts]

    def status(self) -> AgentStatus:
        try:
            res = self.runner.run(self._args("status", "--json"))
        except Exception as e:  # noqa: BLE001
            return AgentStatus(installed=False, running=False, detail=str(e))
        if res.returncode != 0:
            return AgentStatus(installed=False, running=False, detail=res.stderr.strip())
        try:
            data = json.loads(res.stdout.strip() or "{}")
        except json.JSONDecodeError:
            return AgentStatus(installed=True, running=False, health="degraded",
                               detail="status json parse failed")
        up_ms = data.get("uptimeMs") or 0
        return AgentStatus(
            installed=True,
            running=bool(data.get("running")),
            version=data.get("version"),
            uptime_seconds=int(up_ms // 1000) if up_ms else None,
            pid=data.get("pid"),
            health=data.get("health", "unknown"),
        )

    def install(self) -> Iterator[InstallEvent]:
        for line in self.runner.stream(self._args("onboard", "--install-daemon")):
            yield InstallEvent(level="info", message=line)
        yield InstallEvent(level="done", message="install finished")

    def start(self) -> None:
        self.runner.run(self._args("gateway", "start"))

    def stop(self) -> None:
        self.runner.run(self._args("gateway", "stop"))

    def restart(self) -> None:
        self.runner.run(self._args("gateway", "restart"))

    def uninstall(self) -> None:
        self.runner.run(self._args("uninstall"))

    def get_config(self) -> AgentConfigBundle:
        res = self.runner.run(self._args("config", "get"))
        return AgentConfigBundle(raw=res.stdout, format="json5")

    def set_config(self, bundle: AgentConfigBundle) -> None:
        # v1：整文件写回走 config set（fake 直接接受）；真 CLI 字段级在 smoke 对齐
        self.runner.run(self._args("config", "set", "--file", "-"))

    def stream_logs(self) -> Iterator[str]:
        yield from self.runner.stream(self._args("logs", "--follow"))
```

> 注意：`stream_logs` 的 `logs` 与 `set_config` 的 `config set` 需把 `logs` / 已有的 `config` 加进
> runner 白名单（真实接线见 Task 7 manager 构造）；fake 未覆盖 `logs --follow`，其测试放 Task 11 smoke。

- [ ] **Step 4: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_openclaw_adapter.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/openclaw.py libs/chayuan-server/tests/unit_tests/test_openclaw_adapter.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): OpenClawAdapter maps openclaw CLI (tested vs fake)"
```

---

## Task 6: registry + AgentInstanceManager

**Files:**
- Create: `SRV/chayuan/server/agent_connector/registry.py`
- Create: `SRV/chayuan/server/agent_connector/manager.py`
- Test: `SRV/tests/unit_tests/test_agent_manager.py`

- [ ] **Step 1: 写失败测试**

```python
# SRV/tests/unit_tests/test_agent_manager.py
import pytest
from chayuan.server.agent_connector.manager import AgentInstanceManager
from chayuan.server.agent_connector.policy import derive_host_policy


def test_trusted_local_returns_singleton_per_system():
    mgr = AgentInstanceManager(policy=derive_host_policy(host_policy="trusted-local", auth_required=False))
    a = mgr.resolve("openclaw", user=None)
    b = mgr.resolve("openclaw", user=None)
    assert a is b                       # 单机=单例
    assert a.system_id == "openclaw"


def test_unknown_system_raises():
    mgr = AgentInstanceManager(policy=derive_host_policy(host_policy="trusted-local", auth_required=False))
    with pytest.raises(KeyError):
        mgr.resolve("does-not-exist", user=None)


def test_shared_multitenant_per_user_not_implemented_yet():
    mgr = AgentInstanceManager(policy=derive_host_policy(host_policy="shared-multitenant", auth_required=True))
    with pytest.raises(NotImplementedError):
        mgr.resolve("openclaw", user={"id": 1})
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_manager.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 registry.py + manager.py**

```python
# SRV/chayuan/server/agent_connector/registry.py
from __future__ import annotations
import sys
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

# v1 仅 openclaw；Hermes 在 v2 加一行。
_OPENCLAW_SUBCMDS = {"--version", "status", "config", "onboard", "gateway", "uninstall", "logs"}


def build_adapter(system_id: str):
    if system_id == "openclaw":
        runner = AgentCliRunner(bin_path="openclaw", allowed_subcommands=_OPENCLAW_SUBCMDS)
        # 真实 bin 是 "openclaw"；argv_prefix 留空（fake 注入仅在测试里）
        return OpenClawAdapter(runner=runner)
    raise KeyError(f"unknown agent system: {system_id}")


SUPPORTED_SYSTEMS = ("openclaw",)
```

```python
# SRV/chayuan/server/agent_connector/manager.py
from __future__ import annotations
from typing import Any, Dict, Optional
from chayuan.server.agent_connector.base import ExternalAgentConnector
from chayuan.server.agent_connector.policy import HostPolicy
from chayuan.server.agent_connector import registry


class AgentInstanceManager:
    """按 HostPolicy 解析 agent 实例。
    trusted-local：每 system 一个进程级单例。
    shared-multitenant：per-user 实例（v4 实现，v1 抛 NotImplementedError 占位）。"""

    def __init__(self, *, policy: HostPolicy):
        self.policy = policy
        self._singletons: Dict[str, ExternalAgentConnector] = {}

    def resolve(self, system_id: str, *, user: Optional[Dict[str, Any]]) -> ExternalAgentConnector:
        if self.policy.multi_instance:
            # 缝：v4 在此 spawn/查 per-user profile 实例
            raise NotImplementedError("shared-multitenant per-user spawner is v4")
        inst = self._singletons.get(system_id)
        if inst is None:
            inst = registry.build_adapter(system_id)   # 不存在 system 抛 KeyError
            self._singletons[system_id] = inst
        return inst
```

- [ ] **Step 4: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_manager.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/registry.py libs/chayuan-server/chayuan/server/agent_connector/manager.py libs/chayuan-server/tests/unit_tests/test_agent_manager.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): registry + AgentInstanceManager (trusted-local singleton, per-user seam)"
```

---

## Task 7: external_agent_routes + 注册 + 总开关 gate

**Files:**
- Create: `SRV/chayuan/server/api_server/external_agent_routes.py`
- Modify: `SRV/chayuan/server/api_server/server_app.py`（import 段 + line 145 后）
- Test: `SRV/tests/unit_tests/test_external_agent_routes.py`

- [ ] **Step 1: 写失败测试**（TestClient + monkeypatch manager 注入 fake 适配器）

```python
# SRV/tests/unit_tests/test_external_agent_routes.py
import os, sys
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server import external_agent_routes as R
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

FAKE = os.path.join(os.path.dirname(__file__), "fakes", "fake_openclaw.py")


def _client(monkeypatch, enabled=True):
    monkeypatch.setattr(R, "_agents_enabled", lambda: enabled)

    def fake_resolve(system_id, user=None):
        runner = AgentCliRunner(bin_path=sys.executable, allowed_subcommands={FAKE})
        return OpenClawAdapter(runner=runner, argv_prefix=[FAKE])

    monkeypatch.setattr(R, "_resolve", fake_resolve)
    app = FastAPI()
    app.include_router(R.external_agent_router)
    return TestClient(app)


def test_status_endpoint(monkeypatch):
    os.environ.pop("FAKE_OPENCLAW_RUNNING", None)
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/status")
    assert r.status_code == 200
    assert r.json()["installed"] is True and r.json()["running"] is False


def test_disabled_returns_404(monkeypatch):
    c = _client(monkeypatch, enabled=False)
    r = c.get("/api/v1/external-agents/openclaw/status")
    assert r.status_code == 404


def test_start_endpoint(monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/api/v1/external-agents/openclaw/start")
    assert r.status_code == 200 and r.json()["ok"] is True
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py -v`
Expected: FAIL（ModuleNotFoundError: external_agent_routes）

- [ ] **Step 3: 实现 external_agent_routes.py**

```python
# SRV/chayuan/server/api_server/external_agent_routes.py
from __future__ import annotations
from dataclasses import asdict
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.agent_connector.manager import AgentInstanceManager
from chayuan.server.agent_connector.policy import derive_host_policy

external_agent_router = APIRouter(prefix="/api/v1/external-agents", tags=["External Agents"])


def _agents_enabled() -> bool:
    try:
        from chayuan.settings import Settings
        return bool(getattr(Settings.basic_settings, "EXTERNAL_AGENTS_ENABLED", False))
    except Exception:
        return False


def _manager() -> AgentInstanceManager:
    from chayuan.settings import Settings
    hp = getattr(Settings.basic_settings, "EXTERNAL_AGENTS_HOST_POLICY", "auto")
    auth = bool(getattr(Settings.basic_settings, "AUTH_REQUIRED", False))
    return AgentInstanceManager(policy=derive_host_policy(host_policy=hp, auth_required=auth))


def _resolve(system_id: str, user: Optional[Dict[str, Any]] = None):
    return _manager().resolve(system_id, user=user)


def _guard():
    if not _agents_enabled():
        raise HTTPException(status_code=404, detail="external agents disabled")


@external_agent_router.get("/{system_id}/status")
def status(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    return asdict(_resolve(system_id, user).status())


@external_agent_router.post("/{system_id}/start")
def start(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).start()
    return {"ok": True}


@external_agent_router.post("/{system_id}/stop")
def stop(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).stop()
    return {"ok": True}


@external_agent_router.post("/{system_id}/restart")
def restart(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).restart()
    return {"ok": True}


@external_agent_router.post("/{system_id}/uninstall")
def uninstall(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).uninstall()
    return {"ok": True}


@external_agent_router.get("/{system_id}/config")
def get_config(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    return asdict(_resolve(system_id, user).get_config())


@external_agent_router.post("/{system_id}/install")
def install(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    conn = _resolve(system_id, user)

    def gen():
        import json
        for ev in conn.install():
            yield f"event: agent.install.{ev.level}\ndata: {json.dumps(asdict(ev))}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
```

- [ ] **Step 4: 注册路由**

在 `SRV/chayuan/server/api_server/server_app.py` 的 import 段（line 13-52 内）加：

```python
from chayuan.server.api_server.external_agent_routes import external_agent_router
```

在 `app.include_router(mcp_router)`（line 145）之后加：

```python
app.include_router(external_agent_router)
```

- [ ] **Step 5: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py -v`
Expected: PASS（3 passed）

- [ ] **Step 6: 全量回归 + py_compile**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_policy.py tests/unit_tests/test_agent_runner.py tests/unit_tests/test_agent_base.py tests/unit_tests/test_openclaw_adapter.py tests/unit_tests/test_agent_manager.py tests/unit_tests/test_external_agent_routes.py -v && python -m py_compile chayuan/server/api_server/server_app.py`
Expected: PASS（全绿）

- [ ] **Step 7: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/api_server/external_agent_routes.py libs/chayuan-server/chayuan/server/api_server/server_app.py libs/chayuan-server/tests/unit_tests/test_external_agent_routes.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): external-agents routes (status/lifecycle/config/install SSE) gated by EXTERNAL_AGENTS_ENABLED"
```

---

## Task 8: 前端 API 客户端 externalAgents

**Files:**
- Create: `CLI/packages/api/src/externalAgents.ts`
- Modify: `CLI/packages/api/src/index.ts`（加 `export * from './externalAgents';`）
- Test: `CLI/packages/api/src/externalAgents.test.ts`

- [ ] **Step 1: 写失败测试**（vitest，mock `request`）

```typescript
// CLI/packages/api/src/externalAgents.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({
  request: vi.fn(),
}));
import { request } from './client';
import { externalAgents } from './externalAgents';

describe('externalAgents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('status hits the right path', async () => {
    (request as any).mockResolvedValue({ data: { installed: true, running: false } });
    const s = await externalAgents.status('openclaw');
    expect(request).toHaveBeenCalledWith('/api/v1/external-agents/openclaw/status', { raw: true });
    expect(s.installed).toBe(true);
  });

  it('start posts', async () => {
    (request as any).mockResolvedValue({ data: { ok: true } });
    await externalAgents.start('openclaw');
    expect(request).toHaveBeenCalledWith('/api/v1/external-agents/openclaw/start', { method: 'POST', raw: true });
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd CLI && pnpm vitest run packages/api/src/externalAgents.test.ts`
Expected: FAIL（Cannot find module './externalAgents'）

- [ ] **Step 3: 实现 externalAgents.ts**

```typescript
// CLI/packages/api/src/externalAgents.ts
import { request } from './client';
import { getClientConfig } from './client';

export interface AgentStatus {
  installed: boolean;
  running: boolean;
  version?: string | null;
  uptime_seconds?: number | null;
  pid?: number | null;
  health: string;
  detail: string;
}

export interface AgentConfigBundle {
  raw: string;
  soul: string;
  format: string;
}

export const externalAgents = {
  async status(systemId: string): Promise<AgentStatus> {
    const r = await request<AgentStatus>(`/api/v1/external-agents/${systemId}/status`, { raw: true });
    return r.data;
  },
  async start(systemId: string): Promise<void> {
    await request(`/api/v1/external-agents/${systemId}/start`, { method: 'POST', raw: true });
  },
  async stop(systemId: string): Promise<void> {
    await request(`/api/v1/external-agents/${systemId}/stop`, { method: 'POST', raw: true });
  },
  async restart(systemId: string): Promise<void> {
    await request(`/api/v1/external-agents/${systemId}/restart`, { method: 'POST', raw: true });
  },
  async uninstall(systemId: string): Promise<void> {
    await request(`/api/v1/external-agents/${systemId}/uninstall`, { method: 'POST', raw: true });
  },
  async getConfig(systemId: string): Promise<AgentConfigBundle> {
    const r = await request<AgentConfigBundle>(`/api/v1/external-agents/${systemId}/config`, { raw: true });
    return r.data;
  },
  /** 安装日志 SSE，返回 unsubscribe。仿 runtime.ts:177-215。 */
  subscribeInstall(systemId: string, h: {
    onLog?: (m: { level: string; message: string }) => void;
    onDone?: () => void;
    onError?: (e: unknown) => void;
  }): () => void {
    const cfg = getClientConfig();
    const url = `${cfg.baseURL.replace(/\/+$/, '')}/api/v1/external-agents/${systemId}/install`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url, { withCredentials: cfg.authMode === 'cookie' });
    } catch (e) { h.onError?.(e); return () => undefined; }
    const onLog = (ev: MessageEvent) => { try { h.onLog?.(JSON.parse(ev.data)); } catch (e) { h.onError?.(e); } };
    es.addEventListener('agent.install.info', onLog as EventListener);
    es.addEventListener('agent.install.done', () => { h.onDone?.(); es?.close(); });
    es.onerror = (e) => h.onError?.(e);
    return () => { try { es?.close(); } catch { /* noop */ } };
  },
};
```

> 注意：`request` / `getClientConfig` 的精确导出名以 `CLI/packages/api/src/client.ts` 实际为准；
> 若 `getClientConfig` 不在 `./client` 而在别处（参 `runtime.ts:177` 的 import），按真实路径改 import。

- [ ] **Step 4: 加导出**

在 `CLI/packages/api/src/index.ts` 加一行：

```typescript
export * from './externalAgents';
```

- [ ] **Step 5: 跑测试看通过 + typecheck**

Run: `cd CLI && pnpm vitest run packages/api/src/externalAgents.test.ts && pnpm typecheck`
Expected: PASS + typecheck 全绿

- [ ] **Step 6: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/api/src/externalAgents.ts packages/api/src/externalAgents.test.ts packages/api/src/index.ts
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): externalAgents api client + SSE install subscribe"
```

---

## Task 9: agentStatus 纯函数（状态→色调/文案）

**Files:**
- Create: `CLI/packages/app/src/features/agent/agentStatus.ts`
- Test: `CLI/packages/app/src/features/agent/agentStatus.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// CLI/packages/app/src/features/agent/agentStatus.test.ts
import { describe, it, expect } from 'vitest';
import { branchOf, toneOf } from './agentStatus';
import type { AgentStatus } from '@chayuan/api';

const st = (p: Partial<AgentStatus>): AgentStatus =>
  ({ installed: false, running: false, health: 'unknown', detail: '', ...p });

describe('agentStatus', () => {
  it('not installed → install branch', () => {
    expect(branchOf(st({ installed: false }))).toBe('not_installed');
  });
  it('installed not running → stopped branch', () => {
    expect(branchOf(st({ installed: true, running: false }))).toBe('stopped');
  });
  it('running → running branch', () => {
    expect(branchOf(st({ installed: true, running: true }))).toBe('running');
  });
  it('tone maps running→success, stopped→idle, not_installed→muted', () => {
    expect(toneOf(st({ installed: true, running: true }))).toBe('success');
    expect(toneOf(st({ installed: true, running: false }))).toBe('idle');
    expect(toneOf(st({ installed: false }))).toBe('muted');
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd CLI && pnpm vitest run packages/app/src/features/agent/agentStatus.test.ts`
Expected: FAIL（Cannot find module './agentStatus'）

- [ ] **Step 3: 实现 agentStatus.ts**

```typescript
// CLI/packages/app/src/features/agent/agentStatus.ts
import type { AgentStatus } from '@chayuan/api';

export type AgentBranch = 'not_installed' | 'stopped' | 'running';
export type AgentTone = 'success' | 'idle' | 'muted';

export function branchOf(s: AgentStatus): AgentBranch {
  if (!s.installed) return 'not_installed';
  return s.running ? 'running' : 'stopped';
}

export function toneOf(s: AgentStatus): AgentTone {
  if (!s.installed) return 'muted';
  return s.running ? 'success' : 'idle';
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `cd CLI && pnpm vitest run packages/app/src/features/agent/agentStatus.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/app/src/features/agent/agentStatus.ts packages/app/src/features/agent/agentStatus.test.ts
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): pure status→branch/tone helpers (tested)"
```

---

## Task 10: AgentHubPage 五态主页 + 控制

**Files:**
- Create: `CLI/packages/app/src/features/agent/AgentHubPage.tsx`
- Test: 依赖 typecheck（UI 组件不强制 vitest，状态逻辑已在 Task 9 覆盖）

- [ ] **Step 1: 实现 AgentHubPage.tsx**（仿 `McpPage.tsx:31-136` 的 useQuery + 分支）

```tsx
// CLI/packages/app/src/features/agent/AgentHubPage.tsx
import React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { externalAgents } from '@chayuan/api';
import { branchOf, toneOf } from './agentStatus';

const SYSTEM = 'openclaw';
const QK = ['agent', SYSTEM, 'status'] as const;

const TONE_DOT: Record<string, string> = {
  success: 'bg-emerald-500',
  idle: 'bg-amber-500',
  muted: 'bg-slate-400',
};

export const AgentHubPage: React.FC = () => {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: QK,
    queryFn: () => externalAgents.status(SYSTEM),
    staleTime: 3_000,
    refetchInterval: 5_000,
    retry: 0,
  });

  const act = useMutation({
    mutationFn: (op: 'start' | 'stop' | 'restart') => externalAgents[op](SYSTEM),
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const s = status.data;
  const branch = s ? branchOf(s) : 'not_installed';

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-6 py-6">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">OpenClaw</h1>
        {s && <span className={`h-3 w-3 rounded-full ${TONE_DOT[toneOf(s)]}`} />}
        {s?.version && <span className="text-sm text-slate-500">v{s.version}</span>}
      </header>

      <div className="mt-6 min-h-0 flex-1">
        {status.isLoading && <p className="text-slate-500">加载中…</p>}
        {status.isError && <p className="text-red-500">读取状态失败：{String(status.error)}</p>}

        {branch === 'not_installed' && (
          <InstallHero onDone={() => qc.invalidateQueries({ queryKey: QK })} />
        )}

        {branch === 'stopped' && (
          <div className="space-y-3">
            <p>已安装 v{s?.version} · 守护进程未运行</p>
            <button className="rounded bg-blue-600 px-4 py-2 text-white"
                    onClick={() => act.mutate('start')} disabled={act.isPending}>
              启动
            </button>
          </div>
        )}

        {branch === 'running' && (
          <div className="space-y-3">
            <p>运行中 · pid {s?.pid} · uptime {s?.uptime_seconds}s · 健康 {s?.health}</p>
            <div className="flex gap-2">
              <button className="rounded border px-4 py-2" onClick={() => act.mutate('restart')}>重启</button>
              <button className="rounded border px-4 py-2" onClick={() => act.mutate('stop')}>停止</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const InstallHero: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [logs, setLogs] = React.useState<string[]>([]);
  const [installing, setInstalling] = React.useState(false);
  const start = () => {
    setInstalling(true);
    setLogs([]);
    const unsub = externalAgents.subscribeInstall(SYSTEM, {
      onLog: (m) => setLogs((p) => [...p, m.message]),
      onDone: () => { setInstalling(false); onDone(); unsub(); },
      onError: () => setInstalling(false),
    });
  };
  return (
    <div className="space-y-3">
      <p className="text-slate-600">尚未安装 OpenClaw。安装会在本机执行（需联网）。</p>
      <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={start} disabled={installing}>
        {installing ? '安装中…' : '一键安装'}
      </button>
      {logs.length > 0 && (
        <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
          {logs.join('\n')}
        </pre>
      )}
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd CLI && pnpm typecheck`
Expected: 全绿（若 className 风格/工具类不符，按仓库 Biome 规范微调，不改逻辑）

- [ ] **Step 3: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/app/src/features/agent/AgentHubPage.tsx
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): AgentHubPage five-state shell (install/stopped/running)"
```

---

## Task 11: 页注册（Sidebar / 路由 / i18n）+ 真 CLI smoke

**Files:**
- Modify: `CLI/packages/app/src/features/shell/page-registry.tsx`（line 63 lazy import；line 252-256 ROUTE_ENTRIES）
- Modify: `CLI/packages/app/src/features/shell/Sidebar.tsx`（line 27 icon import；line 82-97 NAV_ITEMS；line 417-431 iconKeyFor）
- Modify: `CLI/packages/app/src/features/shell/tab-titles.ts`（line 7-21 STATIC）
- Modify: `CLI/packages/i18n/src/locales/{zh-CN,en,ja,fr,de,ko}.ts`（nav 段）

- [ ] **Step 1: page-registry.tsx**

line 63 附近加 lazy import：

```tsx
const AgentHubPage = React.lazy(() =>
  import('../agent/AgentHubPage').then((m) => ({ default: m.AgentHubPage })),
);
```

在 `ROUTE_ENTRIES`（line 252-256 处，仿 MCP 条目）加：

```tsx
{ pattern: /^\/agent-hub$/, render: () => <AgentHubPage />, defaultTitle: 'nav.externalAgent', defaultIcon: 'bot' },
```

- [ ] **Step 2: Sidebar.tsx**

line 27 的 lucide-react import 加 `Bot`；`NAV_ITEMS`（line 82-97）加：

```tsx
{ to: '/agent-hub', labelKey: 'nav.externalAgent', icon: Bot },
```

`iconKeyFor()`（line 417-431）加：

```tsx
if (path === '/agent-hub') return 'bot';
```

- [ ] **Step 3: tab-titles.ts**

`STATIC`（line 7-21）加：

```ts
'/agent-hub': 'nav.externalAgent',
```

- [ ] **Step 4: i18n（6 个语言文件）**

每个 `CLI/packages/i18n/src/locales/<lang>.ts` 的 `nav` 对象加（zh-CN 用中文，其余用英文 `External Agent`）：

```ts
externalAgent: '外部 Agent',   // zh-CN；en/ja/fr/de/ko 用 'External Agent'
```

- [ ] **Step 5: typecheck + lint**

Run: `cd CLI && pnpm typecheck && pnpm lint`
Expected: 全绿

- [ ] **Step 6: 真 OpenClaw smoke（手动，验证 fake 契约 vs 真实 CLI）**

> 仅在有联网的开发机执行一次，用来对齐真实 `openclaw status --json` / `config get` 字段与
> Task 4 fake 契约的差异；如有出入，回到 Task 5 调 `OpenClawAdapter` 解析并补单测。

```bash
# 安装并起服务（按 §1 命令）
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
openclaw status --json   # 比对字段名 running/version/pid/uptimeMs/health
openclaw config get      # 比对配置文本形态
# 然后开 EXTERNAL_AGENTS_ENABLED=true，前端进 /agent-hub 走一遍 装→起→停→配置
```

- [ ] **Step 7: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/app/src/features/shell/ packages/i18n/src/locales/
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): register AgentHub page (sidebar/route/i18n)"
```

---

## Task 12: 配置写回（PUT config）+ 配置/SOUL.md 编辑器（功能②的写侧）

**Files:**
- Modify: `SRV/chayuan/server/api_server/external_agent_routes.py`（加 `PUT /{system_id}/config`）
- Modify: `SRV/tests/unit_tests/test_external_agent_routes.py`
- Modify: `CLI/packages/api/src/externalAgents.ts`（加 `setConfig`）
- Modify: `CLI/packages/api/src/externalAgents.test.ts`
- Modify: `CLI/packages/app/src/features/agent/AgentHubPage.tsx`（加配置区 + 卸载按钮）

- [ ] **Step 1: 写后端失败测试**（追加到 test_external_agent_routes.py）

```python
def test_put_config(monkeypatch):
    c = _client(monkeypatch)
    r = c.put("/api/v1/external-agents/openclaw/config",
              json={"raw": "{}", "soul": "be nice", "format": "json5"})
    assert r.status_code == 200 and r.json()["ok"] is True
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py::test_put_config -v`
Expected: FAIL（405 Method Not Allowed，PUT 未定义）

- [ ] **Step 3: 实现 PUT 路由**

在 `external_agent_routes.py` 顶部 import 段加：

```python
from pydantic import BaseModel
```

文件内加模型 + 路由：

```python
class ConfigIn(BaseModel):
    raw: str
    soul: str = ""
    format: str = "json5"


@external_agent_router.put("/{system_id}/config")
def put_config(system_id: str, body: ConfigIn, user=Depends(require_auth_enabled())):
    _guard()
    from chayuan.server.agent_connector.base import AgentConfigBundle
    _resolve(system_id, user).set_config(
        AgentConfigBundle(raw=body.raw, soul=body.soul, format=body.format)
    )
    return {"ok": True}
```

- [ ] **Step 4: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py -v`
Expected: PASS（含 test_put_config）

- [ ] **Step 5: 前端 setConfig + 失败测试**

在 `externalAgents.ts` 的对象里加方法：

```typescript
  async setConfig(systemId: string, body: { raw: string; soul?: string; format?: string }): Promise<void> {
    await request(`/api/v1/external-agents/${systemId}/config`, { method: 'PUT', body, raw: true });
  },
```

在 `externalAgents.test.ts` 追加：

```typescript
  it('setConfig puts body', async () => {
    (request as any).mockResolvedValue({ data: { ok: true } });
    await externalAgents.setConfig('openclaw', { raw: '{}', soul: 'x' });
    expect(request).toHaveBeenCalledWith('/api/v1/external-agents/openclaw/config',
      { method: 'PUT', body: { raw: '{}', soul: 'x' }, raw: true });
  });
```

- [ ] **Step 6: 跑前端测试**

Run: `cd CLI && pnpm vitest run packages/api/src/externalAgents.test.ts`
Expected: PASS

- [ ] **Step 7: AgentHubPage 加配置区 + 卸载按钮**

在 `AgentHubPage.tsx` 内新增 `ConfigSection` 组件，并在 `stopped` 与 `running` 分支底部各渲染
`<ConfigSection />`；在 `stopped` 分支加「卸载」按钮（调 `externalAgents.uninstall`）。

```tsx
const ConfigSection: React.FC = () => {
  const cfg = useQuery({
    queryKey: ['agent', SYSTEM, 'config'] as const,
    queryFn: () => externalAgents.getConfig(SYSTEM),
    staleTime: 30_000, retry: 0,
  });
  const [raw, setRaw] = React.useState('');
  const [soul, setSoul] = React.useState('');
  React.useEffect(() => {
    if (cfg.data) { setRaw(cfg.data.raw); setSoul(cfg.data.soul ?? ''); }
  }, [cfg.data]);
  const save = useMutation({
    mutationFn: () => externalAgents.setConfig(SYSTEM, { raw, soul }),
  });
  if (cfg.isLoading) return <p className="text-slate-500">读取配置…</p>;
  return (
    <details className="mt-6 rounded border p-3">
      <summary className="cursor-pointer font-medium">配置</summary>
      <label className="mt-2 block text-sm text-slate-500">openclaw.json</label>
      <textarea className="h-40 w-full rounded border p-2 font-mono text-xs"
                value={raw} onChange={(e) => setRaw(e.target.value)} />
      <label className="mt-2 block text-sm text-slate-500">SOUL.md（人格）</label>
      <textarea className="h-32 w-full rounded border p-2 font-mono text-xs"
                value={soul} onChange={(e) => setSoul(e.target.value)} />
      <button className="mt-2 rounded bg-blue-600 px-4 py-2 text-white"
              onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? '保存中…' : '保存（需重启生效）'}
      </button>
    </details>
  );
};
```

在 `stopped` 分支按钮区追加：

```tsx
<button className="rounded border border-red-300 px-4 py-2 text-red-600"
        onClick={() => { if (confirm('确认卸载 OpenClaw？')) externalAgents.uninstall(SYSTEM).then(() => qc.invalidateQueries({ queryKey: QK })); }}>
  卸载
</button>
```

> 桌面端 `confirm` 受限（见 memory `feedback_tauri_no_window_prompt`），落地时换项目 `confirmDialog`，不要用 `window.confirm`。

- [ ] **Step 8: typecheck**

Run: `cd CLI && pnpm typecheck`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/api_server/external_agent_routes.py libs/chayuan-server/tests/unit_tests/test_external_agent_routes.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): PUT config route"
git -C /work/chayuan-desktop/chayuan-client add packages/api/src/externalAgents.ts packages/api/src/externalAgents.test.ts packages/app/src/features/agent/AgentHubPage.tsx
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): config + SOUL.md editor and uninstall in AgentHub"
```

---

## Task 13: 日志流式（GET logs/stream）+ 日志面板（功能③的日志侧）

**Files:**
- Modify: `SRV/tests/unit_tests/fakes/fake_openclaw.py`（加 `logs --follow`）
- Modify: `SRV/chayuan/server/api_server/external_agent_routes.py`（加 logs/stream 路由）
- Modify: `SRV/tests/unit_tests/test_external_agent_routes.py`
- Modify: `CLI/packages/api/src/externalAgents.ts`（加 `subscribeLogs`）
- Modify: `CLI/packages/app/src/features/agent/AgentHubPage.tsx`（running 分支加 `LogsPanel`）

- [ ] **Step 1: fake 加 logs 分支**

在 `fake_openclaw.py` 的 `uninstall` 分支前加：

```python
    if argv[:1] == ["logs"] and "--follow" in argv:
        for line in ("[info] gateway up", "[info] channel ready"):
            print(line)
        return 0
```

- [ ] **Step 2: 写后端失败测试**

```python
def test_logs_stream(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/logs/stream")
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "gateway up" in r.text
```

- [ ] **Step 3: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py::test_logs_stream -v`
Expected: FAIL（404，路由未定义）

- [ ] **Step 4: 实现 logs/stream 路由**

```python
@external_agent_router.get("/{system_id}/logs/stream")
def logs_stream(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    conn = _resolve(system_id, user)

    def gen():
        import json
        for line in conn.stream_logs():
            yield f"event: agent.log\ndata: {json.dumps({'line': line})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
```

- [ ] **Step 5: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py -v`
Expected: PASS（含 test_logs_stream）

- [ ] **Step 6: 前端 subscribeLogs**

在 `externalAgents.ts` 加（仿 `subscribeInstall`）：

```typescript
  subscribeLogs(systemId: string, h: { onLine?: (s: string) => void; onError?: (e: unknown) => void }): () => void {
    const cfg = getClientConfig();
    const url = `${cfg.baseURL.replace(/\/+$/, '')}/api/v1/external-agents/${systemId}/logs/stream`;
    let es: EventSource | null = null;
    try { es = new EventSource(url, { withCredentials: cfg.authMode === 'cookie' }); }
    catch (e) { h.onError?.(e); return () => undefined; }
    es.addEventListener('agent.log', (ev: MessageEvent) => {
      try { h.onLine?.(JSON.parse(ev.data).line); } catch (e) { h.onError?.(e); }
    });
    es.onerror = (e) => h.onError?.(e);
    return () => { try { es?.close(); } catch { /* noop */ } };
  },
```

- [ ] **Step 7: AgentHubPage running 分支加 LogsPanel**

```tsx
const LogsPanel: React.FC = () => {
  const [lines, setLines] = React.useState<string[]>([]);
  React.useEffect(() => {
    const unsub = externalAgents.subscribeLogs(SYSTEM, {
      onLine: (l) => setLines((p) => [...p.slice(-200), l]),
    });
    return unsub;
  }, []);
  return (
    <pre className="mt-4 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
      {lines.join('\n') || '(等待日志…)'}
    </pre>
  );
};
```

在 `running` 分支末尾渲染 `<LogsPanel />`。

- [ ] **Step 8: typecheck + 全量回归**

Run: `cd CLI && pnpm typecheck && pnpm vitest run packages/api/src/externalAgents.test.ts` 然后
`cd SRV && PYTHONPATH=. pytest tests/unit_tests/ -k agent -v`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/api_server/external_agent_routes.py libs/chayuan-server/tests/unit_tests/
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): logs/stream SSE route + fake logs"
git -C /work/chayuan-desktop/chayuan-client add packages/api/src/externalAgents.ts packages/app/src/features/agent/AgentHubPage.tsx
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): logs panel in AgentHub running view"
```

---

## 完成定义（v1 退出标准）

- [ ] 后端 6 个测试文件全绿；`server_app.py` 能 import（py_compile 过）。
- [ ] 前端 `pnpm typecheck && pnpm lint && pnpm vitest run` 全绿。
- [ ] `EXTERNAL_AGENTS_ENABLED=false` 时 `/api/v1/external-agents/*` 全 404、Sidebar 入口可隐藏。
- [ ] 抽象骨架（`ExternalAgentConnector`/`AgentInstanceManager`/`HostPolicy`）就位，Hermes/shared-multitenant 缝为 `KeyError`/`NotImplementedError` 占位。
- [ ] 功能②写侧：`PUT /config` + 配置/SOUL.md 编辑器可保存（Task 12）。
- [ ] 功能③日志：`logs/stream` SSE + 日志面板出行（Task 13）。
- [ ] Task 11 smoke 在真机跑通装→配→监控→起停，fake 契约与真 CLI 差异已回填。

## 不在 v1（后续阶段）

- Hermes adapter（v2）、技能查看/下载/翻译（v2）、chayuan MCP server + 模型共享 + 对接（v3）、
  服务器多租户 spawner/沙箱/Fleet（v4）、内网离线安装轨（并行）。详见设计 §9。
