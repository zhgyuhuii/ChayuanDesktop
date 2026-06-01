# 模型广场(在线模型库)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改名「模型广场」为「模型厂商」,并新增独立「模型广场」页面:在线检索 ModelScope/HuggingFace 官方模型库(列表式、类型过滤+搜索 AND 联合、页码分页、参数/文件大小)、一键复用既有下载器安装(带进度)、显示已安装清单与卸载、装完经 sidecar 自动接入对应服务下拉。

**Architecture:** 后端新建归一适配器层 `model_registry/hub_catalog/`(每源一 adapter,归一成 `NormalizedModelCard`),两个只读 endpoint `/v1/model-hub/search|detail`;下载复用既有 `chayuan-modelmgr` + `/admin/models/install_model`;manifest 增 `origin` 做精确安装态;新增 `/admin/models/uninstall`。前端新建列表式 `ModelGalleryPage`,抽共享 `useInstallJob`,装完/卸载 invalidate `['v1.models']`/`['runtime.models']` 让对话下拉自动更新。

**Tech Stack:** Python/FastAPI/Pydantic v2/httpx/pytest(后端)、React/TS/@tanstack/react-query(前端)。

---

## 关键约束(每个实施 subagent 必读)

- **仓库 root 所有**:Edit/Write 工具会 EACCES。所有写文件/提交走 `sudo`(Bash),例如
  `sudo tee path <<'EOF' ... EOF` 或 `sudo python3 - <<'PY' ...(读改写)... PY`。
- **本机仅 py3.6**:跑不了项目的 pytest(项目要 py312/pydantic v2),也跑不了
  `npm run typecheck`。带 `from __future__ import annotations` 的文件连 `py_compile` 都报错。
  **后端纯函数单测的"运行"由用户在 py312 跑**;实施时本地只能读检 + 写好可运行的测试。
  每个后端 Task 仍按 TDD 写测试(先写失败测试→实现→标注"待用户 py312 跑")。
- **分支 main→origin/main**。只 `sudo git add <精确路径>`(本仓有大量 mode-bit 噪音,禁止 `git add -A`)。
- **提交信息结尾**加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **真复用硬规则(CLAUDE.md)**:`useInstallJob` 必须真抽共享(老 `InstallModelDialog` 改成用它),
  不造阉割版;能力 chips 复用 `ModelMenuList` 的组件/样式;卡片不再造,列表行视觉参照 `ProviderCard`。
- **接口写前必实测(memory 教训)**:hub 接口/字段不准就全盘偏。P0 Task 0.2 先实测各 hub 接口录
  fixture,后续 adapter 单测全用 fixture 离线跑。用户环境:ModelScope 可达、HF 官方不可达、hf-mirror 可达。

## 已核实的复用点(确切签名/路径)

- 下载器 manifest:`chayuan-server/libs/chayuan-modelmgr/src/chayuan_modelmgr/verifier.py`
  `write_manifest(model_dir: Path, *, source: str = "imported") -> Path`(payload 有 version/source/files/total_bytes)。
- 安装 job:`chayuan-server/libs/chayuan-server/chayuan/server/model_registry/install_model.py`
  `InstallModelJobManager.start(*, source, model_id, capability, specific_file=None)`(已支持单文件=quant);
  落点 `<CHAYUAN_ROOT>/models/bundled/<cap_subdir>/<repo.replace('/','--')>/`;`_repo_safe_name(repo)`。
- 本地索引:`model_registry/local_index.py` — `local_models.json` 在
  `<CHAYUAN_ROOT>/model_registry/local_models.json`;`LocalModelIndex.by_capability(cap)`、
  `.remove(model_id)`、`scan_once(*, persist=True) -> ScanDelta`;`LocalModelEntry` 有 path/relpath/capability/size_bytes/source_tag。
- 能力识别:`model_registry/identifier.py` — `_CAPABILITY_BY_PIPELINE`、`_DIFFUSERS_PIPELINE_KIND`、
  `_PATH_HINTS`、`_CAPABILITY_BY_MODELTYPE`(复用其映射,勿重写)。
- 对话下拉真源:`GET /v1/models?type=llm`(openai_routes.py);本地模型 `GET /runtime/models`。
- v1 路由:`provider_routes.py` `provider_router = APIRouter(prefix="/v1/providers")` —— model-hub 路由同款挂。
- 前端安装 API:`packages/api/src/modelPlatform.ts` `serverModelsInstallModel.start({source,model_id,capability,requested_file?})`、
  `InstallModelJob{ id,status,progress_pct,progress_message,log_tail,requested_file,... }`、`.get(id)`、`.cancel(id)`。
- 前端菜单/路由/i18n:`packages/app/src/features/shell/Sidebar.tsx` NAV_ITEMS、
  `packages/app/src/router/index.tsx` workspaceRoutes、`packages/i18n/src/locales/zh-CN.ts`(nav.modelMarket 第29行 / marketplace title 第156行)。
