# 数字人多角色/结构化脚本生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 每角色人设+各自知识库,AI 一次生成符合人设/用各自事实的有序多角色对话;内置带货结构模板;分段时长预估避免失衡。

**Architecture:** AvatarSlot 加 persona/ku_ids;后端逐角色检索→合一个多角色 prompt→一次 LLM→`[角色名]台词` 容错解析成有序 role_segments;coframe plan 扩展吃 role_segments;前端模板选择+对话脚本预览(时长)。

**Tech Stack:** Python/FastAPI/langchain/pytest(后端)、React/TS/vitest(前端)。

---

## 关键约束(每个实施 subagent 必读)
- root 所有:写文件/提交全走 `sudo`(`sudo python3 - <<'PY'...PY` / `sudo tee`)。
- **能跑 py312 真测**(免密 sudo + conda py312),别只 ast:
  `sudo -n bash -lc 'conda activate py312 && PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest -q <文件>'`。
  前端 `npx tsc -p chayuan-client/packages/<app|api>/tsconfig.json --noEmit`。
- 分支 main→origin/main;只 `sudo git add <精确路径>`(禁止 -A)。提交结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。完成 `sudo git push origin main`。
- 真复用:`_retrieve_kb_context`、`get_ChatOpenAI`、`KnowledgePickerPill`(受控 value/onChange)、`KbResultsView`/`dhSourcesToRetrieval`、`script_router.plan`、`usePresetBinding`。

## 已核实现状
- `.../digital_human/schemas.py`:`AvatarSlot`(ref/kind/label/lines/voice_provider/voice_name/name/voice_rate/voice_volume/language/x/y/scale);`DigitalHumanPreset`(model/ku_ids/allow_*_override);`DhGenerateRequest`(script/role_scripts/role_segments/product_image)。
- `.../api_server/digital_human_routes.py`:`_retrieve_kb_context(user, ku_ids, query_text, *, top_k=5) -> (context:str|None, sources:list)`;`/script/generate`(调 generate_script、返 {script,kb_used,sources});`subject_from_user(user)`;`store.get_preset(pid)`。
- `.../video_generation/steps/script.py`:`generate_script(video_subject, *, language, paragraph_number, model, product_ref, kb_context)`;`get_ChatOpenAI(model_name=)`;`_SCRIPT_PROMPT`;`_invoke_llm(prompt, model=)`。
- `.../digital_human/script_router.py`:`plan(dh_type, script=None, role_scripts=None, role_segments=None, *, roles)`(coframe role_scripts 按句交织 / sequential role_segments 有序||role_scripts 回退);`_unit(i, role, text)` 读 role.voice_provider/voice_name/voice_rate/voice_volume;`_split_string_by_punctuations`。
- 前端 `packages/api/src/digitalHuman.ts`:`AvatarSlot` 类型;`dhGenerateScript(subject, {model,productRef,kuIds}) -> {script,kb_used,sources}`;`DhScriptSource`。
- 前端 `features/digital-human/GeneratePanel.tsx`(coframeScripts/seqSegments/distributeScript/previewOrder/scriptModel/scriptKuIds/sources 展示)、`PresetEditor.tsx`(每角色聚焦配置 name/language/VoicePicker/rate/volume;预设级 model+KB+allow)、`dhBinding.tsx`(BindingHint/dhSourcesToRetrieval)、`usePresetBinding.ts`。
- 前端 `features/composer/KnowledgePickerPill.tsx`(受控 value/onChange)、`features/kb/components/KbResultsView.tsx`。

---

# P1 — 数据模型(AvatarSlot persona/ku_ids + 模板常量/路由)

### Task 1.1: AvatarSlot 加 persona/ku_ids(前后端)
**Files:** Modify `.../digital_human/schemas.py`、`chayuan-client/packages/api/src/digitalHuman.ts`;Test `.../tests/unit_tests/test_dh_avatarslot_persona.py`

