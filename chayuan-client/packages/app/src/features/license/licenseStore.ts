/**
 * 授权激活态（client state）。
 *
 * - 真源在 chayuan-server（机器指纹绑定 + 防回拨）。本 store 只缓存反应式状态供 UI 订阅，
 *   不 persist（避免与后端 seenMax 冲突）。
 * - 桌面走本地 sidecar、网页走远程同一套 `/api/v1/license/*`；门控统一按后端 `licensed`。
 * - fail-closed：未刷新 / 网络异常 → 未授权，由 LicenseGate 显激活入口（可离线手输短码）。
 */

import {
  type ConsumeResult,
  type LicenseStatus,
  licenseActivate,
  licenseActivateToken,
  licenseConsume,
  licenseStatus,
} from '@chayuan/api';
import { create } from 'zustand';

export type { ConsumeResult, LicenseStatus } from '@chayuan/api';

interface LicenseState {
  statusByApp: Record<string, LicenseStatus>;
  /** 该 app 是否已至少刷新回来一次（供 Gate 显 loading，避免闪锁屏）。 */
  readyApps: Record<string, boolean>;

  /** 读后端授权态（后端内部做偶尔在线自动激活）。网络异常落 fail-closed（不抛）。 */
  refresh(app: string): Promise<LicenseStatus>;
  /**
   * 主动激活：与 `refresh` 不同，**网络/服务端异常会向上抛**（由 LicenseDialog 的
   * try/catch 捕获并显错），因为这是用户显式操作、需要看到失败原因；失败时不动 store 缓存。
   */
  activateSerial(app: string, serial: string): Promise<LicenseStatus>;
  /** 同 activateSerial：异常上抛由调用方处理。 */
  activateToken(app: string, token: string): Promise<LicenseStatus>;
  /**
   * 按次门控：执行前调用扣减一次额度，直接转发 licenseConsume，不缓存结果。
   * 网络异常会向上抛（调用方负责 fail-open 或错误处理）。
   */
  consume(app: string): Promise<ConsumeResult>;
  isLicensed(app: string): boolean;
  isReady(app: string): boolean;
  reset(): void;
}

const FAIL_CLOSED = (app: string): LicenseStatus => ({ licensed: false, app, reason: 'none' });

export const useLicenseStore = create<LicenseState>((set, get) => {
  /** 写入某 app 的授权态并置 ready（三处写路径共用）。 */
  const put = (app: string, s: LicenseStatus): void =>
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));

  return {
    statusByApp: {},
    readyApps: {},

    async refresh(app) {
      let s: LicenseStatus;
      try {
        s = await licenseStatus(app);
      } catch {
        s = FAIL_CLOSED(app);
      }
      put(app, s);
      return s;
    },

    async activateSerial(app, serial) {
      const s = await licenseActivate(app, serial);
      put(app, s);
      return s;
    },

    async activateToken(app, token) {
      const s = await licenseActivateToken(app, token);
      put(app, s);
      return s;
    },

    async consume(app) {
      return licenseConsume(app);
    },

    isLicensed(app) {
      return get().statusByApp[app]?.licensed ?? false;
    },

    isReady(app) {
      return get().readyApps[app] ?? false;
    },

    reset() {
      set({ statusByApp: {}, readyApps: {} });
    },
  };
});

/** 反应式门控判定（供组件订阅）：fail-closed。 */
export function useIsLicensed(app: string): boolean {
  return useLicenseStore((s) => s.statusByApp[app]?.licensed ?? false);
}

/** 反应式 ready 判定（供 Gate 显 loading）。 */
export function useLicenseReady(app: string): boolean {
  return useLicenseStore((s) => s.readyApps[app] ?? false);
}
