# 数字人增强簇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 形象昵称必填+角色名显示名称;文案生成可选模型+上传商品图/视频走 VLM 看图出文案;同框/分段改为每角色脚本模型(同框按句轮流交织、分段有序多段)。

**Architecture:** 复用 ModelMenuList(选模型)、ffmpeg(抽帧)、get_ChatOpenAI(多模态)、render_coframe_turntaking/render_sequential(合成)、/model-gallery(引导)。后端纯函数(script_router.plan)TDD;前端读检+用户 typecheck。

**Tech Stack:** Python/FastAPI/langchain(后端)、React/TS/@tanstack/react-query(前端)、ffmpeg。

---

## 关键约束(每个实施 subagent 必读)
- 仓库 root 所有:Edit/Write 会 EACCES。写文件/提交全走 `sudo`(`sudo tee <p> > /dev/null <<'EOF'...EOF` / `sudo python3 - <<'PY'...PY`)。
- 本机 py3.6:跑不了项目 pytest/typecheck(带 `from __future__ import annotations` 连 py_compile 都报错)。**写好可运行的 pytest 测试,本地用 ast/python3 -c 验纯逻辑,注明"待 py312 跑"**。前端若本机有 toolchain 可 `npx tsc -p packages/app/tsconfig.json --noEmit`。
- 分支 main→origin/main;只 `sudo git add <精确路径>`(禁止 -A)。提交结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。完成 `sudo git push origin main`。
- 真复用硬规则:ModelMenuList、ffmpeg、get_ChatOpenAI 多模态、render_coframe_turntaking/render_sequential。

## 已核实现状(基于勘察)
- 前端 `chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx`:`onAiScript`→`digitalHuman.generateScript(subject)`;single 一个 textarea(`text`);sequential 每角色一个 `<input>`(`roleScripts:string[]`);coframe 用全局 `text`;商品上传 `accept="image/*"`→`digitalHuman.uploadProduct(file)`→`productRef`;生成传 `{script 或 role_scripts, product_image:productRef}`。
- 前端 `.../digital-human/PresetEditor.tsx`:`canSave`(single `slots.length>=1`/multi `>=2`);聚焦配置区有昵称 `<input>`(setSlotField(ref,{name}))。
- 后端 `chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py`:`/script/generate`(已接 `body.get("model")`,空结果抛 `HTTPException(502,"文案生成失败(LLM 不可用?先在模型配置里设默认 chat 模型)")`);`/products`(只图);`DhGenerateRequest`(schemas.py 有 script/role_scripts)。
- 后端 `.../video_generation/steps/script.py`:`generate_script(subject,language,paragraph_number,model=)`→`_invoke_llm(prompt,model)`→`get_ChatOpenAI(model_name=)`;无图像分支。
- 后端 `.../digital_human/script_router.py`:`plan(dh_type,script,role_scripts,roles)`(single/coframe 按句 j%N/sequential role_scripts[i]);`_unit`/`SynthUnit`/`_split_string_by_punctuations`。
- 后端 `.../digital_human/jobs.py`:`_gen_slot_clips`(调 plan;coframe→render_coframe_turntaking、sequential→render_sequential);labels 取 slot.name(空则不显示)。
- 复用:`features/composer/ModelMenuList.tsx`(props items/value/onChange/capabilityFilter);`CHAT_CAPABILITIES={chat,vl}`(modelCapabilityChip.tsx);`models.list()` GET `/v1/models`(RawModelItem.model_type/capability)。

---

# P1 — Part A:命名校验 + 角色名显示

### Task 1.1: 形象昵称必填 + 缺名高亮(#4)
**Files:** Modify `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`

- [ ] **Step 1:** 改 `canSave`,加每个 slot 昵称非空:

```ts
const allNamed = slots.every((s) => (s.name ?? '').trim().length > 0);
const canSave = name.trim().length > 0 && !saving && allNamed && (
  composeMode === 'single' ? slots.length >= 1 : slots.length >= 2
);
```