- [ ] **Step 1: 写失败测试**:
```python
def test_avatarslot_persona_kuids_defaults():
    from chayuan.server.video_generation.digital_human.schemas import AvatarSlot
    s = AvatarSlot(ref="user:a")
    assert s.persona == "" and s.ku_ids == []
def test_avatarslot_accepts_persona_kuids():
    from chayuan.server.video_generation.digital_human.schemas import AvatarSlot
    s = AvatarSlot(ref="user:a", persona="热情主播", ku_ids=["doc:kb1"])
    assert s.persona == "热情主播" and s.ku_ids == ["doc:kb1"]
```
- [ ] **Step 2: 运行确认失败** —— `pytest -q .../test_dh_avatarslot_persona.py`(预期 AttributeError/validation)。
- [ ] **Step 3: 实现** —— `AvatarSlot` 加 `persona: str = ""` 与 `ku_ids: List[str] = Field(default_factory=list)`(确认 List/Field 已 import)。
- [ ] **Step 4: 运行测试通过**。
- [ ] **Step 5: 前端类型** —— `digitalHuman.ts` 的 `AvatarSlot` 接口加 `persona?: string;`、`ku_ids?: string[];`。
- [ ] **Step 6: 提交** `feat(dh): AvatarSlot 加 persona/ku_ids(每角色人设+各自库)`(前端 tsc 通过)。

### Task 1.2: 内置 ScriptTemplate 常量 + 路由 + 前端客户端
**Files:** Create `.../digital_human/script_templates.py`;Modify `.../api_server/digital_human_routes.py`、`packages/api/src/digitalHuman.ts`;Test `.../tests/unit_tests/test_script_templates.py`

- [ ] **Step 1: 写失败测试**:
```python
def test_builtin_templates_shape():
    from chayuan.server.video_generation.digital_human.script_templates import list_templates, get_template
    ts = list_templates()
    assert any(t["id"] == "free" for t in ts)
    sell = get_template("sell4")
    assert sell and len(sell["sections"]) == 4
    assert get_template("nope") is None
```
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现 `script_templates.py`**:
```python
"""内置带货/口播结构模板(只读常量)。"""
from __future__ import annotations
from typing import List, Dict, Optional

_TEMPLATES: List[Dict] = [
    {"id": "free", "name": "自由", "sections": []},
    {"id": "sell4", "name": "带货四段", "sections": ["开场吸引", "卖点展示", "促单逼单", "结尾引导"]},
    {"id": "psa", "name": "问题方案", "sections": ["痛点引入", "解决方案", "行动号召"]},
]

def list_templates() -> List[Dict]:
    return [dict(t) for t in _TEMPLATES]

def get_template(tid: str) -> Optional[Dict]:
    for t in _TEMPLATES:
        if t["id"] == tid:
            return dict(t)
    return None
```
- [ ] **Step 4: 路由** —— `digital_human_routes.py` 加 `GET /script/templates`(读现有 router prefix,返 `{"templates": list_templates()}`)。
- [ ] **Step 5: 前端客户端** —— `digitalHuman.ts` 加 `listScriptTemplates(): Promise<{templates: Array<{id:string;name:string;sections:string[]}>}>`(GET 对应路径)。
- [ ] **Step 6: 运行测试通过** + 提交 `feat(dh): 内置脚本结构模板(带货四段/问题方案/自由)+ 路由+客户端`。

---

# P2 — 后端多角色生成(纯函数 + 路由)

### Task 2.1: build_multirole_prompt + parse_multirole_output(纯函数,核心)
**Files:** Create `.../digital_human/multirole.py`;Test `.../tests/unit_tests/test_multirole.py`