- 能力 chips/分组:`packages/app/src/features/composer/ModelMenuList.tsx`(capability 过滤 chip)。
- 列表视觉参照:`packages/app/src/features/marketplace/components/ProviderCard.tsx`。
- 旧下载对话框(抽 hook 来源):`packages/app/src/features/aiPlatform/InstallModelDialog.tsx`(2s 轮询逻辑 ~第276-348行)。

---

# P0 — 改名 + 接口实测 fixture

### Task 0.1: 「模型广场」改名「模型厂商」

**Files:**
- Modify: `chayuan-client/packages/i18n/src/locales/zh-CN.ts`(`nav.modelMarket` 文案、marketplace `title`)

- [ ] **Step 1: 读当前文案** —— `grep -n "模型广场\|modelMarket\|marketplace" chayuan-client/packages/i18n/src/locales/zh-CN.ts`,确认第29行 `modelMarket: '模型广场'` 与第156行 `title: '模型广场'`,并查其它语言包同 key(`en.ts/ja.ts/...` 若存在)。
- [ ] **Step 2: 改文案** —— 把这两处中文 `模型广场`→`模型厂商`(en 包对应改 `Model Vendors` 等;只改文案,**不改 key、不改路由 `/marketplace`**)。用 `sudo python3 -` 读改写,保证 UTF-8。
- [ ] **Step 3: 自检** —— `grep -rn "模型广场" chayuan-client/packages/i18n/` 应只剩**新增**的 `nav.modelGallery`(本任务还没加,故此刻应 0 命中旧的厂商页文案)。
- [ ] **Step 4: 提交** —— `sudo git add chayuan-client/packages/i18n/src/locales/*.ts && sudo git commit -m "refactor(i18n): 模型广场改名模型厂商(为新模型广场让出名字)"`(附 Co-Authored-By)。

### Task 0.2: 实测各 hub 接口并录 JSON fixture(无此步后续 adapter 全盲做)

**Files:**
- Create: `chayuan-server/libs/chayuan-server/tests/unit_tests/fixtures/hub/hf_search.json`
- Create: `.../fixtures/hub/hf_tree.json`
- Create: `.../fixtures/hub/ms_search.json`
- Create: `.../fixtures/hub/ms_files.json`
- Create: `docs/superpowers/notes/2026-06-02-hub-api-probe.md`(记录实测命令+字段观察)

- [ ] **Step 1: 实测 HF(走 hf-mirror,国内可达)搜索** —— 用户/实施者在可联网环境跑:
  `curl -sL 'https://hf-mirror.com/api/models?search=qwen3&filter=gguf&sort=downloads&direction=-1&limit=5&full=false'`(**-L 必须**:hf-mirror 308 重定向。沙箱实测 200,`full=false` 也带 `siblings[{rfilename}]` 可判 runnable/选 quant)
  保存为 `hf_search.json`。观察字段:`id, downloads, likes, tags, pipeline_tag, library_name, createdAt`。
- [ ] **Step 2: 实测 HF 文件树(取大小)** —— 取上一步某 id(如 `Qwen/Qwen3-4B-Instruct-GGUF`):
  `curl -s 'https://hf-mirror.com/api/models/<id>/tree/main?recursive=true'` 保存 `hf_tree.json`。
  观察:数组,每项 `{path, type, size, oid, lfs:{size,oid}}`。
- [ ] **Step 3: 实测 ModelScope 搜索** —— ModelScope 列表 API(实测确认确切形态,二选一并记录):
  **沙箱已实测确认**:`curl -sL -X PUT 'https://www.modelscope.cn/api/v1/dolphin/models' -H 'Content-Type: application/json' -d '{"PageSize":5,"PageNumber":1,"Name":"qwen","SortBy":"Default"}'`(返 200,`{"Code":200,"Data":{"FiledAgg":{...},...}}`)。GET `/api/v1/models?...` 是 404,**别用**。
  保存 `ms_search.json`,在 probe 笔记记录 Models 数组真实路径(`Data.Model.Models[]` 或 `Data.Models[]`,实测时打印 Data 顶层 key 确认)与每项字段(Name/Path/ChineseName/Tasks/Downloads)。
- [ ] **Step 4: 实测 ModelScope 文件列表** —— 取某 owner/name:
  `curl -s 'https://www.modelscope.cn/api/v1/models/<owner>/<name>/repo/files?Revision=master&Root='`
  保存 `ms_files.json`。观察 `Data.Files[]` 每项 `{Path, Name, Size, Type}`。
- [ ] **Step 5: 写观察笔记** —— 把"字段→归一字段"的真实映射、分页参数、各源能力字段(HF `pipeline_tag` / MS `Tasks`)写进 probe 笔记。**后续所有 adapter Task 以此笔记+fixture 为准。**
- [ ] **Step 6: 提交** —— `sudo git add` 上述 fixture + 笔记;commit `test(hub): 实测 HF/ModelScope 接口并录 fixture+映射笔记`。

