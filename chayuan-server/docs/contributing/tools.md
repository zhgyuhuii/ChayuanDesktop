# Agent 工具集成指南

本文档面向「想给察元添加新工具」的开发者。覆盖：数据结构、目录约定、
三步添加法、伞型工具模式、依赖处理策略、体检命令、配置面板交互方式。

---

## 1. 工具系统全景

察元的 Agent 工具链由四层组成：

```
┌────────────────────────────────────────────────────┐
│ 对话界面（Streamlit :8501）                           │
│   ├── 选择工具下拉                                    │
│   │     ↓ GET /tools?enabled=true                   │
└────┬───────────────────────────────────────────────┘
     │
┌────▼───────────────────────────────────────────────┐
│ API Server（FastAPI :62581）                          │
│   ├── /tools?enabled=true → 按 use=true 过滤         │
│   ├── /tools/call  → get_tool(name).ainvoke(...)    │
└────┬───────────────────────────────────────────────┘
     │
┌────▼───────────────────────────────────────────────┐
│ 配置面板（NiceGUI :8502）                             │
│   ├── 工具配置页（⑦）                                 │
│   │   └── render_tool_settings_page                 │
│   │       ↑ 数据源 = tools_catalog.json             │
│   │         + tool_settings.yaml                    │
└────┬───────────────────────────────────────────────┘
     │
┌────▼───────────────────────────────────────────────┐
│ 工具运行时（chayuan/server/agent/tools_factory/*.py）  │
│   └── @regist_tool 注册进 _TOOLS_REGISTRY            │
└────────────────────────────────────────────────────┘
```

- `**chayuan/data/tools_catalog.json**` —— 工具的**门面数据**：名字 / 图标 /
分类 / 描述 / 参数字段 / 默认值 / 必填 / 依赖；配置面板完全按它渲染卡片。
- `**chayuan_data/tool_settings.yaml`** —— 每个工具的**运行时配置**：
`use: true/false` + 密钥 / 参数；同时也是描述覆盖（`_desc`）的存储位置。
- `**chayuan/server/agent/tools_factory/<tool>.py`** —— 工具的**真执行逻辑**。
- `**_TOOLS_REGISTRY`** —— 由 `@regist_tool` 装饰器在 import 时自动填充的字典，
`{name: BaseTool}`。

---

## 2. 三步添加一个新工具

以「再加一个叫 `foo_bar` 的工具」为例：

### 步骤 1 —— 写运行时

在 `libs/chayuan-server/chayuan/server/agent/tools_factory/foo_bar.py`：

```python
from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="Foo Bar 工具")
def foo_bar(query: str = Field(description="用户问题 / 查询")):
    """一句话描述：做什么。"""
    cfg = get_tool_config("foo_bar") or {}
    api_key = (cfg.get("api_key") or "").strip()
    if not api_key:
        return BaseToolOutput({"error": "请在工具配置里填 api_key"}, format="json")

    # ...业务逻辑...
    return BaseToolOutput({"data": "..."}, format="json")
```

要点：

- **标题**用中文（展示在对话界面的下拉里），docstring 是 LLM 看的英文优先。
- **配置**一律通过 `get_tool_config(name)` 读，`name` 必须与 yaml 的顶层 key 完全一致。
- **第三方 SDK** 一定放进函数体里做 **lazy import**，并在 `ImportError` 时返回
`"请 pip install XXX"` 的 `BaseToolOutput`，绝不让主进程崩。

### 步骤 2 —— 注册

在 `libs/chayuan-server/chayuan/server/agent/tools_factory/__init__.py` 追加：

```python
from .foo_bar import foo_bar
```

这一行触发装饰器，`foo_bar` 才会进 `_TOOLS_REGISTRY`。

### 步骤 3 —— 在目录 JSON 里描述

在 `libs/chayuan-server/chayuan/data/tools_catalog.json` 的 `tools` 数组里追加：

```json
{
  "key": "foo_bar",
  "title": "Foo Bar",
  "icon": "widgets",
  "category": "data",
  "summary": "一行卡片副标题",
  "description": "详细说明：做什么 / 解决什么问题 / 适合场景。",
  "tags": ["Foo", "Bar"],
  "docs_url": "https://foo.example.com/",
  "required_imports": ["some_sdk"],
  "extras": "tools-misc",
  "required_config": ["api_key"],
  "fields": [
    {"path": "api_key", "label": "API Key", "widget": "password"}
  ],
  "defaults": {"use": false, "api_key": ""}
}
```

其中：


| 字段                                                | 作用                                                | 必填                 |
| ------------------------------------------------- | ------------------------------------------------- | ------------------ |
| `key`                                             | 同 yaml 顶层 key，与 `@regist_tool` 函数名一致              | ✅                  |
| `title / icon / category / summary / description` | 卡片渲染                                              | ✅                  |
| `tags`                                            | 搜索匹配 + 卡片底栏 `#tag`                                | ✖                  |
| `docs_url`                                        | 卡片右下「官网」链接                                        | ✖                  |
| `fields`                                          | 设置弹窗里的编辑控件清单                                      | ✖                  |
| `defaults`                                        | 点「添加工具」时写入 yaml 的初始值                              | ✅（至少含 `use:false`） |
| `required_imports`                                | doctor 会尝试 import 这些模块，缺了标 critical               | ✖                  |
| `extras`                                          | 缺包时 doctor 给的 `poetry install -E <extras>` 提示     | ✖                  |
| `required_config`                                 | doctor 判定「启用但空着」的必填清单；不填则 fallback 所有 password 字段 | ✖                  |
| `register_as`                                     | 见「伞型工具」节                                          | ✖                  |


