import type { VgTimeline, VgTimelineTrack } from '@chayuan/api';
import { patchClip } from './timelineEdit';

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

/**
 * 在「视频轨子序列」内把某条视频轨上移/下移一格(不影响音频/字幕轨相对次序)。
 * 列表次序即画面层级:索引 0 = 主轨(铺底),其后视频轨为 PIP,越靠前层级越高(遮盖靠后)。
 * 合成端按同一约定派生 z(见 compose._build_pip_layers)。
 */
export function reorderVideoTrack(t: VgTimeline, trackId: string, dir: 'up' | 'down'): VgTimeline {
  const tracks = [...(t.tracks || [])];
  // 视频轨在整体数组里的下标序列
  const vIdx = tracks.map((tr, i) => (tr.kind === 'video' ? i : -1)).filter((i) => i >= 0);
  const pos = vIdx.findIndex((i) => tracks[i]!.id === trackId);
  if (pos < 0) return t;
  const swapPos = dir === 'up' ? pos - 1 : pos + 1;
  if (swapPos < 0 || swapPos >= vIdx.length) return t;
  const a = vIdx[pos]!; const b = vIdx[swapPos]!;
  [tracks[a], tracks[b]] = [tracks[b]!, tracks[a]!];
  return { ...t, tracks };
}

/** 设 PIP clip 的 transform(夹正 x/y∈[0,1],scale∈[0.05,1])。 */
export function setClipTransform(
  t: VgTimeline,
  clipId: string,
  tf: { x?: number; y?: number; scale?: number; z?: number },
): VgTimeline {
  return patchClip(t, clipId, tf);
}
