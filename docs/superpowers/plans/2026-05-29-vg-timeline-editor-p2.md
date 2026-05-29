# 时间轴编辑器 P2(只读时间轴页 + 加入轨道 + 画面代理预览)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** 新建独立时间轴页 `/video-generation/timeline`:从素材库/在线/链接「加入轨道」→ 只读展示 视频/音频/字幕 三轨 → 服务端低清「仅画面轨」代理预览整条 → 提交生成(走 P1 的 EDL 渲染)。

**Architecture:** 后端加 `render_proxy_from_timeline`(复用 P1 `_build_edl_render_plan`,低清、仅画面、无音/字幕)+ `POST /preview-edl` 端点。前端 `buildTimelineFromMaterials` 把已选素材派生成 Timeline EDL;`VgTimeline` 只读三轨组件;`VgTimelineEditorPage` 组合 素材选择(复用 MaterialsStep)+ 轨道展示 + 预览 + 提交;注册路由。

**Tech Stack:** FastAPI / ffmpeg(已有 concat helper)/ moviepy;React / Zustand / TanStack Query / TS。

**Spec:** `docs/superpowers/specs/2026-05-29-vg-timeline-editor-design.md`(P2 段);**已确认**:独立页 + 预览仅画面轨。

**前置:** P1 已落地(`Timeline` schema、`render_from_edl`、`_build_edl_render_plan`、`VgTimeline*` TS 类型、runner `_use_edl` 分流)。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 main,每 task 完成 `git push origin main`。

---

## File Structure

- `libs/.../video_generation/steps/compose.py` — 加 `render_proxy_from_timeline`(低清仅画面)。
- `libs/.../api_server/video_generation_routes.py` — 加 `POST /preview-edl`。
- `tests/unit_tests/test_vg_timeline.py` — 追加 proxy plan 测试。
- `packages/api/src/videoGeneration.ts` — 加 `vgPreviewEdl`。
- `packages/app/src/features/video-generation/timeline/buildTimeline.ts` — `buildTimelineFromMaterials`(纯)。
- `packages/app/src/features/video-generation/timeline/VgTimeline.tsx` — 只读三轨组件。
- `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx` — 编辑页。
- `packages/app/src/router/index.tsx` + TabHost 路由表 — 注册 `/video-generation/timeline`。

---

## Task 1: 后端 `render_proxy_from_timeline`(低清仅画面)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`

- [ ] **Step 1: 实现(放在 `render_from_edl` 之后)**

复用 `_build_edl_render_plan` + 现有 `_open_video_clip_quietly` / `concat_video_clips_with_ffmpeg` / `close_clip` / `video_codec` / `fps`。仅画面、低清、无音轨无字幕:

```python
def render_proxy_from_timeline(
    timeline,
    video_aspect,
    output_file: str,
    *,
    source_resolver,
    scale: float = 0.5,
    threads: int = 2,
) -> str:
    """低清「仅画面轨」代理预览:按 EDL 顺序裁剪+缩放到 scale 倍分辨率 ->
    ffmpeg concat。无音轨/字幕,出片快,给时间轴页快速看素材顺序/时长。"""
    aspect = VideoAspect(video_aspect)
    w, h = aspect.to_resolution()
    pw, ph = max(2, int(w * scale) // 2 * 2), max(2, int(h * scale) // 2 * 2)
    output_dir = os.path.dirname(output_file)

    plan = _build_edl_render_plan(timeline, video_aspect, source_resolver=source_resolver)
    if not plan:
        raise RuntimeError("时间轴没有可预览的视频片段")

    clip_files: list = []
    for i, p in enumerate(plan):
        clip = _open_video_clip_quietly(p["path"])
        try:
            src_dur = clip.duration
            start_s = min(p["start_s"], max(0.0, src_dur - 0.1))
            end_s = p["end_s"] if p["end_s"] is not None else src_dur
            end_s = min(end_s, src_dur)
            if end_s <= start_s:
                end_s = min(start_s + 1.0, src_dur)
            seg = clip.subclipped(start_s, end_s).resized(new_size=(pw, ph))
            seg_path = os.path.join(output_dir, f"proxy-seg-{i}.mp4")
            seg.write_videofile(seg_path, logger=None, fps=15, codec=video_codec)
            clip_files.append(seg_path)
        finally:
            close_clip(clip)

    concat_video_clips_with_ffmpeg(clip_files, output_file, threads=threads, output_dir=output_dir)
    return output_file
```

> `video_codec`/`fps` 用文件内既有常量(Task P1 已确认 `video_codec="libx264"`、`fps=30`;这里预览固定 `fps=15`)。`write_videofile` 是否带 `threads` kwarg 以文件内既有调用为准(P1 里没带,这里也别带)。

