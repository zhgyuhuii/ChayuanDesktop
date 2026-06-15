# 时间轴片段属性面板 + 轨道音量重设计(第1期)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把时间轴轨道音量从内联横滑条改成「图标→竖向滑条弹层」,并加一个逐片段「属性」弹层(透明度仅 PIP、逐片段音量、数值化位置/缩放/层级)。

**Architecture:** 纯前端,后端已就绪(`TimelineClip.opacity` 与 PIP `with_opacity` 早有)。新增一个通用纯函数 `patchClip`(带 clamp)作为所有逐片段写入的单一入口,两个新组件 `VerticalSliderPopover`/`ClipPropertyPopover` 复用 `VgAspectPicker` 的「开/点外关/Esc」弹层范式,接到 `TimelineTracks` 轨道头与 `VgTimeline` 选中工具栏。

**Tech Stack:** React + TypeScript + Tailwind(CSS 变量主题)、lucide-react 图标、vitest(纯逻辑单测)。

**约定 — 本仓特殊事项(务必遵守):**
- 仓库 root 所有 + 大量 filemode 噪音。编辑前 `sudo chown admin:admin <file>`,改完 `sudo chown root:root <file>`;提交 `sudo git -c core.filemode=false add -- <精确文件>` 后 `sudo git commit`,**只 stage 本任务改的文件**。
- 每次 commit 先跑 `sudo /usr/bin/python3.11 scripts/bump-version.py` 并把 VERSION + 3 个 tauri.conf.json + server pyproject.toml 一并 stage(本仓约定:版本跟提交走)。
- typecheck:`cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit` 和 `… -p packages/app/tsconfig.json --noEmit`(无 pnpm,逐包跑)。
- vitest:`cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/vitest run <相对 client 根的路径>`。
- 组件任务无 render 测试(本仓 UI 不写 render 单测,只测纯逻辑)→ 用 typecheck + 手动核对清单验证。
- 全部完成后提醒用户**重建 desktop + 重启 sidecar**才能看到效果。

---

## File Structure

- `chayuan-client/packages/api/src/videoGeneration.ts` — `VgTimelineClip` 加 `opacity?` 字段(类型层)
- `chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts` — 新增 `patchClip` + `ClipPatch` 类型;`setClipMuted` 收敛为其薄封装
- `chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts` — `patchClip` 单测
- `chayuan-client/packages/app/src/features/video-generation/timeline/trackOps.ts` — `setClipTransform` 收敛到 `patchClip`(消除重复 clamp)
- `chayuan-client/packages/app/src/features/video-generation/timeline/LivePreviewCanvas.tsx` — PIP 图层应用 `opacity`
- `chayuan-client/packages/app/src/features/video-generation/timeline/VerticalSliderPopover.tsx` — 新建(通用竖向滑条弹层)
- `chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx` — 新建(片段属性面板)
- `chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx` — 轨道头音量改竖滑条
- `chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx` — 选中工具栏加「属性」按钮 + 接面板

---

## Task 1: 数据层 — `VgTimelineClip.opacity` 类型 + `patchClip` helper(TDD)

**Files:**
- Modify: `chayuan-client/packages/api/src/videoGeneration.ts`(`VgTimelineClip` 接口)
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts`
- Test: `chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`

- [ ] **Step 1: 给 `VgTimelineClip` 加 `opacity` 字段**

在 `videoGeneration.ts` 的 `VgTimelineClip` 接口里,`z?: number;` 之后加一行(后端 schema 早有该字段,前端类型补齐;Pydantic 收 0-1 浮点):

```ts
  opacity?: number;           // 画中画层不透明度 0-1(1=不透明);后端 schema 已有
```

- [ ] **Step 2: 写 `patchClip` 失败测试**

在 `timelineEdit.test.ts` 顶部 import 里加入 `patchClip`(与现有 import 合并),并在文件末尾追加:

```ts
import { patchClip } from './timelineEdit';

const tlPip = (): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [
    { id: 'v', kind: 'video', clips: [{ id: 'a', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 3000 }] },
    { id: 'v2', kind: 'video', removable: true, clips: [{ id: 'b', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 2000, x: 0.5, y: 0.1, scale: 0.4, z: 1 }] },
  ],
});

it('patchClip 设 opacity 并 clamp 到 [0,1]', () => {
  expect(patchClip(tlPip(), 'b', { opacity: 1.5 }).tracks[1]!.clips![0]!.opacity).toBe(1);
  expect(patchClip(tlPip(), 'b', { opacity: -0.3 }).tracks[1]!.clips![0]!.opacity).toBe(0);
});

