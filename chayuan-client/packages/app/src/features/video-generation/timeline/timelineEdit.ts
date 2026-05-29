import type { VgTimeline, VgTimelineClip } from '@chayuan/api';

const MIN_DUR = 200;

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
  let hasVideo = false;
  const tracks = (t.tracks || []).map((tr) => {
    if (tr.kind !== 'video') return tr;
    hasVideo = true;
    return { ...tr, clips };
  });
  if (!hasVideo) tracks.push({ id: 'v', kind: 'video' as const, clips });
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

/** 从拖入素材生成一个视频轨 clip,插入到 atIndex(默认末尾),重算 starts。 */
export function appendClipFromMaterial(
  t: VgTimeline,
  m: DraggedMaterial,
  atIndex?: number,
): VgTimeline {
  const clips = [...videoClips(t)];
  const dur = m.durationMs && m.durationMs > 0
    ? Math.round(m.durationMs)
    : (m.kind === 'image' ? 3000 : 0); // 图像默认 3s;视频 0=整段
  const clip: VgTimelineClip = {
    id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
    source: m.materialId ? { material_id: m.materialId } : { url: m.url ?? '' },
    track_start_ms: 0,
    in_ms: 0,
    out_ms: dur,
    duration_ms: m.kind === 'image' ? (dur || 3000) : (m.durationMs || 0),
  };
  const at = atIndex == null ? clips.length : Math.max(0, Math.min(atIndex, clips.length));
  clips.splice(at, 0, clip);
  return recomputeStarts(withVideoClips(t, clips));
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

/** 往 audio 轨追加一个插入音频 clip(顺序排在该轨末尾;无 audio 轨则建)。 */
export function appendAudioClip(t: VgTimeline, m: DraggedMaterial, atIndex?: number): VgTimeline {
  const tracks = [...(t.tracks || [])];
  let ai = tracks.findIndex((tr) => tr.kind === 'audio');
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
