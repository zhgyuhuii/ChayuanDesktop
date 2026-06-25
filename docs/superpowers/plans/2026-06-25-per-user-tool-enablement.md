# 按用户的工具开关 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让网络版每个用户自助开关工具,只有自己开启的工具出现在自己对话框里并能用;单机版保持现状。

**Architecture:** 「关闭集覆盖」(opt-out):有效工具 = 全局启用(`tool_settings.yaml` `use:true`) − 该用户关闭集。新增表 `user_tool_pref` 只存被关闭的 (user_id, tool_name);新 `/tools/my` 端点读写个人开关;`chat_routes` 对 `req.tools` 与有效集求交集做服务端强制;前端对话框工具列表数据源切到 `/tools/my`,工具页加个人开关。

**Tech Stack:** Python/FastAPI/SQLAlchemy(`session_scope`)、React/TanStack Query v5、pnpm。设计见 `docs/superpowers/specs/2026-06-25-per-user-tool-enablement-design.md`。

**沙箱测试现实**(见记忆 reference_py312_test_env):本机只有 `/usr/bin/python3.11`(带 pytest,**无 sqlalchemy/pydantic/langchain**);纯逻辑可跑,触达 DB 的测试加 `pytest.importorskip("sqlalchemy")` 让其在沙箱 skip、真机才跑;路由/含重依赖的文件只 `py_compile` 自检 + 真机验。前端 `node_modules/.bin/tsc -p packages/<pkg>/tsconfig.json --noEmit` 与 `node node_modules/vitest/vitest.mjs run <file>` 可跑。提交版本号一律 `sudo /usr/bin/python3.11 scripts/bump-version.py`(改了程序代码才 bump)。仓库 root 所有:编辑前 `sudo chown admin <file>`,`git add`/`commit` 走 sudo,只 stage 改动文件。

**路径前缀**:后端 = `chayuan-server/libs/chayuan-server/chayuan/server/`;后端测试 = `chayuan-server/libs/chayuan-server/tests/unit_tests/`;前端 = `chayuan-client/`。

---

### Task 1: 纯函数 `effective_enabled_names`(可在沙箱跑)

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/tools/user_tools.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_user_tools.py`

- [ ] **Step 1: 写失败测试**

`tests/unit_tests/test_user_tools.py`:
```python
from chayuan.server.tools.user_tools import effective_enabled_names


def test_effective_is_global_minus_disabled():
    g = {"search_internet", "url_reader", "calculate"}
    assert effective_enabled_names(g, {"url_reader"}) == {"search_internet", "calculate"}


def test_effective_empty_disabled_returns_all():
    g = {"a", "b"}
    assert effective_enabled_names(g, set()) == {"a", "b"}


def test_effective_disabled_not_in_global_is_ignored():
    assert effective_enabled_names({"a"}, {"zzz"}) == {"a"}


def test_effective_none_disabled_safe():
    assert effective_enabled_names({"a"}, None) == {"a"}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd chayuan-server/libs/chayuan-server && sudo PYTHONPATH="$PWD" /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_user_tools.py`
Expected: FAIL(ModuleNotFoundError: user_tools)

- [ ] **Step 3: 写最小实现**

`chayuan/server/tools/user_tools.py`:
```python
"""按用户的工具有效集计算(opt-out:有效 = 全局启用 − 用户关闭)。

纯函数 effective_enabled_names 不依赖 DB/全局配置,可单测;global_enabled_tool_names /
effective_enabled_tools 在运行时把全局配置 + 用户关闭集接起来(懒导入,避免循环依赖)。
"""
from __future__ import annotations

from typing import Optional, Set


def effective_enabled_names(global_enabled: Set[str], disabled: Optional[Set[str]]) -> Set[str]:
    """有效启用工具名 = 全局启用 − 用户关闭(关闭集里不在全局的项天然被忽略)。"""
    return set(global_enabled or set()) - set(disabled or set())


def global_enabled_tool_names() -> Set[str]:
    """全局启用(tool_settings.yaml use:true)的运行时工具名集合;与 list_tools(enabled) 同源。"""
    from chayuan.server.utils import get_tool, get_tool_config
    from chayuan.server.api_server.tool_routes import _effective_config_key  # 懒导入避免环

    out: Set[str] = set()
    for t in (get_tool() or {}).values():
        cfg = get_tool_config(_effective_config_key(t.name)) or {}
        if bool(cfg.get("use", False)):
            out.add(t.name)
    return out