- [ ] **Step 2:** 聚焦配置区昵称 `<input>`:缺名时红框 + 保存区提示。在昵称 input className 末尾按条件加红边:`cn('...原有...', !(fSlot.name ?? '').trim() && 'border-[var(--cy-danger-500)]')`(确认 cn 已 import);在操作按钮上方加一行提示:`{!allNamed && <span className="text-[10px] text-[var(--cy-danger-500)]">每个形象必须填昵称</span>}`。
- [ ] **Step 3:** 读检(本机无 toolchain 跑不了 tsc 就读检 cn/slots 类型);若有 toolchain 跑 `npx tsc -p packages/app/tsconfig.json --noEmit` 确认零新错。
- [ ] **Step 4:** 提交 `feat(dh): 形象昵称必填校验+缺名高亮`,push。

### Task 1.2: 角色名一律显示名称而非路径(#5)
**Files:** 先 grep 定位,再 Modify 命中处(候选:`features/digital-human/*.tsx`、字幕/实时角色列表、`CanvasStage.tsx`)

- [ ] **Step 1: 定位** —— 跑:
  `grep -rn "avatar_ref\|\.ref\b\|relpath\|avatarFileUrl\|split('/').pop\|basename" chayuan-client/packages/app/src/features/digital-human/ | grep -iv "src=\|avatarFileUrl(" `
  找出把 ref/路径/文件名**当角色名文本显示**的地方(区别于用作 img src)。重点看实时页/字幕设置里列角色名的组件、`ModelHubRow` 无关。把命中清单记下。
- [ ] **Step 2: 改** —— 命中处统一改用 `slot.name`(Part A1 已保证非空)。如有 `name || ref || 文件名` 回退链,删掉 ref/文件名回退,保留 `name`(必要时回退到 `'角色'+序号`,**绝不回退到路径/文件名**)。CanvasStage 标签(r.name)、GeneratePanel 分段 placeholder(`r.name || r.label || '角色'+i`)若含文件名回退则同样清理。
- [ ] **Step 3:** 后端 `jobs.py` labels 已取 slot.name(无需改);确认无误即可。
- [ ] **Step 4:** 读检/tsc;提交 `fix(dh): 角色名统一显示昵称,去除图像路径/文件名回退`,push。
- [ ] **Step 5(报告):** 在 commit message 或报告里列出实际命中并修改的文件:行,供复核「显示路径」真实位置。

---

# P2 — Part C:每角色脚本模型(后端纯函数优先)

### Task 2.1: schemas 加 role_segments + 语义注释
**Files:** Modify `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py`

- [ ] **Step 1:** `DhGenerateRequest` 加字段(role_scripts 注释改为 coframe 用):

```python
    script: Optional[str] = None              # single 用
    role_scripts: Optional[List[str]] = None  # coframe 用:每角色一串,plan 按句轮流交织
    role_segments: Optional[List[Dict[str, Any]]] = None  # sequential 用:有序 [{role_index,text}]
```

(确认文件已 `from typing import Optional, List, Dict, Any`;缺则补 import。)

- [ ] **Step 2:** `python3 -c "import ast; ast.parse(open('...schemas.py').read())"` 验语法(future-annotations 文件 py_compile 不行,用 ast)。
- [ ] **Step 3:** 提交 `feat(dh): DhGenerateRequest 加 role_segments + role_scripts 改 coframe 语义`。

### Task 2.2: script_router.plan 重写 + 纯函数单测(核心)
**Files:** Modify `.../digital_human/script_router.py`;Test `chayuan-server/libs/chayuan-server/tests/unit_tests/test_script_router_plan.py`

- [ ] **Step 1: 写失败测试**(纯函数,py312 可跑):

