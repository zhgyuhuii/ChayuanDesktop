/**
 * 单任务进度卡 — 从 RenderStep + InProgressTasksPanel 抽出,VgMessageExtras 内嵌。
 *
 * 4 态:pending|processing 进度条 / complete 嵌入 video / failed 错误 / canceled 标签。
 */
import * as React from 'react';
import { Loader2, CircleCheck, AlertTriangle, Square, Download } from 'lucide-react';
import { videoGeneration, vgTaskFileUrl, type VgTask } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { reportError } from '../../store/errorDialog';

const STEP_LABELS: Record<number, string> = {
  5: '准备', 10: '生成脚本', 20: '生成关键词', 35: '语音合成',
  50: '字幕生成', 70: '素材准备', 95: '视频合成', 100: '完成',
};
const stepLabel = (p: number) => {
  let l = STEP_LABELS[5]!;
  for (const t of [5, 10, 20, 35, 50, 70, 95, 100]) {
    if (p >= t) l = STEP_LABELS[t]!;
  }
  return l;
};

export interface RenderProgressCardProps {
  taskId: string;
  /** 终态时(complete/failed/canceled)父级回调,可触发刷新 library 等 */
  onTerminal?: () => void;
}

export const RenderProgressCard: React.FC<RenderProgressCardProps> = ({ taskId, onTerminal }) => {
  const [task, setTask] = React.useState<VgTask | null>(null);

  React.useEffect(() => {
    const ctl = new AbortController();
    void videoGeneration.subscribeTaskEvents(
      taskId, { onTask: (t) => setTask(t) }, { signal: ctl.signal },
    ).catch(() => { /* SSE 失败静默 */ });
    return () => ctl.abort();
  }, [taskId]);

  React.useEffect(() => {
    if (task && (task.state === 'complete' || task.state === 'failed' || task.state === 'canceled')) {
      onTerminal?.();
    }
  }, [task?.state, onTerminal]);

  if (!task) return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3 text-xs text-[var(--cy-text-tertiary)]">
      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> 等待任务订阅…
    </div>
  );

  const p = task.progress;
  const cancel = async () => { try { await videoGeneration.cancelTask(taskId); } catch { /* noop */ } };

  if (task.state === 'complete') {
    const videos = task.result?.final_videos ?? [];
    return (
      <div className="space-y-2">
        <p className="text-xs text-emerald-700">
          <CircleCheck className="mr-1 inline h-3.5 w-3.5" /> 合成完成 · {videos.length} 份
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {videos.map((vp, i) => {
            const name = vp.split(/[\\/]/).pop() || `final-${i+1}.mp4`;
            return (
              <li key={vp} className="overflow-hidden rounded-lg border border-[var(--cy-border-subtle)]">
                <video src={vgTaskFileUrl(taskId, name, false)} controls preload="metadata"
                  className="w-full bg-black" style={{ aspectRatio: '9 / 16', maxHeight: '40vh' }} />
                <div className="flex items-center justify-between gap-2 p-1.5 text-[10px]">
                  <span className="truncate">{name}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      // Tauri WKWebView 不支持 <a download> 存盘 → 统一 fetch blob + saveBinary(弹原生保存框)
                      try {
                        const { blob } = await videoGeneration.downloadTaskFile(taskId, name);
                        await getPlatform().fs.saveBinary(name, blob);
                      } catch (e) {
                        reportError(e as Error, '下载失败');
                      }
                    }}
                    className="inline-flex items-center gap-0.5 rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5">
                    <Download className="h-3 w-3" /> 下载
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (task.state === 'failed') {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs">
        <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-600" />
        合成失败:{(task.error || '未知错误').slice(0, 100)}
      </div>
    );
  }

  if (task.state === 'canceled') {
    return <p className="text-xs text-[var(--cy-text-tertiary)]"><Square className="mr-1 inline h-3 w-3" /> 已取消</p>;
  }

  // processing / pending
  return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--cy-brand-500)]" />
        <span className="text-[var(--cy-text-secondary)]">{stepLabel(p)}</span>
        <span className="ml-auto tabular-nums text-[var(--cy-text-tertiary)]">{p}%</span>
        <button type="button" onClick={cancel}
          className="rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5 text-[10px] hover:border-rose-300 hover:text-rose-600">
          <Square className="mr-0.5 inline h-2.5 w-2.5" /> 取消
        </button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--cy-surface-2)]">
        <div className="h-full bg-[var(--cy-brand-500)] transition-all"
          style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      </div>
    </div>
  );
};
