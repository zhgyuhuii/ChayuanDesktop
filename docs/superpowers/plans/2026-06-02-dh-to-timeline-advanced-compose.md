# 数字人生成 → 高级合成(时间轴) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 数字人生成结果加「去编辑合成」→ 进 VG 时间轴,按模式建轨:single=视频+字幕;coframe=主轨(空)+每角色 PIP 轨+合并字幕;sequential=主轨(空)+每角色全屏轨+合并字幕。

**Architecture:** jobs 记录各段元数据(segments)→ to-timeline 把各段注册成 material + 模式相关 build_timeline_for_mode 建轨 → 前端复用 VG 时间轴编辑器(多轨/PIP/字幕)。无 segments 退回现有单片逻辑。

**Tech Stack:** Python/FastAPI/pydantic/ffprobe(后端)、React/TS/@tanstack/react-query(前端)。

---

## 关键约束(每个实施 subagent 必读)
- root 所有:写文件/提交全走 `sudo`(`sudo python3 - <<'PY'...PY` / `sudo tee`)。
- py3.6 跑不了项目 pytest(future-annotations 连 py_compile 报错)。**写好可运行 pytest 测试,本地 `python3 -c "import ast;ast.parse(open(p).read())"` 验语法,注明待 py312**。前端有 toolchain 则 `npx tsc -p packages/<pkg>/tsconfig.json --noEmit`。
- 分支 main→origin/main;只 `sudo git add <精确路径>`(禁止 -A)。提交结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。完成 `sudo git push origin main`。
- 真复用硬规则:VG `Timeline/TimelineTrack/TimelineClip/SrtCue`、`materials_store.create_material`、`build_cues_from_script`、VG 编辑器多轨/PIP 渲染、`_resolve_positions`、DhProgressCard 现有导航。

## 已核实现状
- VG 模型 `.../video_generation/schemas.py`:`Timeline{version,duration_ms,tracks}`、`TimelineTrack{id,kind(video/audio/subtitle),clips,cues,removable,label}`、`TimelineClip{id,source(Dict[str,str] material_id|path|url),track_start_ms,in_ms,out_ms,transition,volume,x,y,scale,z}`、`SrtCue{index,start_ms,end_ms,text}`。前端 `packages/api/src/videoGeneration.ts` `Vg*`。
- `.../digital_human/timeline_bridge.py`:`build_cues_from_script(script,total_ms)`、`build_timeline(video_path,cues,total_ms)`(单视频轨+字幕轨)。
- `.../digital_human/jobs.py`:`_gen_slot_clips`(行180-217)→`(clips=<td>/seg{i}.mp4, unit_roles)`;coframe(268-296)/sequential 分支;`td=task_dir(f"dh-{tid}")` 不清理;single 路径(298-331)。`_synth_to_wav` 产 seg wav,engine.generate 产 seg mp4。
- `.../digital_human/schemas.py` `DhTaskStatus`(有 script 字段)。
- `.../api_server/digital_human_routes.py` `POST /tasks/{tid}/to-timeline`(281-316):`materials_store.create_material(...)` + `_probe_audio_duration_ms` + build_cues_from_script + build_timeline,返 `{material,timeline}`。
- `.../digital_human/compose_multi.py`:`render_coframe_turntaking`、`render_sequential`、`_resolve_positions(positions,layout,n,w,h)`。
- `.../video_generation/store/materials.py` `create_material(*,source,name,path,owner_id=None,mime="",size=0,duration_ms=0,width=0,height=0,thumbnail_path=None,tags=None)→dict`。
- 前端 `DhProgressCard.tsx`:`digitalHuman.taskToTimeline(taskId)`→`useVgComposer.getState().patchParams({timeline})`→导航 `/video-generation/timeline`;现按钮「在时间轴编辑」。
- 前端 `packages/api/src/videoGeneration.ts` `taskToTimeline`(返 `{material,timeline}`);`VgTimelineEditorPage`(`params.timeline` 优先,多轨/PIP/字幕/加删轨已支持);`MediaPoolPanel`(useQuery 拉 materials)。