```python
from chayuan.server.video_generation.digital_human.script_router import plan

class _Role:  # 最小桩,plan 只用 voice/name 等;按真实 AvatarSlot 字段补
    def __init__(self, ref): self.ref=ref; self.name=ref; self.voice_provider=""; self.voice_name=""; self.voice_rate=1.0; self.voice_volume=1.0

def _roles(n): return [_Role(f"r{i}") for i in range(n)]

def test_single():
    u = plan("single", script="你好世界。再见。", role_scripts=None, role_segments=None, roles=_roles(1))
    assert len(u) == 1 and u[0].role_index == 0

def test_coframe_interleave():
    # 角色A 两句、角色B 一句 → A.s1,B.s1,A.s2(按句序轮流,B 无第2句跳过)
    u = plan("coframe", script=None, role_scripts=["甲一。甲二。", "乙一。"], role_segments=None, roles=_roles(2))
    assert [(x.role_index) for x in u] == [0, 1, 0]
    assert u[0].text.startswith("甲一") and u[1].text.startswith("乙一") and u[2].text.startswith("甲二")

def test_sequential_ordered_segments():
    segs = [{"role_index":0,"text":"A段1"},{"role_index":1,"text":"B段1"},{"role_index":0,"text":"A段2"}]
    u = plan("sequential", script=None, role_scripts=None, role_segments=segs, roles=_roles(2))
    assert [(x.role_index, x.text) for x in u] == [(0,"A段1"),(1,"B段1"),(0,"A段2")]

def test_sequential_fallback_role_scripts():
    u = plan("sequential", script=None, role_scripts=["甲","","丙"], role_segments=None, roles=_roles(3))
    assert [(x.role_index, x.text) for x in u] == [(0,"甲"),(2,"丙")]  # 空段跳过
```

- [ ] **Step 2:** 运行确认失败(待 py312):`PYTHONPATH=chayuan-server/libs/chayuan-server pytest -q .../test_script_router_plan.py`。
- [ ] **Step 3: 重写 plan**(签名加 role_segments):

```python
def plan(dh_type, script=None, role_scripts=None, role_segments=None, *, roles):
    out = []
    n = len(roles or [])
    if not n:
        return out
    if dh_type == "single" or n <= 1:
        t = (script or "").strip()
        if t:
            out.append(_unit(0, roles[0], t))
        return out
    if dh_type == "coframe":
        rs = role_scripts or []
        per = []
        for i in range(n):
            s = (rs[i] if i < len(rs) else "") or ""
            per.append([x for x in _split_string_by_punctuations(s) if x.strip()])
        maxk = max((len(p) for p in per), default=0)
        for k in range(maxk):
            for i in range(n):
                if k < len(per[i]):
                    out.append(_unit(i, roles[i], per[i][k]))
        return out
    if dh_type == "sequential":
        segs = role_segments or []
        if segs:
            for seg in segs:
                idx = int(seg.get("role_index", 0))
                t = (seg.get("text") or "").strip()
                if 0 <= idx < n and t:
                    out.append(_unit(idx, roles[idx], t))
        else:  # 向后兼容:旧 sequential 发 role_scripts(每角色一段)
            rs = role_scripts or []
            for i in range(n):
                t = (rs[i] if i < len(rs) else "") or ""
                if t.strip():
                    out.append(_unit(i, roles[i], t))
        return out
    return out
```

(读现有 `_unit`/`_split_string_by_punctuations` 确认签名一致;`roles` 改 keyword-only 要同步改调用方 jobs.py,见 Task 2.3。若 _unit 需要 voice 字段,桩补齐。)

- [ ] **Step 4:** 运行测试通过(待 py312);本地 ast 验语法。
- [ ] **Step 5:** 提交 `feat(dh): script_router.plan 重写(coframe 按句交织/sequential 有序多段/兼容)`。

### Task 2.3: jobs 传 role_scripts/role_segments
**Files:** Modify `.../digital_human/jobs.py`

- [ ] **Step 1:** 读 `_gen_slot_clips` 与 `submit`/pipeline 取参处,确认 role_scripts 来源(args)。加 role_segments 透传:`submit(...)` 与 `_run_pipeline` 把 `role_segments` 从 DhGenerateRequest 传到 `_gen_slot_clips`,再调 `script_router.plan(dh_type, script=global_text, role_scripts=role_scripts, role_segments=role_segments, roles=slots)`(keyword 对齐 Task 2.2 签名)。
- [ ] **Step 2:** `digital_human_routes.py` 提交任务处把 `body.role_segments` 一并传入 `dh_jobs.submit`。
- [ ] **Step 3:** ast 验语法;提交 `feat(dh): jobs/route 透传 role_segments 给 plan`。