it('patchClip clamp scale[0.05,1] / x,y[0,1] / z 取整', () => {
  const c = patchClip(tlPip(), 'b', { scale: 2, x: -0.2, y: 1.4, z: 2.7 }).tracks[1]!.clips![0]!;
  expect(c.scale).toBe(1);
  expect(c.x).toBe(0);
  expect(c.y).toBe(1);
  expect(c.z).toBe(3);
});

it('patchClip volume clamp 到 [0,1.5]', () => {
  expect(patchClip(tlPip(), 'a', { volume: 5 }).tracks[0]!.clips![0]!.volume).toBe(1.5);
});

it('patchClip 只改目标 clip,其它 clip/轨不动', () => {
  const r = patchClip(tlPip(), 'b', { muted: true });
  expect(r.tracks[0]!.clips![0]).toEqual(tlPip().tracks[0]!.clips![0]);
  expect(r.tracks[1]!.clips![0]!.muted).toBe(true);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`
Expected: FAIL —— `patchClip` 未导出(`No "patchClip" export` 或 4 条新用例报错)。

- [ ] **Step 4: 实现 `patchClip`**

在 `timelineEdit.ts` 顶部 `const MIN_DUR = 200;` 之后加 clamp 工具(若已有 clamp 则复用),并加 `patchClip` + `ClipPatch`(放在 `setTrackAudio` 附近):

```ts
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 逐片段属性写入的单一入口(带 clamp)。x/y∈[0,1]、scale∈[0.05,1]、opacity∈[0,1]、volume∈[0,1.5]、z 取整。 */
export type ClipPatch = Partial<Pick<VgTimelineClip, 'opacity' | 'volume' | 'muted' | 'x' | 'y' | 'scale' | 'z'>>;
export function patchClip(t: VgTimeline, clipId: string, patch: ClipPatch): VgTimeline {
  const apply = (c: VgTimelineClip): VgTimelineClip => {
    const n: VgTimelineClip = { ...c };
    if (patch.opacity !== undefined) n.opacity = clampN(patch.opacity, 0, 1);
    if (patch.volume !== undefined) n.volume = clampN(patch.volume, 0, 1.5);
    if (patch.muted !== undefined) n.muted = patch.muted;
    if (patch.x !== undefined) n.x = clampN(patch.x, 0, 1);
    if (patch.y !== undefined) n.y = clampN(patch.y, 0, 1);
    if (patch.scale !== undefined) n.scale = clampN(patch.scale, 0.05, 1);
    if (patch.z !== undefined) n.z = Math.round(patch.z);
    return n;
  };
  return {
    ...t,
    tracks: (t.tracks || []).map((tr) => ({
      ...tr,
      clips: (tr.clips || []).map((c) => (c.id === clipId ? apply(c) : c)),
    })),
  };
}
```

`VgTimelineClip` 已在该文件顶部 import(`import type { VgTimeline, VgTimelineClip } from '@chayuan/api';`),无需新增 import。

- [ ] **Step 5: 收敛 `setClipMuted` 为 `patchClip` 薄封装**

把 `timelineEdit.ts` 现有 `setClipMuted` 函数体替换为:

```ts
/** 单个 clip 的静音开关(视频帧静音按钮用;后端 compose 据 muted 决定是否混入原声)。 */
export function setClipMuted(t: VgTimeline, clipId: string, muted: boolean): VgTimeline {
  return patchClip(t, clipId, { muted });
}
```

- [ ] **Step 6: 跑测试确认通过(含原有用例不回归)**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`
Expected: PASS(全部用例,含新增 4 条)。

- [ ] **Step 7: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: 两个都 exit 0。

- [ ] **Step 8: Commit**(按仓库约定:bump + sudo + 精确 stage)

```bash
cd /work/chayuan-desktop
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/api/src/videoGeneration.ts \
  chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts \
  chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(vg): clip 加 opacity + patchClip 统一写入(带 clamp)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 收敛 `setClipTransform` 到 `patchClip`(消重)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/trackOps.ts`(`setClipTransform`)
- Test: `chayuan-client/packages/app/src/features/video-generation/timeline/trackOps.test.ts`(已有,确保不回归)

- [ ] **Step 1: 把 `setClipTransform` 改为调用 `patchClip`**

打开 `trackOps.ts`,`setClipTransform(timeline, clipId, tf)` 接受 `tf: { x?; y?; scale?; z? }`。把函数体替换为(从 `./timelineEdit` import `patchClip`):

```ts
import { patchClip } from './timelineEdit';

// ... 其余不动 ...

/** 设置某 clip 的画中画 transform(x/y/scale/z),clamp 复用 patchClip。 */
export function setClipTransform(timeline: VgTimeline, clipId: string, tf: { x?: number; y?: number; scale?: number; z?: number }): VgTimeline {
  return patchClip(timeline, clipId, tf);
}
```

注意:若 `trackOps.ts` 内已有本地 `clamp` 仅服务 `setClipTransform`,删掉它避免未用变量报错;若被其它函数用则保留。

- [ ] **Step 2: 跑 trackOps 测试确认不回归**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/vitest run packages/app/src/features/video-generation/timeline/trackOps.test.ts`
Expected: PASS(原有用例;clamp 语义未变:x/y[0,1]、scale[0.05,1]、z 取整)。

若有用例因旧实现允许 `scale` 上限非 1 而失败,核对 spec:scale 上限就是 1,按 `patchClip` 为准;如确为既有用例假设不同,**停下问用户**,勿擅改测试。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/app/src/features/video-generation/timeline/trackOps.ts \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "refactor(vg): setClipTransform 收敛到 patchClip 消除重复 clamp

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 预览 PIP 图层应用 opacity

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/LivePreviewCanvas.tsx`(图层 `<div>` 的 `style`)

- [ ] **Step 1: 图层 style 加 opacity**

在渲染每条视频轨图层的 `<div key={c.id} ... style={{ ... }}>` 里(`...(full ? {...} : {...})` 与 `...transitionStyle(c, playheadMs)` 同级),追加一行 `opacity`(放在 transitionStyle 之后,使转场入场动画仍能临时覆盖):

```tsx
            style={{
              ...(full
                ? { inset: 0, zIndex: 10 + (videoTracks.length - i) }
                : { left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%`, zIndex: 10 + (videoTracks.length - i) }),
              opacity: c.opacity ?? 1, // 预览反映片段不透明度(主轨 clip 不会被设 opacity → 1)
              ...transitionStyle(c, playheadMs),
            }}
