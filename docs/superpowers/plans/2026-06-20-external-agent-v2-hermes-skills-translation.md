# External Agent v2 (Hermes adapter + 技能查看/下载/翻译) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** 在 v1 抽象之上 ① 加 `HermesAdapter`（验证抽象正确，两家可切）；② 实现功能⑤技能/组件全量查看 + 翻译展示、功能⑥下载技能（装/卸/搜市场 + 权限预览）。

**Architecture:** 复用 v1 的 `ExternalAgentConnector` / `AgentCliRunner` / 路由骨架。给 connector 加技能方法族；OpenClaw 走 ClawHub（`openclaw skills …`），Hermes 走其技能市场（`hermes skills …`）。翻译走后端 `get_OpenAIClient()` 本地 LLM + `SkillTranslation` SQLite 缓存；**权限清单不机翻**。前端技能 tab 照搬 `McpBoard` 卡片网格。

**Tech Stack:** 同 v1。前置依赖：v1 全部任务已合入。

**设计依据:** `docs/superpowers/specs/2026-06-20-external-agent-integration-design.md` §3(⑤⑥) / §7。

---

## 路径约定（同 v1）

- 后端 `SRV/` = `/work/chayuan-desktop/chayuan-server/libs/chayuan-server/`
- 前端 `CLI/` = `/work/chayuan-desktop/chayuan-client/`
- 后端测试：`cd SRV && PYTHONPATH=. pytest tests/unit_tests/<file> -v`
- 前端：`cd CLI && pnpm typecheck && pnpm vitest run <file>`

## File Structure（v2 新增/修改）

- Create `SRV/chayuan/server/agent_connector/hermes.py` — `HermesAdapter`
- Create `SRV/tests/unit_tests/fakes/fake_hermes.py`
- Modify `SRV/chayuan/server/agent_connector/base.py` — 加 `Skill` 数据类 + 技能抽象方法
- Modify `SRV/chayuan/server/agent_connector/openclaw.py` / `hermes.py` — 技能方法实现
- Modify `SRV/chayuan/server/agent_connector/registry.py` — 注册 hermes
- Create `SRV/chayuan/server/db/models/skill_translation_model.py` — 翻译缓存表
- Create `SRV/chayuan/server/agent_connector/translation.py` — 翻译服务（LLM + 缓存）
- Modify `SRV/chayuan/server/api_server/external_agent_routes.py` — 技能路由
- Create `CLI/packages/app/src/features/agent/SkillsTab.tsx` + `BilingualText.tsx`
- Modify `CLI/packages/api/src/externalAgents.ts` — 技能方法
- Modify `CLI/packages/app/src/features/agent/AgentHubPage.tsx` — 挂 SkillsTab + 系统切换器

---

## Task 1: HermesAdapter（验证抽象 + 两家可切）

**Files:**
- Create: `SRV/tests/unit_tests/fakes/fake_hermes.py`
- Create: `SRV/chayuan/server/agent_connector/hermes.py`
- Modify: `SRV/chayuan/server/agent_connector/registry.py`
- Test: `SRV/tests/unit_tests/test_hermes_adapter.py`

- [ ] **Step 1: fake_hermes.py**（v2 hermes 契约真源）

```python
# SRV/tests/unit_tests/fakes/fake_hermes.py
import json, os, sys

def main() -> int:
    a = sys.argv[1:]
    running = os.environ.get("FAKE_HERMES_RUNNING") == "1"
    if a[:2] == ["gateway", "status"]:
        print("running" if running else "stopped"); return 0
    if a[:1] == ["status"] and "--all" in a:
        print(json.dumps({"version": "1.0.0", "gateway": running})); return 0
    if a[:2] == ["config", "show"]:
        print(json.dumps({"model": {"provider": "custom"}})); return 0
    if a[:2] == ["config", "set"]:
        return 0
    if a[:1] == ["setup"] and "--non-interactive" in a:
        print("setup ok"); print("installed daemon"); return 0
    if a[:2] in (["gateway", "start"], ["gateway", "stop"], ["gateway", "restart"]):
        return 0
    if a[:1] == ["uninstall"]:
        return 0
    if a[:2] == ["skills", "list"]:
        print(json.dumps([{"id": "weather", "name": "Weather", "version": "1.0",
                           "description": "weather tool", "permissions": ["net"], "installed": True}])); return 0
    if a[:2] == ["skills", "search"]:
        print(json.dumps([{"id": "calendar", "name": "Calendar", "version": "2.1",
                           "description": "calendar", "permissions": ["fs"], "installed": False}])); return 0
    if a[:2] in (["skills", "install"], ["skills", "uninstall"]):
        return 0
    print(f"unknown {a}", file=sys.stderr); return 2

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 写失败测试**

```python
# SRV/tests/unit_tests/test_hermes_adapter.py
import os, sys
from chayuan.server.agent_connector.hermes import HermesAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

