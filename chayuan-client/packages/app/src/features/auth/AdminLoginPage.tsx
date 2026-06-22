/**
 * AdminLoginPage —— 网络版统一独立登录 / 首启页(全页,非 modal)。
 *
 * 路径 `/login`(统一登录入口)。同页双模式(以 `/auth/config` 为准):
 *   - 后端无管理员(admin_setup_required) → 「设置首个管理员」表单(复用原 AdminSetupGate 逻辑)
 *   - 已有管理员 → 「登录」表单(allow_registration 时附「注册」)
 *
 * 登录 / 设置成功后按角色分流:
 *   - role === 'admin' → /admin(管理员专属后台,经 adminRedirect → /admin/traces)
 *   - 其它           → /home
 *
 * 仅网络版使用;单机桌面版不经过此页(沿用原流程)。
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { auth as authApi, type UserInfo } from '@chayuan/api';
import { isAuthPersistent, setAuthPersistent } from '@chayuan/platform-shared';
import { useAuthStore } from '../../store/auth';
import { useLoginModalStore } from '../../store/loginModal';
import { CHAYUAN_LOGO_URL } from '../../lib/brandAssets';

type Mode = 'setup' | 'login' | 'register';

const FIELD =
  'w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] ' +
  'px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const doLogin = useAuthStore((s) => s.login);
  const setUser = useAuthStore((s) => s.setUser);

  const [ready, setReady] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('login');
  const [allowRegistration, setAllowRegistration] = React.useState(false);
  const [authRequired, setAuthRequired] = React.useState(true);
  const [instanceName, setInstanceName] = React.useState('');

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [setupInstance, setSetupInstance] = React.useState('');
  const [remember, setRemember] = React.useState<boolean>(() => isAuthPersistent());
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // 按角色跳转:admin 进专属后台,其它回首页。
  const goByRole = React.useCallback(
    (u: UserInfo) => {
      useLoginModalStore.getState().setAdminSetupRequired(false);
      if (u.role === 'admin') void navigate({ to: '/admin', replace: true });
      else void navigate({ to: '/home', replace: true });
    },
    [navigate],
  );

  // 已登录直接按角色离开登录页(防止登录态下停在 /login)。
  React.useEffect(() => {
    if (isLoggedIn) {
      const u = useAuthStore.getState().user;
      if (u) goByRole(u);
      else void navigate({ to: '/home', replace: true });
    }
  }, [isLoggedIn, goByRole, navigate]);

  // 拉 /auth/config 决定 setup vs login,并同步全局 store(保持守卫一致)。
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await authApi.config();
      if (cancelled) return;
      setAllowRegistration(cfg.auth_allow_registration);
      setAuthRequired(Boolean(cfg.auth_required));
      setInstanceName(cfg.instance_name || '');
      const s = useLoginModalStore.getState();
      s.setAllowRegistration(cfg.auth_allow_registration);
      s.setAuthRequired(Boolean(cfg.auth_required));
      s.setAdminSetupRequired(Boolean(cfg.admin_setup_required));
      setMode(cfg.admin_setup_required ? 'setup' : 'login');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 任意字段 / 模式变化清掉上一次错误。
  React.useEffect(() => {
    setErr(null);
  }, [username, password, confirm, email, setupInstance, mode]);

  const onSetup = async () => {
    if (!username.trim()) return setErr('请输入用户名');
    if (password.length < 6) return setErr('密码至少 6 位');
    if (password !== confirm) return setErr('两次密码不一致');
    setBusy(true);
    try {
      const res = await authApi.setupAdmin({
        username: username.trim(),
        password,
        instanceName: setupInstance.trim() || undefined,
      });
      setUser(res.user);
      goByRole(res.user);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 409) {
        useLoginModalStore.getState().setAdminSetupRequired(false);
        setMode('login');
        setErr('管理员已被创建,请改用登录');
      } else {
        setErr((e as Error)?.message || '设置失败,请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  const onLogin = async () => {
    if (!username.trim() || !password) return setErr('请输入用户名和密码');
    setBusy(true);
    setAuthPersistent(remember);
    try {
      const u = await doLogin(username.trim(), password);
      goByRole(u);
    } catch (e) {
      setErr((e as Error)?.message || '登录失败,请检查用户名或密码');
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    if (!username.trim()) return setErr('请输入用户名');
    if (password.length < 6) return setErr('密码至少 6 位');
    setBusy(true);
    setAuthPersistent(remember);
    try {
      await authApi.register({
        username: username.trim(),
        password,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      const u = await doLogin(username.trim(), password);
      goByRole(u);
    } catch (e) {
      setErr((e as Error)?.message || '注册失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'setup') void onSetup();
    else if (mode === 'register') void onRegister();
    else void onLogin();
  };

  // 强制态(需要登录 或 首启设置)下不给「返回首页」逃生。
  const forced = authRequired || mode === 'setup';
  const title =
    mode === 'setup' ? '首次使用 · 设置管理员' : mode === 'register' ? '注册账户' : '登录';
  const subtitle =
    mode === 'setup'
      ? '检测到系统尚无管理员,请创建首个管理员账户。'
      : mode === 'register'
        ? '创建一个新账户并登录。'
        : '请输入账户与密码登录。';

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[var(--cy-surface-2,#f6f8fc)] px-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(99,102,241,0.10),transparent_32%),radial-gradient(circle_at_75%_75%,rgba(14,165,233,0.10),transparent_30%)]" />
      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-[420px] space-y-4 rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base,#fff)] p-8 shadow-[var(--cy-shadow-lg)] dark:bg-zinc-900"
      >
        <div className="flex flex-col items-center text-center">
          <img src={CHAYUAN_LOGO_URL} alt="察元 AI" className="h-14 w-14 object-contain" />
          <span className="mt-2 text-sm font-semibold tracking-[0.18em] text-[var(--cy-brand-500)]">
            察元AI
          </span>
          {instanceName && <span className="mt-1 text-xs opacity-60">{instanceName}</span>}
        </div>
        <div className="text-center">
          <div className="text-xl font-semibold text-[var(--cy-text-primary)]">{title}</div>
          <div className="mt-1 text-xs opacity-70">{subtitle}</div>
        </div>

        {!ready ? (
          <div className="py-6 text-center text-sm opacity-60">加载中…</div>
        ) : (
          <>
            <input
              className={FIELD}
              placeholder="用户名"
              value={username}
              autoFocus
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              className={FIELD}
              placeholder={mode === 'login' ? '密码' : '密码(≥6 位)'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'setup' && (
              <input
                type="password"
                className={FIELD}
                placeholder="确认密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
            {mode === 'register' && (
              <input
                type="email"
                className={FIELD}
                placeholder="邮箱(可选)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            {mode === 'setup' && (
              <input
                className={FIELD}
                placeholder="实例标识 / 名称(可选)"
                value={setupInstance}
                onChange={(e) => setSetupInstance(e.target.value)}
              />
            )}

            {mode !== 'setup' && (
              <label className="flex items-center gap-2 text-xs opacity-80">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--cy-brand-500)]"
                />
                <span>记住我</span>
              </label>
            )}

            {err && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[var(--cy-brand-500)] py-2.5 text-sm font-medium text-white transition hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
            >
              {busy
                ? '处理中…'
                : mode === 'setup'
                  ? '创建并登录'
                  : mode === 'register'
                    ? '注册并登录'
                    : '登录'}
            </button>

            {mode !== 'setup' && allowRegistration && (
              <div className="text-center text-xs opacity-70">
                {mode === 'register' ? '已有账户?' : '还没有账户?'}{' '}
                <button
                  type="button"
                  className="text-[var(--cy-brand-500)] hover:underline"
                  onClick={() => setMode((m) => (m === 'register' ? 'login' : 'register'))}
                >
                  {mode === 'register' ? '去登录' : '注册'}
                </button>
              </div>
            )}

            {!forced && (
              <button
                type="button"
                className="w-full text-center text-xs opacity-50 hover:opacity-80"
                onClick={() => void navigate({ to: '/home', replace: true })}
              >
                返回首页
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
};
