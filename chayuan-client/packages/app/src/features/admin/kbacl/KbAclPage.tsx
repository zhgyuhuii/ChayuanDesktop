import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { kbAcl, type KbAclItem, type KbAclUser, type KbGrant } from '@chayuan/api';

const GrantsDialog: React.FC<{ kb: KbAclItem; users: KbAclUser[]; onClose(): void }> = ({ kb, users, onClose }) => {
  const q = useQuery({ queryKey: ['admin', 'kb-acl', kb.id, 'grants'], queryFn: () => kbAcl.grants(kb.id) });
  const grants = q.data ?? [];
  const [uid, setUid] = React.useState<number | ''>('');
  const [role, setRole] = React.useState('reader');
  const grantedIds = new Set(grants.map((g) => g.user_id));
  const candidates = users.filter((u) => !grantedIds.has(u.id) && u.id !== kb.owner_id);

  const add = async () => { if (uid === '') return; await kbAcl.addGrant(kb.id, Number(uid), role); setUid(''); void q.refetch(); };
  const revoke = async (g: KbGrant) => { await kbAcl.revokeGrant(kb.id, g.user_id); void q.refetch(); };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-[var(--cy-surface-base,#fff)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-semibold">授权 · {kb.kb_name}</h2>
        <div className="flex gap-2">
          <select className="flex-1 rounded border p-2 text-sm" value={uid} onChange={(e) => setUid(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">选择用户…</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
          <select className="rounded border p-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}><option value="reader">reader</option><option value="editor">editor</option></select>
          <Button disabled={uid === ''} onClick={() => void add()}>授权</Button>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="p-1">用户</th><th className="p-1">角色</th><th className="p-1">操作</th></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.user_id} className="border-t"><td className="p-1">{g.user}</td><td className="p-1">{g.role}</td><td className="p-1"><Button variant="ghost" onClick={() => void revoke(g)}>撤销</Button></td></tr>
            ))}
            {!grants.length ? <tr><td colSpan={3} className="p-2 text-muted-foreground">暂无授权</td></tr> : null}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={onClose}>关闭</Button></div>
      </div>
    </div>
  );
};

export const KbAclPage: React.FC = () => {
  const q = useQuery({ queryKey: ['admin', 'kb-acl'], queryFn: () => kbAcl.list(), staleTime: 30_000 });
  const kbs = q.data?.kbs ?? [];
  const users = q.data?.users ?? [];
  const [grantsKb, setGrantsKb] = React.useState<KbAclItem | null>(null);

  const setVis = async (kb: KbAclItem, v: string) => { await kbAcl.setVisibility(kb.id, v); void q.refetch(); };
  const setOwner = async (kb: KbAclItem, ownerId: number | null) => { await kbAcl.setOwner(kb.id, ownerId); void q.refetch(); };

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">public 库所有登录用户可读；private 库仅 owner 与被授权者可访问。</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="p-2">知识库</th><th className="p-2">可见性</th><th className="p-2">Owner</th><th className="p-2">授权</th></tr></thead>
        <tbody>
          {kbs.map((kb) => (
            <tr key={kb.id} className="border-t">
              <td className="p-2">{kb.kb_name}</td>
              <td className="p-2">
                <select className="rounded border p-1 text-sm" value={kb.visibility} onChange={(e) => void setVis(kb, e.target.value)}><option value="private">private</option><option value="public">public</option></select>
              </td>
              <td className="p-2">
                <select className="rounded border p-1 text-sm" value={kb.owner_id ?? 0} onChange={(e) => void setOwner(kb, Number(e.target.value) || null)}>
                  <option value={0}>（无 owner）</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </td>
              <td className="p-2"><Button variant="ghost" onClick={() => setGrantsKb(kb)}>授权管理</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {grantsKb ? <GrantsDialog kb={grantsKb} users={users} onClose={() => setGrantsKb(null)} /> : null}
    </div>
  );
};
