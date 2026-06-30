import * as React from 'react';
import { Button } from '@chayuan/ui';
import { Building2, FolderPlus, FolderTree, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { orgs as orgsApi, depts as deptsApi, roles as rolesApi, type DeptNode } from '@chayuan/api';
import { reportError, notifySuccess } from '../../../store/errorDialog';
import { promptDialog } from '../../../store/promptDialog';
import { confirmDialog } from '../../../store/confirmDialog';
import { DeptTree } from './DeptTree';
import { OrgFormDialog } from './OrgFormDialog';

// 组织机构页(org-RBAC P5)。左:组织下拉 + 部门树 + 建组织/部门/删;
// 右:选中部门的成员列表 + 部门继承角色(成员自动获得这些角色功能权)。
// 仅网络版后台用;部门输入走统一 promptDialog,新建组织走 OrgFormDialog(双字段+自动编码)。
export const OrgManagementPage: React.FC = () => {
  const [orgId, setOrgId] = React.useState<number | null>(null);
  const [sel, setSel] = React.useState<DeptNode | null>(null);
  const [includeSub, setIncludeSub] = React.useState(false);
  const [orgFormOpen, setOrgFormOpen] = React.useState(false);

  const orgsQ = useQuery({ queryKey: ['admin', 'orgs'], queryFn: () => orgsApi.list(), staleTime: 60_000 });
  React.useEffect(() => {
    const first = orgsQ.data?.[0];
    if (orgId === null && first) setOrgId(first.id);
  }, [orgsQ.data, orgId]);

  const treeQ = useQuery({
    queryKey: ['admin', 'depts', orgId],
    queryFn: () => deptsApi.tree(orgId as number),
    enabled: orgId !== null,
  });
  const membersQ = useQuery({
    queryKey: ['admin', 'dept-members', sel?.id, includeSub],
    queryFn: () => deptsApi.members(sel!.id, includeSub),
    enabled: !!sel,
  });
  const deptRolesQ = useQuery({
    queryKey: ['admin', 'dept-roles', sel?.id],
    queryFn: () => deptsApi.roles(sel!.id),
    enabled: !!sel,
  });
  const allRolesQ = useQuery({ queryKey: ['admin', 'roles', 'all'], queryFn: () => rolesApi.list(), staleTime: 60_000 });

  const existingCodes = React.useMemo(() => (orgsQ.data ?? []).map((o) => o.code), [orgsQ.data]);

  const addDept = async (parentId: number | null) => {
    if (orgId === null) return;
    const nm = await promptDialog('部门名称', { title: '新建部门' });
    if (!nm) return;
    try { await deptsApi.create({ org_id: orgId, parent_id: parentId, name: nm }); notifySuccess('已创建部门'); void treeQ.refetch(); }
    catch (e) { reportError(e, '创建部门失败'); }
  };
  const delOrg = async () => {
    if (orgId === null) return;
    const cur = (orgsQ.data ?? []).find((o) => o.id === orgId);
    if (!(await confirmDialog(`确定删除组织「${cur?.name ?? orgId}」？组织下若仍有部门会被拒绝，需先清空部门。`, { title: '删除组织？', danger: true }))) return;
    try {
      await orgsApi.remove(orgId);
      notifySuccess('已删除组织');
      setOrgId(null);
      setSel(null);
      void orgsQ.refetch();
    } catch (e) {
      reportError(e, '删除组织失败（可能仍有部门）');
    }
  };
  const delDept = async (d: DeptNode) => {
    try { await deptsApi.remove(d.id); notifySuccess('已删除'); setSel(null); void treeQ.refetch(); }
    catch (e) { reportError(e, '删除部门失败(可能有子部门/成员)'); }
  };
  const toggleDeptRole = async (roleName: string, on: boolean) => {
    if (!sel) return;
    const cur = deptRolesQ.data ?? [];
    const next = on
      ? [...cur, { role_name: roleName, include_subtree: false }]
      : cur.filter((r) => r.role_name !== roleName);
    try { await deptsApi.setRoles(sel.id, next); void deptRolesQ.refetch(); }
    catch (e) { reportError(e, '保存部门角色失败'); }
  };
  const toggleDeptRoleSubtree = async (roleName: string, sub: boolean) => {
    if (!sel) return;
    const next = (deptRolesQ.data ?? []).map((r) => r.role_name === roleName ? { ...r, include_subtree: sub } : r);
    try { await deptsApi.setRoles(sel.id, next); void deptRolesQ.refetch(); }
    catch (e) { reportError(e, '保存失败'); }
  };

  return (
    <div className="flex h-full gap-4 p-4">
      <div className="w-72 shrink-0 rounded-lg border border-[var(--cy-border-subtle)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <select className="flex-1 rounded border p-1.5 text-sm" value={orgId ?? ''} onChange={(e) => { setOrgId(e.target.value === '' ? null : Number(e.target.value)); setSel(null); }}>
            {(orgsQ.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setOrgFormOpen(true)} title="新建组织">
            <Building2 className="h-4 w-4" />
          </Button>
          {orgId !== null ? (
            <Button variant="outline" size="sm" className="shrink-0 text-red-500 hover:text-red-600" onClick={() => void delOrg()} title="删除当前组织">
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <div className="mb-2 flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => void addDept(null)}>
            <FolderPlus className="mr-1 h-4 w-4" /> 根部门
          </Button>
          {sel ? (
            <Button variant="ghost" size="sm" onClick={() => void addDept(sel.id)}>
              <FolderTree className="mr-1 h-4 w-4" /> 子部门
            </Button>
          ) : null}
          {sel ? (
            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => void delDept(sel)}>
              <Trash2 className="mr-1 h-4 w-4" /> 删除
            </Button>
          ) : null}
        </div>
        <DeptTree nodes={treeQ.data ?? []} selectedId={sel?.id ?? null} onSelect={setSel} />
      </div>

      <div className="flex-1 rounded-lg border border-[var(--cy-border-subtle)] p-3">
        {!sel ? (
          <div className="text-sm text-muted-foreground">请选择左侧部门</div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-medium">{sel.name} · 成员</div>
              <label className="text-xs"><input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> 含下级</label>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="p-1">用户名</th><th className="p-1">角色</th><th className="p-1">状态</th></tr></thead>
              <tbody>
                {(membersQ.data ?? []).map((m) => (
                  <tr key={m.id} className="border-t"><td className="p-1">{m.username}</td><td className="p-1">{m.roles.join(', ')}</td><td className="p-1">{m.is_active ? '正常' : '停用'}</td></tr>
                ))}
                {!(membersQ.data ?? []).length ? <tr><td colSpan={3} className="p-2 text-muted-foreground">暂无成员</td></tr> : null}
              </tbody>
            </table>

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium opacity-70">部门继承角色（成员自动获得这些角色的功能权）</div>
              <div className="space-y-1">
                {(allRolesQ.data?.roles ?? []).map((r) => {
                  const dr = (deptRolesQ.data ?? []).find((x) => x.role_name === r.name);
                  const on = !!dr;
                  return (
                    <div key={r.name} className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={on} onChange={(e) => void toggleDeptRole(r.name, e.target.checked)} />{r.name}</label>
                      {on && dr ? <label className="flex items-center gap-1 text-xs opacity-70"><input type="checkbox" checked={dr.include_subtree} onChange={(e) => void toggleDeptRoleSubtree(r.name, e.target.checked)} />传给下级</label> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <OrgFormDialog
        open={orgFormOpen}
        existingCodes={existingCodes}
        onClose={() => setOrgFormOpen(false)}
        onCreated={() => void orgsQ.refetch()}
      />
    </div>
  );
};
