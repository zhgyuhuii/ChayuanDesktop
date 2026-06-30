import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import {
  adminUsersSnapshot,
  adminSetUserActive,
  deploymentStatus,
  type AdminUserRow,
  type DeploymentStatus,
} from '@chayuan/api';
import { CreateUserDialog } from './CreateUserDialog';
import { UserPersonaDialog } from './UserPersonaDialog';
import { EditUserDialog } from './EditUserDialog';
import { confirmDialog } from '../../../store/confirmDialog';

export const UsersTable: React.FC = () => {
  const [kw, setKw] = React.useState('');
  const [personaUser, setPersonaUser] = React.useState<AdminUserRow | null>(null);
  const [editUser, setEditUser] = React.useState<AdminUserRow | null>(null);
  const snap = useQuery({ queryKey: ['admin', 'users', 'snapshot'], queryFn: adminUsersSnapshot, staleTime: 30_000 });
  const seat = useQuery<DeploymentStatus>({ queryKey: ['admin', 'deployment', 'status'], queryFn: deploymentStatus, staleTime: 30_000 });

  const rows = React.useMemo(() => {
    const list: AdminUserRow[] = snap.data?.users ?? [];
    const q = kw.trim().toLowerCase();
    return q
      ? list.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            (u.email ?? '').toLowerCase().includes(q) ||
            u.role.includes(q),
        )
      : list;
  }, [snap.data, kw]);

  const seatFull = seat.data?.maxUsers != null && (seat.data.available ?? 0) <= 0;

  const toggle = async (u: AdminUserRow) => {
    // 停用是破坏性操作,二次确认;启用直接执行。
    if (
      u.is_active &&
      !(await confirmDialog(`确定停用用户「${u.username}」?停用后该用户将无法登录。`, {
        title: '停用用户?',
        danger: true,
      }))
    )
      return;
    await adminSetUserActive(u.id, !u.is_active);
    void snap.refetch();
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <input className="rounded border p-2 text-sm" placeholder="搜索 用户名/邮箱/角色" value={kw} onChange={(e) => setKw(e.target.value)} />
        {seat.data?.maxUsers != null ? (
          <span className="text-sm text-muted-foreground">
            席位 {seat.data.usedUsers}/{seat.data.maxUsers}
          </span>
        ) : null}
      </div>
      {seatFull ? (
        <p className="text-sm text-amber-600">席位已满，无法新建用户。请升级网络版席位。</p>
      ) : (
        <CreateUserDialog
          onCreated={() => {
            void snap.refetch();
            void seat.refetch();
          }}
        />
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="p-2">用户</th>
            <th className="p-2">角色/状态</th>
            <th className="p-2">部门</th>
            <th className="p-2">消息</th>
            <th className="p-2">~tokens</th>
            <th className="p-2">最近活跃</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t">
              <td className="p-2">
                {u.username}
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td className="p-2">
                {(u.roles && u.roles.length ? u.roles.join('/') : u.role)} · {u.is_active ? '启用' : '停用'}
              </td>
              <td className="p-2">{u.dept_name ?? '—'}</td>
              <td className="p-2">{u.msg_count}</td>
              <td className="p-2">{u.est_tokens}</td>
              <td className="p-2">{u.last_active ? new Date(u.last_active).toLocaleString() : '—'}</td>
              <td className="p-2 flex gap-1">
                <Button variant="ghost" onClick={() => setEditUser(u)}>编辑</Button>
                <Button variant="ghost" onClick={() => setPersonaUser(u)}>画像</Button>
                <Button variant="ghost" onClick={() => void toggle(u)}>
                  {u.is_active ? '停用' : '启用'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {snap.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {personaUser ? <UserPersonaDialog user={personaUser} onClose={() => setPersonaUser(null)} /> : null}
      {editUser ? (
        <EditUserDialog
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => void snap.refetch()}
        />
      ) : null}
    </div>
  );
};
