# 数字人模型纠正 R1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]`。

**Goal:** 把台词从预设移到生成端;预设=身份(每角色 昵称/音色/语速/音量/语言),生成端给台词(single/coframe 一套、sequential 每角色)。

**Architecture:** 后端 schemas/store/route/jobs 数据层纠正(向后兼容,新字段默认值);前端 PresetEditor 去台词、改"一行一角色"含昵称/语速/音量/语言,GeneratePanel 承载台词(single/coframe 一框、sequential 每角色行)。

**Tech Stack:** FastAPI/Pydantic v2/pytest;React/TS。spec: docs/superpowers/specs/2026-06-01-dh-identity-vs-generation-redesign.md

> 本仓约定:root 所有→`sudo` 改文件 + `sudo git`;只 stage 改的文件(勿 -A);分支 main;commit 末 Co-Authored-By。py 语法自检:`grep -v 'from __future__ import annotations' <f> > /tmp/x.py && python3 -m py_compile /tmp/x.py`(沙箱 py3.6,带 walrus/future 的整文件编不过属正常;pytest/typecheck 用户 py312 跑)。R1 不做:CanvasStage 拖拽/昵称标签渲染/并发重构/同框按句轮流(留 R2-R4)。

## 文件结构
- `digital_human/schemas.py` — AvatarSlot 加 name/voice_rate/voice_volume/language/x/y/scale;DhGenerateRequest 加 script/role_scripts。
- `digital_human/store.py` — create_preset 透传(avatars 里随 AvatarSlot 带,无需新参数)。
- `api_server/digital_human_routes.py` — generate 路由透传 script/role_scripts。
- `digital_human/jobs.py` — submit/_PENDING/_run_pipeline/_gen_slot_clips 用 script/role_scripts(不读 preset lines)。
- `packages/api/src/digitalHuman.ts` — AvatarSlot 类型加字段;dhGenerate 传 script/role_scripts。
- `features/digital-human/PresetEditor.tsx` — 去台词,角色行加 昵称/语言/语速/音量。
- `features/digital-human/GeneratePanel.tsx` — 台词区:single/coframe 一框、sequential 每角色行。
- 测试:`tests/unit_tests/test_digital_human_store.py`、`test_digital_human_jobs.py`。

---

## Task 1: schemas — Role 字段 + 生成请求台词字段

**Files:** Modify `.../digital_human/schemas.py`;Test `.../tests/unit_tests/test_digital_human_store.py`

- [ ] **Step 1: 写失败测试**(追加)
```python
from chayuan.server.video_generation.digital_human.schemas import (
    AvatarSlot as _Slot, DhGenerateRequest as _Gen,
)
def test_role_fields_defaults_and_roundtrip():
    s = _Slot(ref="user:a.png", kind="image", name="小李",
              voice_provider="sherpa", voice_name="vz",
              voice_rate=1.1, voice_volume=0.9, language="zh", x=0.1, y=0.2, scale=0.5)
    d = s.model_dump()
    assert d["name"] == "小李" and d["voice_rate"] == 1.1 and d["x"] == 0.1
    s2 = _Slot(ref="user:b.png")            # 全默认,向后兼容
    assert s2.name == "" and s2.voice_rate == 1.0 and s2.voice_volume == 1.0 and s2.scale == 1.0
def test_generate_request_scripts():
    g = _Gen(preset_id="p", text="x", script="一套台词", role_scripts=["甲词", "乙词"])
    assert g.script == "一套台词" and g.role_scripts == ["甲词", "乙词"]
    g2 = _Gen(preset_id="p", text="x")      # 向后兼容
    assert g2.script is None and g2.role_scripts is None
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -q -k "role_fields or generate_request_scripts"`
Expected: FAIL(字段不存在)
- [ ] **Step 3: 改 schemas.py**
AvatarSlot 在 lines 后追加:
```python
    voice_provider: str = ""
    voice_name: str = ""
    voice_rate: float = 1.0
    voice_volume: float = 1.0
    language: str = ""
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
```
(注:voice_provider/voice_name 若已存在则不重复加;lines 字段保留但不再写。)
DhGenerateRequest 在 engine 后追加:
```python
    script: Optional[str] = None          # single/coframe 一套台词
    role_scripts: Optional[List[str]] = None  # sequential 每角色台词
```
确保顶部 `from typing import List, Literal, Optional` 含 List。
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
sudo git commit -m "feat(dh): R1 Role 加 name/语速/音量/语言/位置 + 生成请求 script/role_scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 2: jobs — 台词源改为生成请求(不读预设 lines)

