import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@chayuan/ui';
import {
  adminCreateUser,
  roles as rolesApi,
  orgs as orgsApi,
  depts as deptsApi,
} from '@chayuan/api';
import { useQuery } from '@tanstack/react-query';
import { DeptSelect } from '../orgs/DeptTree';

/** 管理控制台「用户」页新建用户 —— 真·弹窗(Radix Dialog),点「新建用户」弹出。 */
export const CreateUserDialog: React.FC<{ onCreated(): void }> = ({ onCreated }) => {
  const [open, setOpen] = React.useState(false);
  const [username, setU] = React.useState('');
  const [password, setP] = React.useState('');
  const [email, setE] = React.useState('');
  // 多角色复选(org-RBAC P5):默认 user。
  const [roleSet, setRoleSet] = React.useState<Set<string>>(new Set(['user']));
  // 部门归属:组织下拉 + 部门下拉。
  const [orgId, setOrgId] = React.useState<number | null>(null);
  const [deptId, setDeptId] = React.useState<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // 角色复选用真实角色表(含自定义角色,RBAC #2);未加载时回退内置 user/admin。
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

  // 组织 / 部门:仅弹窗打开时拉取。
  const orgsQ = useQuery({
    queryKey: ['admin', 'orgs', 'for-create'],
    queryFn: () => orgsApi.list(),
    staleTime: 60_000,
    enabled: open,
  });
  React.useEffect(() => {
    if (orgId === null && orgsQ.data && orgsQ.data.length > 0) {
      setOrgId(orgsQ.data[0]!.id);
    }
  }, [orgsQ.data, orgId]);

  const treeQ = useQuery({
    queryKey: ['admin', 'depts', 'for-create', orgId],
    queryFn: () => deptsApi.tree(orgId as number),
    enabled: open && orgId !== null,
  });

  const toggleRole = (name: string) => {
    setRoleSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const reset = () => {
    setU('');
    setP('');
    setE('');
    setRoleSet(new Set(['user']));
    setOrgId(null);
    setDeptId(null);
    setErr(null);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminCreateUser({
        username: username.trim(),
        password,
        roles: Array.from(roleSet),
        email: email.trim() || undefined,
        dept_id: deptId,
      });
      setOpen(false);
      reset();
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>新建用户</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <input
            className="w-full rounded border p-2 text-sm"
            placeholder="用户名*"
            value={username}
            autoFocus
            onChange={(e) => setU(e.target.value)}
          />
          <input
            className="w-full rounded border p-2 text-sm"
            placeholder="邮箱(可选)"
            value={email}
            onChange={(e) => setE(e.target.value)}
          />
          <input
            className="w-full rounded border p-2 text-sm"
            type="password"
            placeholder="初始密码*(≥6)"
            value={password}
            onChange={(e) => setP(e.target.value)}
          />

          <label className="block text-xs opacity-60">角色（可多选）</label>
          <div className="max-h-40 space-y-1 overflow-auto rounded border p-2">
            {roleList.map((r) => (
              <label key={r.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={roleSet.has(r.name)}
                  onChange={() => toggleRole(r.name)}
                />
                <span>{r.name}</span>
                {r.description ? (
                  <span className="text-xs opacity-60">—— {r.description}</span>
                ) : null}
              </label>
            ))}
          </div>

          <label className="block text-xs opacity-60">所属部门（可选）</label>
          <select
            className="w-full rounded border p-2 text-sm"
            value={orgId ?? ''}
            onChange={(e) => {
              setOrgId(e.target.value === '' ? null : Number(e.target.value));
              setDeptId(null);
            }}
          >
            <option value="">（选择组织）</option>
            {(orgsQ.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <DeptSelect nodes={treeQ.data ?? []} value={deptId} onChange={setDeptId} />

          {err ? <p className="text-sm text-destructive">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            取消
          </Button>
          <Button
            disabled={busy || !username.trim() || password.length < 6}
            onClick={() => void submit()}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
