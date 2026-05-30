import type { VgTimeline, VgTimelineClip } from '@chayuan/api';

const MIN_DUR = 200;

/**
 * 把 timeline 里所有「后端为整数」的字段取整,避免小数 out_ms/track_start_ms/duration_ms
 * 触发后端 422(TimelineClip.out_ms 等是 int)。x/y/scale 是 float 保留。
 * 小数来源举例:图像 clip 填充时长 = contentMs - start,而 contentMs 含 audioDurationMs 可能是小数。
 */
export function roundTimeline(t: VgTimeline): VgTimeline {
  const r = (v: number | undefined | null) => (v == null ? v : Math.round(v));
  return {
    ...t,
    duration_ms: Math.round(t.duration_ms || 0),
    tracks: (t.tracks || []).map((tr) => ({
      ...tr,
      clips: (tr.clips || []).map((c) => ({
        ...c,
        track_start_ms: Math.round(c.track_start_ms || 0),
        in_ms: r(c.in_ms) as number | undefined,
        out_ms: r(c.out_ms) as number | undefined,
        duration_ms: r(c.duration_ms) as number | undefined,
        z: r(c.z) as number | undefined,
      })),
    })),
  };
}

/** clip 有效时长(ms):优先 out-in;否则 duration_ms;再否则 1000。 */
export function clipDurMs(c: VgTimelineClip): number {
  const inMs = c.in_ms ?? 0;
  if (c.out_ms && c.out_ms > inMs) return c.out_ms - inMs;
  if (c.duration_ms && c.duration_ms > 0) return c.duration_ms;
  return 1000;
}

function videoClips(t: VgTimeline): VgTimelineClip[] {
  return (t.tracks || []).find((tr) => tr.kind === 'video')?.clips ?? [];
}

function withVideoClips(t: VgTimeline, clips: VgTimelineClip[]): VgTimeline {
  // 只改「第一条 video 轨」(主轨)。⚠ 之前 map 给每条 video 轨都赋同一份 clips,
  // 多视频轨(PIP)存在后往主轨 drop 会把素材广播到所有视频轨(#13 下一轨被填充 +
  // 连带 #12 预览遮挡)。这里精确只写主轨。
  const firstIdx = (t.tracks || []).findIndex((tr) => tr.kind === 'video');
  const tracks = firstIdx < 0
    ? [...(t.tracks || []), { id: 'v', kind: 'video' as const, clips }]
    : (t.tracks || []).map((tr, i) => (i === firstIdx ? { ...tr, clips } : tr));
  let cursor = 0;
  for (const c of clips) cursor += clipDurMs(c);
  return { ...t, tracks, duration_ms: Math.max(cursor, t.duration_ms ?? 0) };
}

/** 顺序重算 track_start_ms(clips 紧贴拼接)。 */
export function recomputeStarts(t: VgTimeline): VgTimeline {
  let cursor = 0;
  const next = videoClips(t).map((c) => {
    const nc = { ...c, track_start_ms: cursor };
    cursor += clipDurMs(c);
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
  return recomputeStarts(withVideoClips(t, videoClips(t).filter((c) => c.id !== clipId)));
}

/** 替换某条轨的 clips 并按全轨末端刷新 duration_ms(泛化,任意 kind)。 */
function withTrackClips(t: VgTimeline, trackId: string, clips: VgTimelineClip[]): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => (tr.id === trackId ? { ...tr, clips } : tr));
  let dur = 0;
  for (const tr of tracks) for (const c of (tr.clips || [])) dur = Math.max(dur, (c.track_start_ms || 0) + clipDurMs(c));
  return { ...t, tracks, duration_ms: Math.max(dur, 0) };
}

