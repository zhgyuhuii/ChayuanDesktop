# 数字人预设绑定模型+知识库 & 知识库脚本生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 数字人预设绑定对话模型+知识库(+各一个"允许临时改"开关);实时/生成默认用绑定值(按开关显隐预填);脚本生成基于绑定/所选知识库做 grounding 贴合企业话术。

**Architecture:** 预设加 model/ku_ids/allow_model_override/allow_kb_override;复用 ModelPicker/ModelMenuList、KnowledgePickerPill(加受控 props 不 fork)、kb_query.service.search(Subject 同 kb-query 路由)。实时/生成统一 effective 解析。

**Tech Stack:** Python/FastAPI/pydantic(后端)、React/TS/@tanstack/react-query(前端)。

---

## 关键约束(每个实施 subagent 必读)
- root 所有:Edit/Write 会 EACCES。写文件/提交全走 `sudo`(`sudo python3 - <<'PY'...PY` / `sudo tee`)。
- py3.6:跑不了项目 pytest(future-annotations 连 py_compile 都报错)。**写好可运行 pytest 测试,本地 `python3 -c "import ast;ast.parse(open(p).read())"` 验语法,注明待 py312**。前端有 toolchain 则 `npx tsc -p packages/app/tsconfig.json --noEmit`。
- 分支 main→origin/main;只 `sudo git add <精确路径>`(禁止 -A)。提交结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。完成 `sudo git push origin main`。
- 真复用硬规则:ModelPicker/ModelMenuList、KnowledgePickerPill(**加受控 props,默认仍走 store,不 fork 阉割版**)、kb_query.service.search、Subject 构造同 `/api/v1/kb-query/search` 路由、dhComposerStore。

## 已核实现状
- 后端 `.../digital_human/schemas.py` `DigitalHumanPreset`(有 model_validator 回填 avatars↔avatar_ref);`.../digital_human/store.py` `create_preset`(显式 kwargs + `_SUB_KEYS` setdefault + `**sub_fields`)、`update_preset(**fields)`(已通用解包)。`DhGenerateRequest`(有 script/role_scripts/role_segments/product_image)。
- 后端 `.../video_generation/steps/script.py` `generate_script(video_subject, *, language, paragraph_number, model=None, product_ref=None)`→`_invoke_llm(prompt, model=)`;`.../api_server/digital_human_routes.py` `/script/generate`(取 body model/product_ref)。
- 后端 `.../kb_query/service.py` `search(subject, req, *, request_id="", job_id=None)`;`.../kb_query/schemas.py` `SearchRequest(ku_ids, contents:[QueryContent], options:QueryOptions)`;`/api/v1/kb-query/search` 的 handler(在 api_server,**读它怎么从 request 建 Subject**)。
- 前端 `packages/api/src/digitalHuman.ts` `DigitalHumanPreset` 接口、`createPreset`/`updatePreset`、`generateScript(subject,{model,productRef})`、`dhGenerate`。
- 前端 `.../digital-human/PresetEditor.tsx`(预设全局区:画布/字幕/合成模式;canSave;onSave body)。
- 前端 `ModelPicker`(LiveAvatarPage 用 `value` + `onChange(id,pn)`)、`features/composer/ModelMenuList.tsx`、`CHAT_CAPABILITIES`(modelCapabilityChip)、`encodeModel/decodeModel`(platform::id)。
- 前端 `features/composer/KnowledgePickerPill.tsx`(读写全局 `dhComposerStore.selectedKuIds`;props includeKinds 等)。
- 前端 `.../digital-human/LiveAvatarPage.tsx`(`model`/`platformName` 本地态,`kuIds=dhComposerStore.selectedKuIds`,ChatRequestV2 {query,model,ku_ids});`GeneratePanel.tsx`(已有 ModelMenuList 选模型,`scriptModel`=platform::id;`generateScript`)。
- 前端 `packages/api/src/kbUniverse.ts` `kbQuery.search(query, kuIds, opts)`。

---

# P1 — 数据模型(前后端 4 字段)

