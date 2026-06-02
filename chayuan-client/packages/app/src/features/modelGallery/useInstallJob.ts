/**
 * 共享的「单模型下载任务」hook。对外提供两个 hook,签名/语义一致
 * (job / isInstalling / start / cancel / reset),区别只在 state 落在哪:
 *
 *   - ``useInstallJobFor(key, opts)``(推荐,模型广场行用):job state + 轮询都落在
 *     全局 ``useInstallJobsStore``,按 ``key = source::model_id`` 索引。行 unmount/
 *     remount、翻页、搜索、切菜单都不丢进度(P0 修复)。轮询在 store 层单点进行,
 *     与行的挂载无关。
 *
 *   - ``useInstallJob(opts)``(旧 InstallModelDialog 用):本地 useState + 内联轮询。
 *     单例对话框一次只下一个、关掉即销毁,没有「行 unmount 丢进度」问题,行为与
 *     历史一字不差。
 *
 * 两者对外 API 完全一致,调用方按场景选其一即可。
 */
import * as React from 'react';
import {
  type InstallModelCapability,
  type InstallModelJob,
  type InstallModelSource,
  serverModelsInstallModel,
} from '@chayuan/api';
import {
  jobKey,
  onInstallJobDone,
  useInstallJobsStore,
} from './installJobsStore';

/** start 入参;requested_file 映射到后端的 specific_file。 */
export interface StartInstallArgs {
  source: InstallModelSource;
  model_id: string;
  capability: InstallModelCapability | string;
  requested_file?: string | null;
  revision?: string | null;   // 仓库分支/tag/commit;省略=源默认分支
  /** 预估下载体积(选中文件大小 / 仓库总大小);后端据此做磁盘空间预检。 */
  expected_bytes?: number | null;
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

// ── 全局 store 背书版(模型广场行) ─────────────────────────────────────
/**
 * 按 ``key``(= `source::model_id`)从全局下载 store 读 / 写 job。
 * 行 unmount 不影响进度与轮询。
 */
export function useInstallJobFor(
  key: string,
  opts?: { onDone?: (job: InstallModelJob) => void },
): UseInstallJobResult {
  const job = useInstallJobsStore((s) => s.jobs[key] ?? null);
  const storeStart = useInstallJobsStore((s) => s.start);
  const storeCancel = useInstallJobsStore((s) => s.cancel);
  const storeReset = useInstallJobsStore((s) => s.reset);

  // onDone 经由 store 的全局 doneListeners 派发;只关心本 key 的完成事件。
  const onDoneRef = React.useRef(opts?.onDone);
  onDoneRef.current = opts?.onDone;
  React.useEffect(() => {
    return onInstallJobDone((done) => {
      if (jobKey(done.source, done.model_id) === key) onDoneRef.current?.(done);
    });
  }, [key]);

  const start = React.useCallback(
    async (args: StartInstallArgs) => {
      await storeStart({
        source: args.source,
        model_id: args.model_id,
        capability: args.capability,
        requested_file: args.requested_file ?? null,
        revision: args.revision ?? null,
        expected_bytes: args.expected_bytes ?? null,
      });
    },
    [storeStart],
  );

  const cancel = React.useCallback(() => storeCancel(key), [storeCancel, key]);
  const reset = React.useCallback(() => storeReset(key), [storeReset, key]);

  const isInstalling =
    job !== null && (job.status === 'queued' || job.status === 'running');

  return { job, isInstalling, start, cancel, reset };
}

// ── 本地 state 版(旧 InstallModelDialog,行为与历史一字不差) ───────────
export function useInstallJob(opts?: {
  onDone?: (job: InstallModelJob) => void;
}): UseInstallJobResult {
  const [job, setJob] = React.useState<InstallModelJob | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const onDoneRef = React.useRef(opts?.onDone);
  onDoneRef.current = opts?.onDone;

  const stopPolling = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

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
        expected_bytes: args.expected_bytes ?? null,
      });
      setJob(j);
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