def effective_enabled_tools(user_id: Optional[int]) -> Set[str]:
    """该用户在对话里实际可用的工具名。user_id None(guest/单机)→ 全部全局启用(不过滤)。"""
    g = global_enabled_tool_names()
    if user_id is None:
        return g
    try:
        from chayuan.server.db.repository import user_tool_pref_repository as repo
        disabled = repo.list_disabled(int(user_id))
    except Exception:  # noqa: BLE001 — 无 DB / 异常一律不过滤,不挡对话
        disabled = set()
    return effective_enabled_names(g, disabled)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd chayuan-server/libs/chayuan-server && sudo PYTHONPATH="$PWD" /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_user_tools.py`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-server/libs/chayuan-server/chayuan/server/tools/user_tools.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_user_tools.py
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/tools/user_tools.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_user_tools.py
sudo git commit -m "feat(tools): 按用户工具有效集纯函数 effective_enabled_names + 接线骨架"
```

---

### Task 2: ORM 模型 `user_tool_pref` + 注册

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/db/models/user_tool_pref_model.py`
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py`(加一行 import)

- [ ] **Step 1: 写模型**

`db/models/user_tool_pref_model.py`:
```python
"""按用户的工具关闭记录(opt-out)。

一行 = 该用户**关闭**了该工具;不在表 = 启用。有效工具 = 全局启用 − 本表(见 tools.user_tools)。
新表:create_all 会自动建(不踩"create_all 不 ALTER 已存在表"的坑);单机/网络都生效。
"""
from sqlalchemy import Column, DateTime, Integer, String, func

from chayuan.server.db.base import Base


class UserToolPrefModel(Base):
    __tablename__ = "user_tool_pref"

    user_id = Column(Integer, primary_key=True, nullable=False, comment="users.id;关闭该工具的用户")
    tool_name = Column(String(128), primary_key=True, nullable=False, comment="被关闭的运行时工具名")
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<UserToolPref(user_id={self.user_id}, tool={self.tool_name})>"
```

- [ ] **Step 2: 注册到 models 包**

在 `db/models/__init__.py` 的 import 区(`user_model` 那一行附近,保持字母序)加:
```python
from chayuan.server.db.models import user_tool_pref_model  # noqa: F401
```

- [ ] **Step 3: 语法自检**

Run: `cd chayuan-server/libs/chayuan-server && sudo /usr/bin/python3.11 -m py_compile chayuan/server/db/models/user_tool_pref_model.py chayuan/server/db/models/__init__.py && echo OK`
Expected: `OK`(注:`__init__.py` 仅 import 不执行 sqlalchemy,py_compile 通过即可;真机 create_all 建表)

- [ ] **Step 4: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-server/libs/chayuan-server/chayuan/server/db/models/user_tool_pref_model.py chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/db/models/user_tool_pref_model.py chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py
sudo git commit -m "feat(db): user_tool_pref 表(按用户工具关闭记录)+ 注册 create_all"
```

---

### Task 3: 仓库 `user_tool_pref_repository`

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/db/repository/user_tool_pref_repository.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_user_tool_pref_repo.py`

- [ ] **Step 1: 写失败测试(沙箱无 sqlalchemy → importorskip 跳过,真机跑)**

`tests/unit_tests/test_user_tool_pref_repo.py`:
```python
import pytest

pytest.importorskip("sqlalchemy")  # 需 DB 栈;沙箱缺依赖则 skip,真机才跑

from chayuan.server.db.repository import user_tool_pref_repository as repo


def test_set_and_list_disabled_roundtrip():
    uid = 999001
    # 清干净
    repo.set_tool_disabled(uid, "url_reader", disabled=False)
    assert "url_reader" not in repo.list_disabled(uid)
    # 关闭 → 出现在集合
    repo.set_tool_disabled(uid, "url_reader", disabled=True)
    assert "url_reader" in repo.list_disabled(uid)
    # 幂等再关一次仍只一条
    repo.set_tool_disabled(uid, "url_reader", disabled=True)
    assert "url_reader" in repo.list_disabled(uid)
    # 重新启用 → 移除
    repo.set_tool_disabled(uid, "url_reader", disabled=False)
    assert "url_reader" not in repo.list_disabled(uid)


def test_list_disabled_none_user_is_empty():
    assert repo.list_disabled(None) == set()
```