> 若实施环境无网络:此 Task 必须交回用户在 py312/联网机器跑 Step 1-4,把 4 个 json 贴回。**不要凭印象造 fixture** —— 那会让 P1 全错。

---

# P1 — 后端归一适配器 + search/detail endpoint

### Task 1.1: 归一契约 + capability 映射(纯函数,可单测)

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/hub_catalog/__init__.py`
- Create: `.../hub_catalog/base.py`
- Create: `.../hub_catalog/capability.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_hub_capability.py`

- [ ] **Step 1: 写失败测试** `test_hub_capability.py`:

```python
from chayuan.server.model_registry.hub_catalog.capability import (
    capability_from_hf_pipeline, capability_from_ms_tasks, parse_param_size, is_runnable_format,
)

def test_hf_pipeline_to_capability():
    assert capability_from_hf_pipeline("text-generation") == "chat"
    assert capability_from_hf_pipeline("automatic-speech-recognition") == "speech-to-text"
    assert capability_from_hf_pipeline("sentence-similarity") == "text-embedding"
    assert capability_from_hf_pipeline(None) == "other"

def test_ms_tasks_to_capability():
    assert capability_from_ms_tasks(["text-generation"]) == "chat"
    assert capability_from_ms_tasks(["text-to-image"]) == "text-to-image"
    assert capability_from_ms_tasks([]) == "other"

def test_parse_param_size():
    assert parse_param_size("Qwen/Qwen3-4B-Instruct-GGUF") == "4B"
    assert parse_param_size("bge-reranker-v2-m3") is None
    assert parse_param_size("Qwen2.5-0.5B") == "0.5B"

def test_is_runnable_format():
    assert is_runnable_format([".gguf"]) is True
    assert is_runnable_format([".onnx"]) is True
    assert is_runnable_format([".safetensors"]) is False  # 纯 HF 权重需 transformers,本地 sidecar 不直跑
```

- [ ] **Step 2: 运行确认失败(待用户 py312)** —— `PYTHONPATH=.../libs/chayuan-server pytest -q tests/unit_tests/test_hub_capability.py`;预期 ImportError。
- [ ] **Step 3: 实现 `capability.py`** —— **复用 `identifier.py` 的映射常量**(import 它的 `_CAPABILITY_BY_PIPELINE` 等,不重抄):

```python
from __future__ import annotations
import re
from typing import List, Optional
from chayuan.server.model_registry import identifier as _idf

def capability_from_hf_pipeline(pipeline_tag: Optional[str]) -> str:
    if not pipeline_tag:
        return "other"
    return _idf._CAPABILITY_BY_PIPELINE.get(pipeline_tag, "other")

_MS_TASK_ALIASES = {"text-generation": "chat", "chat": "chat", "sentence-embedding": "text-embedding"}
def capability_from_ms_tasks(tasks: List[str]) -> str:
    for t in tasks or []:
        c = _MS_TASK_ALIASES.get(t) or _idf._CAPABILITY_BY_PIPELINE.get(t)
        if c:
            return c
    # 回退路径启发(复用 identifier 的 _PATH_HINTS)
    for t in tasks or []:
        for kw, cap in _idf._PATH_HINTS:
            if kw in t:
                return cap
    return "other"

_PARAM_RE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])")
def parse_param_size(model_id: str) -> Optional[str]:
    m = _PARAM_RE.search(model_id or "")
    return f"{m.group(1)}B" if m else None

_RUNNABLE_EXT = {".gguf", ".onnx", ".bin"}  # bin: whisper ggml/部分 onnx 附属;具体 P1.3 细化
def is_runnable_format(exts: List[str]) -> bool:
    return any(e.lower() in _RUNNABLE_EXT for e in exts)
```

- [ ] **Step 4: 实现 `base.py`** —— 归一契约(Pydantic v2 BaseModel):

```python
from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel

class HubFile(BaseModel):
    rfilename: str
    size_bytes: Optional[int] = None
    runnable: bool = False

class NormalizedModelCard(BaseModel):
    source: str            # 'modelscope' | 'huggingface'
    model_id: str
    display_name: str
    owner: str = ""
    capability: str = "other"
    param_size: Optional[str] = None
    file_size_bytes: Optional[int] = None
    format: Optional[str] = None
    runnable: bool = False
    serveable: bool = True   # t2i/t2v=False
    downloads: int = 0
    likes: int = 0
    updated_at: Optional[str] = None
    tags: List[str] = []
    installed: bool = False

class SearchPage(BaseModel):
    items: List[NormalizedModelCard]
    page: int
    page_size: int
    has_more: bool
    total: Optional[int] = None