```

(主轨 clip 永远不会被属性面板设 opacity,故 `?? 1` 不影响主轨。)

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/app/src/features/video-generation/timeline/LivePreviewCanvas.tsx \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(vg): 实时预览 PIP 图层应用 opacity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 新建 `VerticalSliderPopover` 组件

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/timeline/VerticalSliderPopover.tsx`

- [ ] **Step 1: 写组件**

完整文件内容:

```tsx
import * as React from 'react';

/**
 * 通用「图标 → 点开竖向滑条」弹层。复用 VgAspectPicker 的开/点外关/Esc 范式,
 * 用于轨道头音量等空间紧张处(竖排省横向地方)。
 * 竖向 range:标准 writing-mode:vertical-lr + direction:rtl(min 在下、max 在上),
 * 叠 WebkitAppearance:slider-vertical 兜底旧 WebKit(桌面 WebKitGTK 重建后需验证)。
 */
export const VerticalSliderPopover: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  icon: React.ReactNode;
  title?: string;
  format?: (v: number) => string;
}> = ({ value, min, max, step, onChange, icon, title, format }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" title={title} aria-label={title} onClick={() => setOpen((v) => !v)}
        className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">
        {icon}
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-[220] mb-1 flex -translate-x-1/2 flex-col items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 shadow-xl">
          <span className="text-[10px] tabular-nums text-[var(--cy-text-secondary)]">{format ? format(value) : String(value)}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-24 accent-[var(--cy-brand-500)] [direction:rtl] [writing-mode:vertical-lr]"
            style={{ WebkitAppearance: 'slider-vertical' } as React.CSSProperties}
          />
        </div>
      )}
    </span>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0。若 `WebkitAppearance` 仍报类型错,保留 `as React.CSSProperties` 整体断言(已加)。

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
sudo chown root:root chayuan-client/packages/app/src/features/video-generation/timeline/VerticalSliderPopover.tsx
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/app/src/features/video-generation/timeline/VerticalSliderPopover.tsx \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(vg): 新增 VerticalSliderPopover(图标→竖向滑条弹层)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 新建 `ClipPropertyPopover` 组件

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx`

- [ ] **Step 1: 写组件**

完整文件内容:

```tsx
import * as React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { VgTimeline, VgTimelineClip } from '@chayuan/api';
import { patchClip, type ClipPatch } from './timelineEdit';

const NumField: React.FC<{ label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }>
  = ({ label, value, step, min, max, onChange }) => (
  <label className="flex items-center gap-1">
    <span className="w-9 shrink-0 text-[var(--cy-text-tertiary)]">{label}</span>
    <input type="number" value={value} step={step} min={min} max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 py-0.5 tabular-nums" />
  </label>
);

/**
 * 选中片段的「属性」弹层。复用 VgAspectPicker 的点外关/Esc 范式。
 * isPip=true(画中画/附加视频轨)才显示透明度 + 位置/缩放/层级(后端只对 PIP 层 with_opacity、
 * 主轨拼接没有透明度/层级语义)。所有写入走 patchClip(带 clamp)。
 */
export const ClipPropertyPopover: React.FC<{
  timeline: VgTimeline;
  clip: VgTimelineClip;
  isPip: boolean;
  onChange: (t: VgTimeline) => void;
  onClose: () => void;
}> = ({ timeline, clip, isPip, onChange, onClose }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const set = (patch: ClipPatch) => onChange(patchClip(timeline, clip.id, patch));
  const muted = !!clip.muted;
  const opacity = clip.opacity ?? 1;
  const volume = clip.volume ?? 1;

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      className="absolute -top-2 left-0 z-[230] w-52 -translate-y-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-[11px] shadow-xl">
      <p className="mb-1 font-medium text-[var(--cy-text-secondary)]">片段属性</p>

      {isPip && (
        <label className="mb-1 flex items-center gap-2">
          <span className="w-10 shrink-0 text-[var(--cy-text-tertiary)]">透明度</span>
          <input type="range" min={0} max={1} step={0.05} value={opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            className="flex-1 accent-[var(--cy-brand-500)]" />
          <span className="w-8 shrink-0 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
        </label>
      )}

      <label className="mb-1 flex items-center gap-2">
        <button type="button" title={muted ? '取消静音' : '静音'} onClick={() => set({ muted: !muted })}
          className="shrink-0 text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <input type="range" min={0} max={1.5} step={0.05} value={volume} disabled={muted}
          onChange={(e) => set({ volume: Number(e.target.value) })}
          className="flex-1 accent-[var(--cy-brand-500)] disabled:opacity-40" />
        <span className="w-8 shrink-0 text-right tabular-nums">{volume.toFixed(2)}</span>
      </label>

      {isPip && (
        <div className="grid grid-cols-2 gap-1">
          <NumField label="位置X" value={clip.x ?? 0} step={0.01} min={0} max={1} onChange={(v) => set({ x: v })} />
          <NumField label="位置Y" value={clip.y ?? 0} step={0.01} min={0} max={1} onChange={(v) => set({ y: v })} />
          <NumField label="缩放" value={clip.scale ?? 1} step={0.01} min={0.05} max={1} onChange={(v) => set({ scale: v })} />
          <NumField label="层级" value={clip.z ?? 0} step={1} min={0} max={99} onChange={(v) => set({ z: v })} />
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
sudo chown root:root chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(vg): 新增 ClipPropertyPopover(透明度/音量/位置缩放层级)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 轨道头音量改竖向滑条弹层

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`(import + 第 110-127 行 action)

- [ ] **Step 1: 加 import**

`TimelineTracks.tsx` 顶部 lucide import 行加 `SlidersVertical`;并 import 新组件:

```tsx
import { Mic, Captions, Music, Music2, Clapperboard, PictureInPicture2, Volume2, VolumeX, SlidersVertical } from 'lucide-react';
import { VerticalSliderPopover } from './VerticalSliderPopover';
```

- [ ] **Step 2: 替换轨道头 action 里的内联横滑条为竖滑条弹层**

把现有 `action={(tr.clips && tr.clips.length > 0) ? (() => { ... })() : undefined}`(静音按钮 + `{!allMuted && (<input type="range" ... className="w-10 ..." />)}`)整段替换为:

```tsx
              action={(tr.clips && tr.clips.length > 0) ? (() => {
                const allMuted = tr.clips.every((c) => c.muted);
                const vol = tr.clips[0]?.volume ?? 1;
                return (
                  <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" title={allMuted ? '取消静音(混入该轨视频原声)' : '静音该轨视频原声'}
                      onClick={() => onTimelineChange(setTrackAudio(timeline, tr.id, { muted: !allMuted }))}
                      className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">
                      {allMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                    {!allMuted && (
                      <VerticalSliderPopover value={vol} min={0} max={1.5} step={0.05}
                        title={`音量 ${vol.toFixed(2)}`} format={(v) => v.toFixed(2)}
                        icon={<SlidersVertical className="h-3 w-3" />}
                        onChange={(v) => onTimelineChange(setTrackAudio(timeline, tr.id, { volume: v }))} />
                    )}
                  </span>
                );
              })() : undefined}
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(vg): 轨道头音量改图标→竖向滑条弹层(去内联横滑条)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 片段选中工具栏加「属性」按钮 + 接面板

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx`