### Task 1.1: 后端 schemas + store 加 4 字段
**Files:** Modify `.../digital_human/schemas.py`、`.../digital_human/store.py`;Test `chayuan-server/libs/chayuan-server/tests/unit_tests/test_dh_preset_bind_fields.py`

- [ ] **Step 1: 写失败测试**:

```python
from chayuan.server.video_generation.digital_human.store import create_preset, update_preset

def test_create_preset_bind_fields(tmp_path, monkeypatch):
    # monkeypatch 存储目录到 tmp(读 store 怎么定位 presets.json,patch 之)
    p = create_preset(name="x", model="ollama::qwen3", ku_ids=["doc:kb1"],
                      allow_model_override=False, allow_kb_override=True)
    assert p.model == "ollama::qwen3"
    assert p.ku_ids == ["doc:kb1"]
    assert p.allow_model_override is False and p.allow_kb_override is True

def test_defaults_backward_compatible():
    from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset
    d = DigitalHumanPreset(id="i", name="n")
    assert d.model == "" and d.ku_ids == [] and d.allow_model_override is True and d.allow_kb_override is True
```

- [ ] **Step 2: 运行确认失败(待 py312)**。
- [ ] **Step 3: schemas.py** —— `DigitalHumanPreset` 加(放 subtitle 字段附近):

```python
    model: str = ""                      # 绑定对话模型 platform_name::id
    ku_ids: List[str] = Field(default_factory=list)  # 绑定知识库 doc:<kb>/src:<id>
    allow_model_override: bool = True
    allow_kb_override: bool = True
```

(确认 `List` 已 import;`model_validator` 不动。)

- [ ] **Step 4: store.py** —— `create_preset` 加显式 kwargs `model: str = "", ku_ids: Optional[List[str]] = None, allow_model_override: bool = True, allow_kb_override: bool = True`,在构造 `DigitalHumanPreset(...)` 时传 `model=model, ku_ids=ku_ids or [], allow_model_override=allow_model_override, allow_kb_override=allow_kb_override`(放 `**sub_fields` 之外的显式参数区)。`update_preset(**fields)` 已通用透传,无需改(确认 update 的 `setattr`/`r.update` 能接受这些 key)。
- [ ] **Step 5: route** —— `digital_human_routes.py` `create_preset` handler(`store.create_preset(...)` 调用处)从 body 取这 4 个字段传入(读现有怎么取 subtitle 等,照加 `model=body.get("model",""), ku_ids=body.get("ku_ids") or [], allow_model_override=bool(body.get("allow_model_override", True)), allow_kb_override=bool(body.get("allow_kb_override", True))`)。update handler 已 `**body` 透传,确认 body 带这些 key 能进 update_preset。
- [ ] **Step 6: 运行测试通过(待 py312)**;`ast.parse` 验 schemas/store/routes。
- [ ] **Step 7: 提交** `feat(dh): 预设加 model/ku_ids/allow_model_override/allow_kb_override(后端)`。

### Task 1.2: 前端 digitalHuman.ts 接口加 4 字段
**Files:** Modify `chayuan-client/packages/api/src/digitalHuman.ts`

- [ ] **Step 1:** `DigitalHumanPreset` 接口加:

```ts
  model?: string;
  ku_ids?: string[];
  allow_model_override?: boolean;
  allow_kb_override?: boolean;
```

- [ ] **Step 2:** `createPreset`/`updatePreset` 的请求体类型若是 `Partial<DigitalHumanPreset>` 则自动覆盖;若有显式 body 类型,确认这 4 字段可传(读现有 create/update 签名)。
- [ ] **Step 3:** 有 toolchain 跑 `npx tsc -p packages/api/tsconfig.json --noEmit`;提交 `feat(dh): 前端预设类型加 model/ku_ids/allow_override(api)`,push。

---

# P2 — PresetEditor 绑定 UI

### Task 2.1: KnowledgePickerPill 加可选受控 props(真复用)
**Files:** Modify `chayuan-client/packages/app/src/features/composer/KnowledgePickerPill.tsx`

