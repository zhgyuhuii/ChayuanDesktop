# 时间轴编辑器 P3(交互编辑:排序 / 删除 / 裁剪 in-out / 拖时长)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 时间轴从「派生只读」升级为「可编辑 EDL 状态」:clip 可拖拽排序、删除、拖左右把手裁剪 in/out、拖右边缘改时长;编辑直接改 `vgComposer.params.timeline`,提交走 P1 EDL 渲染。

**Architecture:** 新增一层**纯函数 timeline 编辑算子**(reorder/delete/setIn/setDuration/recomputeStarts,可单测)。编辑器把 `params.timeline` 作为唯一可编辑真源(空时由 `buildTimelineFromMaterials` 初始化;「加入轨道」append);`VgTimeline` 升级为交互组件(选中 / 删除 / 左右移 / 左把手裁 in / 右把手裁时长,pointer 拖拽),回调走纯算子改 `params.timeline`。

**Tech Stack:** React 19 / TS / pointer events;Vitest/jest(单测纯算子)。

**前置:** P1(Timeline schema + EDL 渲染)、P2(VgTimelineEditorPage + VgTimeline 只读 + buildTimelineFromMaterials + /preview-edl)已落地。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 main,每 task 完成 `git push origin main`。

---

## File Structure

- `packages/app/src/features/video-generation/timeline/timelineEdit.ts` — 纯编辑算子(新建)。
- `packages/app/src/features/video-generation/timeline/timelineEdit.test.ts` — 单测(新建)。
- `packages/app/src/features/video-generation/timeline/VgTimeline.tsx` — 升级为交互组件(改)。
- `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx` — 改用可编辑 params.timeline + 加入轨道 append(改)。

> clip 时长真源:P2 的 `buildTimelineFromMaterials` 把 `out_ms=0`(整段)。P3 编辑需要具体时长 —— 算子里若 `out_ms<=in_ms` 则按"已知素材时长 fallback"(编辑器传入每 clip 的 natural duration 映射),首次编辑即固化 out_ms。为简化:`VgTimelineClip` 增加可选 `duration_ms`(展示/编辑用的有效时长),算子优先用它。

---

## Task 1: 纯编辑算子 + 单测

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/timelineEdit.ts`
- Create: `packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { clipDurMs, recomputeStarts, reorderClip, deleteClip, setClipDuration, setClipIn } from './timelineEdit';
import type { VgTimeline } from '@chayuan/api';

const mk = (): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [{ id: 'v', kind: 'video', clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 3000 },
    { id: 'b', source: { path: '/b.mp4' }, track_start_ms: 3000, in_ms: 0, out_ms: 2000 },
    { id: 'c', source: { path: '/c.mp4' }, track_start_ms: 5000, in_ms: 1000, out_ms: 4000 },
  ] }],
});

it('clipDurMs uses out-in, falls back to duration_ms', () => {
  expect(clipDurMs({ id: 'x', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 3000 })).toBe(3000);
  expect(clipDurMs({ id: 'x', source: {}, track_start_ms: 0, in_ms: 1000, out_ms: 4000 })).toBe(3000);
  expect(clipDurMs({ id: 'x', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 0, duration_ms: 5000 } as any)).toBe(5000);
});

it('recomputeStarts makes clips abut', () => {
  const t = recomputeStarts(mk());
  const c = t.tracks[0]!.clips!;
  expect(c.map((x) => x.track_start_ms)).toEqual([0, 3000, 5000]);
});