FAKE = os.path.join(os.path.dirname(__file__), "fakes", "fake_hermes.py")


def _ad(running=False):
    r = AgentCliRunner(bin_path=sys.executable, allowed_subcommands={FAKE})
    os.environ["FAKE_HERMES_RUNNING"] = "1" if running else "0"
    return HermesAdapter(runner=r, argv_prefix=[FAKE])


def test_status_running():
    s = _ad(running=True).status()
    assert s.installed is True and s.running is True and s.version == "1.0.0"


def test_status_stopped():
    s = _ad(running=False).status()
    assert s.running is False
```

- [ ] **Step 3: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_hermes_adapter.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 4: 实现 hermes.py**

```python
# SRV/chayuan/server/agent_connector/hermes.py
from __future__ import annotations
import json
from typing import Iterator, Sequence
from chayuan.server.agent_connector.base import (
    ExternalAgentConnector, AgentStatus, AgentConfigBundle, InstallEvent,
)
from chayuan.server.agent_connector.runner import AgentCliRunner


class HermesAdapter(ExternalAgentConnector):
    system_id = "hermes"

    def __init__(self, *, runner: AgentCliRunner, argv_prefix: Sequence[str] = ()):
        self.runner = runner
        self.prefix = list(argv_prefix)

    def _args(self, *p: str) -> list[str]:
        return [*self.prefix, *p]

    def status(self) -> AgentStatus:
        try:
            res = self.runner.run(self._args("status", "--all"))
        except Exception as e:  # noqa: BLE001
            return AgentStatus(installed=False, running=False, detail=str(e))
        if res.returncode != 0:
            return AgentStatus(installed=False, running=False, detail=res.stderr.strip())
        try:
            data = json.loads(res.stdout.strip() or "{}")
        except json.JSONDecodeError:
            return AgentStatus(installed=True, running=False, health="degraded")
        return AgentStatus(installed=True, running=bool(data.get("gateway")),
                           version=data.get("version"), health="ok" if data.get("gateway") else "unknown")

    def install(self) -> Iterator[InstallEvent]:
        for line in self.runner.stream(self._args("setup", "--non-interactive")):
            yield InstallEvent(level="info", message=line)
        yield InstallEvent(level="done", message="install finished")

    def start(self) -> None: self.runner.run(self._args("gateway", "start"))
    def stop(self) -> None: self.runner.run(self._args("gateway", "stop"))
    def restart(self) -> None: self.runner.run(self._args("gateway", "restart"))
    def uninstall(self) -> None: self.runner.run(self._args("uninstall"))

    def get_config(self) -> AgentConfigBundle:
        res = self.runner.run(self._args("config", "show"))
        return AgentConfigBundle(raw=res.stdout, format="yaml")

    def set_config(self, bundle: AgentConfigBundle) -> None:
        self.runner.run(self._args("config", "set", "raw", bundle.raw[:0] or "noop"))

    def stream_logs(self) -> Iterator[str]:
        yield from self.runner.stream(self._args("logs", "--follow"))
```

- [ ] **Step 5: 注册 hermes**

在 `registry.py` 加：

```python
from chayuan.server.agent_connector.hermes import HermesAdapter
_HERMES_SUBCMDS = {"status", "config", "setup", "gateway", "uninstall", "logs", "skills"}
```

`build_adapter` 内加分支：

```python
    if system_id == "hermes":
        runner = AgentCliRunner(bin_path="hermes", allowed_subcommands=_HERMES_SUBCMDS)
        return HermesAdapter(runner=runner)
```

`SUPPORTED_SYSTEMS = ("openclaw", "hermes")`

- [ ] **Step 6: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_hermes_adapter.py -v`
Expected: PASS（2 passed）