```

`base.py` 再定义 adapter 协议(抽象基类)`HubAdapter`,方法 `search(query, capability, runnable_only, page, page_size, *, route, token) -> SearchPage` 与 `detail(model_id, *, revision, route, token) -> List[HubFile]`。`__init__.py` 导出这些 + `_SERVEABLE_CAPS = {"chat","text-embedding","rerank","speech-to-text","text-to-audio","image-embedding","image-to-text"}`(t2i/t2v 不在内→serveable=False)。

- [ ] **Step 5: 运行测试通过(待用户 py312)**;预期 4 测试 PASS。
- [ ] **Step 6: 提交** `feat(hub): 归一契约 NormalizedModelCard/HubFile + capability 映射(复用 identifier)`。

### Task 1.2: HuggingFace adapter(fixture 驱动单测)

**Files:**
- Create: `.../hub_catalog/huggingface.py`
- Test: `.../tests/unit_tests/test_hub_hf_adapter.py`

- [ ] **Step 1: 写失败测试**(用 Task 0.2 的 `hf_search.json`/`hf_tree.json` 做 mock,**HTTP 层 mock,不联网**):

```python
import json, pathlib
from chayuan.server.model_registry.hub_catalog.huggingface import HuggingFaceAdapter

FIX = pathlib.Path(__file__).parent / "fixtures" / "hub"

def _load(n): return json.loads((FIX / n).read_text(encoding="utf-8"))

def test_hf_search_normalizes(monkeypatch):
    a = HuggingFaceAdapter()
    monkeypatch.setattr(a, "_get_json", lambda url, **kw: _load("hf_search.json"))
    page = a.search(query="qwen3", capability="chat", runnable_only=True, page=1, page_size=5, route="mirror", token=None)
    assert page.items, "应解析出卡片"
    c = page.items[0]
    assert c.source == "huggingface"
    assert "/" in c.model_id
    assert c.capability in {"chat","other","text-embedding","rerank","speech-to-text","text-to-audio","image-embedding","image-to-text"}

def test_hf_detail_sizes(monkeypatch):
    a = HuggingFaceAdapter()
    monkeypatch.setattr(a, "_get_json", lambda url, **kw: _load("hf_tree.json"))
    files = a.detail("Qwen/Qwen3-4B-Instruct-GGUF", revision="main", route="mirror", token=None)
    assert any(f.rfilename.endswith(".gguf") for f in files)
    assert any((f.size_bytes or 0) > 0 for f in files)
```

- [ ] **Step 2: 运行确认失败(待用户 py312)**。
- [ ] **Step 3: 实现 `huggingface.py`** —— httpx 调 `/api/models`(search/sort/limit + offset 模拟页码)与 `/api/models/{id}/tree/main?recursive=true`;`route` 决定 host(`mirror`→`https://hf-mirror.com`,`official`→`https://huggingface.co`);`token` 加 `Authorization: Bearer`;`_get_json(url, **kw)` 单独方法便于 mock;超时 10s;`runnable_only` 时 `filter=gguf` 优先 + 结果按 runnable 过滤;`capability` 过滤映射成 HF `pipeline_tag`/`filter`;归一成 `NormalizedModelCard`(serveable 按 `_SERVEABLE_CAPS`)。**字段名严格按 Task 0.2 笔记**。
- [ ] **Step 4: 运行测试通过(待用户 py312)**。
- [ ] **Step 5: 提交** `feat(hub): HuggingFace adapter(hf-mirror/官方线路+token+offset 分页+文件树取大小)`。

### Task 1.3: ModelScope adapter(fixture 驱动单测)

**Files:**
- Create: `.../hub_catalog/modelscope.py`
- Test: `.../tests/unit_tests/test_hub_ms_adapter.py`

- [ ] **Step 1: 写失败测试** —— 结构同 1.2,用 `ms_search.json`/`ms_files.json`;断言 `c.source=="modelscope"`、能从 `Tasks` 映射 capability、detail 从 `Size` 求和。
- [ ] **Step 2: 运行确认失败(待用户 py312)**。
- [ ] **Step 3: 实现 `modelscope.py`** —— 按 Task 0.2 实测的真实路径(`Data.Model.Models[]` 等)解析;原生 `PageNumber/PageSize` 分页;detail 调 `/repo/files`;capability 用 `capability_from_ms_tasks`;route 固定 `https://www.modelscope.cn`(ModelScope 国内直连)。
- [ ] **Step 4: 运行测试通过(待用户 py312)**。
- [ ] **Step 5: 提交** `feat(hub): ModelScope adapter(原生页码+repo/files 取大小+Tasks 映射)`。

