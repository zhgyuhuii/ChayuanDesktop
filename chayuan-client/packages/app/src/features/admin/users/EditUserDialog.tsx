import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@chayuan/ui';
import {
  adminSetUserRoles,
  adminSetUserDept,
  roles as rolesApi,
  orgs as orgsApi,
  depts as deptsApi,
  type AdminUserRow,
} from '@chayuan/api';
import { useQuery } from '@tanstack/react-query';
import { DeptSelect } from '../orgs/DeptTree';

/**
 * 编辑现有用户的多角色与所属部门(org-RBAC P5 收尾)。
 * 复用 CreateUserDialog 同款角色复选 + 组织/部门下拉,预填当前值。
 * 角色变更走 PUT /users/{id}/roles;部门「重新指派」或「移出」走 PATCH /users/{id}/dept。
 * 仅在真正改动时才调用对应端点(脏标记),避免无谓写入。
 */
export const EditUserDialog: React.FC<{
  user: AdminUserRow;
  onClose(): void;
  onSaved(): void;
}> = ({ user, onClose, onSaved }) => {
  const initialRoles = React.useMemo(
    () => new Set<string>(user.roles && user.roles.length ? user.roles : user.role ? [user.role] : []),
    [user],
  );
  const [roleSet, setRoleSet] = React.useState<Set<string>>(initialRoles);
  // 部门改派:未触碰则不写。reassign 选了组织+部门 → 写新 dept;移出 → 写 null。
  const [orgId, setOrgId] = React.useState<number | null>(null);
  const [newDeptId, setNewDeptId] = React.useState<number | null>(null);
  const [deptDirty, setDeptDirty] = React.useState(false);
  const [deptTarget, setDeptTarget] = React.useState<number | null>(user.dept_id ?? null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const rolesQ = useQuery({
    queryKey: ['admin', 'roles', 'for-edit'],
    queryFn: () => rolesApi.list(),
    staleTime: 60_000,
  });
  const roleList = rolesQ.data?.roles ?? [
    { name: 'user', description: '普通用户' },
    { name: 'admin', description: '管理员' },
  ];

  const orgsQ = useQuery({
    queryKey: ['admin', 'orgs', 'for-edit'],
    queryFn: () => orgsApi.list(),
    staleTime: 60_000,
  });
  React.useEffect(() => {
    if (orgId === null && orgsQ.data && orgsQ.data.length > 0) {
      setOrgId(orgsQ.data[0]!.id);
    }
  }, [orgsQ.data, orgId]);

  const treeQ = useQuery({
    queryKey: ['admin', 'depts', 'for-edit', orgId],
    queryFn: () => deptsApi.tree(orgId as number),
    enabled: orgId !== null,
  });

  const toggleRole = (name: string) => {
    setRoleSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const rolesChanged = React.useMemo(() => {
    if (roleSet.size !== initialRoles.size) return true;
    for (const r of roleSet) if (!initialRoles.has(r)) return true;
    return false;
  }, [roleSet, initialRoles]);

  const reassign = (deptId: number | null) => {
    setNewDeptId(deptId);
    setDeptTarget(deptId);
    setDeptDirty(true);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (rolesChanged) {
        if (roleSet.size === 0) {
          setErr('至少保留一个角色');
          setBusy(false);
          return;
        }
        await adminSetUserRoles(user.id, Array.from(roleSet));
      }
      if (deptDirty) {
        await adminSetUserDept(user.id, newDeptId);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑用户 · {user.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="block text-xs opacity-60">角色（可多选）</label>
          <div className="max-h-40 space-y-1 overflow-auto rounded border p-2">
            {roleList.map((r) => (
              <label key={r.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={roleSet.has(r.name)} onChange={() => toggleRole(r.name)} />
                <span>{r.name}</span>
                {r.description ? <span className="text-xs opacity-60">—— {r.description}</span> : null}
              </label>
            ))}
          </div>

          <label className="block text-xs opacity-60">所属部门</label>
          <div className="text-sm">
            当前：{deptDirty
              ? (newDeptId === null ? '（移出部门）' : `已选 #${deptTarget}`)
              : (user.dept_name ?? '（无）')}
            {deptDirty || user.dept_id != null ? (
              <Button variant="ghost" size="sm" className="ml-2 text-red-500" onClick={() => reassign(null)}>
                移出部门
              </Button>
            ) : null}
          </div>
          <select
            className="w-full rounded border p-2 text-sm"
            value={orgId ?? ''}
            onChange={(e) => setOrgId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">（选择组织以改派）</option>
            {(orgsQ.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <DeptSelect nodes={treeQ.data ?? []} value={deptDirty ? newDeptId : (user.dept_id ?? null)} onChange={reassign} />

          {err ? <p className="text-sm text-destructive">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || (!rolesChanged && !deptDirty)} onClick={() => void submit()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