### Task 2.4: 前端脚本输入区改(coframe 每角色框 / sequential 分组多段)
**Files:** Modify `GeneratePanel.tsx`;Modify `chayuan-client/packages/api/src/digitalHuman.ts`(dhGenerate 类型/字段)

- [ ] **Step 1: dhGenerate 客户端** —— `digitalHuman.ts` 的生成请求体类型加 `role_segments?: Array<{role_index:number; text:string}>`;`dhGenerate` 透传。
- [ ] **Step 2: coframe 输入** —— GeneratePanel 在 `composeMode==='coframe'` 时,渲染**每角色一个 `<textarea>`**(标题=`role.name`),状态 `coframeScripts: string[]`(index 对应角色)。生成时 `role_scripts: coframeScripts`。
- [ ] **Step 3: sequential 输入** —— `composeMode==='sequential'` 时,**按角色分组**:每组标题=`role.name` + 「添加一段」按钮;组内 `segments: string[]`(每角色一个数组,状态 `seqSegs: Record<roleIndex, string[]>` 或 `string[][]`)。生成时**拼有序 role_segments**:按段序轮流——`for k in 0..maxSegs: for i in roles: if seqSegs[i][k] 非空 → push {role_index:i, text:seqSegs[i][k]}`。
- [ ] **Step 4:** 生成请求按 mode 发对应字段(single→script、coframe→role_scripts、sequential→role_segments)。
- [ ] **Step 5:** tsc/读检;提交 `feat(dh): 脚本输入区 — 同框每角色框 + 分段按角色分组多段`,push。

---

# P3 — Part B:文案选模型 + 图像/视频→VLM

### Task 3.1: 商品上传支持视频(#3)
**Files:** Modify `GeneratePanel.tsx`(accept);Modify `digital_human_routes.py`(/products 白名单)

- [ ] **Step 1:** GeneratePanel 商品上传 input `accept="image/*,video/*"`;展示处区分图/视频(视频用 `<video>` 缩略或显示文件名)。
- [ ] **Step 2:** 后端 `/products`(digital_human_routes.py:198)扩展名白名单加 `.mp4 .mov .webm .mkv`(读现有保存逻辑,只扩白名单+保留原扩展名,别改默认 .png 逻辑成把视频存成 png)。返回 ref 不变(`product:<fid>`,带真实后缀)。
- [ ] **Step 3:** ast/tsc;提交 `feat(dh): 商品上传支持视频`,push。

### Task 3.2: 后端 /script/generate 多模态(VLM 看图出文案)(#2)
**Files:** Modify `digital_human_routes.py`(/script/generate 接 product_ref);Modify `.../steps/script.py`(图像分支)

- [ ] **Step 1:** `/script/generate` 入参取 `product_ref = body.get("product_ref")`,连同 `model` 传 `generate_script(subject, ..., model=model, product_ref=product_ref)`。
- [ ] **Step 2:** `steps/script.py` `generate_script` 加形参 `product_ref: Optional[str]=None`。有 product_ref 时:
  - 从 `dh_products_dir()` 解析文件(ref `product:<fid>` → 找对应文件,读真实后缀)。
  - 图片 → 读 bytes→base64 data URL。
  - **视频 → ffmpeg 抽 3-4 帧**(复用现有 ffmpeg 调用风格,参考 `/script/from-video` 的 ffmpeg 抽音写法;命令如 `ffmpeg -i in -vf fps=... -frames:v 4 out_%d.jpg` 或按时长均匀取帧)→ 每帧 base64 data URL。
  - 构造多模态消息:`from langchain_core.messages import HumanMessage`;`HumanMessage(content=[{"type":"text","text":主题提示},{"type":"image_url","image_url":{"url":data_url}}, ...每帧一个 image_url])`;调 `get_ChatOpenAI(model_name=model).invoke([sys?, human])` → 取 .content 作文案。
  - 失败(模型不支持 vision/超时)→ 抛带原因的异常,route 转成可读错误。
  - 无 product_ref → 现有纯文本路径(带 model),不变。