---

# P1 — jobs 记录 segments 元数据

### Task 1.1: DhTaskStatus 加 segments 字段
**Files:** Modify `.../digital_human/schemas.py`;Test `chayuan-server/libs/chayuan-server/tests/unit_tests/test_dh_task_segments_field.py`

- [ ] **Step 1: 写失败测试**:
```python
def test_task_status_segments_default():
    from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
    s = DhTaskStatus(task_id="t", state="complete")
    assert s.segments == []
def test_task_status_segments_roundtrip():
    from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
    s = DhTaskStatus(task_id="t", state="complete", segments=[{"role_index":0,"path":"/x/seg0.mp4","text":"hi","duration_ms":1200}])
    assert s.segments[0]["role_index"] == 0 and s.segments[0]["duration_ms"] == 1200
```
- [ ] **Step 2: 运行确认失败(待 py312)**。
- [ ] **Step 3: 实现** —— `DhTaskStatus` 加 `segments: List[Dict[str, Any]] = Field(default_factory=list)`(确认 List/Dict/Any/Field 已 import;读现有 DhTaskStatus 字段定义照风格加)。
- [ ] **Step 4: 运行通过(待 py312)**;`ast.parse` 验。
- [ ] **Step 5: 提交** `feat(dh): DhTaskStatus 加 segments 字段(多轨时间轴用)`。

### Task 1.2: jobs 收集 segments 写入完成态
**Files:** Modify `.../digital_human/jobs.py`

- [ ] **Step 1: 读** `_gen_slot_clips`(返回 clips/unit_roles)、coframe/sequential 分支、units 在哪(plan 产物,unit 有 text/role_index)、完成态怎么写(`_STATUS`/tasks.json 持久化处)、是否有 `_probe_duration` 工具(否则用 `_probe_audio_duration_ms` 或加个 ffprobe 时长)。
- [ ] **Step 2: 让 `_gen_slot_clips` 也返回每段元数据** —— 改成返回 `(clips, unit_roles, seg_meta)`,其中 `seg_meta=[{"role_index": u.role_index, "path": clips[i], "text": units[i].text, "duration_ms": <ffprobe clips[i]>}]`(units 是 plan 产物,SynthUnit 有 text/role_index;duration 用现有 probe helper 对 seg mp4)。**只 coframe/sequential 填**;single 路径不产 seg_meta(返回空或不变)。改所有调用 `_gen_slot_clips` 的地方接收新返回值。
- [ ] **Step 3: 写入完成态** —— pipeline 在写 `result_path`/script 的完成态处,一并 `status.segments = seg_meta`(single 为 [])。确保持久化到 tasks.json。
- [ ] **Step 4:** `ast.parse` 验;提交 `feat(dh): jobs 收集各段 segments(role/path/text/duration)写入完成态`,push。

---

# P2 — timeline_bridge 模式相关建轨(纯函数核心)

### Task 2.1: build_timeline_for_mode + 合并 cue
**Files:** Modify `.../digital_human/timeline_bridge.py`;Test `chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_bridge_modes.py`