- [ ] **Step 1: 写失败测试**:
```python
from chayuan.server.video_generation.digital_human.multirole import build_multirole_prompt, parse_multirole_output

def test_build_prompt_has_personas_context_template():
    roles = [{"name": "小李", "persona": "热情主播", "context": "三年质保"},
             {"name": "小周", "persona": "理性助理", "context": ""}]
    p = build_multirole_prompt("卖扫地机", roles, ["开场", "卖点"], paragraph_number=2)
    assert "小李" in p and "热情主播" in p and "三年质保" in p
    assert "小周" in p and "理性助理" in p
    assert "开场" in p and "卖点" in p
    assert "卖扫地机" in p

def test_parse_tagged_lines_in_order():
    out = "[小李] 大家好。\n[小周] 我来补充。\n[小李] 这款三年质保。"
    segs = parse_multirole_output(out, ["小李", "小周"])
    assert [(s["role_index"], s["text"]) for s in segs] == [(0,"大家好。"),(1,"我来补充。"),(0,"这款三年质保。")]

def test_parse_colon_prefix_and_fuzzy():
    out = "小李：开场\n小周: 方案"
    segs = parse_multirole_output(out, ["小李", "小周"])
    assert [s["role_index"] for s in segs] == [0, 1]

def test_parse_untagged_falls_back_to_first_role():
    out = "一整段没有任何标签的文案。"
    segs = parse_multirole_output(out, ["小李", "小周"])
    assert len(segs) >= 1 and segs[0]["role_index"] == 0

def test_parse_unknown_tag_merges_into_prev():
    out = "[小李] 第一句。\n[路人] 接着说。"
    segs = parse_multirole_output(out, ["小李", "小周"])
    # 未知标签 → 并入上一段(role 0),不丢
    assert segs[0]["role_index"] == 0 and "接着说" in " ".join(s["text"] for s in segs)
```
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现 `multirole.py`**:
```python
"""多角色脚本生成:prompt 构造 + 输出容错解析(纯函数,无 IO)。"""
from __future__ import annotations
import re
from typing import List, Dict, Optional

def build_multirole_prompt(subject: str, roles: List[Dict], template_sections: List[str], *, paragraph_number: int = 1) -> str:
    lines = ["你是带货/口播脚本编剧。请为以下多个角色写一段【交错对话】口播脚本。"]
    lines.append("角色(每个角色保持各自人设、只用自己的参考资料中的事实):")
    for r in roles:
        nm = (r.get("name") or "").strip() or "角色"
        ps = (r.get("persona") or "").strip()
        lines.append(f"- {nm}" + (f"(人设:{ps})" if ps else ""))
        ctx = (r.get("context") or "").strip()
        if ctx:
            lines.append(f"  【{nm}·参考资料】{ctx}")
    if template_sections:
        lines.append("请按以下结构推进:" + " → ".join(template_sections) + f"(共约 {paragraph_number} 段)")
    lines.append(f"主题:{subject}")
    lines.append("严格输出格式:每行一句,以 `[角色名] 台词` 开头,按真实对话播放顺序排列,不要额外解释。")
    return "\n".join(lines)

_TAG = re.compile(r"^\s*(?:\[(?P<b>[^\]]{1,20})\]|(?P<c>[^：:\n]{1,20})[：:])\s*(?P<text>.+)$")

def parse_multirole_output(text: str, role_names: List[str]) -> List[Dict]:
    names = [(n or "").strip() for n in role_names]
    def match_role(tag: str) -> Optional[int]:
        tag = (tag or "").strip()
        for i, n in enumerate(names):
            if n and (tag == n or n in tag or tag in n):
                return i
        return None
    segs: List[Dict] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _TAG.match(line)
        if m:
            tag = m.group("b") or m.group("c")
            body = (m.group("text") or "").strip()
            ri = match_role(tag)
            if ri is not None:
                segs.append({"role_index": ri, "text": body})
                continue
            # 未知标签 → 并入上一段(连同标签文本),无上一段则归角色0
            if segs:
                segs[-1]["text"] = (segs[-1]["text"] + " " + line).strip()
            else:
                segs.append({"role_index": 0, "text": line})
            continue
        # 无标签行:并入上一段;无则归角色0
        if segs:
            segs[-1]["text"] = (segs[-1]["text"] + " " + line).strip()
        else:
            segs.append({"role_index": 0, "text": line})
    return [s for s in segs if s["text"].strip()]
```
- [ ] **Step 4: 运行测试通过**(5 用例)。
- [ ] **Step 5: 提交** `feat(dh): 多角色 prompt 构造 + 输出容错解析(纯函数)`。

