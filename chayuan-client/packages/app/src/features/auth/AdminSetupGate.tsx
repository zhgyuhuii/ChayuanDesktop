import * as React from 'react';
import { auth as authApi } from '@chayuan/api';
import { useAuthStore } from '../../store/auth';
import { useLoginModalStore } from '../../store/loginModal';

/**
 * 网络版首启:后端无 admin 时全屏强制设置首个管理员。
 * 提交成功 → 写 token + 登录态 + 关闭门;并发被抢先(409)→ 转登录。
 * 仅在 Shell 判定 adminSetupRequired(网络版 + admin_setup_required)时挂载。
 */
export const AdminSetupGate: React.FC = () => {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);

  // 任意字段变化即清除上一次错误提示,避免改完仍显示旧报错
  React.useEffect(() => { setErr(null); }, [username, password, confirm]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!username.trim()) { setErr('请输入用户名'); return; }
    if (password.length < 6) { setErr('密码至少 6 位'); return; }
    if (password !== confirm) { setErr('两次密码不一致'); return; }
    setBusy(true);
    try {
      const res = await authApi.setupAdmin({
        username: username.trim(),
        password,
      });
      setUser(res.user);
      // 以服务端为准重拉 /auth/config 确认 admin 已建(状态一致性保证)。
      // 重拉本身失败不回退:setup 已 200 即权威,兜底直接关门。
      let stillRequired = false;
      try {
        stillRequired = (await authApi.config()).admin_setup_required;
      } catch {
        stillRequired = false;
      }
      if (stillRequired) {
        setErr('管理员保存未生效,请刷新重试');
        return;
      }
      useLoginModalStore.getState().setAdminSetupRequired(false);
    } catch (e2) {
      const status = (e2 as { status?: number })?.status;
      if (status === 409) {
        useLoginModalStore.getState().setAdminSetupRequired(false);
        useLoginModalStore.getState().lock();
        setErr('管理员已被创建,请改用登录');
      } else {
        setErr((e2 as Error)?.message || '设置失败,请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
      >
        <div className="text-lg font-semibold">首次使用 · 设置管理员</div>
        <div className="text-xs opacity-70">检测到系统尚无管理员,请创建首个管理员账户。</div>
        <input
          className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800"
          placeholder="密码(≥6 位)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800"
          placeholder="确认密码"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {err && <div className="text-xs text-rose-600">{err}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-[var(--cy-brand-600)] py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? '设置中…' : '创建并进入'}
        </button>
      </form>
    </div>
  );
};