- [ ] **Step 7: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/hermes.py libs/chayuan-server/chayuan/server/agent_connector/registry.py libs/chayuan-server/tests/unit_tests/fakes/fake_hermes.py libs/chayuan-server/tests/unit_tests/test_hermes_adapter.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): HermesAdapter + register (validates abstraction)"
```

---

## Task 2: Skill 数据类 + 技能抽象方法

**Files:**
- Modify: `SRV/chayuan/server/agent_connector/base.py`
- Test: `SRV/tests/unit_tests/test_agent_base.py`（追加）

- [ ] **Step 1: 写失败测试**（追加）

```python
def test_skill_dataclass_and_methods():
    from chayuan.server.agent_connector.base import Skill, ExternalAgentConnector
    sk = Skill(id="x", name="X", version="1.0", description="d", permissions=["net"], installed=False)
    assert sk.publisher == "" and sk.verified is False
    for m in ("list_skills", "search_skills", "install_skill", "uninstall_skill", "skill_detail"):
        assert hasattr(ExternalAgentConnector, m)
```

- [ ] **Step 2: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_base.py::test_skill_dataclass_and_methods -v`
Expected: FAIL（ImportError: Skill）

- [ ] **Step 3: 加 Skill + 抽象方法**

在 `base.py` 加：

```python
@dataclass
class Skill:
    id: str
    name: str
    version: str
    description: str
    permissions: list = field(default_factory=list)   # 不机翻
    installed: bool = False
    publisher: str = ""
    verified: bool = False
    readme: str = ""
```

在 `ExternalAgentConnector` 加抽象方法（默认 `raise NotImplementedError`，让 v1 已实现的两个 adapter 不被强制——改为非 abstractmethod 普通方法抛 NotImplementedError，避免破坏 v1）：

```python
    def list_skills(self) -> list: raise NotImplementedError
    def search_skills(self, query: str) -> list: raise NotImplementedError
    def install_skill(self, skill_id: str) -> Iterator[InstallEvent]: raise NotImplementedError
    def uninstall_skill(self, skill_id: str) -> None: raise NotImplementedError
    def skill_detail(self, skill_id: str) -> "Skill": raise NotImplementedError
```

- [ ] **Step 4: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_agent_base.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/base.py libs/chayuan-server/tests/unit_tests/test_agent_base.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): Skill dataclass + skill methods on connector"
```

---

## Task 3: OpenClaw 技能实现 + fake 扩展

**Files:**
- Modify: `SRV/tests/unit_tests/fakes/fake_openclaw.py`（加 skills 分支）
- Modify: `SRV/chayuan/server/agent_connector/openclaw.py`
- Modify: `SRV/chayuan/server/agent_connector/registry.py`（白名单加 `skills`）
- Test: `SRV/tests/unit_tests/test_openclaw_adapter.py`（追加）

- [ ] **Step 1: fake 加 skills**

在 `fake_openclaw.py` 的 `uninstall` 分支前加：

```python
    if argv[:2] == ["skills", "list"]:
        print(json.dumps([{"slug": "web-search", "name": "Web Search", "version": "1.2",
                           "description": "search web", "requires": ["net"], "verified": True}]))
        return 0
    if argv[:2] == ["skills", "search"]:
        print(json.dumps([{"slug": "todo", "name": "Todo", "version": "0.3",
                           "description": "todo", "requires": [], "verified": False}]))
        return 0
    if argv[:2] in (["skills", "install"], ["skills", "uninstall"]):
        if argv[1] == "install":
            print("downloading"); print("installed")
        return 0
```

- [ ] **Step 2: 写失败测试**（追加到 test_openclaw_adapter.py）

```python
def test_list_skills():
    skills = _adapter().list_skills()
    assert skills[0].name == "Web Search" and skills[0].installed is True
    assert skills[0].permissions == ["net"]


def test_search_skills():
    res = _adapter().search_skills("todo")
    assert res[0].name == "Todo" and res[0].installed is False
```

- [ ] **Step 3: 跑测试看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_openclaw_adapter.py -k skills -v`
Expected: FAIL（NotImplementedError）

- [ ] **Step 4: 实现 openclaw 技能方法**

在 `OpenClawAdapter` 加（import 顶部加 `from chayuan.server.agent_connector.base import Skill`）：

