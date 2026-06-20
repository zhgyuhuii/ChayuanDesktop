# 后台 React 迁移·工具配置域 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。Steps 用 `- [ ]`。

**Goal:** AdminPage 加「工具」tab,React 化工具配置(卡片网格+过滤+启停+设置弹窗+动态字段+添加/移除),复用现成 `/tools/catalog` `GET/PUT /tools/{key}/config`,后端只补 `DELETE /tools/{key}/config`。

**Architecture:** 后端补 `yaml_store.delete_key` + `config_service.delete_config` + DELETE 路由。前端 `endpoints.ts` 加 `tools.*`,`features/admin/tools/` 组件 react-query。添加工具复用 PUT(enabled=false+defaults)。

**Tech Stack:** Python/FastAPI/ruamel.yaml(后端)、React19/TS/react-query(前端)。

**环境**:仓库 root 所有→sudo 写/git,只 stage 改的,不 push/不 bump(最后统一);后端 pytest 跑不了→ast 自检+待真机(`/usr/bin/python3.11 -c "import ast;ast.parse(open(F).read())"`);前端 `node_modules/.bin/tsc -p packages/<api|app>/tsconfig.json --noEmit`。

---

## 文件结构
- **Modify** `chayuan/server/config_panel/yaml_store.py` — `delete_key(name, key)`。
- **Modify** `chayuan/server/tools/config_service.py` — `delete_config(key)`。
- **Modify** `chayuan/server/api_server/tool_routes.py` — `DELETE /{key}/config`。
- **Modify** `packages/api/src/endpoints.ts` — `tools.*` + 类型。
- **Create** `packages/app/src/features/admin/tools/{ToolsPage,ToolsToolbar,ToolCard,ToolSettingsDialog,ToolFieldInput,AddToolDialog}.tsx`。
- **Modify** `packages/app/src/features/admin/AdminPage.tsx` — 工具 tab。
- **Tests**: `tests/unit_tests/test_tools_delete.py`。

---

## Task 1: 后端 — delete_key + delete_config + DELETE 路由

**Files:** Modify `yaml_store.py`、`config_service.py`、`tool_routes.py` · Test `tests/unit_tests/test_tools_delete.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_tools_delete.py
from __future__ import annotations
import pytest


def test_delete_key_removes_node(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from chayuan.server.config_panel import yaml_store
    yaml_store.save_updates("tool_settings.yaml", {"foo.use": True, "bar.use": False})
    assert yaml_store.delete_key("tool_settings.yaml", "foo") is True
    res = yaml_store.load_yaml("tool_settings.yaml")
    assert "foo" not in (res.doc or {}) and "bar" in (res.doc or {})
    # 删不存在的 key 返回 False
    assert yaml_store.delete_key("tool_settings.yaml", "nope") is False


def test_delete_config_unknown_key_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from chayuan.server.tools.config_service import delete_config
    with pytest.raises(KeyError):
        delete_config("___not_in_catalog___")
```

- [ ] **Step 2: 语法自检失败** Run: `/usr/bin/python3.11 -c "import ast; ast.parse(open('tests/unit_tests/test_tools_delete.py').read())"`

- [ ] **Step 3: 写实现**

`yaml_store.py` 末尾追加（仿 `save_updates` 的备份+原子写+mirror）：
```python
def delete_key(name: str, key: str) -> bool:
    """从 yaml 顶层删除整个 ``<key>`` 节点。删除成功返回 True,key 不存在返回 False。"""
    result = load_yaml(name)
    doc = result.doc if result.exists else {}
    if not isinstance(doc, dict) or key not in doc:
        return False
    del doc[key]
    _backup(result.path)
    y = import_yaml()
    _atomic_write(result.path, lambda f: y.dump(doc, f))
    _mirror_to_config_center(name, doc, [key])
    return True
```

`config_service.py` 追加（用 `_TOOL_SETTINGS_YAML` + `load_catalog`,仿 `update_config` 的 key 校验）：
```python
def delete_config(key: str) -> str:
    """移除工具(从 tool_settings.yaml 删整个 <key>)。key 不在 catalog 抛 KeyError。"""
    specs, _ = load_catalog()
    if not any(s.key == key for s in specs):
        raise KeyError(f"工具 key 不存在: {key!r}")
    yaml_store.delete_key(_TOOL_SETTINGS_YAML, key)
    return key
```
> 实现前 `grep -n "load_catalog\|_TOOL_SETTINGS_YAML\|^from\|^import" config_service.py` 核对 `load_catalog` 导入与 `_TOOL_SETTINGS_YAML` 常量名;不一致按真实改。

`tool_routes.py` 在 PUT `/{key}/config`(164 行)之后追加：
```python
@tool_router.delete("/{key}/config", response_model=BaseResponse)
async def delete_tool_config_doc(key: str = PathParam(..., min_length=1)):
    from chayuan.server.tools.config_service import delete_config
    try:
        delete_config(key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"工具不存在: {key}")
    return BaseResponse(data={"deleted": key})
```
> 核对 `BaseResponse` 用法与同文件其它端点一致(返回 data 包装)。

- [ ] **Step 4: 语法自检 + 真测待机器** Run: `/usr/bin/python3.11 -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan/server/config_panel/yaml_store.py','chayuan/server/tools/config_service.py','chayuan/server/api_server/tool_routes.py','tests/unit_tests/test_tools_delete.py']]; print('OK')"`

- [ ] **Step 5: 提交** `feat(tools): DELETE /tools/{key}/config 移除工具(yaml delete_key+delete_config)`

---

## Task 2: 前端 API tools.*

**Files:** Modify `packages/api/src/endpoints.ts`