### Task 2.2: generate-multi 路由(逐角色检索+一次 LLM+解析)
**Files:** Modify `.../api_server/digital_human_routes.py`;Test `.../tests/unit_tests/test_generate_multi_route.py`

- [ ] **Step 1: 写失败测试**(TestClient + monkeypatch `_retrieve_kb_context`、`get_ChatOpenAI`、`store.get_preset`):
```python
def test_generate_multi_returns_role_segments(client, monkeypatch):
    # preset: coframe, 两角色(各 persona, role0 有 ku_ids)
    # monkeypatch _retrieve_kb_context 返回 ("ctx", [{"file_name":"f","snippet":"s","kind":"document"}])
    # monkeypatch get_ChatOpenAI().invoke 返回带 .content = "[小李] 甲\n[小周] 乙"
    r = client.post("/v1/digital-human/script/generate-multi", json={"preset_id":"p1","subject":"卖货","template_id":"sell4"})
    assert r.status_code == 200
    body = r.json()
    assert [(s["role_index"], s["text"]) for s in body["role_segments"]] == [(0,"甲"),(1,"乙")]
    assert "kb_used" in body and "sources" in body
```
(按 test_digital_human_routes.py 现有 client/monkeypatch 模式写。)
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现路由** `POST /script/generate-multi`(读现有 /script/generate handler 的 user/preset/model 取法照搬):
  - 取 body `preset_id/subject/template_id/(product_ref)`;`preset = store.get_preset(preset_id)`;`roles = preset.avatars`;`model = preset.model or None`。
  - 逐角色:`eff = role.ku_ids or preset.ku_ids`;`ctx_i, src_i = _retrieve_kb_context(user, eff, subject)`(空则 (None,[]))。聚合 all_sources(每条加 `role` 标注=role.name)。
  - `tpl = get_template(template_id) or {}`;`prompt = build_multirole_prompt(subject, [{"name":r.name,"persona":r.persona,"context":ctx_i or ""} ...], tpl.get("sections",[]), paragraph_number=<body 可选,默认与角色数相关或 1>)`。
  - `llm = get_ChatOpenAI(model_name=model); resp = llm.invoke([HumanMessage(content=prompt)]); out = str(resp.content)`(读 script.py 现有 invoke 用法;异常→502 可读错误)。
  - `role_segments = parse_multirole_output(out, [r.name for r in roles])`;`kb_used = bool(all_sources)`。
  - 返 `{"role_segments": role_segments, "kb_used": kb_used, "sources": all_sources}`。
- [ ] **Step 4: 运行测试通过** + 跑 `test_digital_human_routes.py` 确认无回归。
- [ ] **Step 5: 提交** `feat(dh): POST /script/generate-multi(逐角色检索+多角色prompt+解析role_segments)`,push。

---

# P3 — plan coframe 接受 role_segments + 时长预估

### Task 3.1: script_router.plan coframe 支持 role_segments
**Files:** Modify `.../digital_human/script_router.py`;Test 扩 `.../tests/unit_tests/test_script_router_plan.py`

