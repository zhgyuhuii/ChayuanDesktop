import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import {
  kbAcl,
  orgs as orgsApi,
  depts as deptsApi,
  roles as rolesApi,
  type KbAclItem,
  type KbAclUser,
  type KbGrant,
} from '@chayuan/api';
import { reportError } from '../../../store/errorDialog';
import { DeptSelect } from '../orgs/DeptTree';

const SUBJECT_LABEL: Record<string, string> = { user: '用户', role: '角色', dept: '部门' };

export const GrantsDialog: React.FC<{ kb: KbAclItem; users: KbAclUser[]; onClose(): void }> = ({ kb, users, onClose }) => {
  const q = useQuery({ queryKey: ['admin', 'kb-acl', kb.id, 'grants'], queryFn: () => kbAcl.grants(kb.id) });
  const grants = q.data ?? [];

  const [subjectType, setSubjectType] = React.useState<'user' | 'role' | 'dept'>('user');
  const [subjectId, setSubjectId] = React.useState<string>('');
  const [includeSub, setIncludeSub] = React.useState(false);
  const [role, setRole] = React.useState('reader');
  const [orgId, setOrgId] = React.useState<number | null>(null);

  // 切换主体类型时清空已选主体。
  const changeSubjectType = (t: 'user' | 'role' | 'dept') => { setSubjectType(t); setSubjectId(''); };

  const rolesQ = useQuery({
    queryKey: ['admin', 'roles', 'all'],
    queryFn: () => rolesApi.list(),
    enabled: subjectType === 'role',
    staleTime: 60_000,
  });
  const orgsQ = useQuery({
    queryKey: ['admin', 'orgs'],
    queryFn: () => orgsApi.list(),
    enabled: subjectType === 'dept',
    staleTime: 60_000,
  });
  React.useEffect(() => {
    const first = orgsQ.data?.[0];
    if (subjectType === 'dept' && orgId === null && first) setOrgId(first.id);
  }, [subjectType, orgsQ.data, orgId]);
  const treeQ = useQuery({
    queryKey: ['admin', 'depts', orgId],
    queryFn: () => deptsApi.tree(orgId as number),
    enabled: subjectType === 'dept' && orgId !== null,
  });

  // user 主体候选:排除已授权用户 + KB owner。
  const grantedUserIds = new Set(grants.filter((g) => g.subject_type === 'user').map((g) => g.user_id));
  const userCandidates = users.filter((u) => !grantedUserIds.has(u.id) && u.id !== kb.owner_id);

  const add = async () => {
    if (subjectId === '') return;
    try {
      await kbAcl.addSubjectGrant(kb.id, subjectType, subjectId, role, subjectType === 'dept' ? includeSub : false);
      setSubjectId('');
      setIncludeSub(false);
      void q.refetch();
    } catch (e) {
      reportError(e, '授权失败');
    }
  };
  const revoke = async (g: KbGrant) => {
    try {
      await kbAcl.revokeSubjectGrant(kb.id, g.subject_type, g.subject_id);
      void q.refetch();
    } catch (e) {
      reportError(e, '撤销失败');
    }
  };

  const grantLabel = (g: KbGrant): string => {
    if (g.subject_type === 'user') return g.user ?? g.subject_id;
    return g.subject_id;
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-semibold">授权 · {kb.kb_name}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border p-2 text-sm"
            value={subjectType}
            onChange={(e) => changeSubjectType(e.target.value as 'user' | 'role' | 'dept')}
          >
            <option value="user">用户</option>
            <option value="role">角色</option>
            <option value="dept">部门</option>
          </select>

          {subjectType === 'user' ? (
            <select className="flex-1 rounded border p-2 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">选择用户…</option>
              {userCandidates.map((u) => <option key={u.id} value={String(u.id)}>{u.label}</option>)}
            </select>
          ) : null}

          {subjectType === 'role' ? (
            <select className="flex-1 rounded border p-2 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">选择角色…</option>
              {(rolesQ.data?.roles ?? []).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          ) : null}

          {subjectType === 'dept' ? (
            <>
              <select
                className="rounded border p-2 text-sm"
                value={orgId ?? ''}
                onChange={(e) => { setOrgId(e.target.value === '' ? null : Number(e.target.value)); setSubjectId(''); }}
              >
                <option value="">选择组织…</option>
                {(orgsQ.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <div className="flex-1 min-w-[10rem]">
                <DeptSelect
                  nodes={treeQ.data ?? []}
                  value={subjectId === '' ? null : Number(subjectId)}
                  onChange={(id) => setSubjectId(id === null ? '' : String(id))}
                  allowEmpty
                />
              </div>
            </>
          ) : null}

          <select className="rounded border p-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="reader">reader</option>
            <option value="editor">editor</option>
          </select>
          <Button disabled={subjectId === ''} onClick={() => void add()}>授权</Button>
        </div>
        {subjectType === 'dept' ? (
          <label className="mt-2 flex items-center gap-1 text-xs opacity-70">
            <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> 含下级部门
          </label>
        ) : null}

        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="p-1">类型</th><th className="p-1">主体</th><th className="p-1">角色</th><th className="p-1">操作</th></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={`${g.subject_type}:${g.subject_id}`} className="border-t">
                <td className="p-1">{SUBJECT_LABEL[g.subject_type] ?? g.subject_type}</td>
                <td className="p-1">{grantLabel(g)}{g.subject_type === 'dept' && g.include_subtree ? ' (含下级)' : ''}</td>
                <td className="p-1">{g.role}</td>
                <td className="p-1"><Button variant="ghost" onClick={() => void revoke(g)}>撤销</Button></td>
              </tr>
            ))}
            {!grants.length ? <tr><td colSpan={4} className="p-2 text-muted-foreground">暂无授权</td></tr> : null}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={onClose}>关闭</Button></div>
      </div>
    </div>
  );
};