- [ ] **Step 2: 跑测试**

Run: `cd chayuan-server/libs/chayuan-server && sudo PYTHONPATH="$PWD" /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_user_tool_pref_repo.py`
Expected: 沙箱 = `2 skipped`(无 sqlalchemy);真机 = 2 passed。先确认至少不 error。

- [ ] **Step 3: 写实现**

`db/repository/user_tool_pref_repository.py`:
```python
"""按用户的工具关闭记录仓库。一行 = 用户关闭了某工具(opt-out)。"""
from __future__ import annotations

import logging
from typing import Optional, Set

from chayuan.server.db.models.user_tool_pref_model import UserToolPrefModel
from chayuan.server.db.session import session_scope

logger = logging.getLogger("chayuan.user_tool_pref_repo")


def list_disabled(user_id: Optional[int]) -> Set[str]:
    """该用户关闭的工具名集合;user_id 为空 → 空集。"""
    if user_id is None:
        return set()
    try:
        with session_scope() as s:
            rows = (
                s.query(UserToolPrefModel.tool_name)
                .filter(UserToolPrefModel.user_id == int(user_id))
                .all()
            )
            return {r[0] for r in rows}
    except Exception as e:  # noqa: BLE001 — 查询失败按"无关闭"处理,不挡功能
        logger.warning("[user_tool_pref] list_disabled 失败: %r", e)
        return set()


def set_tool_disabled(user_id: Optional[int], tool_name: str, disabled: bool) -> None:
    """disabled=True 插入(幂等);False 删除。user_id/tool_name 为空直接返回。"""
    if user_id is None or not tool_name:
        return
    with session_scope() as s:
        q = s.query(UserToolPrefModel).filter(
            UserToolPrefModel.user_id == int(user_id),
            UserToolPrefModel.tool_name == tool_name,
        )
        row = q.first()
        if disabled and row is None:
            s.add(UserToolPrefModel(user_id=int(user_id), tool_name=tool_name))
        elif not disabled and row is not None:
            q.delete()
```

- [ ] **Step 4: 跑测试 + 语法自检**

Run: `cd chayuan-server/libs/chayuan-server && sudo /usr/bin/python3.11 -m py_compile chayuan/server/db/repository/user_tool_pref_repository.py && sudo PYTHONPATH="$PWD" /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_user_tool_pref_repo.py`
Expected: py_compile OK;测试沙箱 2 skipped(真机 2 passed)

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-server/libs/chayuan-server/chayuan/server/db/repository/user_tool_pref_repository.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_user_tool_pref_repo.py
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/db/repository/user_tool_pref_repository.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_user_tool_pref_repo.py
sudo git commit -m "feat(db): user_tool_pref 仓库(list_disabled/set_tool_disabled,幂等)"
```

---

### Task 4: 后端端点 `GET /tools/my` + `PUT /tools/my/{name}`

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/tool_routes.py`(在 `list_tools` 之后插入两个路由)

- [ ] **Step 1: 加路由**

