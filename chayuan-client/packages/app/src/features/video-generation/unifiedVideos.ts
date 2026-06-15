/**
 * 视频中心数据归一:把「图文成片」(VG, VgVideo) 与「数字人视频」(DH, DhTaskStatus)
 * 映射成统一卡模型 UnifiedVideo,并分区为:
 *   - completed:已完成的成片 + 数字人,按 createdAt 倒序混排(统一网格)
 *   - active   :数字人「生成中/失败/取消」任务(页面顶部独立区)
 *
 * 纯函数,无副作用,便于单测。轮询/查询由 useUnifiedVideos 负责。
 */
import { vgTaskFileUrl, digitalHuman, type VgVideo, type DhTaskStatus } from '@chayuan/api';

export type UnifiedSource = 'vg' | 'dh';
export type UnifiedState = 'complete' | 'processing' | 'failed' | 'canceled';

export interface UnifiedVideo {
  key: string;                 // `vg:${video_id}` / `dh:${task_id}`
  source: UnifiedSource;
  title: string;
  fileUrl: string;             // 播放/下载地址;进行中的 DH 为空
  durationMs: number;
  createdAt: number;           // 统一毫秒
  width?: number;
  height?: number;
  state: UnifiedState;
  progress?: number;           // 仅 DH 进行中
  raw: VgVideo | DhTaskStatus;
}

function fromVg(v: VgVideo): UnifiedVideo {
  const name = v.path.split(/[\\/]/).pop() || `${v.video_id}.mp4`;
  return {
    key: `vg:${v.video_id}`,
    source: 'vg',
    title: v.title || '未命名视频',
    fileUrl: vgTaskFileUrl(v.task_id, name, false),
    durationMs: v.duration_ms || 0,
    createdAt: v.created_at || 0,
    width: v.width,
    height: v.height,
    state: 'complete',
    raw: v,
  };
}

function fromDh(t: DhTaskStatus): UnifiedVideo {
  const st: UnifiedState =
    t.state === 'complete' || t.state === 'failed' || t.state === 'canceled' ? t.state : 'processing';
  return {
    key: `dh:${t.task_id}`,
    source: 'dh',
    title: t.name || '数字人视频',
    fileUrl: st === 'complete' ? digitalHuman.taskFileUrl(t.task_id) : '',
    durationMs: 0,
    createdAt: (t.created_at ?? 0) * 1000,  // DH created_at 为秒
    state: st,
    progress: st === 'processing' ? t.progress : undefined,
    raw: t,
  };
}

export function mergeUnifiedVideos(
  videos: VgVideo[],
  dh: { items: DhTaskStatus[] },
): { completed: UnifiedVideo[]; active: UnifiedVideo[] } {
  const all = [...videos.map(fromVg), ...((dh?.items ?? []).map(fromDh))];
  const completed = all
    .filter((v) => v.state === 'complete')
    .sort((a, b) => b.createdAt - a.createdAt);
  const active = all
    .filter((v) => v.source === 'dh' && v.state !== 'complete')
    .sort((a, b) => b.createdAt - a.createdAt);
  return { completed, active };
}