- [ ] **Step 1: 读** timeline_bridge 现有 build_timeline/build_cues_from_script + 从 video_generation.schemas import Timeline/TimelineTrack/TimelineClip/SrtCue 的方式;compose_multi `_resolve_positions` 签名。
- [ ] **Step 2: 写失败测试**(纯函数,喂构造 segments,无 IO):
```python
from chayuan.server.video_generation.digital_human.timeline_bridge import build_timeline_for_mode

class _Slot:
    def __init__(self, name, x=0.0, y=0.0, scale=1.0): self.name=name; self.x=x; self.y=y; self.scale=scale; self.ref="r"
def _segs():
    return [
        {"role_index":0,"material_id":"m0","path":"/a/s0.mp4","text":"甲一","duration_ms":1000},
        {"role_index":1,"material_id":"m1","path":"/a/s1.mp4","text":"乙一","duration_ms":2000},
        {"role_index":0,"material_id":"m2","path":"/a/s2.mp4","text":"甲二","duration_ms":1500},
    ]

def test_single():
    tl = build_timeline_for_mode("single", result_material_id="rm", result_path="/a/r.mp4", segments=[], slots=[_Slot("A")], total_ms=5000, script="你好。再见。")
    kinds = [t.kind for t in tl.tracks]
    assert "video" in kinds and "subtitle" in kinds
    vt = [t for t in tl.tracks if t.kind=="video"][0]
    assert len(vt.clips)==1

def test_coframe_layout_and_offsets():
    tl = build_timeline_for_mode("coframe", result_material_id="rm", result_path="/a/r.mp4", segments=_segs(), slots=[_Slot("A",0.1,0.1,0.5),_Slot("B",0.6,0.1,0.5)], total_ms=4500, script="")
    vids = [t for t in tl.tracks if t.kind=="video"]
    main = [t for t in vids if t.id=="dh-main"][0]
    assert main.clips == []                      # 主轨空
    roleA = [t for t in vids if t.id=="dh-role-0"][0]
    roleB = [t for t in vids if t.id=="dh-role-1"][0]
    assert [c.track_start_ms for c in roleA.clips] == [0, 3000]   # 甲一@0, 甲二@(1000+2000)
    assert [c.track_start_ms for c in roleB.clips] == [1000]      # 乙一@1000
    assert roleA.clips[0].scale == 0.5 and roleA.clips[0].x == 0.1  # PIP 定位
    sub = [t for t in tl.tracks if t.kind=="subtitle"][0]
    assert [c.text for c in sub.cues] == ["A: 甲一","B: 乙一","A: 甲二"]
    assert [(c.start_ms,c.end_ms) for c in sub.cues] == [(0,1000),(1000,3000),(3000,4500)]

def test_sequential_fullscreen():
    tl = build_timeline_for_mode("sequential", result_material_id="rm", result_path="/a/r.mp4", segments=_segs(), slots=[_Slot("A"),_Slot("B")], total_ms=4500, script="")
    roleA = [t for t in tl.tracks if t.id=="dh-role-0"][0]
    assert roleA.clips[0].scale == 1.0 and roleA.clips[0].x == 0.0   # 全屏

def test_no_segments_falls_back_single():
    tl = build_timeline_for_mode("coframe", result_material_id="rm", result_path="/a/r.mp4", segments=[], slots=[_Slot("A"),_Slot("B")], total_ms=3000, script="你好。")
    vids = [t for t in tl.tracks if t.kind=="video"]
    assert len(vids)==1 and len(vids[0].clips)==1   # 退回单片
```
- [ ] **Step 3: 运行确认失败(待 py312)**。
- [ ] **Step 4: 实现 `build_timeline_for_mode`**:
```python
def build_timeline_for_mode(mode, *, result_material_id, result_path, segments, slots, total_ms, script):
    tracks = []
    # 无 segments(single/旧任务/seg 缺) → 退回单片(成片视频轨+脚本字幕)
    if mode == "single" or not segments:
        tracks.append(TimelineTrack(id="dh-video", kind="video", removable=False, label="数字人",
            clips=[TimelineClip(id="dh-video-0", source={"material_id": result_material_id, "path": result_path},
                                track_start_ms=0, in_ms=0, out_ms=total_ms)]))
        tracks.append(TimelineTrack(id="dh-subtitle", kind="subtitle", removable=True, label="字幕",
            cues=build_cues_from_script(script, total_ms)))
        return Timeline(version=1, duration_ms=total_ms, tracks=tracks)

    n = len(slots or [])
    # coframe 取位置;sequential 全屏
    positions = _resolve_positions(None, getattr(slots, "layout", None) or "side", n, 1280, 720) if mode == "coframe" else None
    # 主轨空
    tracks.append(TimelineTrack(id="dh-main", kind="video", removable=False, label="主轨(背景)", clips=[]))
    # 累计偏移 + 分角色 clips + 合并 cue
    cum = 0
    role_clips = {}     # role_index -> [TimelineClip]
    cues = []
    for k, seg in enumerate(segments):
        ri = int(seg.get("role_index", 0)); dur = int(seg.get("duration_ms", 0) or 0)
        clip_kwargs = dict(id=f"dh-seg-{k}", source={"material_id": seg.get("material_id",""), "path": seg.get("path","")},
                           track_start_ms=cum, in_ms=0, out_ms=dur)
        if mode == "coframe":
            sl = slots[ri] if 0 <= ri < n else None
            x = float(getattr(sl, "x", 0.0) or 0.0); y = float(getattr(sl, "y", 0.0) or 0.0); sc = float(getattr(sl, "scale", 1.0) or 1.0)
            clip_kwargs.update(x=x, y=y, scale=sc, z=ri + 1)
        else:  # sequential 全屏
            clip_kwargs.update(x=0.0, y=0.0, scale=1.0, z=ri + 1)
        role_clips.setdefault(ri, []).append(TimelineClip(**clip_kwargs))
        nm = (getattr(slots[ri], "name", "") if 0 <= ri < n else "") or ""
        cues.append(SrtCue(index=k + 1, start_ms=cum, end_ms=cum + dur, text=(f"{nm}: " if nm else "") + (seg.get("text") or "")))
        cum += dur
    for ri in range(n):
        nm = (getattr(slots[ri], "name", "") or "") or f"角色{ri+1}"
        tracks.append(TimelineTrack(id=f"dh-role-{ri}", kind="video", removable=True, label=nm, clips=role_clips.get(ri, [])))
    tracks.append(TimelineTrack(id="dh-subtitle", kind="subtitle", removable=True, label="字幕", cues=cues))
    return Timeline(version=1, duration_ms=total_ms or cum, tracks=tracks)
```
(`_resolve_positions` 返回像素位置——若用它,coframe 的 x/y 应是归一(0-1)给 PIP;**优先直接用 slot.x/y/scale(归一)**,如上;`_resolve_positions` 仅作 slot 无位置时的兜底,实现者按其真实返回适配,保证 x/y 是归一 0-1。import Timeline/TimelineTrack/TimelineClip/SrtCue from video_generation.schemas。)
- [ ] **Step 5: 运行测试通过(待 py312)**;`ast.parse` 验。
- [ ] **Step 6: 提交** `feat(dh): timeline_bridge build_timeline_for_mode(模式相关多轨+合并cue+缺segments退单片)`。