- [ ] **Step 1: 写失败测试**(加到现有文件):
```python
def test_coframe_uses_role_segments_when_present():
    segs = [{"role_index":0,"text":"甲一"},{"role_index":1,"text":"乙一"},{"role_index":0,"text":"甲二"}]
    u = plan("coframe", script=None, role_scripts=None, role_segments=segs, roles=_roles(2))
    assert [(x.role_index, x.text) for x in u] == [(0,"甲一"),(1,"乙一"),(0,"甲二")]

def test_coframe_falls_back_to_role_scripts_when_no_segments():
    u = plan("coframe", script=None, role_scripts=["甲一。甲二。","乙一。"], role_segments=None, roles=_roles(2))
    assert [x.role_index for x in u] == [0,1,0]  # 按句交织(回退)
```
- [ ] **Step 2: 运行确认失败**(coframe 现在忽略 role_segments)。
- [ ] **Step 3: 改 plan coframe 分支** —— 在 coframe 处理最前面加:`if role_segments: 走与 sequential 相同的有序逻辑(按 role_segments 顺序逐段 _unit,越界跳过)再 return`;否则保持现有 role_scripts 按句交织。(读现有 sequential 分支的有序实现,coframe 直接复用同样的"按 role_segments 顺序产 units";渲染侧 jobs coframe→render_coframe_turntaking 不变,只是 units 来源是有序 role_segments。)
- [ ] **Step 4: 运行测试通过** + 跑全 `test_script_router_plan.py` + `test_digital_human_jobs.py` 不回归。
- [ ] **Step 5: 提交** `feat(dh): script_router.plan coframe 支持有序 role_segments(AI多角色产物),无则回退role_scripts`。

### Task 3.2: 前端时长预估纯函数
**Files:** Create `chayuan-client/packages/app/src/features/digital-human/estimateDuration.ts`;Test `estimateDuration.test.ts`(vitest)

- [ ] **Step 1: 实现 + vitest**:
```ts
export const BASE_CPS = 4.5; // 中文 TTS 基准 字/秒
export function estimateDurationMs(text: string, voiceRate = 1): number {
  const chars = (text || '').replace(/\s/g, '').length;
  const rate = voiceRate && voiceRate > 0 ? voiceRate : 1;
  return Math.round((chars / (BASE_CPS * rate)) * 1000);
}
export function fmtSec(ms: number): string { return `${(ms / 1000).toFixed(1)}秒`; }
```
```ts
// estimateDuration.test.ts
import { describe, it, expect } from 'vitest';
import { estimateDurationMs } from './estimateDuration';
describe('estimateDurationMs', () => {
  it('counts chars / (4.5*rate)', () => {
    expect(estimateDurationMs('九个字的一段话啊', 1)).toBe(Math.round((8/4.5)*1000));
  });
  it('faster rate → shorter', () => {
    expect(estimateDurationMs('一二三四五六七八九', 1.5)).toBeLessThan(estimateDurationMs('一二三四五六七八九', 1));
  });
  it('empty → 0', () => { expect(estimateDurationMs('', 1)).toBe(0); });
});
```
- [ ] **Step 2: 跑 vitest**(项目有 vitest 则 `npx vitest run estimateDuration` 或对应命令;无则跳过注明) + tsc。
- [ ] **Step 3: 提交** `feat(dh): 时长预估纯函数 estimateDurationMs(字数/语速)`。

---

# P4 — 前端 UI

### Task 4.1: PresetEditor 每角色 persona + KB
**Files:** Modify `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`

- [ ] **Step 1: 状态** —— slots 已是受控数组;`setSlotField(ref, {persona})` / `setSlotField(ref, {ku_ids})` 复用现有 setSlotField(读它支持任意字段)。
- [ ] **Step 2: UI(每角色聚焦配置区)** —— 在该角色 VoicePicker/rate/volume 附近加:
  - `<textarea>` persona(value=`fSlot.persona ?? ''`,onChange `setSlotField(fSlot.ref,{persona:e.target.value})`,placeholder「人设/语气,如:热情主播,口语化」)。
  - `<KnowledgePickerPill value={fSlot.ku_ids ?? []} onChange={(ids)=>setSlotField(fSlot.ref,{ku_ids:ids})} />` + 小字「留空=用预设知识库」。
