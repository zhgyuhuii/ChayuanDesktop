# 数字人可视化位置 R2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(沙箱约束:root 所有→sudo 编辑/提交;py3.6 只能 py_compile;前端无 toolchain 跑不了 typecheck,careful reading 验证)。步骤用 `- [ ]`。

**Goal:** 多角色在画面中的位置可【在线拖拽可视化设置】(归一 x/y/scale),编辑器与生成预览共用同一 CanvasStage,合成用自由位置。

**Architecture:** 后端 compose_multi 支持 positions(归一→像素)+jobs coframe 传每角色位置;前端新增可复用 CanvasStage(拖拽)接入 PresetEditor(可编辑)与 DhStudio 预览(只读)。归一坐标与画幅解耦。

**Tech Stack:** Python(moviepy/pytest)/React-TS。spec: docs/superpowers/specs/2026-06-01-dh-identity-vs-generation-redesign.md(R2)。

> 本仓:sudo 改文件+sudo git;只 stage 改的文件(勿 -A);分支 main;不 push(控制器 push)。py 语法自检:`grep -v 'from __future__ import annotations' <f>>/tmp/c.py && python3 -m py_compile /tmp/c.py`。R2 不做:昵称标签渲染/字幕/同框按句轮流(R3/R4)。

## 文件结构
- `digital_human/compose_multi.py` — 加 `_resolve_positions`(归一→像素,纯函数)+ render_coframe 接受 positions。
- `digital_human/jobs.py` — coframe 分支传 positions=[(slot.x,slot.y,slot.scale)…]。
- `features/digital-human/CanvasStage.tsx`(新) — 可复用拖拽舞台。
- `features/digital-human/PresetEditor.tsx` — 多形象时嵌 CanvasStage(可拖)。
- `features/digital-human/DhStudio.tsx` — 左预览改用 CanvasStage(readOnly)。
- 测试:`tests/unit_tests/test_digital_human_compose_position.py`(新)。

---

## Task 1: compose_multi 自由位置(归一→像素,可回退 layout)

**Files:** Modify `.../digital_human/compose_multi.py`;Create `.../tests/unit_tests/test_digital_human_compose_position.py`

- [ ] **Step 1: 写失败测试**(新文件)
```python
from chayuan.server.video_generation.digital_human.compose_multi import _resolve_positions

def test_resolve_positions_normalized():
    # 2 角色,归一 (x,y,scale) → 像素 (x*W, y*H, scale*W)
    pos = [(0.0, 0.0, 0.5), (0.5, 0.25, 0.4)]
    out = _resolve_positions(pos, "side", 2, 1000, 2000)
    assert out[0] == (0, 0, 500)
    assert out[1] == (500, 500, 400)

def test_resolve_positions_fallback_layout():
    # positions=None → 回退 layout(side 横向均分):各占 width/n
    out = _resolve_positions(None, "side", 2, 1000, 2000)
    assert len(out) == 2 and out[0][2] == 500  # side: 每格 width/2
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose_position.py -q`
Expected: FAIL(`_resolve_positions` 不存在)
- [ ] **Step 3: 改 compose_multi.py**
在 `_coframe_positions` 之后加纯函数:
```python
def _resolve_positions(positions, layout, n, width, height):
    """每角色位置 → 像素 (x_px, y_px, target_w_px)。
    positions: 归一 (x,y,scale) 列表(0-1);非空→自由位置,空/None→回退 _coframe_positions(layout)。"""
    if positions and len(positions) >= n:
        out = []
        for x, y, scale in positions[:n]:
            tw = max(1, int(float(scale) * width))
            out.append((int(float(x) * width), int(float(y) * height), tw))
        return out
    return _coframe_positions(layout, n, width, height)
```
然后改 `render_coframe` 签名与定位逻辑:把 `def render_coframe(clip_paths, *, layout, out_path, width, height)` 改为 `def render_coframe(clip_paths, *, layout="side", out_path, width, height, positions=None)`;函数体内原来调用 `_coframe_positions(layout, len(raw), width, height)` 的那行改为 `_resolve_positions(positions, layout, len(raw), width, height)`。(READ 该函数确认 pos 变量名/调用点,精确替换。)
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/compose_multi.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose_position.py
sudo git commit -m "feat(dh): R2 compose_multi 支持每角色自由位置(归一→像素,回退 layout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 2: jobs coframe 传每角色位置