---

# P3 — to-timeline 路由注册各段 material

### Task 3.1: 路由建各段 material + 调 build_timeline_for_mode
**Files:** Modify `.../api_server/digital_human_routes.py`

- [ ] **Step 1: 读** `/tasks/{tid}/to-timeline`(281-316)现状:怎么取 task status(含 result_path/script,现加了 segments)、怎么 create_material、怎么算 dur_ms、owner 怎么来、返回结构。读 task 怎么拿 compose_mode/slots(preset.avatars——经 preset_id 取 preset?status 里有没有 mode/slots?**确认 to-timeline 能拿到 mode + slots**;拿不到则从 task 关联的 preset 取)。
- [ ] **Step 2: 实现**:
  - 仍 `create_material(成片)` → `result_material_id`(保留)。
  - 取 `segments = status.segments or []`;对每段 `seg`:`m = create_material(source="digital_human_role", name=os.path.basename(seg["path"]), path=seg["path"], owner_id=owner, mime="video/mp4", size=os.path.getsize(seg["path"]), duration_ms=seg["duration_ms"], tags=[f"dh_task_{tid}", f"role_{seg['role_index']}"])`;`seg2 = {**seg, "material_id": m["material_id"]}`。**任一段 create/读盘失败 → try/except 跳过该段或整体置 segments=[](退单片),日志告警**。
  - `mode = <task/preset 的 compose_mode>`;`slots = <preset.avatars>`(读 preset)。
  - `tl = build_timeline_for_mode(mode, result_material_id=result_material_id, result_path=status.result_path, segments=segments_with_mid, slots=slots, total_ms=dur_ms, script=status.script)`。
  - 返回 `{"materials": [成片 material, *各段 material], "timeline": tl}`。