在 `tool_routes.py` 中 `list_tools` 函数之后插入(保持文件现有 import 风格;`get_tool`/`get_tool_config`/`_effective_config_key`/`BaseResponse`/`tool_router`/`BaseModel`/`PathParam`/`Body`/`Request`/`HTTPException` 均已在文件顶部导入):
```python
@tool_router.get("/my", response_model=BaseResponse)
async def list_my_tools(request: Request):
    """当前用户视角的工具清单:全局启用工具逐个标 enabled(= 该用户未关闭)。

    供对话框工具选择器(只展示 enabled)与工具页个人开关使用。
    guest/未鉴权(单机)→ 关闭集为空 → 全部 enabled,保持现状。
    """
    from chayuan.server.auth.deps import get_current_user_optional, owner_id_of
    from chayuan.server.db.repository import user_tool_pref_repository as repo

    uid = owner_id_of(get_current_user_optional(request))
    disabled = repo.list_disabled(uid) if uid is not None else set()
    items = []
    for t in get_tool().values():
        cfg = get_tool_config(_effective_config_key(t.name)) or {}
        if not bool(cfg.get("use", False)):
            continue
        items.append({
            "name": t.name,
            "title": getattr(t, "title", t.name),
            "description": t.description,
            "enabled": t.name not in disabled,
        })
    return {"data": items}


class _MyToolUpdate(BaseModel):
    enabled: bool


@tool_router.put("/my/{name}", response_model=BaseResponse)
async def set_my_tool(
    request: Request,
    name: str = PathParam(..., min_length=1),
    payload: _MyToolUpdate = Body(...),
):
    """开/关当前用户的某个工具(只影响自己)。enabled=false → 关闭集加一行;true → 删一行。

    仅允许操作"全局启用"的工具。guest/单机 uid 为空 → 不持久化、返回 enabled=true(全开)。
    """
    from chayuan.server.auth.deps import get_current_user_optional, owner_id_of
    from chayuan.server.db.repository import user_tool_pref_repository as repo
    from chayuan.server.tools.user_tools import global_enabled_tool_names

    uid = owner_id_of(get_current_user_optional(request))
    if uid is None:
        return {"data": {"name": name, "enabled": True, "persisted": False}}
    if name not in global_enabled_tool_names():
        raise HTTPException(status_code=404, detail=f"工具 {name!r} 未全局启用,无法设置")
    repo.set_tool_disabled(uid, name, disabled=not payload.enabled)
    return {"data": {"name": name, "enabled": bool(payload.enabled), "persisted": True}}
```

- [ ] **Step 2: 语法自检**

Run: `cd chayuan-server/libs/chayuan-server && sudo /usr/bin/python3.11 -m py_compile chayuan/server/api_server/tool_routes.py && echo OK`
Expected: `OK`(路由真机验:`GET /tools/my` 返回带 enabled 的列表;`PUT /tools/my/url_reader {"enabled":false}` 后再 GET 该项 enabled=false)

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-server/libs/chayuan-server/chayuan/server/api_server/tool_routes.py
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/api_server/tool_routes.py
sudo git commit -m "feat(tools): /tools/my(个人工具清单)+ PUT /tools/my/{name}(个人开关)"
```

---

### Task 5: 对话服务端强制过滤(`chat_routes`)

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/chat_routes.py`(`chatgraph_endpoint` 构造 `ChatRequest` 前过滤 `tools`)

- [ ] **Step 1: 加过滤(在已算出 `uid` 之后、`req = ChatRequest(...)` 之前)**

`chatgraph_endpoint` 里 `uid` 已由 `uid = (user or {}).get("id") ...` 得到。在构造 `ChatRequest` 之前插入:
```python
    # 按用户的工具启用集服务端强制:丢弃该用户未启用的工具(防前端绕过)。
    # uid 为空(guest/单机)→ effective_enabled_tools 返回全部全局启用,不过滤,保持现状。
    _req_tools = list(tools or [])
    if uid is not None and _req_tools:
        try:
            from chayuan.server.tools.user_tools import effective_enabled_tools
            _allowed = effective_enabled_tools(int(uid))
            _req_tools = [t for t in _req_tools if t in _allowed]
        except Exception:  # noqa: BLE001 — 过滤失败不挡对话(退回不过滤)
            _req_tools = list(tools or [])
```
然后把 `ChatRequest(...)` 里的 `tools=list(tools or [])` 改为 `tools=_req_tools`。

- [ ] **Step 2: 语法自检**

