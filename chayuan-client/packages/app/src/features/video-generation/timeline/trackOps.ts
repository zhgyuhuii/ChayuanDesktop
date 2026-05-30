import type { VgTimeline, VgTimelineTrack } from '@chayuan/api';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 追加一条可删空轨(video/audio)。 */
export function addTrack(t: VgTimeline, kind: 'video' | 'audio'): VgTimeline {
  const n = (t.tracks || []).filter((x) => x.kind === kind).length;
  const track: VgTimelineTrack = {
    id: `${kind}-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    kind, clips: [], removable: true,
    label: `${kind === 'video' ? '视频' : '音频'} ${n + 1}`,
  };
  return { ...t, tracks: [...(t.tracks || []), track] };
}

/** 删除轨:仅 removable 轨可删,否则原样返回。 */
export function removeTrack(t: VgTimeline, trackId: string): VgTimeline {
  const tr = (t.tracks || []).find((x) => x.id === trackId);
  if (!tr || !tr.removable) return t;
  return { ...t, tracks: (t.tracks || []).filter((x) => x.id !== trackId) };
}

/** 设 PIP clip 的 transform(夹正 x/y∈[0,1],scale∈[0.05,1])。 */
export function setClipTransform(
  t: VgTimeline,
  clipId: string,
  tf: { x?: number; y?: number; scale?: number; z?: number },
): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => ({
    ...tr,
    clips: (tr.clips || []).map((c) => {
      if (c.id !== clipId) return c;
      return {
        ...c,
        ...(tf.x != null ? { x: clamp(tf.x, 0, 1) } : {}),
        ...(tf.y != null ? { y: clamp(tf.y, 0, 1) } : {}),
        ...(tf.scale != null ? { scale: clamp(tf.scale, 0.05, 1) } : {}),
        ...(tf.z != null ? { z: Math.round(tf.z) } : {}),
      };
    }),
  }));
  return { ...t, tracks };
}
