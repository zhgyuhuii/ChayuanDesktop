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