### Task 1.4: search/detail endpoint + adapter 路由分发

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/model_hub_routes.py`
- Modify: 主 app 装配处(`grep -rn "include_router(provider_router" chayuan-server/libs/...` 找到后,同处 include `model_hub_router`)
- Test: `.../tests/unit_tests/test_model_hub_routes.py`

- [ ] **Step 1: 写失败测试**(FastAPI TestClient + monkeypatch adapter.search 返固定 SearchPage):

```python
def test_search_route(monkeypatch, client):
    # client = TestClient(app);monkeypatch hub adapter 工厂返回 stub
    r = client.get("/v1/model-hub/search", params={"source":"huggingface","query":"qwen","capability":"chat","page":1})
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "page" in body and "has_more" in body
```

- [ ] **Step 2: 运行确认失败(待用户 py312)**。
- [ ] **Step 3: 实现路由** —— `model_hub_router = APIRouter(prefix="/v1/model-hub", tags=["ModelHub"])`;
  `GET /search`(query 参数 source/query/capability/runnable_only/page/page_size/route/token→分发到对应 adapter→单源 try/except 隔离,失败返 502+`{detail}` 不抛栈)、
  `GET /detail`(source/model_id/revision/route/token→adapter.detail→[HubFile])。**安装态填充留 Task 2.2 接**(此刻 installed 先恒 False)。把 token 从 query 改为读后端配置(P5 接),此处先接收可选 query token。
- [ ] **Step 4: 注册 router** —— 在 include provider_router 同处 `app.include_router(model_hub_router)`。
- [ ] **Step 5: 运行测试通过(待用户 py312)**。
- [ ] **Step 6: 提交** `feat(hub): GET /v1/model-hub/search|detail 端点 + 单源错误隔离`。

---

# P2 — 安装态(manifest origin)+ 卸载

### Task 2.1: 下载器 manifest 记 origin

**Files:**
- Modify: `chayuan-server/libs/chayuan-modelmgr/src/chayuan_modelmgr/verifier.py`(`write_manifest` 加 origin)
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/install_model.py`(下载完写 manifest 时传 origin)
- Test: `chayuan-server/libs/chayuan-modelmgr/tests/test_verifier_origin.py`(若该库有 tests 目录;否则放 chayuan-server tests)

- [ ] **Step 1: 写失败测试**:

```python
import json
from pathlib import Path
from chayuan_modelmgr.verifier import write_manifest, MANIFEST_NAME

def test_write_manifest_origin(tmp_path: Path):
    (tmp_path / "a.gguf").write_bytes(b"x")
    write_manifest(tmp_path, source="downloaded", origin={"source":"huggingface","repo_id":"Qwen/Qwen3-4B-GGUF","revision":"main"})
    data = json.loads((tmp_path / MANIFEST_NAME).read_text(encoding="utf-8"))
    assert data["origin"]["repo_id"] == "Qwen/Qwen3-4B-GGUF"
    assert data["origin"]["source"] == "huggingface"
```

- [ ] **Step 2: 运行确认失败(待用户 py312)**。
- [ ] **Step 3: 改 `write_manifest`** —— 加形参 `origin: dict | None = None`,payload 增 `"origin": origin`(None 时省略或置 null)。
- [ ] **Step 4: 改 `install_model.py`** —— 下载完成调 `write_manifest` 处,传 `origin={"source": job.source, "repo_id": job.model_id, "revision": getattr(job,"revision",None)}`。(找到调用 write_manifest 的行;若当前没调,在下载成功分支补调。)
- [ ] **Step 5: 运行测试通过(待用户 py312)**。
- [ ] **Step 6: 提交** `feat(modelmgr): manifest 记 origin{source,repo_id,revision} 供精确安装态`。

### Task 2.2: 已安装集合 + 填充 search.installed

**Files:**
- Create: `.../hub_catalog/installed.py`
- Modify: `.../api_server/model_hub_routes.py`(search 填 installed)
- Test: `.../tests/unit_tests/test_hub_installed.py`

- [ ] **Step 1: 写失败测试**(造临时 models 目录,放两个含 manifest origin 的子目录):

```python
def test_installed_repos(tmp_path, monkeypatch):
    from chayuan.server.model_registry.hub_catalog import installed as ins
    # 造 <root>/models/bundled/chat/Qwen--X/.chayuan-manifest.json origin.repo_id=Qwen/X
    # monkeypatch CHAYUAN_ROOT=tmp_path
    repos = ins.installed_repo_set()
    assert ("huggingface","Qwen/X") in repos
```

- [ ] **Step 2: 运行确认失败(待用户 py312)**。
- [ ] **Step 3: 实现 `installed.py`** —— `installed_repo_set() -> set[tuple[str,str]]`:扫 `<CHAYUAN_ROOT>/models/**/.chayuan-manifest.json` 读 origin →`(source,repo_id)`;无 origin 的回退用目录名 `repo.replace('/','--')` 反推塞入(source 标 'unknown')。`mark_installed(cards, repo_set)`:对每张卡 `(card.source,card.model_id) in repo_set` 或 unknown 兜底匹配→`installed=True`。
- [ ] **Step 4: 接入 search 路由** —— search 归一后调 `mark_installed`。
- [ ] **Step 5: 运行测试通过(待用户 py312)**。
- [ ] **Step 6: 提交** `feat(hub): manifest origin 扫描得已安装集合 + 填充 search.installed`。

### Task 2.3: 卸载 endpoint(删盘+重扫+移出 enabled+三边界)