/** 自由设置某 clip 的起始时间(>=0),用于 PIP/音频轨拖动改位置(任意轨)。 */
export function setClipStart(t: VgTimeline, clipId: string, startMs: number): VgTimeline {
  const s = Math.max(0, Math.round(startMs));
  const tr = (t.tracks || []).find((x) => (x.clips || []).some((c) => c.id === clipId));
  if (!tr) return t;
  const clips = (tr.clips || []).map((c) => (c.id === clipId ? { ...c, track_start_ms: s } : c));
  return withTrackClips(t, tr.id, clips);
}

/** 主视频轨拖动结束后归一:按当前 start 排序再紧贴重算(把自由拖动落成新顺序)。 */
export function normalizeMontage(t: VgTimeline): VgTimeline {
  const tr = (t.tracks || []).find((x) => x.kind === 'video');
  if (!tr) return t;
  const sorted = [...(tr.clips || [])].sort((a, b) => (a.track_start_ms || 0) - (b.track_start_ms || 0));
  let cursor = 0;
  const next = sorted.map((c) => {
    const nc = { ...c, track_start_ms: cursor };
    cursor += clipDurMs(c);
    return nc;
  });
  return withTrackClips(t, tr.id, next);
}

/** 设时长:out = in + dur(>=MIN_DUR);随后重算 starts。 */
export function setClipDuration(t: VgTimeline, clipId: string, durMs: number): VgTimeline {
  const d = Math.max(MIN_DUR, Math.round(durMs));
  const clips = videoClips(t).map((c) => (c.id === clipId ? { ...c, out_ms: (c.in_ms ?? 0) + d } : c));
  return recomputeStarts(withVideoClips(t, clips));
}

/** 设入点 in_ms(>=0),保持时长地板(out 至少 in+max(MIN_DUR,原时长))。 */
export function setClipIn(t: VgTimeline, clipId: string, inMs: number): VgTimeline {
  const v = Math.max(0, Math.round(inMs));
  const clips = videoClips(t).map((c) => {
    if (c.id !== clipId) return c;
    const dur = clipDurMs(c);
    return { ...c, in_ms: v, out_ms: v + Math.max(MIN_DUR, dur) };
  });
  return recomputeStarts(withVideoClips(t, clips));
}

/** 拖拽 dataTransfer 的 MIME 与 payload 类型(MaterialsStep 写 / TimelineTracks 读)。 */
export const VG_MATERIAL_DND_MIME = 'application/x-vg-material';

export interface DraggedMaterial {
  materialId?: string;
  url?: string;
  kind: 'video' | 'image' | 'audio';
  durationMs?: number;
}

/** 从拖入素材生成一个视频轨 clip,插入到 atIndex(默认末尾),重算 starts。
 *  trackId 指定目标视频轨(P5c-2 PIP 附加轨);不传 = 主视频轨(第一条)。
 *  附加轨(非第一条)新 clip 默认带 PIP transform(右上角小窗),便于直接看到画中画。 */
export function appendClipFromMaterial(
  t: VgTimeline,
  m: DraggedMaterial,
  atIndex?: number,
  trackId?: string,
  fillToMs?: number,
): VgTimeline {
  // 视频:用真实时长(m.durationMs;0=到素材末尾,渲染时取整段)。
  // 图像:占「剩余时间轴」—— 从落点到内容末尾(fillToMs);无内容则默认 3s。
  const isImage = m.kind === 'image';
  const mkClip = (start: number): VgTimelineClip => {
    let dur: number;
    if (isImage) {
      // 图像:显式时长优先;否则占「剩余时间轴」(落点→内容末尾),无内容默认 3s
      dur = m.durationMs && m.durationMs > 0 ? Math.round(m.durationMs) : (Math.max(3000, (fillToMs ?? 0) - start) || 3000);
    } else {
      dur = m.durationMs && m.durationMs > 0 ? Math.round(m.durationMs) : 0;
    }
    return {
      id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
      source: m.materialId ? { material_id: m.materialId } : { url: m.url ?? '' },
      track_start_ms: start,
      in_ms: 0,
      out_ms: dur,
      duration_ms: isImage ? dur : (m.durationMs || 0),
    };
  };

  const tracks = t.tracks || [];
  const firstVideoIdx = tracks.findIndex((tr) => tr.kind === 'video');
  const isMain = trackId == null || tracks[firstVideoIdx]?.id === trackId;
  if (isMain) {
    const clips = [...videoClips(t)];
    const at = atIndex == null ? clips.length : Math.max(0, Math.min(atIndex, clips.length));
    const priorSum = clips.slice(0, at).reduce((acc, c) => acc + clipDurMs(c), 0);
    clips.splice(at, 0, mkClip(priorSum));
    return recomputeStarts(withVideoClips(t, clips));
  }
  // 附加视频轨(PIP):排在该轨末尾 + 默认 PIP transform(图像填充到末尾)
  const next = tracks.map((tr) => {
    if (tr.id !== trackId) return tr;
    const clips = [...(tr.clips || [])];
    const last = clips[clips.length - 1];
    const start = last ? last.track_start_ms + clipDurMs(last) : 0;
    clips.push({ ...mkClip(start), x: 0.55, y: 0.05, scale: 0.4, z: clips.length + 1 });
    return { ...tr, clips };
  });
  return { ...t, tracks: next };
}