- [ ] **Step 1: 读现状** —— 确认它现在怎么读写 `dhComposerStore.selectedKuIds`/`setKuIds`、props 接口、渲染列表(knowledgeUniverse.list)。
- [ ] **Step 2: 加可选受控 props** —— props 加 `value?: string[]`、`onChange?: (ids: string[]) => void`。内部:`const selected = value ?? storeSelected;` `const setSelected = onChange ?? storeSet;`(value/onChange 同时传时走受控,否则**默认仍走 store** 向后兼容)。所有读/写处改用 `selected`/`setSelected`。**不新建组件、不 fork。**
- [ ] **Step 3:** 有 toolchain 跑 tsc;确认现有 ChatComposer/LiveAvatarPage 用法(不传 value/onChange)行为不变。
- [ ] **Step 4:** 提交 `refactor(kb): KnowledgePickerPill 加可选受控 props(默认仍走 store)`。

### Task 2.2: PresetEditor 加模型 + KB + 两开关
**Files:** Modify `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`

- [ ] **Step 1: 状态 + 预填** —— 加 `const [model, setModel] = React.useState(initial?.model ?? '');`、`const [kuIds, setKuIds] = React.useState<string[]>(initial?.ku_ids ?? []);`、`const [allowModelOverride, setAllowModelOverride] = React.useState(initial?.allow_model_override ?? true);`、`const [allowKbOverride, setAllowKbOverride] = React.useState(initial?.allow_kb_override ?? true);`。
- [ ] **Step 2: UI** —— 在预设全局区(合成模式附近)加两块:
  - 对话模型:`<ModelMenuList ... currentId/onPick>` 包装或直接用项目里现成的模型选择 pill(读 GeneratePanel 刚加的选模型用法照搬,value=model platform::id);下一行 `<label><input type="checkbox" checked={allowModelOverride} onChange={e=>setAllowModelOverride(e.target.checked)} /> 允许实时/生成时更改</label>`。
  - 知识库:`<KnowledgePickerPill value={kuIds} onChange={setKuIds} />`(受控);下一行 allowKbOverride checkbox。
- [ ] **Step 3: onSave** —— body 加 `model, ku_ids: kuIds, allow_model_override: allowModelOverride, allow_kb_override: allowKbOverride`。
- [ ] **Step 4:** 有 toolchain 跑 tsc;提交 `feat(dh): PresetEditor 加对话模型+知识库绑定+两个允许更改开关`,push。

---

# P3 — 后端脚本 grounding

### Task 3.1: generate_script 加 kb_context 注入(纯函数单测)
**Files:** Modify `.../video_generation/steps/script.py`;Test `chayuan-server/libs/chayuan-server/tests/unit_tests/test_generate_script_grounding.py`

- [ ] **Step 1: 写失败测试**(mock `_invoke_llm` 捕获 prompt):

```python
from chayuan.server.video_generation.steps import script as S

def test_kb_context_injected(monkeypatch):
    captured = {}
    monkeypatch.setattr(S, "_invoke_llm", lambda prompt, **kw: captured.setdefault("p", prompt) or "稿")
    out = S.generate_script("卖点", kb_context="企业话术:三年质保")
    assert "三年质保" in captured["p"]
    assert out == "稿"

def test_no_kb_context_unchanged(monkeypatch):
    captured = {}
    monkeypatch.setattr(S, "_invoke_llm", lambda prompt, **kw: captured.setdefault("p", prompt) or "稿")
    S.generate_script("卖点")
    assert "企业话术" not in captured["p"] and "【企业知识" not in captured["p"]
```

- [ ] **Step 2: 运行确认失败(待 py312)**。
- [ ] **Step 3: 实现** —— `generate_script` 加形参 `kb_context: Optional[str] = None`;构造 prompt 后,若 `kb_context`,前置注入:`prompt = f"【企业知识/参考话术】\n{kb_context}\n\n" + prompt`(放主题提示前)。与 product_ref 多模态分支可并存(都拼进 prompt 文本)。
- [ ] **Step 4: 运行通过(待 py312)**;`ast.parse` 验。
- [ ] **Step 5: 提交** `feat(dh): generate_script 支持 kb_context grounding 注入`。