- [ ] **Step 2: 编译**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. python -m py_compile chayuan/server/video_generation/steps/compose.py`
Expected: 无输出。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py
git commit -m "feat(server/vg): render_proxy_from_timeline 低清仅画面代理预览

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: 后端 `POST /preview-edl` 端点

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

- [ ] **Step 1: 加路由(在 `serve_material_file` 附近)**

接收 `{timeline, aspect}`,用 `render_proxy_from_timeline` 出低清 mp4,FileResponse inline 返回。source 解析:material_id→库路径 / url→下载 / path→直通(复用 runner `_compose_via_edl` 的解析思路)。按 timeline 的 hash 缓存到临时目录避免重复渲。

```python
@video_generation_router.post(
    "/preview-edl", summary="时间轴低清代理预览(仅画面轨拼接)",
)
def preview_edl(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    import hashlib
    import json as _json
    from chayuan.server.video_generation.schemas import Timeline, VideoAspect
    from chayuan.server.video_generation.steps import compose as compose_step
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation.store import materials as materials_store
    from chayuan.server.video_generation._helpers import storage_dir

    raw_tl = body.get("timeline") or {}
    aspect = str(body.get("aspect") or "9:16")
    try:
        timeline = Timeline.model_validate(raw_tl)
        VideoAspect(aspect)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"timeline/aspect 非法: {e}") from e

    cache_dir = storage_dir("preview", create=True)
    key = hashlib.md5((aspect + _json.dumps(raw_tl, sort_keys=True, ensure_ascii=False)).encode("utf-8")).hexdigest()
    out_path = os.path.join(cache_dir, f"proxy-{key}.mp4")

    if not (os.path.isfile(out_path) and os.path.getsize(out_path) > 0):
        def _resolve(source: dict) -> str:
            mid = source.get("material_id")
            if mid:
                try:
                    row = materials_store.get_material(mid)
                except Exception:  # noqa: BLE001
                    row = None
                return (row or {}).get("path") or ""
            url = source.get("url") or ""
            if url.startswith(("http://", "https://")):
                return materials_step.save_video(url, save_dir=cache_dir) or ""
            return source.get("path") or ""
        try:
            compose_step.render_proxy_from_timeline(
                timeline, aspect, out_path, source_resolver=_resolve,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg] preview-edl 失败: %r", e)
            raise HTTPException(502, f"预览渲染失败: {e}") from e

    return FileResponse(out_path, media_type="video/mp4")
```

确认 `Body` / `FileResponse` / `HTTPException` / `os` 已 import(其它 endpoint 已用)。

- [ ] **Step 2: 编译**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. python -m py_compile chayuan/server/api_server/video_generation_routes.py`

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git commit -m "feat(server/vg): POST /preview-edl 时间轴低清代理预览端点(hash 缓存)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: 前端 API `vgPreviewEdl`

**Files:**
- Modify: `chayuan-client/packages/api/src/videoGeneration.ts`

- [ ] **Step 1: 加函数(返回 blob,前端 createObjectURL 播放)**

参考已有返 blob 的 `vgPreviewAudio` 写法(找它确认 request blob 的写法 — 用同款 `responseType: 'blob'` / fetch blob 约定):

```typescript
export async function vgPreviewEdl(args: { timeline: VgTimeline; aspect?: VgVideoAspect }): Promise<{ blob: Blob }> {
  // 与 vgPreviewAudio 同款:POST 取二进制 blob
  const { blob } = await /* 复用 vgPreviewAudio 内部用的 blob 请求工具 */ ...
  return { blob };
}
```

> 实现以 `vgPreviewAudio` 为模板(同文件内),把 url 换成 `/api/v1/video-generation/preview-edl`,body 传 `{ timeline, aspect: aspect ?? '9:16' }`,返回 `{ blob }`。在默认导出对象加 `previewEdl: vgPreviewEdl`。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/api): vgPreviewEdl 时间轴代理预览客户端

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: 前端 `buildTimelineFromMaterials` 纯函数

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/timeline/buildTimeline.ts`

- [ ] **Step 1: 实现**

把已选素材(VgMaterialInfo[])顺序派生成 video 轨 Timeline;每段默认整段(out_ms=0=到末尾),track_start 用累计的 clip_duration(预览/展示用近似时长)。

```typescript
import type { VgMaterialInfo, VgTimeline, VgTimelineClip } from '@chayuan/api';

/** 已选素材 -> Timeline EDL(单视频轨,顺序拼接)。
 *  duration 用素材已知 duration(秒)估算 track_start;素材路径放 source。 */