- [ ] **Step 3:** 单测 `test_script_generate_multimodal.py`(mock ffmpeg 抽帧 + mock get_ChatOpenAI):断言有 product_ref(图)时构造了含 image_url 的 HumanMessage;视频时调用了抽帧并产生多个 image_url;无 product_ref 走纯文本。(待 py312)
- [ ] **Step 4:** ast 验;提交 `feat(dh): /script/generate 多模态 — 商品图/视频经 VLM 看图出文案`,push。

### Task 3.3: GeneratePanel 选模型 + 动态 VLM 过滤 + 无 VLM 引导(#1 #2)
**Files:** Modify `GeneratePanel.tsx`;`digitalHuman.ts`(generateScript 加 model/product_ref)

- [ ] **Step 1: generateScript 客户端** —— `digitalHuman.generateScript(subject, opts?: { model?: string; productRef?: string })`,请求体加 `model`/`product_ref`。
- [ ] **Step 2: 模型选择器** —— GeneratePanel 加模型选择,**复用 `ModelMenuList`**:`const modelsQ = useQuery(['v1.models',{type:'all'}], () => models.list())`;`<ModelMenuList items={modelsQ.data} value={selected} onChange={setSelected} capabilityFilter={capFilter} />`。
- [ ] **Step 3: 动态 capability** —— `const hasImage = !!productRef;` `const capFilter = hasImage ? VL_ONLY : CHAT_CAPABILITIES;`(VL_ONLY=`new Set(['vl'])`;CHAT_CAPABILITIES 从 modelCapabilityChip import)。
- [ ] **Step 4: 无 VLM 引导** —— 当 `hasImage` 且 `modelsQ.data` 过滤 vl 后为空 → 显示提示「未检测到图像对话(VLM)模型,去模型广场安装」+ 按钮跳 `/model-gallery`(用项目导航方式,grep 现有跳转写法)。
- [ ] **Step 5: onAiScript** —— 传 `{ model: selected?.id, productRef }`;失败时若 hasImage 提示「请选 VLM 模型/去模型广场装」,否则提示去模型厂商配默认 chat。
- [ ] **Step 6:** tsc/读检;提交 `feat(dh): 文案生成选模型(挂图过滤VLM+无VLM引导去模型广场)`,push。

---

## 验证总览(交用户 py312 + 重建)
1. 后端单测:`PYTHONPATH=chayuan-server/libs/chayuan-server pytest -q .../tests/unit_tests/test_script_router_plan.py test_script_generate_multimodal.py`。
2. 前端:`pnpm -r typecheck`。
3. 重启 sidecar + 重建 desktop,集成冒烟(spec 测试节 7 条):选模型生成、挂图选VLM生成、挂视频生成、同框每角色脚本看交织、分段每角色多段看轮流、缺昵称存不了、字幕角色名显示昵称。

## Self-Review
- **Spec 覆盖**:#4=1.1;#5=1.2;#6=2.2(coframe)+2.4(前端框);#7=2.2(sequential)+2.4(分组多段);#1=3.3;#2=3.2+3.3;#3=3.1+3.2(视频抽帧)。全覆盖。
- **类型一致**:`plan(dh_type,script,role_scripts,role_segments,*,roles)` 在 2.2 定义、2.3 调用一致;`role_segments=[{role_index,text}]` 在 schemas(2.1)/plan(2.2)/jobs(2.3)/前端(2.4)/客户端类型一致;`generateScript(subject,{model,productRef})` 在 3.1/3.3 一致。
- **无占位**:核心纯函数(plan)给全码+测试;前端给结构+关键码;多模态给 message 构造法。A2「定位路径显示点」是必要的 grep-then-fix(勘察未精确定位),已写明审计清单。
- **风险**:多模态 message 格式依赖 get_ChatOpenAI 透传给底层 OpenAI 兼容 /v1/chat/completions 的 vision 支持——本地 VLM 须支持 image_url;3.2 失败要可读报错。ffmpeg 抽帧命令以实测为准。
