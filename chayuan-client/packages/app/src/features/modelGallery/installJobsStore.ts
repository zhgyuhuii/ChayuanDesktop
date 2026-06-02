/**
 * 模型广场「全局下载任务」store —— 单一真源,跨行 / 翻页 / 搜索 / 切菜单不丢进度。
 *
 * 背景(P0 修复)
 * ===============
 * 旧实现把下载 job 存在 ``ModelHubRow`` 各自的 ``useInstallJob`` useState 里。
 * 行一旦 unmount(翻页 / 改搜索 / 切到别的菜单),进度 state 连同轮询 interval
 * 一起销毁 —— 用户回来看到的是「安装」按钮,以为没在下,实际后端还在下载。
 *
 * 修法:把进行中 / 最近的 job 提到全局 zustand store,按 ``key = source::model_id``
 * 索引;ModelHubRow 按自己卡片的 key 从 store 读对应 job 渲染进度。轮询也在
 * store 层做(单一 interval,只要有进行中 job 就转,与任何行的挂载无关)。
 *
 * 设计要点
 * ========
 * - **key = ``source::model_id``**:跟 ModelGalleryPage 里 ModelHubRow 的 React key
 *   (``${card.source}::${card.model_id}``)一致,行能直接按自己卡片定位 job。
 * - **轮询单点**:``ensurePolling`` 起一个全局 interval(2s),刷新所有非终态 job;
 *   全部进终态后自动停。行 mount/unmount 不影响轮询。
 * - **回填**:``hydrate()`` 调 ``serverModelsInstallModel.list()`` 把后端已有 job
 *   灌进 store(进入模型广场 / 刷新时拉一次),让重进也能看到在下的任务。
 * - **不持久化**:后端是唯一真源,store 只是 cache layer。
 */

import {
  type InstallModelJob,
  serverModelsInstallModel,
} from '@chayuan/api';
import { create } from 'zustand';

/** 任务索引 key:与 ModelHubRow 的 React key 同构。 */
export function jobKey(source: string, modelId: string): string {
  return `${source}::${modelId}`;
}

const POLL_INTERVAL_MS = 2000;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function isTerminal(job: InstallModelJob): boolean {
  return TERMINAL.has(job.status);
}

/** start 入参;requested_file 映射到后端的 specific_file。 */
export interface StartInstallArgs {
  source: string;
  model_id: string;
  capability: string;
  requested_file?: string | null;
  revision?: string | null;
}

export interface InstallJobsStoreState {
  /** key=`source::model_id` → 最近一次该卡片的 job(进行中或终态)。 */
  jobs: Record<string, InstallModelJob>;
  /** 已成功完成、但本会话尚未通知调用方 onDone 的 job key(用于 UI 刷新去重)。 */
  hydrated: boolean;

  /** 启动一次下载并写入 store;返回 job(失败时 reject)。 */
  start(args: StartInstallArgs): Promise<InstallModelJob>;
  /** 取消(乐观本地置 cancelled + 后端 fire-and-forget)。 */
  cancel(key: string): void;
  /** 清掉某个 key 的 job state(重试前 / 关闭面板)。 */
  reset(key: string): void;
  /** 进入模型广场 / 刷新时拉一次后端全部 job 回填。 */
  hydrate(): Promise<void>;
}

// interval 句柄放模块作用域(单例 store,无需放进 state 触发渲染)。
let pollTimer: ReturnType<typeof setInterval> | null = null;
// 成功完成时的回调:由订阅方(ModelGalleryPage)注册,用来 invalidate query。
const doneListeners = new Set<(job: InstallModelJob) => void>();

/** 订阅「某个 job 成功完成」事件;返回取消订阅函数。 */
export function onInstallJobDone(fn: (job: InstallModelJob) => void): () => void {
  doneListeners.add(fn);
  return () => doneListeners.delete(fn);
}

function notifyDone(job: InstallModelJob): void {
  doneListeners.forEach((fn) => {
    try {
      fn(job);
    } catch {
      /* 监听器异常不影响其它监听器 */
    }
  });
}

export const useInstallJobsStore = create<InstallJobsStoreState>((set, get) => {
  /** 有任何非终态 job 时确保轮询在转;否则停。 */
  function ensurePolling(): void {
    const anyActive = Object.values(get().jobs).some((j) => !isTerminal(j));
    if (anyActive && pollTimer === null) {
      pollTimer = setInterval(() => {
        void pollOnce();
      }, POLL_INTERVAL_MS);
    } else if (!anyActive && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /** 刷新所有非终态 job;新到的终态成功 job 触发 doneListeners。 */
  async function pollOnce(): Promise<void> {
    const active = Object.entries(get().jobs).filter(([, j]) => !isTerminal(j));
    if (active.length === 0) {
      ensurePolling();
      return;
    }
    await Promise.all(
      active.map(async ([key, j]) => {
        try {
          const fresh = await serverModelsInstallModel.get(j.id);
          // get 返回空对象({} as InstallModelJob)时跳过,避免覆盖成无 id 脏数据。
          if (!fresh || !fresh.id) return;
          const wasTerminal = isTerminal(j);
          set((s) => ({ jobs: { ...s.jobs, [key]: fresh } }));
          if (!wasTerminal && fresh.status === 'succeeded') notifyDone(fresh);
        } catch {
          // 单个 job 查询失败:保留旧 state,下一轮再试。
        }
      }),
    );
    ensurePolling();
  }

  return {
    jobs: {},
    hydrated: false,

    async start(args) {
      const key = jobKey(args.source, args.model_id);
      const job = await serverModelsInstallModel.start({
        source: args.source as never,
        model_id: args.model_id,
        capability: args.capability,
        specific_file: args.requested_file ?? null,
        revision: args.revision ?? null,
      });
      set((s) => ({ jobs: { ...s.jobs, [key]: job } }));
      if (job.status === 'succeeded') notifyDone(job);
      ensurePolling();
      return job;
    },

    cancel(key) {
      const job = get().jobs[key];
      if (!job) return;
      // 后端 cancel 只 set flag(SDK 阻塞下载不可即时中断)→ 前端乐观置 cancelled
      // 给即时反馈,后端 cancel fire-and-forget。
      void serverModelsInstallModel.cancel(job.id).catch(() => {});
      set((s) => ({
        jobs: {
          ...s.jobs,
          [key]: {
            ...job,
            status: 'cancelled',
            log_tail: [
              ...job.log_tail,
              '[install_model] 已请求取消;后台 SDK 阻塞调用会在当前下载片段完成后退出',
            ],
          },
        },
      }));
      ensurePolling();
    },

    reset(key) {
      set((s) => {
        if (!(key in s.jobs)) return s;
        const next = { ...s.jobs };
        delete next[key];
        return { jobs: next };
      });
      ensurePolling();
    },

    async hydrate() {
      try {
        const list = await serverModelsInstallModel.list();
        set((s) => {
          const next = { ...s.jobs };
          for (const job of list) {
            const key = jobKey(job.source, job.model_id);
            // 回填策略:后端没记录的不动;已有 in-memory 进行中 job 不被旧快照覆盖。
            const existing = next[key];
            if (existing && !isTerminal(existing)) continue;
            next[key] = job;
          }
          return { jobs: next, hydrated: true };
        });
        ensurePolling();
      } catch {
        // 回填失败(后端未起 / 离线)不阻塞页面;标记 hydrated 避免反复重试卡住。
        set({ hydrated: true });
      }
    },
  };
});