### Task 3.2: /script/generate 路由检索 + Subject + kb_context
**Files:** Modify `.../api_server/digital_human_routes.py`

- [ ] **Step 1: 读 kb-query 路由** —— 找 `/api/v1/kb-query/search` handler,看它**怎么从 request 建 `Subject`**(依赖注入/默认 owner/guest)。记下构造方式。
- [ ] **Step 2: 实现检索** —— `/script/generate` handler 取 `ku_ids = body.get("ku_ids") or []`;非空时:
  ```python
  kb_context = None
  if ku_ids:
      try:
          from chayuan.server.kb_query.service import search as kb_search
          from chayuan.server.kb_query.schemas import SearchRequest, QueryContent, QueryOptions
          subject = <照 kb-query 路由同款构造 Subject>
          req = SearchRequest(ku_ids=ku_ids, contents=[QueryContent(text=subject_text)], options=QueryOptions(top_k=3))
          res = kb_search(subject, req)
          kb_context = _format_kb_context(res)  # 把命中 items 的 content 拼成文本块(标题+片段,限长)
      except Exception as e:
          logger.warning("[dh] KB grounding 检索失败,降级无 grounding: %r", e)
          kb_context = None
  script = generate_script(subject_text, ..., model=model, product_ref=product_ref, kb_context=kb_context)
  ```
  (QueryContent 字段名以 schemas 真实为准;subject_text = 主题。`_format_kb_context` 写个小 helper,空命中返 None。)
- [ ] **Step 3:** `ast.parse` 验;提交 `feat(dh): /script/generate 接 ku_ids→kb_query 检索→kb_context grounding(失败不阻断)`,push。

### Task 3.3: 前端 generateScript 透传 kuIds
**Files:** Modify `chayuan-client/packages/api/src/digitalHuman.ts`

- [ ] **Step 1:** `generateScript(subject, opts?)` 的 opts 加 `kuIds?: string[]`;body 加 `ku_ids: opts?.kuIds`(读现有 body 拼法照加)。
- [ ] **Step 2:** 有 toolchain 跑 tsc;提交 `feat(dh): generateScript 客户端透传 ku_ids`。

---

# P4 — 实时/生成消费(预填/显隐/有效值)

### Task 4.1: 有效值解析 helper
**Files:** Create `chayuan-client/packages/app/src/features/digital-human/usePresetBinding.ts`

- [ ] **Step 1: 实现** —— 纯 helper(非必须 hook):

```ts
export function effectiveModel(preset: { model?: string; allow_model_override?: boolean } | null, sessionModel: string): string {
  const allow = preset?.allow_model_override ?? true;
  if (!allow && preset?.model) return preset.model;
  return sessionModel || preset?.model || '';
}
export function effectiveKuIds(preset: { ku_ids?: string[]; allow_kb_override?: boolean } | null, sessionKuIds: string[]): string[] {
  const allow = preset?.allow_kb_override ?? true;
  if (!allow && (preset?.ku_ids?.length ?? 0) > 0) return preset!.ku_ids!;
  return sessionKuIds.length ? sessionKuIds : (preset?.ku_ids ?? []);
}
export function showModelPicker(preset: { model?: string; allow_model_override?: boolean } | null): boolean {
  return (preset?.allow_model_override ?? true) || !preset?.model;
}
export function showKbPicker(preset: { ku_ids?: string[]; allow_kb_override?: boolean } | null): boolean {
  return (preset?.allow_kb_override ?? true) || !(preset?.ku_ids?.length);
}
```

- [ ] **Step 2:** 有 toolchain 跑 tsc;提交 `feat(dh): 预设绑定有效值/显隐解析 helper`。

### Task 4.2: LiveAvatarPage 预填 + 显隐
**Files:** Modify `chayuan-client/packages/app/src/features/digital-human/LiveAvatarPage.tsx`