**Files:** Modify `.../digital_human/jobs.py`;Test `.../tests/unit_tests/test_digital_human_jobs.py`

- [ ] **Step 1: 写失败测试**(追加)
```python
def test_coframe_passes_positions(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap: (open(ap, "wb").write(b"w"), ap)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    seen = {}
    monkeypatch.setattr(cm, "render_coframe",
        lambda clips, **k: (seen.update(k), open(k["out_path"], "wb").write(b"c"), k["out_path"])[2])
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref": "user:a", "kind": "video", "x": 0.1, "y": 0.2, "scale": 0.5},
                 {"ref": "user:b", "kind": "video", "x": 0.6, "y": 0.2, "scale": 0.5}],
        compose_mode="coframe").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width": 720, "height": 1280}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert seen.get("positions") == [(0.1, 0.2, 0.5), (0.6, 0.2, 0.5)]
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -q -k coframe_passes_positions`
Expected: FAIL(render_coframe 未收到 positions)
- [ ] **Step 3: 改 jobs coframe 分支**
READ `_run_pipeline` 的 coframe 分支(约 line 206)。在调用 `_cm.render_coframe(...)` 前用 slots 算 positions:
```python
                    positions = [(float(getattr(s, "x", 0.0) or 0.0),
                                  float(getattr(s, "y", 0.0) or 0.0),
                                  float(getattr(s, "scale", 1.0) or 1.0)) for s in slots]
```
并把 `_cm.render_coframe(clips, layout=getattr(preset, "layout", "side") or "side", out_path=out_path, width=args["width"], height=args["height"])` 加 `positions=positions` 实参。(`slots` 变量在该分支已存在=preset.avatars。)
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
sudo git commit -m "feat(dh): R2 jobs coframe 传每角色归一位置 positions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 3: CanvasStage 可复用拖拽组件(新)

**Files:** Create `.../features/digital-human/CanvasStage.tsx`

- [ ] **Step 1: 写组件**(完整代码;无后端往返,纯前端拖拽)
```tsx
import * as React from 'react';
import { digitalHuman, type AvatarSlot } from '@chayuan/api';

export interface CanvasStageProps {
  width: number;          // 画幅像素(仅定比例)
  height: number;
  roles: AvatarSlot[];    // 每角色 ref/kind/name/x/y/scale(归一)
  onChange?: (ref: string, pos: { x: number; y: number; scale: number }) => void;
  readOnly?: boolean;
}

/** 按画幅比例显示舞台,角色缩略图按归一 x/y/scale 摆放,可拖拽改位置(归一)。
 *  编辑器(可拖)与生成预览(readOnly)共用。 */
export const CanvasStage: React.FC<CanvasStageProps> = ({ width, height, roles, onChange, readOnly }) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ ref: string; dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, r: AvatarSlot) => {
    if (readOnly || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const curX = (r.x ?? 0) * box.width;
    const curY = (r.y ?? 0) * box.height;
    dragRef.current = { ref: r.ref, dx: e.clientX - box.left - curX, dy: e.clientY - box.top - curY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !boxRef.current || !onChange) return;
    const box = boxRef.current.getBoundingClientRect();
    const nx = Math.min(0.99, Math.max(0, (e.clientX - box.left - d.dx) / box.width));
    const ny = Math.min(0.99, Math.max(0, (e.clientY - box.top - d.dy) / box.height));
    const r = roles.find((x) => x.ref === d.ref);
    onChange(d.ref, { x: nx, y: ny, scale: r?.scale ?? 1 });
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div ref={boxRef}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      className="relative mx-auto overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: `${width} / ${height}`, height: '100%', maxWidth: '100%' }}>
      {roles.map((r) => (
        <div key={r.ref}
          onPointerDown={(e) => onPointerDown(e, r)}
          className={'absolute ' + (readOnly ? '' : 'cursor-move')}
          style={{ left: `${(r.x ?? 0) * 100}%`, top: `${(r.y ?? 0) * 100}%`, width: `${(r.scale ?? 1) * 100}%` }}>
          {r.kind === 'video'
            ? <video src={digitalHuman.avatarFileUrl(r.ref)} muted loop autoPlay playsInline className="w-full rounded" />
            : <img src={digitalHuman.avatarFileUrl(r.ref)} alt={r.name || r.ref} className="w-full rounded" />}
          {r.name ? <span className="absolute -bottom-4 left-0 rounded bg-black/60 px-1 text-[10px] text-white">{r.name}</span> : null}
        </div>
      ))}
    </div>
  );
};
```
(注:scale 调整本期用各角色行已有滑块/或后续加;CanvasStage 先做 x/y 拖拽 + 按 scale 显示宽度。昵称标签此处仅预览显示,成片标签是 R3。)
- [ ] **Step 2: 读校验** READ 组件:JSX 平衡、props 类型正确、无未用 import。(无法 typecheck,careful reading。)
- [ ] **Step 3: 提交**
```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/CanvasStage.tsx
sudo git commit -m "feat(dh): R2 新增可复用 CanvasStage(按画幅显示+拖拽改归一位置)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 4: 接入 PresetEditor(可拖) + DhStudio 预览(只读)

**Files:** Modify `.../features/digital-human/PresetEditor.tsx`、`.../DhStudio.tsx`

- [ ] **Step 1: PresetEditor 嵌 CanvasStage**
READ PresetEditor。import:`import { CanvasStage } from './CanvasStage';`。在多形象(isMulti && slots.length>0)区域(各角色配置块之上或之下)插入:
```tsx
      {isMulti && slots.length >= 1 && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">位置(拖拽角色到画面对应处)</label>
          <div className="h-48">
            <CanvasStage width={canvas.w} height={canvas.h} roles={slots}
              onChange={(ref, pos) => setSlotField(ref, pos)} />
          </div>
        </div>
      )}