- [ ] **Step 3: onSave** —— slots 已整体进 body.avatars(persona/ku_ids 随 slot 一起),确认 onSave 传的是完整 slots(含新字段),无需额外改。
- [ ] **Step 4: tsc** + 提交 `feat(dh): PresetEditor 每角色加人设+知识库绑定`。

### Task 4.2: GeneratePanel 模板选择 + 多角色生成 + 对话脚本预览(时长)
**Files:** Modify `chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx`、`packages/api/src/digitalHuman.ts`

- [ ] **Step 1: 客户端** —— `digitalHuman.ts` 加:
  - `generateMultiRoleScript(args:{preset_id:string;subject:string;template_id?:string;productRef?:string}): Promise<{role_segments:Array<{role_index:number;text:string}>;kb_used?:boolean;sources?:DhScriptSource[]}>`(POST /script/generate-multi)。
  - `listScriptTemplates()`(Task 1.2 已加则复用)。
- [ ] **Step 2: 模板下拉** —— GeneratePanel 加 `const tplQ = useQuery(['dh.templates'], ()=>digitalHuman.listScriptTemplates())`;多角色模式显示模板 `<select>`(value=templateId,默认 'free')。
- [ ] **Step 3: 多角色 AI 生成** —— 多角色模式的「AI 生成文案」改调 `generateMultiRoleScript({preset_id:pid, subject, template_id:templateId, productRef})`;拿到 `role_segments` → 填入 seqSegments/role_segments 状态(按 role_index 分组到各角色,顺序保留);sources → 存 scriptSources(复用 KbResultsView 展示)。single 模式仍走 dhGenerateScript。
- [ ] **Step 4: 对话脚本预览(时长)** —— 在多角色脚本区,用 `previewOrder`(已有)展示有序对话;每段后加 `fmtSec(estimateDurationMs(seg.text, 该角色 voice_rate))`;底部显示**每角色累计** + **总时长**(对 role_segments 累加,voice_rate 取对应 slot)。
- [ ] **Step 5: tsc**(app+api) + 提交 `feat(dh): GeneratePanel 模板选择+多角色AI生成+对话脚本时长预览`,push。

---

## 验证总览(py312 + tsc)
1. 后端:`pytest -q .../test_dh_avatarslot_persona.py test_script_templates.py test_multirole.py test_generate_multi_route.py test_script_router_plan.py`(+ 回归 test_digital_human_jobs/routes)。
2. 前端:`pnpm -r typecheck`;`vitest run estimateDuration`。
3. 集成冒烟(用户重建):预设给两角色填人设+各自库 → 生成页选模板「带货四段」→ 多角色 AI 生成 → 看交错对话+各段时长+来源 → coframe/sequential 生成出片。

## Self-Review
- **Spec 覆盖**:①数据模型=1.1/1.2;②生成架构=2.1(prompt+解析)/2.2(逐角色检索+路由);③时长=3.2,plan coframe role_segments=3.1;④前端=4.1(persona/KB)/4.2(模板+多角色生成+预览)。全覆盖。
- **类型一致**:`role_segments=[{role_index,text}]` 在 multirole(2.1)/路由(2.2)/plan(3.1)/前端(4.2)同形;`build_multirole_prompt(subject,roles,template_sections,*,paragraph_number)`/`parse_multirole_output(text,role_names)` 在 2.1 定义、2.2 调用一致;`ScriptTemplate{id,name,sections}` 在 1.2/2.2/4.2 一致;`generateMultiRoleScript` 返回与路由响应一致;`estimateDurationMs(text,voiceRate)` 3.2 定义、4.2 用。
- **无占位**:纯函数(multirole/estimateDuration/plan)给全码+测试;路由/前端给骨架+复用点(读现有照搬)。
- **风险**:多角色生成是真 LLM 调用(集成层),单测 mock invoke;输出解析容错已覆盖未知/无标签;coframe role_segments 渲染走既有 turntaking(jobs 不变)。