export function buildTimelineFromMaterials(
  materials: VgMaterialInfo[],
  opts: { audioMs?: number } = {},
): VgTimeline {
  let cursorMs = 0;
  const clips: VgTimelineClip[] = materials
    .filter((m) => m.url)
    .map((m, i) => {
      const durMs = Math.max(1000, Math.round((m.duration || 5) * 1000));
      const isHttp = /^https?:\/\//.test(m.url);
      const clip: VgTimelineClip = {
        id: `c${i}`,
        source: isHttp ? { url: m.url } : { path: m.url },
        track_start_ms: cursorMs,
        in_ms: 0,
        out_ms: 0,
      };
      cursorMs += durMs;
      return clip;
    });
  return {
    version: 1,
    duration_ms: Math.max(cursorMs, opts.audioMs ?? 0),
    tracks: [{ id: 'v', kind: 'video', clips }],
  };
}
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/buildTimeline.ts
git commit -m "feat(client/vg): buildTimelineFromMaterials 已选素材派生 EDL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: 前端 `VgTimeline` 只读三轨组件

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx`

- [ ] **Step 1: 实现**

横向时间轴:视频轨(clip 块按时长定宽,显示序号)+ 音频轨(占位条,P2 仅展示)+ 字幕轨(cue 标记,P2 占位)。点 clip 块回调 onClipClick(单段预览,父级处理)。时长→像素:`pxPerSec` 固定(如 12px/s)。

```tsx
import * as React from 'react';
import type { VgTimeline as VgTimelineData } from '@chayuan/api';

const PX_PER_SEC = 12;

export const VgTimeline: React.FC<{
  timeline: VgTimelineData;
  onClipClick?: (clipId: string) => void;
}> = ({ timeline, onClipClick }) => {
  const videoTrack = (timeline.tracks || []).find((t) => t.kind === 'video');
  const clips = videoTrack?.clips ?? [];
  const totalSec = Math.max(1, (timeline.duration_ms ?? 0) / 1000);
  const widthPx = Math.max(240, totalSec * PX_PER_SEC);

  // 每段宽度:用相邻 track_start 差;最后一段补到 totalSec
  const segs = clips.map((c, i) => {
    const startS = c.track_start_ms / 1000;
    const nextS = i + 1 < clips.length ? clips[i + 1]!.track_start_ms / 1000 : totalSec;
    return { id: c.id, leftPx: startS * PX_PER_SEC, widthPx: Math.max(24, (nextS - startS) * PX_PER_SEC), idx: i + 1 };
  });

  const trackBase = 'relative h-12 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] overflow-hidden';
  return (
    <div className="space-y-1.5 overflow-x-auto cy-hide-scrollbar" style={{ minWidth: 0 }}>
      <div style={{ width: widthPx }} className="space-y-1.5">
        {/* 视频轨 */}
        <div className={trackBase}>
          <span className="absolute left-1 top-0.5 z-10 text-[9px] text-[var(--cy-text-tertiary)]">视频</span>
          {segs.map((s) => (
            <button key={s.id} type="button" onClick={() => onClipClick?.(s.id)}
              style={{ left: s.leftPx, width: s.widthPx }}
              className="absolute top-3 h-8 rounded border border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[10px] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]"
              title={`片段 ${s.idx}`}>
              {s.idx}
            </button>
          ))}
          {segs.length === 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">
              从下方「加入轨道」添加素材
            </span>
          )}
        </div>
        {/* 音频轨(P2 占位) */}
        <div className={trackBase}>
          <span className="absolute left-1 top-0.5 text-[9px] text-[var(--cy-text-tertiary)]">音频</span>
          <div className="absolute inset-x-1 top-4 h-5 rounded bg-[var(--cy-surface-2)]" />
        </div>
        {/* 字幕轨(P2 占位) */}
        <div className={trackBase}>
          <span className="absolute left-1 top-0.5 text-[9px] text-[var(--cy-text-tertiary)]">字幕</span>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx
git commit -m "feat(client/vg): VgTimeline 只读三轨组件(视频块/音频/字幕占位)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: `VgTimelineEditorPage` + 路由注册

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`
- Modify: `chayuan-client/packages/app/src/router/index.tsx`(加 `/video-generation/timeline` 路由)
- Modify: 路由 → 组件映射处(TabHost / route component map,跟 BatchModePage 同款挂载)

- [ ] **Step 1: 编辑页**

组合:复用 `MaterialsStep`(已选 → vgComposer.params.video_materials)+ `VgTimeline`(由 video_materials 派生)+ 预览按钮(调 vgPreviewEdl 播放 proxy)+ 提交生成(submitTask,把派生 timeline 写进 params)。

```tsx
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Play, Sparkles, Film } from 'lucide-react';
import { videoGeneration } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';
import { MaterialsStep } from './steps/MaterialsStep';
import { VgTimeline } from './timeline/VgTimeline';
import { buildTimelineFromMaterials } from './timeline/buildTimeline';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { useTabsStore } from '../../store/tabs';