- [ ] **Step 3:** `ast.parse` 验;提交 `feat(dh): to-timeline 注册各段material+模式建轨,返 materials[]`,push。

---

# P4 — 前端「去编辑合成」+ 消费

### Task 4.1: taskToTimeline 客户端返回类型 + 按钮 + 刷新素材库
**Files:** Modify `chayuan-client/packages/api/src/videoGeneration.ts`(或 digitalHuman.ts,看 taskToTimeline 定义处)、`chayuan-client/packages/app/src/features/digital-human/DhProgressCard.tsx`

- [ ] **Step 1: 客户端类型** —— `taskToTimeline` 返回类型从 `{material, timeline}` 改为 `{materials: VgMaterial[]; timeline: VgTimeline}`(读现有 VgMaterial/VgTimeline 类型名;保留 timeline 字段)。
- [ ] **Step 2: DhProgressCard** —— 按钮文案「在时间轴编辑」→「去编辑合成」;onClick:`const r = await digitalHuman.taskToTimeline(taskId); useVgComposer.getState().patchParams({ timeline: r.timeline }); queryClient.invalidateQueries({ queryKey: <VG materials query key> }); navigate('/video-generation/timeline')`。读 MediaPoolPanel 用的 materials useQuery key,invalidate 它,让编辑器把 clip 的 material_id 解析到刚注册的各段素材。
- [ ] **Step 3:** 有 toolchain 跑 tsc;提交 `feat(dh): 去编辑合成按钮+taskToTimeline 返 materials[]+刷新素材库`,push。
- [ ] **Step 4: 确认编辑器解析** —— 读 VgTimelineEditorPage / 渲染 clip 处,确认 clip `source.material_id` 能经素材库解析到文件;若只认 path,build_timeline 已双写 path 兜底(P2 已含)。无需大改即记录确认结论。

---

## 验证总览(交用户 py312 + 重建)
1. 后端单测:`PYTHONPATH=chayuan-server/libs/chayuan-server pytest -q .../tests/unit_tests/test_timeline_bridge_modes.py test_dh_task_segments_field.py`。
2. 前端:`pnpm -r typecheck`。
3. 重启 sidecar + 重建 desktop,冒烟:single→去编辑合成→视频+字幕轨;coframe→主轨空+每角色 PIP 轨+合并字幕;sequential→每角色轨(全屏)+字幕;编辑器调位置/删轨/渲染出片;旧任务(无 segments)→退回单片不崩。

## Self-Review
- **Spec 覆盖**:①产物导出=1.1/1.2;②模式建轨=2.1;③前端=4.1;④兜底=2.1(无segments退单片)+3.1(seg失败退单片)。全覆盖。
- **类型一致**:`segments=[{role_index,path,text,duration_ms(,material_id)}]` 在 schemas(1.1)/jobs(1.2)/build_timeline_for_mode(2.1)/route(3.1)同形;`build_timeline_for_mode(mode,*,result_material_id,result_path,segments,slots,total_ms,script)` 在 2.1 定义、3.1 调用一致;`taskToTimeline→{materials,timeline}` 在 3.1 后端、4.1 前端一致;TimelineTrack/TimelineClip/SrtCue 字段用 VG schemas 真实名。
- **无占位**:核心纯函数 build_timeline_for_mode 给全码+测试;jobs/route 给骨架(需读真实 status/preset 拿 mode/slots——已标注必读)。
- **风险**:to-timeline 能否拿到 mode+slots(可能需经 preset_id 取 preset)——3.1 首步必读确认;`_resolve_positions` 返回是像素还是归一——2.1 优先用 slot.x/y/scale 归一,positions 仅兜底;clip source 双写保证 material_id 解析失败可回退 path。