```python
    def _skill_from(self, d: dict, installed: bool) -> "Skill":
        from chayuan.server.agent_connector.base import Skill
        return Skill(id=d.get("slug", ""), name=d.get("name", ""), version=str(d.get("version", "")),
                     description=d.get("description", ""), permissions=list(d.get("requires", [])),
                     installed=installed, verified=bool(d.get("verified", False)))

    def list_skills(self) -> list:
        import json as _j
        res = self.runner.run(self._args("skills", "list", "--json"))
        return [self._skill_from(d, installed=True) for d in _j.loads(res.stdout or "[]")]

    def search_skills(self, query: str) -> list:
        import json as _j
        res = self.runner.run(self._args("skills", "search", query, "--json"))
        return [self._skill_from(d, installed=False) for d in _j.loads(res.stdout or "[]")]

    def install_skill(self, skill_id: str):
        from chayuan.server.agent_connector.base import InstallEvent
        for line in self.runner.stream(self._args("skills", "install", skill_id)):
            yield InstallEvent(level="info", message=line)
        yield InstallEvent(level="done", message="skill installed")

    def uninstall_skill(self, skill_id: str) -> None:
        self.runner.run(self._args("skills", "uninstall", skill_id))
```

在 `registry.py` 的 `_OPENCLAW_SUBCMDS` 确认含 `"skills"`（v1 已含）。

- [ ] **Step 5: 跑测试看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_openclaw_adapter.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/openclaw.py libs/chayuan-server/tests/unit_tests/
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): OpenClaw skills list/search/install/uninstall"
```

---

## Task 4: Hermes 技能实现

**Files:**
- Modify: `SRV/chayuan/server/agent_connector/hermes.py`
- Test: `SRV/tests/unit_tests/test_hermes_adapter.py`（追加）

- [ ] **Step 1: 写失败测试**

```python
def test_hermes_list_skills():
    s = _ad().list_skills()
    assert s[0].name == "Weather" and s[0].permissions == ["net"]
```

- [ ] **Step 2: 跑看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_hermes_adapter.py::test_hermes_list_skills -v`
Expected: FAIL（NotImplementedError）

- [ ] **Step 3: 实现 hermes 技能方法**

```python
    def _skill_from(self, d: dict, installed: bool):
        from chayuan.server.agent_connector.base import Skill
        return Skill(id=d.get("id", ""), name=d.get("name", ""), version=str(d.get("version", "")),
                     description=d.get("description", ""), permissions=list(d.get("permissions", [])),
                     installed=installed if "installed" not in d else bool(d["installed"]))

    def list_skills(self) -> list:
        import json as _j
        res = self.runner.run(self._args("skills", "list"))
        return [self._skill_from(d, True) for d in _j.loads(res.stdout or "[]")]

    def search_skills(self, query: str) -> list:
        import json as _j
        res = self.runner.run(self._args("skills", "search", query))
        return [self._skill_from(d, False) for d in _j.loads(res.stdout or "[]")]

    def install_skill(self, skill_id: str):
        from chayuan.server.agent_connector.base import InstallEvent
        self.runner.run(self._args("skills", "install", skill_id))
        yield InstallEvent(level="done", message="skill installed")

    def uninstall_skill(self, skill_id: str) -> None:
        self.runner.run(self._args("skills", "uninstall", skill_id))
```

- [ ] **Step 4: 跑看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_hermes_adapter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/agent_connector/hermes.py libs/chayuan-server/tests/unit_tests/test_hermes_adapter.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): Hermes skills methods"
```

---

## Task 5: 翻译服务（LLM + SQLite 缓存，权限不机翻）

**Files:**
- Create: `SRV/chayuan/server/db/models/skill_translation_model.py`
- Create: `SRV/chayuan/server/agent_connector/translation.py`
- Test: `SRV/tests/unit_tests/test_skill_translation.py`

- [ ] **Step 1: 缓存表模型**（仿 `db/models/model_metadata_model.py`）

```python
# SRV/chayuan/server/db/models/skill_translation_model.py
from sqlalchemy import Column, Integer, String, Text, DateTime, func, UniqueConstraint
from chayuan.server.db.base import Base