**Files:** Modify `.../digital_human/jobs.py`;Test `.../tests/unit_tests/test_digital_human_jobs.py`

- [ ] **Step 1: 写失败测试**(追加;复用文件内已有 fake 模式)
```python
def test_sequential_uses_role_scripts(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    seen = []
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap: (seen.append((text, provider, name)), open(ap,"wb").write(b"w"), ap)[2])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    monkeypatch.setattr(cm, "render_sequential", lambda clips, **k: (open(k["out_path"],"wb").write(b"s"), k["out_path"])[1])
    from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset, AvatarSlot
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref":"user:a","kind":"video","voice_provider":"sherpa","voice_name":"v1"},
                 {"ref":"user:b","kind":"video","voice_provider":"piper","voice_name":"v2"}],
        compose_mode="sequential").id
    import uuid as _u
    tid = _u.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width":720, "height":1280,
                             "role_scripts": ["甲的台词", "乙的台词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert ("甲的台词","sherpa","v1") in seen and ("乙的台词","piper","v2") in seen
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -q -k sequential_uses_role_scripts`
Expected: FAIL(当前用 slot.lines/global_text,role_scripts 未生效)
- [ ] **Step 3: 改 jobs**
`_gen_slot_clips` 签名加 `role_scripts=None`,段文本取值改为:
```python
        rs = role_scripts or []
        seg_text = (rs[i] if i < len(rs) and (rs[i] or "").strip() else global_text)
```
(删去原 `seg_text = slot.lines or global_text` 对 lines 的依赖。)
`_run_pipeline` 调 `_gen_slot_clips(...)` 处加 `role_scripts=args.get("role_scripts")`;
`submit(...)` 形参加 `role_scripts=None`,`_PENDING[tid]` 加 `"role_scripts": role_scripts`。
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
sudo git commit -m "feat(dh): R1 生成台词源改 role_scripts/script,不再读预设 lines

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 3: 路由透传 script/role_scripts

**Files:** Modify `.../api_server/digital_human_routes.py`;Test `.../tests/unit_tests/test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(用文件内 `_client` 助手 + monkeypatch dh_jobs.submit 记录)
```python
def test_generate_passes_scripts(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: (seen.update(k), "tid")[1])
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id":"p","text":"x","script":"一套","role_scripts":["甲","乙"]})
    assert r.status_code == 200
    assert seen.get("script") == "一套" and seen.get("role_scripts") == ["甲","乙"]
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -q -k generate_passes_scripts`
Expected: FAIL(submit 未收到 script/role_scripts)
- [ ] **Step 3: 改 generate 路由**
`dh_jobs.submit(...)` 调用加:
```python
                         script=body.script, role_scripts=body.role_scripts,
```
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py
sudo git commit -m "feat(dh): R1 generate 路由透传 script/role_scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 4: 前端类型 + dhGenerate 传台词

**Files:** Modify `packages/api/src/digitalHuman.ts`

- [ ] **Step 1: AvatarSlot 类型加字段**(在 lines? 后)
```typescript
  voice_provider?: DhVoiceProvider;
  voice_name?: string;
  voice_rate?: number;
  voice_volume?: number;
  language?: string;
  x?: number; y?: number; scale?: number;
```
(已有的 voice_provider/voice_name 勿重复。)
- [ ] **Step 2: dhGenerate 加 script/role_scripts**
opts 类型加 `script?: string; role_scripts?: string[]`,body 内透传:
```typescript
      script: opts?.script,
      role_scripts: opts?.role_scripts,
```
- [ ] **Step 3: 类型检查** Run: `cd chayuan-client && npm run typecheck` Expected: 通过
- [ ] **Step 4: 提交**
```bash
sudo git add chayuan-client/packages/api/src/digitalHuman.ts
sudo git commit -m "feat(dh): R1 前端类型 AvatarSlot 角色字段 + dhGenerate 台词参数

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 5: PresetEditor 去台词 + 角色行(昵称/语言/语速/音量)

**Files:** Modify `features/digital-human/PresetEditor.tsx`

