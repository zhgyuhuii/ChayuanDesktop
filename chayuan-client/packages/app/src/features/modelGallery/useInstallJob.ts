/**
 * 共享的「单模型下载任务」hook —— 模型下载轮询逻辑的单一真源。
 *
 * 把过去内联在 InstallModelDialog 里的「start → 每 2s 轮询 get → 终态停」
 * 逻辑抽出来,供模型广场(modelGallery)和旧的 InstallModelDialog 共用,
 * 保证两处行为完全一致。
 *
 * 行为约定(与旧 InstallModelDialog 一字不差):
 *   - start(args): 调 serverModelsInstallModel.start 拿 job → 进入轮询;
 *   - 轮询:job 非终态时每 2s 调 .get(job.id) 刷新 state;
 *   - 终态 ∈ {succeeded, failed, cancelled} 时停轮询;succeeded 时调 onDone(job);
 *   - cancel(): 立即停轮询 + 本地 mock cancelled(给用户即时反馈),
 *     后端 .cancel() 走 fire-and-forget(SDK 阻塞调用不可即时中断);
 *   - reset(): 清掉 job state(关闭对话框 / 重新开始时用)。
 */
import * as React from 'react';
import {
  type InstallModelCapability,
  type InstallModelJob,
  type InstallModelSource,
  serverModelsInstallModel,
} from '@chayuan/api';

/** start 入参;requested_file 映射到后端的 specific_file。 */
export interface StartInstallArgs {
  source: InstallModelSource;
  model_id: string;
  capability: InstallModelCapability | string;
  requested_file?: string | null;
  revision?: string | null;   // 仓库分支/tag/commit;省略=源默认分支
}

export interface UseInstallJobResult {
  job: InstallModelJob | null;
  /** 任务处于 queued/running 中(轮询进行中)。 */
  isInstalling: boolean;
  start(args: StartInstallArgs): Promise<void>;
  cancel(): void;
  reset(): void;
}

const POLL_INTERVAL_MS = 2000;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

export function useInstallJob(opts?: {
  onDone?: (job: InstallModelJob) => void;
}): UseInstallJobResult {
  const [job, setJob] = React.useState<InstallModelJob | null>(null);
  // 用 ref 持有 interval 句柄 + 最新 onDone,避免 effect 依赖抖动重置轮询。
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const onDoneRef = React.useRef(opts?.onDone);
  onDoneRef.current = opts?.onDone;

  const stopPolling = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 卸载时清理 interval。
  React.useEffect(() => stopPolling, [stopPolling]);

  const beginPolling = React.useCallback(
    (jobId: string) => {
      stopPolling();
      timerRef.current = setInterval(() => {
        void serverModelsInstallModel
          .get(jobId)
          .then((fresh) => {
            setJob(fresh);
            if (TERMINAL.has(fresh.status)) {
              stopPolling();
              if (fresh.status === 'succeeded') onDoneRef.current?.(fresh);
            }
          })
          .catch(() => {
            // 查询失败:停轮询,保留最后一次已知 job state 供 UI 展示。
            stopPolling();
          });
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  const start = React.useCallback(
    async (args: StartInstallArgs) => {
      const j = await serverModelsInstallModel.start({
        source: args.source,
        model_id: args.model_id,
        capability: args.capability,
        specific_file: args.requested_file ?? null,
        revision: args.revision ?? null,
      });
      setJob(j);
      // 立即返回的 job 已是终态(极少见)就不开轮询;succeeded 直接回调。
      if (TERMINAL.has(j.status)) {
        if (j.status === 'succeeded') onDoneRef.current?.(j);
        return;
      }
      beginPolling(j.id);
    },
    [beginPolling],
  );

  const cancel = React.useCallback(() => {
    stopPolling();
    setJob((prev) => {
      if (!prev) return prev;
      // 后端 cancel 只 set flag,SDK 阻塞下载不可即时中断 —— 前端立即收尾
      // UI(mock cancelled)给用户即时反馈,后端 cancel fire-and-forget。
      void serverModelsInstallModel.cancel(prev.id).catch(() => {});
      return {
        ...prev,
        status: 'cancelled',
        log_tail: [
          ...prev.log_tail,
          '[install_model] 已请求取消;后台 SDK 阻塞调用会在当前下载片段完成后退出',
        ],
      };
    });
  }, [stopPolling]);

  const reset = React.useCallback(() => {
    stopPolling();
    setJob(null);
  }, [stopPolling]);

  const isInstalling =
    job !== null && (job.status === 'queued' || job.status === 'running');

  return { job, isInstalling, start, cancel, reset };
}