做完这三步，重启 `chayuan start -a`，面板就看到新卡片、对话界面也能选到。

---

## 3. 伞型工具（register_as）

有些工具**共享一份 yaml 配置**、但在运行时是多个独立注册的子工具。典型例子：

- yaml: `amap: { use: true, api_key: "..." }`
- 运行时：`amap_poi_search` 与 `amap_weather` 两个 `@regist_tool`

在目录 JSON 里声明：

```json
{
  "key": "amap",
  "register_as": ["amap_poi_search", "amap_weather"],
  "defaults": { "use": false, "api_key": "" }
}
```

之后：

- 配置面板渲染 1 张卡片（标题 "高德地图"），启用开关落在 `amap.use`。
- `/tools?enabled=true` 过滤时会把 `amap_poi_search / amap_weather` 映射回
`amap` 的 `use` 字段（见 `chayuan/server/api_server/tool_routes.py` 的
`_umbrella_map()`）。
- 测试 `test_tools_catalog.py` 自动承认这个映射，不需要改。

---

## 4. 依赖处理策略

分三档：

### a. 开箱即用（内置 httpx）

如 `lark_message / wechat_work_message / dingtalk_message / news_api / openapi_call / notion_search / tavily / serper / pubmed_search / http_request`：纯 HTTP 调用，
目录里 **不写** `required_imports`，体检永远过。

### b. 可选 pip 依赖（推荐打 extras）

如 `yahoo_finance_news / semantic_scholar / stackexchange / github_tool / gitlab_tool / openweather / confluence_search`：

1. `pyproject.toml` 里把包声明为 `optional = true`：
  ```toml
   some_sdk = { version = "^1.0", optional = true }
  ```
2. `[tool.poetry.extras]` 给到合适的分组（或新建）：
  ```toml
   tools-misc = ["some_sdk"]
   tools-all = [..., "some_sdk"]
  ```
3. 目录 JSON 的条目里写上：
  ```json
   "required_imports": ["some_sdk"],
   "extras": "tools-misc"
  ```

这样 `chayuan doctor tools` 会在「启用但缺包」时直接给出
`poetry install -E tools-misc` 的修复命令。

### c. 工具自身也要 lazy import

即使声明了 extras，真正的 `import some_sdk` 也必须**写在函数体里**，这样用户
`pip install chayuan` 不装 extras 也能启动主服务。

```python
def foo_bar(...):
    try:
        import some_sdk
    except ImportError:
        return BaseToolOutput({
            "error": "some_sdk 未安装，请 `pip install some_sdk`"
        }, format="json")
```

---

## 5. 体检命令：`chayuan doctor tools`

加完工具后建议跑一次体检：

```bash
poetry -C libs/chayuan-server run chayuan doctor tools
```

输出按严重度分组：

- 🔴 **critical**：启用但依赖未安装 / 启用但关键配置空着 / 没被 `@regist_tool` 注册
- ⚠️ **warning**：暂未使用（预留位）
- ℹ️ **info**：关键字段已填但 `use=false`（忘了启用？）
- ✅ **ok**：启用 + 依赖齐全 + 关键配置齐全
- — **skip**：未启用（不参与告警）

常用选项：

```bash
chayuan doctor tools --json              # CI / 管道友好
chayuan doctor tools -k github_tool      # 只看一张
chayuan doctor tools --fail-on critical  # CI gate：任一 critical 退 2
```

CI 集成示例（GitHub Actions）：

```yaml
- name: tools health
  run: poetry -C libs/chayuan-server run chayuan doctor tools --fail-on critical
```

---

## 6. 测试保障

`libs/chayuan-server/tests/unit_tests/test_tools_catalog.py` 有 14 个静态断言，
会在 CI 里自动拦住以下最常见的低级 bug：

- 目录 JSON 里有 key 但没注册 `@regist_tool`
- 注册了 `@regist_tool` 但目录 JSON 里没描述（孤儿）
- `fields[*].path` 指向了 `defaults` 里不存在的键
- 工具使用了未声明的 `category`
- `icon` 为空 / `key` 重复

所以加工具时请**一次性**改三处，别想着「代码先合、目录 JSON 后补」——测试会挂。

---

## 7. 描述可编辑

卡片上显示的描述优先读 `tool_settings.yaml/<key>._desc`（以下划线开头表示
这是面板元数据，工具运行时代码不关心它）。

- 在设置弹窗里改描述 → 保存到 `_desc`
- 「恢复默认描述」按钮 → 清空 `_desc`，卡片回落到目录 JSON 里的原描述

---

## 8. 远程目录覆盖

如果想在不改代码的情况下给企业内部扩展更多工具：

1. 把企业自定义的 tools_catalog JSON（同一 schema）放到
  `CHAYUAN_ROOT/tools_catalog.override.json`；
2. 同 `key` 的条目会**整条替换**内置目录的；新 `key` 会**追加**；
3. 重启 `chayuan start -c` 或在面板点右上角「刷新」按钮即可生效。

需要动代码的只有「新工具的运行时文件」（步骤 1）与 `__init__.py`（步骤 2），
其余都能靠覆盖 JSON 在部署环境配置。

---

## 9. 参考

- 目录 schema 源码：`chayuan/server/config_panel/tools_page.py` 的 `ToolSpec / ToolField`
- 体检实现：`chayuan/cli_tools_doctor.py`
- API 路由：`chayuan/server/api_server/tool_routes.py`
- 伞型映射：`chayuan/server/api_server/tool_routes.py::_umbrella_map`
- 测试：`tests/unit_tests/test_tools_catalog.py`

