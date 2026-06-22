/**
 * authPolicy —— 网络版「后端鉴权策略」单次探测 + 缓存。
 *
 * 背景:开启「强制登录(AUTH_REQUIRED)」后,未登录用户必须先登录才能进主页。
 * 但路由守卫(workspaceLayoutRoute.beforeLoad)早于 Shell 拉 ``/auth/config``,
 * 此时 ``loginModal.authRequired`` 还是 ``null``,守卫会误放行 → 首页先挂载、
 * 打 401、Shell 再补跳 /login,造成「闪一下首页」+ 无谓 401。
 *
 * 这里把探测收敛成一个幂等入口:守卫在判断前 ``await ensureAuthPolicy()``,
 * 拿到结果再决定是否 redirect,从而把「强制登录」做成硬门禁(无闪现)。
 * 单飞(inflight)去重,并发调用只发一次网络请求。
 */
import { auth as authApi } from '@chayuan/api';
import { useLoginModalStore } from '../../store/loginModal';

let inflight: Promise<void> | null = null;

/**
 * 确保已探测后端鉴权策略并写入 loginModal store。
 *   - 默认:``authRequired`` 已探测过(非 null)直接返回,不重复请求。
 *   - ``force=true``:强制重探(登录态变化后需刷新 admin_setup_required 等)。
 * 拉不到配置当作「非强制」,避免卡白屏。
 */
export async function ensureAuthPolicy(force = false): Promise<void> {
  if (!force && useLoginModalStore.getState().authRequired !== null) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const cfg = await authApi.config();
      const s = useLoginModalStore.getState();
      s.setAllowRegistration(cfg.auth_allow_registration);
      s.setAuthRequired(Boolean(cfg.auth_required));
      s.setAdminSetupRequired(Boolean(cfg.admin_setup_required));
    } catch {
      useLoginModalStore.getState().setAuthRequired(false);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