export const VgTimelineEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const timeline = React.useMemo(
    () => buildTimelineFromMaterials(params.video_materials ?? []),
    [params.video_materials],
  );

  const onPreview = async () => {
    if (!timeline.tracks[0]?.clips?.length) { reportError(new Error('先加入素材到轨道')); return; }
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewEdl({ timeline, aspect: params.video_aspect });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(r.blob);
      setPreviewUrl(urlRef.current);
    } catch (e) { reportError(e as Error, '预览失败'); }
    finally { setPreviewing(false); }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const t = await videoGeneration.submitTask({ ...params, timeline }, { stop_at: 'video' });
      notifySuccess(`已提交 ${t.task_id.slice(0, 8)}…`, '前往「我的视频」看进度');
      openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
      void navigate({ to: '/video-generation/library' as never });
    } catch (e) { reportError(e as Error, '提交失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto cy-hide-scrollbar px-6 py-6">
      <header>
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-[var(--cy-text-primary)]">
          <Film className="h-5 w-5" /> 时间轴编辑
        </h1>
        <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">加入素材到轨道 → 预览画面顺序 → 提交生成(P2:只读轨道 + 画面预览)</p>
      </header>

      <section className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3">
        <VgTimeline timeline={timeline} />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => void onPreview()} disabled={previewing}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} 预览画面
          </button>
          <button type="button" onClick={() => void onSubmit()} disabled={submitting}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交生成
          </button>
        </div>
        {previewUrl && (
          <video src={previewUrl} controls className="mt-2 max-h-[40vh] rounded-lg bg-black" />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">加入轨道</h2>
        <MaterialsStep />
      </section>
    </div>
  );
};

export default VgTimelineEditorPage;
```

- [ ] **Step 2: 注册路由**

在 `router/index.tsx` 路由数组加(`/video-generation/batch` 之后):
```typescript
  { path: '/video-generation/timeline', id: 'video-generation-timeline' },
```
并在路由 id → 组件映射处(找 `BatchModePage` 怎么挂的,同款)加 `VgTimelineEditorPage` 懒加载/挂载。READ 该映射文件确认模式后照抄。

- [ ] **Step 3: 入口按钮(VgChatPage header 加「时间轴」)**

在 VgChatPage header 的按钮组(批量/素材/我的视频 那排)加一个「时间轴」按钮,`openTab('/video-generation/timeline', ...)` + navigate。照抄 goBatch 写法。

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx chayuan-client/packages/app/src/router/index.tsx chayuan-client/packages/app/src/features/video-generation/VgChatPage.tsx
# 若路由映射在别的文件,一并 add
git commit -m "feat(client/vg): 时间轴编辑页 + 路由 /video-generation/timeline + 入口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review

**Spec coverage(design §3 P2):**
- 时间轴 UI 只读三轨 → Task 5(VgTimeline)✓
- 统一「加入轨道」(库∪在线∪链接)→ Task 6 复用 MaterialsStep(已支持三 tab)→ video_materials → Task 4 派生 timeline ✓
- 服务端低清代理预览(仅画面)→ Task 1(render_proxy_from_timeline)+ Task 2(/preview-edl)+ Task 3(client)+ Task 6(播放)✓
- 提交走 P1 EDL 渲染 → Task 6 submitTask 带 timeline,runner `_use_edl` 命中 ✓

**Placeholder scan:** Task 3 的 vgPreviewEdl 标注「以 vgPreviewAudio 为模板」是真实适配点(blob 请求工具以仓库实际为准),非占位 —— 实现者需 READ vgPreviewAudio 照抄 blob 约定。Task 6 路由映射「找 BatchModePage 同款」同理。

**Type consistency:** `buildTimelineFromMaterials → VgTimeline`(Task4)产出的 `VgTimeline` 与 P1 类型一致;`VgTimeline` 组件(Task5)消费同类型;`vgPreviewEdl({timeline, aspect})`(Task3)与后端 `/preview-edl` body 一致;runner `_use_edl` 已在 P1 处理 timeline 分流。

**依赖顺序:** Task1→2(后端)→3(client)→4(纯函数)→5(组件)→6(页面+路由)。无循环依赖。P2 只读 + 画面预览;拖拽/裁剪/音字幕预览 = P3/P4。