class SkillTranslationModel(Base):
    __tablename__ = "skill_translation"
    __table_args__ = (UniqueConstraint("cache_key", name="uq_skill_tr_key"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_key = Column(String(256), nullable=False)   # f"{system}:{skill_id}:{version}:{field}:{lang}:{src_hash}"
    translated_text = Column(Text, nullable=False)
    create_time = Column(DateTime, default=func.now())
```

> 若仓库 Base 路径不是 `db.base`，按 `model_metadata_model.py` 的实际 import 改。

- [ ] **Step 2: 写失败测试**（mock LLM，不打真模型）

```python
# SRV/tests/unit_tests/test_skill_translation.py
import pytest
from chayuan.server.agent_connector import translation as T


def test_permissions_field_is_not_translated():
    with pytest.raises(ValueError):
        # 权限不机翻：调用方传 field='permissions' 必须被拒
        import asyncio
        asyncio.get_event_loop().run_until_complete(
            T.translate_field(system="openclaw", skill_id="x", version="1",
                              field="permissions", text="net access", target_lang="zh"))


def test_translate_uses_cache(monkeypatch):
    import asyncio
    calls = {"n": 0}

    async def fake_llm(text, target_lang):
        calls["n"] += 1
        return "译文:" + text

    monkeypatch.setattr(T, "_llm_translate", fake_llm)
    monkeypatch.setattr(T, "_cache_get", lambda key: None)
    stored = {}
    monkeypatch.setattr(T, "_cache_set", lambda key, val: stored.__setitem__(key, val))

    out = asyncio.get_event_loop().run_until_complete(
        T.translate_field(system="openclaw", skill_id="x", version="1",
                          field="description", text="hello", target_lang="zh"))
    assert out == "译文:hello" and calls["n"] == 1
```

- [ ] **Step 3: 跑看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_skill_translation.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 4: 实现 translation.py**

```python
# SRV/chayuan/server/agent_connector/translation.py
from __future__ import annotations
import hashlib

_TRANSLATABLE = {"name", "description", "readme"}   # 权限/permissions 永不在内


def _key(system: str, skill_id: str, version: str, field: str, lang: str, text: str) -> str:
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    return f"{system}:{skill_id}:{version}:{field}:{lang}:{h}"


async def _llm_translate(text: str, target_lang: str) -> str:
    from chayuan.server.utils import get_OpenAIClient
    client = get_OpenAIClient(platform_name="local", is_async=True)
    resp = await client.chat.completions.create(
        model="local",
        messages=[
            {"role": "system", "content": f"Translate to {target_lang}. Output only the translation."},
            {"role": "user", "content": text},
        ],
        max_tokens=400,
    )
    return resp.choices[0].message.content or text


def _cache_get(key: str):
    from chayuan.server.db.session import get_session  # 按仓库实际 session 入口改
    from chayuan.server.db.models.skill_translation_model import SkillTranslationModel
    with get_session() as s:
        row = s.query(SkillTranslationModel).filter_by(cache_key=key).first()
        return row.translated_text if row else None


def _cache_set(key: str, val: str) -> None:
    from chayuan.server.db.session import get_session
    from chayuan.server.db.models.skill_translation_model import SkillTranslationModel
    with get_session() as s:
        s.add(SkillTranslationModel(cache_key=key, translated_text=val))
        s.commit()


async def translate_field(*, system: str, skill_id: str, version: str,
                          field: str, text: str, target_lang: str = "zh") -> str:
    if field not in _TRANSLATABLE:
        raise ValueError(f"field '{field}' must not be machine-translated")
    if not text.strip():
        return text
    key = _key(system, skill_id, version, field, target_lang, text)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    out = await _llm_translate(text, target_lang)
    _cache_set(key, out)
    return out
```

> `get_session` / Base 的精确入口以仓库实际为准（参 `db/models/` 现有模型的 import）。

- [ ] **Step 5: 跑看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_skill_translation.py -v`
Expected: PASS（2 passed）

- [ ] **Step 6: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/db/models/skill_translation_model.py libs/chayuan-server/chayuan/server/agent_connector/translation.py libs/chayuan-server/tests/unit_tests/test_skill_translation.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): skill translation service (LLM + SQLite cache, permissions never translated)"
```

---

## Task 6: 技能路由（list/search/install SSE/uninstall/translate）

**Files:**
- Modify: `SRV/chayuan/server/api_server/external_agent_routes.py`
- Test: `SRV/tests/unit_tests/test_external_agent_routes.py`（追加）

- [ ] **Step 1: 写失败测试**

```python
def test_skills_list(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/skills")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "Web Search"
    assert r.json()[0]["permissions"] == ["net"]


def test_skills_search(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/skills/search?q=todo")
    assert r.status_code == 200 and r.json()[0]["name"] == "Todo"
```

> 需 fake_openclaw 已支持 skills（v2 Task 3 已加）；`_client` 的 fake_resolve 复用 v1 测试夹具。

- [ ] **Step 2: 跑看失败**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py -k skills -v`
Expected: FAIL（404）

- [ ] **Step 3: 实现技能路由**

在 `external_agent_routes.py` 加：

```python
@external_agent_router.get("/{system_id}/skills")
def skills_list(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    return [asdict(s) for s in _resolve(system_id, user).list_skills()]


@external_agent_router.get("/{system_id}/skills/search")
def skills_search(system_id: str, q: str = "", user=Depends(require_auth_enabled())):
    _guard()
    return [asdict(s) for s in _resolve(system_id, user).search_skills(q)]


@external_agent_router.post("/{system_id}/skills/{skill_id}/install")
def skills_install(system_id: str, skill_id: str, user=Depends(require_auth_enabled())):
    _guard()
    conn = _resolve(system_id, user)

    def gen():
        import json
        for ev in conn.install_skill(skill_id):
            yield f"event: agent.install.{ev.level}\ndata: {json.dumps(asdict(ev))}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@external_agent_router.post("/{system_id}/skills/{skill_id}/uninstall")
def skills_uninstall(system_id: str, skill_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).uninstall_skill(skill_id)
    return {"ok": True}


@external_agent_router.get("/{system_id}/skills/{skill_id}/translate")
async def skills_translate(system_id: str, skill_id: str, field: str, version: str,
                           text: str, lang: str = "zh", user=Depends(require_auth_enabled())):
    _guard()
    from chayuan.server.agent_connector.translation import translate_field
    try:
        out = await translate_field(system=system_id, skill_id=skill_id, version=version,
                                    field=field, text=text, target_lang=lang)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"translated": out}
```

- [ ] **Step 4: 跑看通过**

Run: `cd SRV && PYTHONPATH=. pytest tests/unit_tests/test_external_agent_routes.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-server add libs/chayuan-server/chayuan/server/api_server/external_agent_routes.py libs/chayuan-server/tests/unit_tests/test_external_agent_routes.py
git -C /work/chayuan-desktop/chayuan-server commit -m "feat(agent): skills routes (list/search/install SSE/uninstall/translate)"
```

---

## Task 7: 前端技能 API 方法

**Files:**
- Modify: `CLI/packages/api/src/externalAgents.ts`
- Modify: `CLI/packages/api/src/externalAgents.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
  it('listSkills GETs', async () => {
    (request as any).mockResolvedValue({ data: [{ id: 'a', name: 'A', permissions: [] }] });
    const s = await externalAgents.listSkills('openclaw');
    expect(request).toHaveBeenCalledWith('/api/v1/external-agents/openclaw/skills', { raw: true });
    expect(s[0].name).toBe('A');
  });
```

- [ ] **Step 2: 跑看失败**

Run: `cd CLI && pnpm vitest run packages/api/src/externalAgents.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `externalAgents.ts` 加 `Skill` 接口与方法：

```typescript
export interface Skill {
  id: string; name: string; version: string; description: string;
  permissions: string[]; installed: boolean; publisher: string; verified: boolean; readme: string;
}

// 加入 externalAgents 对象：
  async listSkills(systemId: string): Promise<Skill[]> {
    const r = await request<Skill[]>(`/api/v1/external-agents/${systemId}/skills`, { raw: true });
    return r.data;
  },
  async searchSkills(systemId: string, q: string): Promise<Skill[]> {
    const r = await request<Skill[]>(`/api/v1/external-agents/${systemId}/skills/search`, { query: { q }, raw: true });
    return r.data;
  },
  async uninstallSkill(systemId: string, skillId: string): Promise<void> {
    await request(`/api/v1/external-agents/${systemId}/skills/${skillId}/uninstall`, { method: 'POST', raw: true });
  },
  async translate(systemId: string, p: { skillId: string; field: 'name' | 'description' | 'readme'; version: string; text: string; lang?: string }): Promise<string> {
    const r = await request<{ translated: string }>(`/api/v1/external-agents/${systemId}/skills/${p.skillId}/translate`,
      { query: { field: p.field, version: p.version, text: p.text, lang: p.lang ?? 'zh' }, raw: true });
    return r.data.translated;
  },
```

- [ ] **Step 4: 跑看通过 + typecheck**

Run: `cd CLI && pnpm vitest run packages/api/src/externalAgents.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/api/src/externalAgents.ts packages/api/src/externalAgents.test.ts
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): skills + translate api client"
```

---

## Task 8: BilingualText + SkillsTab UI

**Files:**
- Create: `CLI/packages/app/src/features/agent/BilingualText.tsx`
- Create: `CLI/packages/app/src/features/agent/SkillsTab.tsx`
- Test: typecheck（卡片 UI；纯逻辑已在后端覆盖）

- [ ] **Step 1: BilingualText.tsx**（仿 v2 调研方案 A）

```tsx
// CLI/packages/app/src/features/agent/BilingualText.tsx
import React from 'react';

export const BilingualText: React.FC<{ original: string; translated?: string }> = ({ original, translated }) => {
  const [showOrig, setShowOrig] = React.useState(false);
  if (!translated || translated === original) return <span>{original}</span>;
  return (
    <span className="cursor-pointer" title="点击切换原文/译文" onClick={() => setShowOrig((v) => !v)}>
      {showOrig ? original : translated}
      <sup className="ml-1 text-[10px] text-slate-400">机翻</sup>
    </span>
  );
};
```

- [ ] **Step 2: SkillsTab.tsx**（仿 `McpBoard.tsx:114-129` 卡片网格 + 已装/市场切换）

```tsx
// CLI/packages/app/src/features/agent/SkillsTab.tsx
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { externalAgents, type Skill } from '@chayuan/api';
import { BilingualText } from './BilingualText';

export const SkillsTab: React.FC<{ systemId: string }> = ({ systemId }) => {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<'installed' | 'market'>('installed');
  const [q, setQ] = React.useState('');

  const installed = useQuery({
    queryKey: ['agent', systemId, 'skills', 'installed'] as const,
    queryFn: () => externalAgents.listSkills(systemId),
    staleTime: 30_000, retry: 0, enabled: mode === 'installed',
  });
  const market = useQuery({
    queryKey: ['agent', systemId, 'skills', 'market', q] as const,
    queryFn: () => externalAgents.searchSkills(systemId, q),
    staleTime: 30_000, retry: 0, enabled: mode === 'market' && q.length > 0,
  });

  const uninstall = useMutation({
    mutationFn: (id: string) => externalAgents.uninstallSkill(systemId, id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['agent', systemId, 'skills'] }),
  });

  const list: Skill[] = mode === 'installed' ? installed.data ?? [] : market.data ?? [];

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <button className={`rounded px-3 py-1 ${mode === 'installed' ? 'bg-slate-200' : ''}`}
                onClick={() => setMode('installed')}>已安装</button>
        <button className={`rounded px-3 py-1 ${mode === 'market' ? 'bg-slate-200' : ''}`}
                onClick={() => setMode('market')}>技能市场</button>
        {mode === 'market' && (
          <input className="ml-2 flex-1 rounded border px-2 py-1" placeholder="搜索技能…"
                 value={q} onChange={(e) => setQ(e.target.value)} />
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((sk) => (
          <SkillCard key={sk.id} systemId={systemId} skill={sk}
                     onUninstall={() => uninstall.mutate(sk.id)} />
        ))}
        {list.length === 0 && <p className="text-slate-500">（无技能）</p>}
      </div>
    </div>
  );
};

const SkillCard: React.FC<{ systemId: string; skill: Skill; onUninstall: () => void }> = ({ systemId, skill, onUninstall }) => {
  const [descZh, setDescZh] = React.useState<string | undefined>();
  React.useEffect(() => {
    externalAgents.translate(systemId, { skillId: skill.id, field: 'description', version: skill.version, text: skill.description })
      .then(setDescZh).catch(() => undefined);
  }, [systemId, skill.id, skill.version, skill.description]);

  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{skill.name}{skill.verified && <span className="ml-1 text-blue-500">✓</span>}</span>
        <span className="text-xs text-slate-400">v{skill.version}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600"><BilingualText original={skill.description} translated={descZh} /></p>
      {skill.permissions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {/* 权限原文,不机翻 */}
          {skill.permissions.map((p) => (
            <span key={p} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{p}</span>
          ))}
        </div>
      )}
      <div className="mt-2">
        {skill.installed
          ? <button className="rounded border border-red-300 px-3 py-1 text-sm text-red-600" onClick={onUninstall}>卸载</button>
          : <InstallButton systemId={systemId} skillId={skill.id} />}
      </div>
    </div>
  );
};