- [ ] **Step 1: 预填** —— 选/切预设的 effect 里:`preset.model` → `decodeModel(preset.model)` 得 {id,platform} → `setModel(id); setPlatformName(platform)`;`preset.ku_ids` → `dhComposerStore.setState({ selectedKuIds: preset.ku_ids ?? [] })`。
- [ ] **Step 2: 显隐** —— ModelPicker 包 `{showModelPicker(preset) && <ModelPicker .../>}`;KnowledgePickerPill 包 `{showKbPicker(preset) && <KnowledgePickerPill/>}`(实时页 KB 仍走 store,显隐即可)。
- [ ] **Step 3: 有效值** —— 构造 ChatRequestV2 时 `model: effectiveModel(preset, model)`、`ku_ids: effectiveKuIds(preset, kuIds)`(kuIds=store selectedKuIds)。
- [ ] **Step 4:** 有 toolchain 跑 tsc;提交 `feat(dh): 实时页按预设预填模型/知识库+开关显隐+有效值`,push。

### Task 4.3: GeneratePanel 预填模型 + 新增 KB 选择器
**Files:** Modify `chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx`

- [ ] **Step 1: 预填模型** —— 选预设时 `setScriptModel(preset.model ?? '')`(已有 scriptModel 状态);ModelMenuList 包 `{showModelPicker(preset) && ...}`。
- [ ] **Step 2: 新增 KB 选择器** —— 加 `const [scriptKuIds, setScriptKuIds] = React.useState<string[]>([]);`,选预设时 `setScriptKuIds(preset.ku_ids ?? [])`;渲染 `{showKbPicker(preset) && <KnowledgePickerPill value={scriptKuIds} onChange={setScriptKuIds} />}`(受控)。
- [ ] **Step 3: 透传** —— `onAiScript`/`onRefVideo` 调 `generateScript(subject, { model: effectiveModel(preset, scriptModel) || undefined, productRef, kuIds: effectiveKuIds(preset, scriptKuIds) })`。
- [ ] **Step 4:** 有 toolchain 跑 tsc;提交 `feat(dh): 生成页预填模型+新增知识库选择器+脚本生成传 ku_ids`,push。

---

## 验证总览(交用户 py312 + 重建)
1. 后端单测:`PYTHONPATH=chayuan-server/libs/chayuan-server pytest -q .../tests/unit_tests/test_dh_preset_bind_fields.py test_generate_script_grounding.py`。
2. 前端:`pnpm -r typecheck`。
3. 重启 sidecar + 重建 desktop,冒烟(spec 测试节):①预设绑模型+库保存 ②实时选该预设直接对话(走绑定) ③allow_override 关→实时/生成不显示选择器 ④生成页脚本基于绑定库 grounding ⑤生成页临时改库/模型生效不写回预设。

## Self-Review
- **Spec 覆盖**:①数据模型=1.1/1.2;②PresetEditor=2.1(受控props)/2.2;③消费=4.1/4.2/4.3;④grounding=3.1/3.2/3.3。全覆盖。
- **类型一致**:`model/ku_ids/allow_model_override/allow_kb_override` 在 schemas(1.1)/store(1.1)/route(1.1)/前端接口(1.2)/PresetEditor(2.2)/helper(4.1)/消费(4.2/4.3)同名;`generateScript(subject,{model,productRef,kuIds})` 在 3.3 定义、4.3 调用一致;`effectiveModel/effectiveKuIds/showModelPicker/showKbPicker` 在 4.1 定义、4.2/4.3 用一致;KnowledgePickerPill 受控 `value/onChange` 在 2.1 加、2.2/4.3 用一致。
- **无占位**:纯函数(generate_script grounding、helper)给全码+测试;KnowledgePickerPill 受控改造给了 selected/setSelected 模式;route 检索给了骨架(Subject 构造标注"读 kb-query 路由照搬"——因单机 Subject 构造需读真实代码,不臆造权限)。
- **风险**:Subject 构造必须照 kb-query 路由真实方式(单机桌面权限模型),3.2 首步强制读;QueryContent/QueryOptions 真实字段名以 schemas 为准;检索失败已兜底不阻断。
