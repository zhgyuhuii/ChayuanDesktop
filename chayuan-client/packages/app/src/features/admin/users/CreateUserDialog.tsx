import * as React from 'react';
import { Button } from '@chayuan/ui';
import { adminCreateUser, roles as rolesApi } from '@chayuan/api';
import { useQuery } from '@tanstack/react-query';

export const CreateUserDialog: React.FC<{ onCreated(): void }> = ({ onCreated }) => {
  const [open, setOpen] = React.useState(false);
  const [username, setU] = React.useState('');
  const [password, setP] = React.useState('');
  const [email, setE] = React.useState('');
  const [role, setR] = React.useState('user');
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // 角色下拉用真实角色表(含自定义角色,RBAC #2);未加载时回退内置 user/admin。
  const rolesQ = useQuery({
    queryKey: ['admin', 'roles', 'for-create'],
    queryFn: () => rolesApi.list(),
    staleTime: 60_000,
    enabled: open,
  });
  const roleList = rolesQ.data?.roles ?? [
    { name: 'user', description: '普通用户' },
    { name: 'admin', description: '管理员' },
  ];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminCreateUser({ username: username.trim(), password, role, email: email.trim() || undefined });
      setOpen(false);
      setU('');
      setP('');
      setE('');
      setR('user');
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <Button onClick={() => setOpen(true)}>新建用户</Button>;
  return (
    <div className="space-y-2 rounded-xl border p-4">
      <input className="w-full rounded border p-2 text-sm" placeholder="用户名*" value={username} onChange={(e) => setU(e.target.value)} />
      <input className="w-full rounded border p-2 text-sm" placeholder="邮箱(可选)" value={email} onChange={(e) => setE(e.target.value)} />
      <input className="w-full rounded border p-2 text-sm" type="password" placeholder="初始密码*(≥6)" value={password} onChange={(e) => setP(e.target.value)} />
      <label className="block text-xs opacity-60">角色</label>
      <select className="w-full rounded border p-2 text-sm" value={role} onChange={(e) => setR(e.target.value)}>
        {roleList.map((r) => (
          <option key={r.name} value={r.name}>
            {r.name}{r.description ? ` —— ${r.description}` : ''}
          </option>
        ))}
      </select>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={busy || !username.trim() || password.length < 6} onClick={() => void submit()}>创建</Button>
      </div>
    </div>
  );
};