```
(`canvas` state 与 `slots`/`setSlotField` 均 R1 已有;setSlotField 接受 Partial<AvatarSlot>,pos={x,y,scale} 合法。)
- [ ] **Step 2: DhStudio 预览改用 CanvasStage(只读)**
READ DhStudio。左预览现在用 `<img>/<video>` 显示 `preset.avatar_ref` 单图。改为:当 preset 有 avatars 时用 CanvasStage(readOnly)按位置显示;import CanvasStage。把预览盒内的单图渲染替换为:
```tsx
          {preset && (preset.avatars?.length ?? 0) > 0 ? (
            <CanvasStage width={w} height={h} roles={preset.avatars!} readOnly />
          ) : preset && preset.avatar_kind === 'image' ? (
            <img src={url} alt={preset.name} className="h-full w-full object-cover" />
          ) : preset ? (
            <video src={url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/40">右侧选择或到「我的数字人」新建一个数字人</div>
          )}
```
(保留原 w/h/url/modeLabel 变量;只替换条件渲染首分支。READ 现有 JSX 精确替换。)
- [ ] **Step 3: 读校验** READ 两文件:import 到位、JSX 平衡、props 名(width/height/roles/onChange/readOnly)与 Task3 一致。
- [ ] **Step 4: 提交**
```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx chayuan-client/packages/app/src/features/digital-human/DhStudio.tsx
sudo git commit -m "feat(dh): R2 编辑器嵌可拖 CanvasStage + 工作台预览按位置显示

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## 自检结论
- **Spec 覆盖**:R2 覆盖 spec §3 CanvasStage(编辑+预览共用)、§4 R2(拖拽位置+自由定位合成)。昵称标签【成片渲染】=R3(本期 CanvasStage 仅预览显示名字),字幕/同框轮流=R3/R4。
- **占位**:无 TBD;每 code step 给完整代码/命令/预期。
- **类型一致**:CanvasStage props(width/height/roles/onChange/readOnly)在 Task3 定义、Task4 两处调用一致;`_resolve_positions(positions, layout, n, width, height)` 与 jobs 传参一致;positions=归一 (x,y,scale) 列表全程一致。
- **风险**:多角色默认 x/y/scale=0/0/1 → 初始全叠左上满宽,需用户拖开(可后续加初始自动铺排,本期 YAGNI);scale 调整本期靠角色行滑块(R1 无 scale 滑块——若需在画布调 scale 留 R2.1/后续,本期 CanvasStage 先拖 x/y、按 scale 显示)。aspect-ratio + height:100% 在极端比例可能溢出,maxWidth 兜底。