it('reorderClip moves and recomputes starts', () => {
  const t = reorderClip(mk(), 'c', 0); // c 到最前
  const c = t.tracks[0]!.clips!;
  expect(c.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  expect(c[0]!.track_start_ms).toBe(0);
  expect(c[1]!.track_start_ms).toBe(3000); // c 时长 3000(4000-1000)
});

it('deleteClip removes + recomputes', () => {
  const t = deleteClip(mk(), 'a');
  expect(t.tracks[0]!.clips!.map((x) => x.id)).toEqual(['b', 'c']);
  expect(t.tracks[0]!.clips![0]!.track_start_ms).toBe(0);
});

it('setClipDuration sets out=in+dur, clamps >=200ms', () => {
  const t = setClipDuration(mk(), 'a', 1500);
  const a = t.tracks[0]!.clips!.find((x) => x.id === 'a')!;
  expect(a.out_ms - a.in_ms).toBe(1500);
  expect(t.tracks[0]!.clips![1]!.track_start_ms).toBe(1500);
});

it('setClipIn shifts in, keeps duration floor', () => {
  const t = setClipIn(mk(), 'c', 2000);
  const c = t.tracks[0]!.clips!.find((x) => x.id === 'c')!;
  expect(c.in_ms).toBe(2000);
  expect(c.out_ms).toBeGreaterThan(2000);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app exec vitest run src/features/video-generation/timeline/timelineEdit.test.ts`
> 若 app 包没配 vitest,改用其它已有测试 runner(grep `*.test.ts` 看现有测试怎么跑);若 app 无单测基建,把测试写成可被现有 runner 跑的形态,或退化为 `tsx`/`node` 断言脚本。先 grep `vitest`/`jest` in packages/app 确认。
Expected: FAIL(模块/函数不存在)。

- [ ] **Step 3: 实现 `timelineEdit.ts`**

```typescript
import type { VgTimeline, VgTimelineClip } from '@chayuan/api';

const MIN_DUR = 200;

/** clip 有效时长(ms):优先 out-in;否则 duration_ms;再否则 1000 兜底。 */
export function clipDurMs(c: VgTimelineClip & { duration_ms?: number }): number {
  if (c.out_ms && c.out_ms > (c.in_ms ?? 0)) return c.out_ms - (c.in_ms ?? 0);
  if (c.duration_ms && c.duration_ms > 0) return c.duration_ms;
  return 1000;
}

function videoClips(t: VgTimeline): VgTimelineClip[] {
  return (t.tracks || []).find((tr) => tr.kind === 'video')?.clips ?? [];
}

function withVideoClips(t: VgTimeline, clips: VgTimelineClip[]): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => (tr.kind === 'video' ? { ...tr, clips } : tr));
  if (!tracks.some((tr) => tr.kind === 'video')) tracks.push({ id: 'v', kind: 'video', clips });
  let cursor = 0;
  for (const c of clips) cursor += clipDurMs(c as any);
  return { ...t, tracks, duration_ms: Math.max(cursor, t.duration_ms ?? 0) };
}

/** 顺序重算 track_start_ms(clips 紧贴拼接)。 */
export function recomputeStarts(t: VgTimeline): VgTimeline {
  const clips = videoClips(t);
  let cursor = 0;
  const next = clips.map((c) => {
    const nc = { ...c, track_start_ms: cursor };
    cursor += clipDurMs(c as any);
    return nc;
  });
  return withVideoClips(t, next);
}

export function reorderClip(t: VgTimeline, clipId: string, toIndex: number): VgTimeline {
  const clips = [...videoClips(t)];
  const from = clips.findIndex((c) => c.id === clipId);
  if (from < 0) return t;
  const [m] = clips.splice(from, 1);
  clips.splice(Math.max(0, Math.min(toIndex, clips.length)), 0, m!);
  return recomputeStarts(withVideoClips(t, clips));
}

export function deleteClip(t: VgTimeline, clipId: string): VgTimeline {
  const clips = videoClips(t).filter((c) => c.id !== clipId);
  return recomputeStarts(withVideoClips(t, clips));
}

/** 设时长:out = in + dur(>=MIN_DUR);随后重算 starts。 */
export function setClipDuration(t: VgTimeline, clipId: string, durMs: number): VgTimeline {
  const d = Math.max(MIN_DUR, Math.round(durMs));
  const clips = videoClips(t).map((c) => (c.id === clipId ? { ...c, out_ms: (c.in_ms ?? 0) + d } : c));
  return recomputeStarts(withVideoClips(t, clips));
}

/** 设入点 in_ms(>=0);保持时长地板(out 至少 in+MIN_DUR)。 */
export function setClipIn(t: VgTimeline, clipId: string, inMs: number): VgTimeline {
  const v = Math.max(0, Math.round(inMs));
  const clips = videoClips(t).map((c) => {
    if (c.id !== clipId) return c;
    const dur = clipDurMs(c as any);
    return { ...c, in_ms: v, out_ms: v + Math.max(MIN_DUR, dur) };
  });
  return recomputeStarts(withVideoClips(t, clips));
}
```

> `VgTimelineClip` 加可选 `duration_ms`:在 `packages/api/src/videoGeneration.ts` 的 `VgTimelineClip` 接口加 `duration_ms?: number;`(后端 schema 忽略未知字段,只用 in/out;此字段纯前端编辑用)。本 task 一并改 api 类型。

- [ ] **Step 4: Run → PASS**

Run: 同 Step 2 命令。Expected: 全 PASS。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/vg): 时间轴纯编辑算子 reorder/delete/setIn/setDuration + 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: `buildTimelineFromMaterials` 填 duration_ms + 编辑器改用可编辑 timeline

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/buildTimeline.ts`
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

- [ ] **Step 1: buildTimelineFromMaterials 写 duration_ms**

在每个 clip 加 `duration_ms: durMs`(已算出),并保持 `out_ms: 0`(整段)。这样编辑算子 `clipDurMs` 能拿到展示时长。改 buildTimeline.ts 的 clip 构造:
```typescript
      const clip: VgTimelineClip = {
        id: `c${i}`,
        source: isHttp ? { url: m.url } : { path: m.url },
        track_start_ms: cursorMs,
        in_ms: 0,
        out_ms: 0,
        duration_ms: durMs,
      } as VgTimelineClip & { duration_ms: number };
```

- [ ] **Step 2: 编辑器用 params.timeline 作可编辑真源**

改 `VgTimelineEditorPage`:不再每次 `useMemo(buildTimelineFromMaterials(...))` 当只读;改为:
- `const timeline = params.timeline ?? buildTimelineFromMaterials(params.video_materials ?? [])`(空则派生)。
- 「加入轨道」语义:监听 video_materials 变化 → 把新选素材 append 进 params.timeline(若 timeline 已存在)或重建。简化做法:提供「同步素材到轨道」按钮 = `patchParams({ timeline: buildTimelineFromMaterials(params.video_materials ?? []) })`(重建轨道,丢弃手动编辑);以及编辑算子直接 patch timeline。
- 编辑回调:`const apply = (next: VgTimeline) => patchParams({ timeline: next });` 传给 VgTimeline。
- 提交:`submitTask({ ...params, timeline }, ...)`(已是 timeline)。

```tsx
const timeline = params.timeline ?? buildTimelineFromMaterials(params.video_materials ?? []);
const apply = (next: VgTimeline) => patchParams({ timeline: next });
// 「重建轨道」按钮(从当前已选素材重置,丢弃手动编辑)
const resetFromMaterials = () => patchParams({ timeline: buildTimelineFromMaterials(params.video_materials ?? []) });
```
渲染:`<VgTimeline timeline={timeline} editable onChange={apply} onClipClick={...} />` + 一个「重建轨道」按钮 + 提示「拖拽排序 / 把手裁剪 / 删除」。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck`

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/buildTimeline.ts chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 编辑器改用可编辑 params.timeline(派生兜底 + 重建轨道)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: `VgTimeline` 升级为交互组件

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/VgTimeline.tsx`

- [ ] **Step 1: 加 editable 交互**

新增 props:`editable?: boolean; onChange?: (t: VgTimeline) => void;`。`editable` 时每个视频 clip 块渲染:
- **选中**:点 clip body 选中(本地 state `selectedId`),选中态高亮。
- **删除**:选中/hover 时右上角 🗑 → `onChange(deleteClip(timeline, id))`。
- **左右移**(可靠排序):选中时显 [‹][›] → `onChange(reorderClip(timeline, id, idx∓1))`。
- **右边缘拖时长**:clip 右缘一个 4px 把手,`onPointerDown` 起拖,`pointermove` 累计 dx → `durMs = clipDurMs(clip) + dx/PX_PER_SEC*1000` → 实时 `onChange(setClipDuration(timeline, id, durMs))`;`pointerup` 解绑。用 `setPointerCapture`。
- **左边缘拖裁 in**:clip 左缘把手,拖 → `inMs = clip.in_ms + dx/PX_PER_SEC*1000` → `onChange(setClipIn(timeline, id, inMs))`。
- **拖拽排序**(可选增强):clip body 横向拖,松手时按指针 x 落到的目标 index `reorderClip`。P3 先保证左右移按钮可靠;body 拖拽排序作为加分项,实现不稳就只留按钮。

实现要点:
- 从 `'./timelineEdit'` import `clipDurMs/deleteClip/reorderClip/setClipDuration/setClipIn`。
- 段宽用 `clipDurMs(clip)` 而非相邻 start 差(编辑后更准):`widthPx = clipDurMs(c)/1000*PX_PER_SEC`,`leftPx = track_start_ms/1000*PX_PER_SEC`。
- pointer 拖拽期间用 ref 存起始 x + 起始值,move 里算 delta;每次 move 直接 `onChange(算子(...))`(算子纯,父级 patch 后重渲染)。注意防抖不必要(算子轻量)。
- 非 editable 时退化为 P2 只读行为(点击 onClipClick)。

给出关键骨架(实现者补全 pointer 细节):
```tsx
const startDrag = (e: React.PointerEvent, clipId: string, mode: 'dur' | 'in', startVal: number) => {
  e.preventDefault(); e.stopPropagation();
  const startX = e.clientX;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    const deltaMs = (ev.clientX - startX) / PX_PER_SEC * 1000;
    if (mode === 'dur') onChange?.(setClipDuration(timeline, clipId, startVal + deltaMs));
    else onChange?.(setClipIn(timeline, clipId, startVal + deltaMs));
  };
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};
```
clip 块 JSX(editable 分支):body + 左把手(`onPointerDown=startDrag(...,'in', clip.in_ms)`)+ 右把手(`startDrag(...,'dur', clipDurMs(clip))`)+ 选中时 [‹][›][🗑]。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx
git commit -m "feat(client/vg): VgTimeline 交互编辑(选中/删除/左右移/把手裁 in/拖时长)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: 联调验证

- [ ] **Step 1: 全量 typecheck + 单测**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck
pnpm --filter @chayuan/app exec vitest run src/features/video-generation/timeline/timelineEdit.test.ts
```
Expected: typecheck 0 错误;单测全 PASS。

- [ ] **Step 2: 手动验收清单(重建前端后)**

- 时间轴页加入素材 → clip 块出现;选中显 [‹][›][🗑]。
- 左右移改顺序;删除移除;拖右把手改时长(块变宽/窄);拖左把手裁 in。
- 编辑后「预览画面」反映新顺序/时长;「提交生成」成片按编辑结果(走 P1 EDL)。
- 「重建轨道」从当前已选素材重置。

---

## Self-Review

**Spec coverage(design §3 P3):** 拖拽排序 → Task3 左右移(可靠)+ body 拖(加分);删除 → Task3 🗑;裁剪 in/out → Task3 左把手(in)+ 右把手(out/时长);改 EDL → Task1 算子 + Task2 可编辑 params.timeline;提交走 EDL → Task2 submitTask(timeline)。✓

**Placeholder scan:** Task1 测试 runner「grep vitest/jest 确认」是真实适配点(app 包测试基建以仓库实际为准)。Task3 pointer 细节给了骨架 + 要点,非占位。

**Type consistency:** `VgTimelineClip.duration_ms?`(Task1 api 改)被 buildTimeline(Task2)写、clipDurMs(Task1)读、VgTimeline(Task3)用;算子签名 `(timeline, clipId, ...)→VgTimeline` 一致;editor `apply=(t)=>patchParams({timeline:t})` 与 VgTimeline `onChange` 一致。

**依赖顺序:** Task1(算子+类型)→ Task2(buildTimeline+editor)→ Task3(交互组件)→ Task4(联调)。无循环依赖。free-drag-reorder 是加分项,左右移保底。