const InstallButton: React.FC<{ systemId: string; skillId: string }> = ({ systemId, skillId }) => {
  const [installing, setInstalling] = React.useState(false);
  const go = () => {
    setInstalling(true);
    const unsub = externalAgents.subscribeInstall(`${systemId}/skills/${skillId}`, {
      onDone: () => { setInstalling(false); unsub(); },
      onError: () => setInstalling(false),
    });
  };
  return (
    <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={go} disabled={installing}>
      {installing ? '安装中…' : '安装'}
    </button>
  );
};
```

> `subscribeInstall` 的 URL 拼接需支持技能安装路径 `/{system}/skills/{id}/install`；
> 落地时把 `subscribeInstall` 的 `systemId` 入参泛化为「相对路径段」，或新增 `subscribeSkillInstall`。
> 实现时二选一并补一个 vitest 断言它命中正确 URL。

- [ ] **Step 3: typecheck**

Run: `cd CLI && pnpm typecheck`
Expected: 全绿（class/工具类按 Biome 规范微调）

- [ ] **Step 4: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/app/src/features/agent/BilingualText.tsx packages/app/src/features/agent/SkillsTab.tsx
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): SkillsTab card grid + BilingualText (permissions not translated)"
```

---

## Task 9: AgentHubPage 挂 SkillsTab + 系统切换器