Run: `cd chayuan-server/libs/chayuan-server && sudo /usr/bin/python3.11 -m py_compile chayuan/server/api_server/chat_routes.py && echo OK`
Expected: `OK`(真机验:用户关掉 url_reader 后,即使前端 `req.tools` 传 ["url_reader"],该轮也不会执行它)

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-server/libs/chayuan-server/chayuan/server/api_server/chat_routes.py
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/api_server/chat_routes.py
sudo git commit -m "feat(chat): v2/chat 按用户工具有效集强制过滤 req.tools(防绕过)"
```

---

### Task 6: 前端 API `tools.listMine` / `tools.setMine`

**Files:**
- Modify: `chayuan-client/packages/api/src/endpoints.ts`(`ToolInfo` 附近加 `MyToolInfo`;`tools` 对象加两个方法)

- [ ] **Step 1: 加类型 + 方法**

在 `endpoints.ts` 的 `ToolInfo` 接口之后加:
```typescript
/** ``GET /tools/my`` 单项:全局启用工具 + 当前用户是否启用 */
export interface MyToolInfo {
  name: string;
  title: string;
  description: string;
  enabled: boolean;
}
```
在 `export const tools = { ... }` 内(`listEnabled` 旁)加:
```typescript
  async listMine(): Promise<MyToolInfo[]> {
    // 后端 data 直接是数组
    return (await http.get<MyToolInfo[]>('/tools/my')) ?? [];
  },
  setMine: (name: string, enabled: boolean) =>
    http.put<{ name: string; enabled: boolean; persisted: boolean }>(
      `/tools/my/${encodeURIComponent(name)}`,
      { enabled },
    ),
```

- [ ] **Step 2: 类型检查**

Run: `cd chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit && echo OK`
Expected: `OK`

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-client/packages/api/src/endpoints.ts
sudo git add -- chayuan-client/packages/api/src/endpoints.ts
sudo git commit -m "feat(api): tools.listMine/setMine(按用户工具开关)"
```

---

### Task 7: 对话框工具选择器只列"我启用的"

**Files:**
- Modify: `chayuan-client/packages/app/src/features/catalog/useCatalog.ts`(`useTools` 数据源切到 `tools.listMine`,只取 enabled)

- [ ] **Step 1: 改 `useTools`**

把 `useCatalog.ts` 里 `useTools` 的 `queryFn` 改为:
```typescript
export function useTools(): UseQueryResult<ToolCardItem[]> {
  return useQuery({
    queryKey: CATALOG_KEYS.tools,
    // 只展示"当前用户启用"的工具(/tools/my 的 enabled 项);guest/单机后端返回全部 enabled
    queryFn: async () =>
      (await tools.listMine())
        .filter((t) => t.enabled)
        .map((t) => mapTool({ name: t.name, title: t.title, description: t.description } as ToolInfo)),
    staleTime: 60_000,
    retry: 0,
  });
}
```
(`mapTool` 已接受 `{name,title,description}`;`ToolInfo` 多出的 `args/config` 在 picker 不用,用 `as ToolInfo` 收窄即可。)

- [ ] **Step 2: 类型检查**

Run: `cd chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit && echo OK`
Expected: `OK`

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-client/packages/app/src/features/catalog/useCatalog.ts
sudo git add -- chayuan-client/packages/app/src/features/catalog/useCatalog.ts
sudo git commit -m "feat(composer): 工具选择器只列当前用户启用的工具(/tools/my)"
```

---

### Task 8: 工具页个人开关 + hooks

**Files:**
- Modify: `chayuan-client/packages/app/src/features/tools/hooks.ts`(加 `useMyTools` / `useSetMyTool`)
- Modify: `chayuan-client/packages/app/src/features/tools/ToolsBoard.tsx`(每张工具卡加"我的开关";先 Read 该文件按其卡片布局放置)

- [ ] **Step 1: 加 hooks**

在 `features/tools/hooks.ts` 末尾加(沿用文件里 `useQuery`/`useMutation`/`useQueryClient` 与 `tools` 客户端导入;若未导入 `tools` 则从 `@chayuan/api` 补):
```typescript
import { tools, type MyToolInfo } from '@chayuan/api';

export const QK_TOOLS_MY = ['tools', 'my'] as const;

export function useMyTools() {
  return useQuery<MyToolInfo[]>({
    queryKey: QK_TOOLS_MY,
    queryFn: () => tools.listMine(),
    staleTime: 60_000,
  });
}