- [ ] **Step 1: 删除每槽台词输入**
移除多形象槽行里的「台词 input」与 `setSlotLines` 用法(lines 不再在预设编辑)。
- [ ] **Step 2: 角色行字段**
每个已选 slot 行内除现有 VoicePicker,加:
```tsx
<input value={sl.name ?? ''} onChange={(e)=>setSlotField(sl.ref,{name:e.target.value})}
  placeholder="昵称(如 小李)" className="h-7 rounded-md border px-2 text-[11px]" />
<input value={sl.language ?? ''} onChange={(e)=>setSlotField(sl.ref,{language:e.target.value})}
  placeholder="语言(zh/en…)" className="h-7 rounded-md border px-2 text-[11px]" />
<label className="text-[10px]">语速
  <input type="range" min={0.5} max={1.5} step={0.05} value={sl.voice_rate ?? 1}
    onChange={(e)=>setSlotField(sl.ref,{voice_rate:Number(e.target.value)})} /></label>
<label className="text-[10px]">音量
  <input type="range" min={0} max={1.5} step={0.05} value={sl.voice_volume ?? 1}
    onChange={(e)=>setSlotField(sl.ref,{voice_volume:Number(e.target.value)})} /></label>
```
加通用 setter:
```tsx
const setSlotField = (ref:string, patch:Partial<AvatarSlot>) =>
  setSlots(prev => prev.map(x => x.ref===ref ? {...x, ...patch} : x));
```
单形象(非多形象模式)亦展示 name/语言/语速/音量(对 slots[0] 或预设级 voice 行)。
- [ ] **Step 3: 类型检查 + 手动验证** Run: `npm run typecheck`;`pnpm dev` 看:编辑数字人每角色一行有 昵称/语言/音色/语速/音量,**无台词框**。
- [ ] **Step 4: 提交**
```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx
sudo git commit -m "feat(dh): R1 编辑器去台词,角色行加昵称/语言/语速/音量

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 6: GeneratePanel 台词区(single/coframe 一框、sequential 每角色行)

**Files:** Modify `features/digital-human/GeneratePanel.tsx`

- [ ] **Step 1: 按所选预设 type 渲染台词输入**
取 `const preset = presets.find(p=>p.id===pid)`,`const mode = preset?.compose_mode ?? 'single'`,`const roles = preset?.avatars ?? []`。
single/coframe:保留现 `text` 一框(作 script)。sequential:每角色一行:
```tsx
{mode === 'sequential' && roles.map((r, i) => (
  <input key={r.ref} value={roleScripts[i] ?? ''}
    onChange={(e)=>setRoleScripts(s=>{const n=[...s]; n[i]=e.target.value; return n;})}
    placeholder={`${r.label || r.name || ('角色'+(i+1))} 的台词`}
    className="h-8 w-full rounded-md border px-2 text-sm" />
))}
```
state:`const [roleScripts, setRoleScripts] = React.useState<string[]>([]);`
- [ ] **Step 2: gen() 传台词**
```tsx
const opts = { engine, ...(productRef?{product_image:productRef,template,matte}:{}),
  ...(mode==='sequential' ? { role_scripts: roleScripts } : { script: text }) };
const r = await digitalHuman.generate(pid, text, opts);
```
(text 仍传作向后兼容/single 兜底。)
- [ ] **Step 3: 类型检查 + 手动验证** Run: `npm run typecheck`;`pnpm dev`:选 sequential 预设→出现每角色一行台词;single/coframe→一个文案框。
- [ ] **Step 4: 提交**
```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx
sudo git commit -m "feat(dh): R1 生成台词区按 type — single/coframe 一框、sequential 每角色行

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## 自检结论
- **Spec 覆盖**:R1 覆盖 spec §1 模型(台词移生成端)、§2 迁移(Role 字段/去 lines)、§4 R1。CanvasStage 拖拽/昵称标签渲染/并发/同框轮流=R2-R4(spec 已列)。
- **占位**:无 TBD;每 code step 给确切代码/命令/预期。
- **类型一致**:AvatarSlot 新字段(name/voice_rate/voice_volume/language/x/y/scale)后端 schemas 与前端 TS 同名;script/role_scripts 在 schemas/route/jobs/前端四处一致。
- **风险**:voice_rate/voice_volume 本期只存+透传到 `_synth_to_wav` 形参,真正影响合成速度/音量留 R3(AudioPipeline.synthesize 暂不收 rate/volume);Task5 `setSlotField` 与 Task4 类型字段名需一致(voice_rate/voice_volume/name/language)。