**Files:**
- Modify: `CLI/packages/app/src/features/agent/AgentHubPage.tsx`

- [ ] **Step 1: 加系统切换器 + tabs**

把 `AgentHubPage` 顶部加 OpenClaw/Hermes 切换（`useState<'openclaw'|'hermes'>`），把硬编码的
`const SYSTEM = 'openclaw'` 改为 state；在「运行中/已安装」视图下加一个「技能」tab，渲染
`<SkillsTab systemId={system} />`。

```tsx
const [system, setSystem] = React.useState<'openclaw' | 'hermes'>('openclaw');
// header 内：
<div className="flex gap-2">
  {(['openclaw', 'hermes'] as const).map((s) => (
    <button key={s} className={`rounded px-3 py-1 ${system === s ? 'bg-slate-200' : ''}`}
            onClick={() => setSystem(s)}>{s}</button>
  ))}
</div>
// 已安装/运行视图底部：
<SkillsTab systemId={system} />
```

> 把 `QK` / `externalAgents.status(SYSTEM)` 等所有 `SYSTEM` 引用换成 `system` 变量。

- [ ] **Step 2: typecheck + 全量回归**

Run: `cd CLI && pnpm typecheck && pnpm vitest run` 然后 `cd SRV && PYTHONPATH=. pytest tests/unit_tests/ -k "agent or skill or hermes or openclaw" -v`
Expected: 全绿