- [ ] **Step 1: 加类型 + tools 对象**(复用 `request` raw 模式,仿 mcp)
```typescript
export interface ToolField {
  path: string;
  label: string;
  widget: 'switch' | 'number' | 'select' | 'model_select' | 'password' | 'textarea' | 'text' | string;
  min?: number; max?: number; step?: number;
  default?: unknown;
  help?: string;
  options?: Array<{ label: string; value: string } | string>;
  model_type?: string;
}
export interface ToolCard {
  key: string; title: string; icon?: string; category?: string;
  summary?: string; description?: string; tags?: string[]; docs_url?: string;
  fields: ToolField[]; values: Record<string, unknown>;
  enabled: boolean; description_override?: string | null;
}
export interface ToolUpdateBody {
  enabled?: boolean; description_override?: string | null; values?: Record<string, unknown>;
}
export const tools = {
  async catalog(): Promise<{ cards: ToolCard[]; categories: Record<string, string> }> {
    const r = await request<{ cards: ToolCard[]; categories: Record<string, string> }>('/api/v1/tools/catalog', { raw: true });
    return r.data;
  },
  async getConfig(key: string): Promise<ToolCard> {
    const r = await request<ToolCard>(`/api/v1/tools/${encodeURIComponent(key)}/config`, { raw: true });
    return r.data;
  },
  async updateConfig(key: string, body: ToolUpdateBody): Promise<ToolCard> {
    const r = await request<ToolCard>(`/api/v1/tools/${encodeURIComponent(key)}/config`, { method: 'PUT', body, raw: true });
    return r.data;
  },
  async deleteConfig(key: string): Promise<void> {
    await request(`/api/v1/tools/${encodeURIComponent(key)}/config`, { method: 'DELETE', raw: true });
  },
};
```
> 实现前核对 `/tools/catalog` 真实返回的 cards 字段名(去 config_service.ToolCardDoc 看 enabled/description_override/fields/values),与上面类型对齐。

- [ ] **Step 2: typecheck api** exit 0
- [ ] **Step 3: 提交** `feat(api): tools.* 客户端(catalog/get/update/delete)`

---

## Task 3: ToolFieldInput + ToolCard

**Files:** Create `.../tools/ToolFieldInput.tsx`、`.../tools/ToolCard.tsx`

- [ ] **Step 1: ToolFieldInput**(受控,按 widget 渲染;model_select 退化为 text input + 提示,文档标注)。switch/number(min/max/step)/select(options)/password/textarea/text;value+onChange。
- [ ] **Step 2: ToolCard**(图标+标题+分类、enabled switch / 未加入 badge、描述截断、tags chip + docs_url、设置按钮;toggle 调 `tools.updateConfig(key,{enabled})`)。
- [ ] **Step 3: typecheck app** exit 0
- [ ] **Step 4: 提交** `feat(admin/tools): ToolFieldInput 动态字段 + ToolCard`

---

## Task 4: ToolSettingsDialog + AddToolDialog

**Files:** Create `.../tools/ToolSettingsDialog.tsx`、`.../tools/AddToolDialog.tsx`

- [ ] **Step 1: ToolSettingsDialog**(启用开关 + 可编辑描述+恢复默认 + 字段区(map ToolFieldInput) + 移除(`deleteConfig`)/取消/保存(`updateConfig` 带 enabled/description_override/values))。
- [ ] **Step 2: AddToolDialog**(catalog 中"未加入"工具(enabled=false 且 values 空 的未配置项,或后端 catalog 已标 enabled)+ 搜索/分类过滤 + 多选 + 确认:对每 key `updateConfig(key,{enabled:false,values:<field defaults>})`)。
- [ ] **Step 3: typecheck app** exit 0
- [ ] **Step 4: 提交** `feat(admin/tools): 设置弹窗 + 添加工具弹窗`

---

## Task 5: ToolsToolbar + ToolsPage

**Files:** Create `.../tools/ToolsToolbar.tsx`、`.../tools/ToolsPage.tsx`

- [ ] **Step 1: ToolsToolbar**(搜索 + 分类下拉 + 状态下拉(全部/已启用/未启用) + 添加按钮 + 刷新)。
- [ ] **Step 2: ToolsPage**(react-query 拉 `tools.catalog()`,前端过滤,卡片网格,编排 Toolbar + Add/Settings 弹窗状态)。
- [ ] **Step 3: typecheck app** exit 0
- [ ] **Step 4: 提交** `feat(admin/tools): 工具栏 + ToolsPage 编排`

---

## Task 6: AdminPage 工具 tab

**Files:** Modify `packages/app/src/features/admin/AdminPage.tsx`

- [ ] **Step 1: 4 处接线**(仿 MCP tab):lucide 加 `Wrench`、`AdminTab` 加 `'tools'`、import ToolsPage、TabButton + `{tab === 'tools' && <ToolsPage />}`。
- [ ] **Step 2: typecheck app + web** exit 0
- [ ] **Step 3: 提交** `feat(admin): AdminPage 加工具 tab`

---

## 自检
1. Spec 覆盖:§2 DELETE→T1;§3 tools.* API→T2;§4 FieldInput/Card→T3、SettingsDialog/AddDialog→T4、Toolbar/Page→T5、tab→T6。
2. 占位符:T1 实现给真实代码 + grep 核对锚点;model_select 退化为 text 已在 §4 spec/T3 文档标注(非占位,是显式降级)。
3. 类型一致:ToolCard/ToolField/ToolUpdateBody/tools.* 跨 Task 一致;后端 ToolCardDoc 字段名实现时核对。

## 执行约束
sudo 写/git、只 stage 改的、不 push/不 bump(最后统一);后端 ast+待真机,前端 typecheck exit 0;parity 后(用户验证)删 NiceGUI tools_page。