- [ ] **Step 1: 加 import + 面板开关 state**

顶部 import 行加 `SlidersHorizontal`,并 import 面板组件:

```tsx
import { ChevronLeft, ChevronRight, Trash2, Replace, Volume2, VolumeX, SlidersHorizontal } from 'lucide-react';
import { ClipPropertyPopover } from './ClipPropertyPopover';
```

在组件体内(`const [selectedId, setSelectedId] = React.useState<string | null>(null);` 附近)加:

```tsx
  const [propOpenId, setPropOpenId] = React.useState<string | null>(null);
  const isPip = !!videoTrack?.removable; // 附加轨/PIP 才显示透明度+变换
```

- [ ] **Step 2: 在选中片段工具栏加「属性」按钮**

在选中工具栏(`{selected && onChange && editable && (<div className="absolute -top-6 ...">`)里,删除片段按钮(`title="删除片段"` 那个 `<button>`)**之前**插入:

```tsx
                    <button type="button" onClick={(e) => { e.stopPropagation(); setPropOpenId((id) => (id === s.id ? null : s.id)); }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="属性(透明度/音量/位置缩放)">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </button>
```

- [ ] **Step 3: 在该 clip 块内渲染属性面板**

在同一个 clip 的 `<div>`(`role="button"` 那个)内、选中工具栏 `</div>` 之后,追加:

```tsx
                {propOpenId === s.id && onChange && (
                  <ClipPropertyPopover timeline={timeline} clip={clips[s.idx]!} isPip={isPip}
                    onChange={onChange} onClose={() => setPropOpenId(null)} />
                )}
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.filemode=false add -- \
  chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx \
  VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json \
  chayuan-client/apps/installer/src-tauri/tauri.conf.json \
  chayuan-client/apps/publisher/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(vg): 片段选中工具栏加「属性」按钮接 ClipPropertyPopover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 全量验证 + 收尾

- [ ] **Step 1: 全 timeline 单测 + 双包 typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client
node_modules/.bin/vitest run packages/app/src/features/video-generation/timeline/
node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit
node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit
```
Expected: 单测全 PASS;两个 typecheck 都 exit 0。

- [ ] **Step 2: push**

```bash
cd /work/chayuan-desktop && sudo git push origin main
```

- [ ] **Step 3: 手动核对清单(交给用户在重建 desktop + 重启 sidecar 后验证)**

- 轨道头:不静音时显竖滑条触发图标,点开→竖向滑条上下调音量、点外/Esc 关闭;点静音图标后竖滑条触发图标消失。
- 选中 PIP 片段→工具栏「属性」→面板含 透明度/音量/位置X·Y/缩放/层级;调透明度,预览实时变;提交合成后成片该层透明(后端已支持)。
- 选中主轨片段→面板只显音量+静音(不显透明度/位置/缩放/层级)。
- 面板数值改位置/缩放,与预览里拖拽双向一致。
- WebKitGTK 竖向滑条显示与拖动正常(本期唯一兼容性风险点,实测确认)。

---

## Self-Review(已对照 spec 自检)

- **覆盖**:轨道音量竖滑条(Task 6)、透明度仅 PIP(Task 1 类型 / Task 3 预览 / Task 5 面板 isPip 门控)、逐片段音量(Task 5)、数值位置/缩放/层级(Task 5)、属性面板基建与前后端映射(Task 1 patchClip + opacity 字段)、复用 VgAspectPicker 范式(Task 4/5)、零后端(全程未改 server 代码)。spec 各节均有对应任务。
- **占位符**:无 TBD/TODO;每个改代码步骤都给了完整代码。
- **类型一致**:`patchClip`/`ClipPatch`(Task 1)→ `setClipTransform`(Task 2)、`ClipPropertyPopover`(Task 5)、`VgTimeline`(Task 7)一致;`VerticalSliderPopover` props(Task 4)与 Task 6 调用一致;`isPip = !!videoTrack?.removable` 在 Task 7 定义并传入 Task 5 组件。
- **风险**:WebKitGTK 竖向 range(Task 4/8 已标注实测确认)。