- [ ] **Step 3: 真机 smoke**

> 装 Hermes（`curl .../install.sh | bash`）+ OpenClaw，开 `EXTERNAL_AGENTS_ENABLED=true`，
> 前端 `/agent-hub` 切两家、看已装技能、搜市场、装一个、看中文译文、确认权限是原文。

- [ ] **Step 4: Commit**

```bash
git -C /work/chayuan-desktop/chayuan-client add packages/app/src/features/agent/AgentHubPage.tsx
git -C /work/chayuan-desktop/chayuan-client commit -m "feat(agent): system switcher + SkillsTab in AgentHub"
```

---

## 完成定义（v2 退出标准）

- [ ] HermesAdapter 测试全绿，两家可在 UI 切换。
- [ ] 技能：list/search/install(SSE)/uninstall 后端测试全绿；前端能看已装、搜市场、装/卸。
- [ ] 翻译：名/描述出中文译文且命中缓存（第二次不再调 LLM）；**权限字段保持原文**（`field='permissions'` 调翻译被 400 拒）。
- [ ] 后端 `pytest -k "agent or skill or hermes or openclaw"` 全绿；前端 typecheck/lint/vitest 全绿。
- [ ] 真机 smoke 跑通两家技能装卸 + 翻译 + 权限原文。

## 依赖与不在 v2

- 前置：v1 全部任务。
- 不在 v2：chayuan MCP server + 模型共享 + 对接（v3）；服务器多租户（v4）；离线轨。详见设计 §9。