**Files:**
- Create/Modify: `.../api_server/admin_routes.py`(加 `POST /admin/models/uninstall`;admin_routes 已有 /admin/models/* 群)
- Create: `.../model_registry/uninstall.py`(纯逻辑:解析路径/停服务/删/重扫/移出 enabled)
- Test: `.../tests/unit_tests/test_uninstall.py`

- [ ] **Step 1: 写失败测试**:

```python
def test_uninstall_resolves_real_path(tmp_path, monkeypatch):
    from chayuan.server.model_registry.uninstall import resolve_model_dir
    # local_index 里有一条 entry path=<tmp>/models/bundled/chat/Qwen--X
    # monkeypatch index
    p = resolve_model_dir(source="huggingface", repo_id="Qwen/X")
    assert str(p).endswith("Qwen--X")

def test_uninstall_blocks_bundled(monkeypatch):
    from chayuan.server.model_registry.uninstall import is_bundled_readonly
    assert is_bundled_readonly(source_tag="bundled") is True
    assert is_bundled_readonly(source_tag="root") is False
```

- [ ] **Step 2: 运行确认失败(待用户 py312)**。
- [ ] **Step 3: 实现 `uninstall.py`** —— `resolve_model_dir(source,repo_id)`:查 `local_index` 用 manifest origin/目录名匹配得**真实 path**(不反推拼);`is_bundled_readonly(source_tag)`;`uninstall(source,repo_id,*,force) -> dict`:① 内置→拒(返 {ok:False,reason:'bundled'});② 若该模型正被某 capability sidecar 加载(查 local_runtime 当前 model)→ 非 force 返 {ok:False,reason:'in_use',capability};force 则先停该 sidecar;③ 若是默认模型(DEFAULT_LLM_MODEL/capability_router)→ 删后回退下一个可用并标记;④ `shutil.rmtree(dir)`;⑤ `local_index.scan_once(persist=True)`;⑥ 从对应 `local-<cap>` platform enabled 移除(deregister 或重注册)。删失败不半删(先校验可写再删,异常回滚提示)。
- [ ] **Step 4: 实现路由** —— `POST /admin/models/uninstall` body `{source,repo_id,force?}` → 调 uninstall → 返结果(含释放字节数、需 force 的边界原因)。
- [ ] **Step 5: 运行测试通过(待用户 py312)**。
- [ ] **Step 6: 提交** `feat(models): POST /admin/models/uninstall(删盘+重扫+移出 enabled+在用/默认/内置边界)`。

---

# P3 — 前端 API 客户端 + 共享 useInstallJob

### Task 3.1: `packages/api/src/modelHub.ts`

**Files:**
- Create: `chayuan-client/packages/api/src/modelHub.ts`
- Modify: `chayuan-client/packages/api/src/index.ts`(导出 modelHub)

- [ ] **Step 1: 实现** —— 类型 `HubModelCard`(镜像后端 NormalizedModelCard,字段全 camel/snake 与后端一致:source/model_id/display_name/owner/capability/param_size/file_size_bytes/format/runnable/serveable/downloads/likes/updated_at/tags/installed)、`HubFile`、`HubSearchPage`;函数:
  `modelHub.search(params:{source,query?,capability?,runnableOnly?,page,pageSize?,route?,token?}): Promise<HubSearchPage>` → GET `/v1/model-hub/search`;
  `modelHub.detail(params:{source,modelId,revision?,route?,token?}): Promise<HubFile[]>` → GET `/v1/model-hub/detail`;
  `modelHub.uninstall(body:{source,repoId,force?}): Promise<{ok:boolean;reason?:string;capability?:string;freed_bytes?:number}>` → POST `/admin/models/uninstall`。
  install 不在此重写——复用 `serverModelsInstallModel`(modelPlatform.ts)。
- [ ] **Step 2: 导出** —— `index.ts` 加 `export * from './modelHub';`。
- [ ] **Step 3: 类型检查(待用户)** —— `cd chayuan-client && npm run typecheck`(实施时本地跑不了,标注)。
- [ ] **Step 4: 提交** `feat(api): modelHub 客户端(search/detail/uninstall)`。

### Task 3.2: 抽共享 hook `useInstallJob`(老 InstallModelDialog 也改用)

**Files:**
- Create: `chayuan-client/packages/app/src/features/modelGallery/useInstallJob.ts`
- Modify: `chayuan-client/packages/app/src/features/aiPlatform/InstallModelDialog.tsx`(改用该 hook,删内联轮询)

- [ ] **Step 1: 读旧轮询** —— 读 `InstallModelDialog.tsx` ~276-348 行,抽出 start→2s 轮询 get→succeeded/failed/cancelled 停→cancel 的逻辑与状态(job/progress/log_tail/pending)。
- [ ] **Step 2: 实现 hook** —— `useInstallJob()` 返回 `{ job, start(args), cancel(), reset(), isInstalling }`,内部 react-query 或 setInterval 2s 轮询 `serverModelsInstallModel.get`;succeeded 时调用方可注册 onDone 回调(用于 invalidate)。**逻辑与旧对话框一致,单一真源。**
- [ ] **Step 3: 改 InstallModelDialog 用 hook** —— 删掉内联轮询,改 `const {job,start,cancel}=useInstallJob()`;UI 不变。**这是"真复用"验收点:旧对话框行为不退化。**
- [ ] **Step 4: 类型检查(待用户)** + 让用户实测旧「设置→本地推理→下载模型」对话框仍正常。
- [ ] **Step 5: 提交** `refactor(models): 抽共享 useInstallJob;InstallModelDialog 改用(不再内联轮询)`。

---

# P4 — 前端列表页(过滤 + 分页)

### Task 4.1: 菜单 + 路由接入

**Files:**
- Modify: `packages/i18n/src/locales/zh-CN.ts`(新增 `nav.modelGallery: '模型广场'`,en 包对应)
- Modify: `packages/app/src/features/shell/Sidebar.tsx`(NAV_ITEMS 加 `{ to:'/model-gallery', labelKey:'nav.modelGallery', icon: Store }`,从 lucide-react import Store)
- Modify: `packages/app/src/router/index.tsx`(workspaceRoutes 加 `{ path:'/model-gallery', id:'modelGallery' }` + 懒加载 ModelGalleryPage)

- [ ] **Step 1: 加 i18n key**(新增,不动 Task 0.1 已改的厂商文案)。
- [ ] **Step 2: 加菜单项 + 路由**(参照现有 `/marketplace` 注册方式)。
- [ ] **Step 3: 占位页** —— 先建 `ModelGalleryPage.tsx` 返回标题占位,确保路由能进。
- [ ] **Step 4: 类型检查(待用户)** + 用户点菜单能进新页。
- [ ] **Step 5: 提交** `feat(gallery): 新增模型广场菜单+路由+占位页`。

### Task 4.2: 列表页骨架 + 顶部过滤(源 tab/能力 chips/搜索/仅可运行)

**Files:**
- Modify: `packages/app/src/features/modelGallery/ModelGalleryPage.tsx`
- Create: `packages/app/src/features/modelGallery/GalleryFilters.tsx`

- [ ] **Step 1: 状态** —— `source('modelscope'|'huggingface'|'installed')`、`hfRoute('mirror'|'official')`、`query`(防抖 300ms)、`capability|null`、`runnableOnly(默认 true)`、`page(默认1)`。任一过滤变化 → `setPage(1)`。
- [ ] **Step 2: GalleryFilters** —— 源 tab(三个:ModelScope/HuggingFace[内嵌线路 select]/已安装)+ 能力 chips(**复用 ModelMenuList 的 capability chip 组件;若耦合则抽其 chip 子组件复用**)+ 搜索框 + `仅可运行` 开关。已安装 tab 时隐藏 query/capability 之外的源相关控件。
- [ ] **Step 3: 数据查询** —— `useQuery(['model-hub.search', {source,hfRoute,query,capability,runnableOnly,page}], () => modelHub.search({...}))`,`enabled: source!=='installed'`;已安装 tab 用 `useQuery(['runtime.models'], runtime.models...)`。AND 联合即所有参数同传后端。
- [ ] **Step 4: 类型检查(待用户)**。
- [ ] **Step 5: 提交** `feat(gallery): 列表页骨架+顶部过滤(源/能力/搜索/仅可运行 AND 联合)`。

### Task 4.3: 列表行 ModelHubRow + 底部页码分页

**Files:**
- Create: `packages/app/src/features/modelGallery/ModelHubRow.tsx`
- Create: `packages/app/src/features/modelGallery/GalleryPagination.tsx`
- Modify: `ModelGalleryPage.tsx`

- [ ] **Step 1: ModelHubRow** —— 一行:名/owner、能力徽标、参数大小(`param_size ?? '—'`)、文件大小(格式化 bytes,`'—'` 兜底)、下载量、右侧操作区(见 P5 安装/卸载;此 Task 先渲染静态 `已安装`/`安装` 占位按钮);serveable=false 行显示「暂无本地运行服务」灰标。视觉参照 ProviderCard。
- [ ] **Step 2: GalleryPagination** —— 上一页/下一页 + `第 page 页` + 跳页输入;`has_more` 控制下一页禁用;已安装 tab 不分页。
- [ ] **Step 3: 组装** —— 列表区 map items 成行 + 底部分页;空态/加载态/源不可达错误态(显示重试按钮)。
- [ ] **Step 4: 类型检查(待用户)**。
- [ ] **Step 5: 提交** `feat(gallery): 列表行+文件/参数大小展示+底部页码分页+空/错/载态`。

---

# P5 — 接线联动 + 文生图标记 + revision/token

### Task 5.1: 安装(含 quant/revision 选择)+ 进度 + 装完联动

**Files:**
- Create: `packages/app/src/features/modelGallery/HubFilePickerDialog.tsx`
- Modify: `ModelHubRow.tsx`(接 useInstallJob)、`ModelGalleryPage.tsx`(onDone invalidate)

- [ ] **Step 1: HubFilePickerDialog** —— 点「安装」→ `modelHub.detail` 取文件列表;若有多个 runnable 文件(多 quant)→ 弹此对话框选文件 + 可选 revision 下拉(默认 main/master);只有一个则直接装。
- [ ] **Step 2: 接 useInstallJob** —— 选定后 `start({source, model_id, capability, requested_file})`(install 复用 serverModelsInstallModel);行内进度条显示 `job.progress_pct/progress_message`;失败展示 `log_tail`。
- [ ] **Step 3: 装完联动** —— useInstallJob onDone → `queryClient.invalidateQueries(['v1.models'])` + `(['runtime.models'])` + `(['model-hub.search'])` → **对话下拉自动出现该模型**、本行变「已安装」。
- [ ] **Step 4: 类型检查(待用户)** + 用户实测:装一个小 GGUF chat 模型 → 对话模型下拉出现可用。
- [ ] **Step 5: 提交** `feat(gallery): 安装(quant/revision 选择)+行内进度+装完 invalidate 联动对话下拉`。

### Task 5.2: 卸载 + 三边界提示

**Files:**
- Modify: `ModelHubRow.tsx`(已安装行的卸载按钮)、已安装 tab 列表

- [ ] **Step 1: 卸载按钮** —— 已安装行/已安装 tab 显示「卸载」;点→`confirmDialog`(显示将释放磁盘大小)→`modelHub.uninstall({source,repoId})`。
- [ ] **Step 2: 边界处理** —— 返回 `reason:'in_use'`→二次 confirm「正在使用,卸载会停止该模型服务」→ `uninstall({...,force:true})`;`reason:'bundled'`→按钮本就禁用(内置模型 tooltip「内置模型不可卸载」);默认模型被卸→后端已回退,前端提示。
- [ ] **Step 3: 卸完联动** —— invalidate `['v1.models']`+`['runtime.models']`+`['model-hub.search']` → 对话下拉消失、行回「未安装」。
- [ ] **Step 4: 类型检查(待用户)** + 用户实测卸载后对话下拉消失。
- [ ] **Step 5: 提交** `feat(gallery): 卸载+在用/默认/内置边界+卸完联动`。

### Task 5.3: 文生图/视频标记 serveable + token 设置

**Files:**
- Modify: `ModelHubRow.tsx`(serveable=false 视觉)、`GalleryFilters.tsx`(HF tab token 输入)、后端 token 配置读取(`model_hub_routes.py` 从配置读 HF token,query token 仅覆盖)

- [ ] **Step 1: serveable 标记** —— t2i/t2v 行:能力徽标 + 灰标「暂无本地运行服务」;仍可安装/卸载/看已装,但不期待出现在任何服务下拉(后端 serveable=false 已隔离)。
- [ ] **Step 2: token** —— HF tab 设置区可填 HF token(localStorage 或后端配置持久化,不入库不上报);search/detail/install 透传 route+token。后端 `model_hub_routes` 优先读后端配置 token,query 覆盖。
- [ ] **Step 3: 类型检查(待用户)**。
- [ ] **Step 4: 提交** `feat(gallery): 文生图/视频标记暂无运行服务 + HF token 设置透传`。

---

## 验证总览(交用户 py312 + 联网)

1. 后端单测(py312):`PYTHONPATH=chayuan-server/libs/chayuan-server pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_hub_*.py test_uninstall.py`。
2. 前端:`cd chayuan-client && npm run typecheck`。
3. 集成冒烟:重启 sidecar(62581,无 reload)+ 重建 desktop → 进「模型广场」→ ModelScope 搜 qwen 出列表 → 装一个小 GGUF chat → 对话下拉出现可用 → 卸载后消失。
4. 回归:旧「模型厂商」(原模型广场)页正常;旧「设置→本地推理→下载模型」对话框(改用 useInstallJob 后)正常。

## Self-Review 记录

- **Spec 覆盖**:改名(0.1)、实测(0.2)、归一+capability(1.1)、HF/MS adapter(1.2/1.3)、search/detail(1.4)、manifest origin(2.1)、installed(2.2)、uninstall+三边界(2.3)、API 客户端(3.1)、useInstallJob 真复用(3.2)、菜单路由(4.1)、过滤(4.2)、列表行+分页(4.3)、安装+quant/revision+联动(5.1)、卸载(5.2)、serveable+token(5.3)。spec 各节均有对应 Task。
- **类型一致**:`NormalizedModelCard`/`HubFile`/`SearchPage` 字段在 base.py(1.1)定义,adapter(1.2/1.3)、路由(1.4)、前端类型(3.1)、行(4.3/5.x)全程同名引用。
- **无占位符**:纯函数 Task 给了真实可跑测试与实现;前端/adapter 因依赖 0.2 实测字段,代码以 fixture+笔记为准并注明"按笔记字段"。
- **风险**:0.2 未实测则 P1 全偏(已硬性前置);moviepy 无关;t2i/t2v 运行明确不做。
