import type { VgMaterialInfo, VgTimeline, VgTimelineClip } from '@chayuan/api';

/** 已选素材 -> Timeline EDL(单视频轨,顺序拼接)。
 *  duration 用素材已知 duration(秒)估算 track_start;http(s) url 进 source.url,否则 source.path。 */
export function buildTimelineFromMaterials(
  materials: VgMaterialInfo[],
  opts: { audioMs?: number } = {},
): VgTimeline {
  let cursorMs = 0;
  const clips: VgTimelineClip[] = (materials ?? [])
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
        // 纯前端编辑用:整段时(out_ms=0)给 clipDurMs 提供展示时长。后端 schema 忽略未知字段。
        duration_ms: durMs,
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