/** 替换 clip 的素材源,保留 in/out/时长/位置。 */
export function replaceClipSource(
  t: VgTimeline,
  clipId: string,
  source: { material_id?: string; url?: string },
): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => ({
    ...tr,
    clips: (tr.clips || []).map((c) => (c.id === clipId ? { ...c, source } : c)),
  }));
  return { ...t, tracks };
}

/** 往 audio 轨追加一个插入音频 clip(顺序排在该轨末尾)。
 *  trackId 指定目标音频轨(P5c-2 多音频轨);不传 = 第一条 audio 轨,无则新建。 */
export function appendAudioClip(t: VgTimeline, m: DraggedMaterial, atIndex?: number, trackId?: string): VgTimeline {
  const tracks = [...(t.tracks || [])];
  let ai = trackId
    ? tracks.findIndex((tr) => tr.id === trackId && tr.kind === 'audio')
    : tracks.findIndex((tr) => tr.kind === 'audio');
  if (ai < 0) { tracks.push({ id: 'a', kind: 'audio', clips: [] }); ai = tracks.length - 1; }
  const clips = [...(tracks[ai]!.clips || [])];
  const dur = m.durationMs && m.durationMs > 0 ? Math.round(m.durationMs) : 0;
  const last = clips[clips.length - 1];
  const start = last
    ? last.track_start_ms + (last.out_ms && last.out_ms > 0 ? last.out_ms : (last.duration_ms || 0))
    : 0;
  const clip: VgTimelineClip = {
    id: `a${Date.now()}${Math.floor(Math.random() * 1000)}`,
    source: m.materialId ? { material_id: m.materialId } : { url: m.url ?? '' },
    track_start_ms: start,
    in_ms: 0,
    out_ms: dur,
    duration_ms: dur,
  };
  const at = atIndex == null ? clips.length : Math.max(0, Math.min(atIndex, clips.length));
  clips.splice(at, 0, clip);
  tracks[ai] = { ...tracks[ai]!, clips };
  return { ...t, tracks };
}

/** 删除任意轨上的某 clip(视频轨删后重算 starts;其它轨保留各 clip 位置)。 */
export function deleteAnyClip(t: VgTimeline, clipId: string): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => {
    if (!(tr.clips || []).some((c) => c.id === clipId)) return tr;
    const clips = (tr.clips || []).filter((c) => c.id !== clipId);
    if (tr.kind === 'video') {
      // 视频轨紧贴拼接:重算 starts
      let cursor = 0;
      const next = clips.map((c) => { const nc = { ...c, track_start_ms: cursor }; cursor += clipDurMs(c); return nc; });
      return { ...tr, clips: next };
    }
    return { ...tr, clips };
  });
  return { ...t, tracks };
}
