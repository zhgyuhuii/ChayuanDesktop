/**
 * 授权激活态（client state）。
 *
 * - 真源在 chayuan-server（机器指纹绑定 + 防回拨）。本 store 只缓存反应式状态供 UI 订阅，
 *   不 persist（避免与后端 seenMax 冲突）。
 * - 桌面走本地 sidecar、网页走远程同一套 `/api/v1/license/*`；门控统一按后端 `licensed`。
 * - fail-closed：未刷新 / 网络异常 → 未授权，由 LicenseGate 显激活入口（可离线手输短码）。
 */

import { type LicenseStatus, licenseActivate, licenseActivateToken, licenseStatus } from '@chayuan/api';
import { create } from 'zustand';

export type { LicenseStatus } from '@chayuan/api';

interface LicenseState {
  statusByApp: Record<string, LicenseStatus>;
  /** 该 app 是否已至少刷新回来一次（供 Gate 显 loading，避免闪锁屏）。 */
  readyApps: Record<string, boolean>;

  /** 读后端授权态（后端内部做偶尔在线自动激活）。网络异常落 fail-closed。 */
  refresh(app: string): Promise<LicenseStatus>;
  activateSerial(app: string, serial: string): Promise<LicenseStatus>;
  activateToken(app: string, token: string): Promise<LicenseStatus>;
  isLicensed(app: string): boolean;
  isReady(app: string): boolean;
  reset(): void;
}

const FAIL_CLOSED = (app: string): LicenseStatus => ({ licensed: false, app, reason: 'none' });

export const useLicenseStore = create<LicenseState>((set, get) => ({
  statusByApp: {},
  readyApps: {},

  async refresh(app) {
    let s: LicenseStatus;
    try {
      s = await licenseStatus(app);
    } catch {
      s = FAIL_CLOSED(app);
    }
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));
    return s;
  },

  async activateSerial(app, serial) {
    const s = await licenseActivate(app, serial);
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));
    return s;
  },

  async activateToken(app, token) {
    const s = await licenseActivateToken(app, token);
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));
    return s;
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
}));

/** 反应式门控判定（供组件订阅）：fail-closed。 */
export function useIsLicensed(app: string): boolean {
  return useLicenseStore((s) => s.statusByApp[app]?.licensed ?? false);
}

/** 反应式 ready 判定（供 Gate 显 loading）。 */
export function useLicenseReady(app: string): boolean {
  return useLicenseStore((s) => s.readyApps[app] ?? false);
}
