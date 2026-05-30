/**
 * 授权激活态（client state）。
 *
 * - 真源是 PAL 安全存储里的 ActivationRecord；本 store 只缓存**反应式状态**供 UI 订阅，
 *   **不** persist 到 localStorage（避免与防回拨 seenMax 冲突，且记录在原生安全层）。
 * - 桌面在 main.tsx 注入 deps（PAL license host + 内嵌公钥 + entitlement 基址）后 `configure()`。
 * - Web 不注入（platform.license 为 undefined）→ `enabled=false` → 门控放行（Web 由账号/服务端控权）。
 */

import { create } from 'zustand';
import {
  type ActivationDeps,
  type ActivationSource,
  type ActivationStatus,
  activateBySerial,
  activateByToken,
  activateOnline,
  currentStatus,
} from './activation';

interface LicenseState {
  /** 仅桌面注入 deps 后为 true；Web 为 false → 不门控。 */
  enabled: boolean;
  deps: ActivationDeps | null;
  statusByApp: Record<string, ActivationStatus>;

  configure(deps: ActivationDeps): void;
  /** 读本地态；若无记录则 best-effort 在线自动激活一次。 */
  refresh(app: string): Promise<ActivationStatus>;
  activateSerial(app: string, serial: string): Promise<ActivationStatus>;
  activateToken(app: string, token: string, source: ActivationSource): Promise<ActivationStatus>;
  activateOnline(app: string): Promise<ActivationStatus>;
  /** 门控判定：未启用(Web)=放行；启用=按已知 status。 */
  isLicensed(app: string): boolean;
  reset(): void;
}

const PASS = (app: string): ActivationStatus => ({ licensed: true, app });

export const useLicenseStore = create<LicenseState>((set, get) => ({
  enabled: false,
  deps: null,
  statusByApp: {},

  configure(deps) {
    set({ deps, enabled: true });
  },

  async refresh(app) {
    const { deps } = get();
    if (!deps) return PASS(app);
    let s = await currentStatus(app, deps);
    if (!s.licensed && s.reason === 'none') {
      const online = await activateOnline(app, deps).catch(() => null);
      if (online?.licensed) s = online;
    }
    set((st) => ({ statusByApp: { ...st.statusByApp, [app]: s } }));
    return s;
  },

  async activateSerial(app, serial) {
    const { deps } = get();
    if (!deps) return PASS(app);
    const s = await activateBySerial(app, serial, deps);
    set((st) => ({ statusByApp: { ...st.statusByApp, [app]: s } }));
    return s;
  },

  async activateToken(app, token, source) {
    const { deps } = get();
    if (!deps) return PASS(app);
    const s = await activateByToken(app, token, source, deps);
    set((st) => ({ statusByApp: { ...st.statusByApp, [app]: s } }));
    return s;
  },

  async activateOnline(app) {
    const { deps } = get();
    if (!deps) return PASS(app);
    const s = await activateOnline(app, deps);
    set((st) => ({ statusByApp: { ...st.statusByApp, [app]: s } }));
    return s;
  },

  isLicensed(app) {
    const { enabled, statusByApp } = get();
    if (!enabled) return true; // Web / 未配置:不门控
    return statusByApp[app]?.licensed ?? false;
  },

  reset() {
    set({ statusByApp: {} });
  },
}));

/** 反应式门控判定（供组件订阅）：未启用(Web)放行；启用按 status。 */
export function useIsLicensed(app: string): boolean {
  return useLicenseStore((s) => (!s.enabled ? true : (s.statusByApp[app]?.licensed ?? false)));
}