export function useSetMyTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => tools.setMine(name, enabled),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK_TOOLS_MY });
      void qc.invalidateQueries({ queryKey: ['catalog', 'tools'] }); // 对话框工具列表同步刷新
    },
  });
}
```
(若 `hooks.ts` 顶部已 import `tools`,合并而非重复 import。)

- [ ] **Step 2: 工具页加开关**

先 `Read packages/app/src/features/tools/ToolsBoard.tsx` 了解工具卡渲染结构。在每张工具卡上加一个 Switch(复用 `@chayuan/ui` 的 Switch),取值 `useMyTools()` 里该工具的 `enabled`,onChange 调 `useSetMyTool().mutate({name, enabled})`,做乐观更新或依赖 invalidate 刷新。开关标题用「在我的对话中启用」。管理员的全局配置区不动(按现有 `useIsAdmin` 视图)。

- [ ] **Step 3: 类型检查**

Run: `cd chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit && echo OK`
Expected: `OK`

- [ ] **Step 4: 提交**

```bash
cd /work/chayuan-desktop
sudo chown admin chayuan-client/packages/app/src/features/tools/hooks.ts chayuan-client/packages/app/src/features/tools/ToolsBoard.tsx
sudo git add -- chayuan-client/packages/app/src/features/tools/hooks.ts chayuan-client/packages/app/src/features/tools/ToolsBoard.tsx
sudo git commit -m "feat(tools-page): 工具卡加个人开关(useMyTools/useSetMyTool)"
```

---

### Task 9: 收尾 — bump 版本 + 全量类型检查 + 真机验证清单

**Files:** 版本文件(由脚本改)

- [ ] **Step 1: 前端全量类型检查**

Run: `cd chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit && echo OK`
Expected: `OK`

- [ ] **Step 2: 后端纯逻辑测试 + 全量 py_compile**

Run:
```bash
cd chayuan-server/libs/chayuan-server
sudo PYTHONPATH="$PWD" /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_user_tools.py
sudo /usr/bin/python3.11 -m py_compile chayuan/server/tools/user_tools.py chayuan/server/db/models/user_tool_pref_model.py chayuan/server/db/repository/user_tool_pref_repository.py chayuan/server/api_server/tool_routes.py chayuan/server/api_server/chat_routes.py && echo OK
```
Expected: 4 passed + `OK`

- [ ] **Step 3: bump 版本**

Run: `cd /work/chayuan-desktop && sudo /usr/bin/python3.11 scripts/bump-version.py`
Expected: `init=OK`,版本 +1

- [ ] **Step 4: 提交版本 + 推送**

```bash
cd /work/chayuan-desktop
sudo git add -- VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/chayuan/__init__.py chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "chore: bump 版本(按用户工具开关功能)"
sudo git push origin main
```

- [ ] **Step 5: 真机验证清单(重建 server + apps/web 后)**

1. 管理员在「工具」页确认某工具全局启用(use:true),且配好 key。
2. 用户 A 进「工具」页,关掉「URL内容阅读」→ A 的对话框工具选择里**没有**它;用户 B 不动 → B 的对话框里**有**它。
3. A 用前端篡改 `req.tools` 强行传被关工具 → 后端 `chat_routes` 过滤掉,不执行(看日志/无该工具调用)。
4. 单机版:工具选择里照常显示所有全局启用工具(guest 不过滤)。
5. 重启后 A 的关闭项仍在(DB 持久化、跨设备)。

---

## Self-Review

- **Spec 覆盖**:① 数据模型→T2;仓库→T3;② `/tools/my`+PUT→T4;③ chat 交集强制→T5;④ 前端 api→T6 / 对话框→T7 / 工具页→T8;⑤ 边界(guest 不过滤、全局优先、opt-out)分散在 T1(纯函数)/T4/T5 的 uid 判空 + global_enabled 过滤;测试→T1(纯)/T3(repo importorskip)/真机清单(T9)。无遗漏。
- **占位符**:无 TBD;唯一"先 Read 再放置"的是 T8 ToolsBoard 卡片插入点(UI 布局依赖现有结构,给了完整 hook 代码 + 明确放置指令,非逻辑占位)。
- **类型一致**:`MyToolInfo{name,title,description,enabled}` 后端 T4 返回与前端 T6 类型一致;`effective_enabled_tools`/`global_enabled_tool_names`/`effective_enabled_names`/`list_disabled`/`set_tool_disabled` 在 T1/T3/T4/T5 签名一致;`UserToolPrefModel(user_id, tool_name)` 复合主键 T2 定义、T3 使用一致。
