import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { kbAcl, kb, type KbAclItem, type KbAclUser, type KbGrant } from '@chayuan/api';
import { RefreshCw, Plus, X } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';

export const CreateKbDialog: React.FC<{ users: KbAclUser[]; onClose(): void; onCreated(): void }> = ({ onClose, onCreated }) => {
  const [name, setName] = React.useState('');
  const [visibility, setVisibility] = React.useState('private');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await kb.create({ knowledge_base_name: name.trim(), visibility: visibility as 'private' | 'public', kb_info: info.trim() || undefined });
      notifySuccess('已创建知识库');
      onCreated();
      onClose();
    } catch (e) {
      reportError(e, '创建知识库失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-5 py-3">
          <h3 className="text-sm font-semibold">添加知识库</h3>
          <button onClick={onClose} className="opacity-50 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <label className="block text-xs">
            <span className="opacity-60">知识库名称*</span>
            <input className="mt-1 w-full rounded border p-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 product_docs" />
          </label>
          <label className="block text-xs">
            <span className="opacity-60">可见性</span>
            <select className="mt-1 w-full rounded border p-2" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="private">private（仅 owner 与被授权者）</option>
              <option value="public">public（所有登录用户可读）</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="opacity-60">简介（可选）</span>
            <input className="mt-1 w-full rounded border p-2" value={info} onChange={(e) => setInfo(e.target.value)} />
          </label>
          <p className="text-[11px] opacity-50">向量库类型 / 嵌入模型使用系统默认（在「向量库」「默认模型」域配置）。</p>
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--cy-border-subtle)] px-5 py-3">
          <Button onClick={() => void create()} disabled={busy || !name.trim()}>创建</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
        </div>
      </div>
    </div>
  );
};

export const GrantsDialog: React.FC<{ kb: KbAclItem; users: KbAclUser[]; onClose(): void }> = ({ kb, users, onClose }) => {
  const q = useQuery({ queryKey: ['admin', 'kb-acl', kb.id, 'grants'], queryFn: () => kbAcl.grants(kb.id) });
  const grants = q.data ?? [];
  const [uid, setUid] = React.useState<number | ''>('');
  const [role, setRole] = React.useState('reader');
  const grantedIds = new Set(grants.map((g) => g.user_id));
  const candidates = users.filter((u) => !grantedIds.has(u.id) && u.id !== kb.owner_id);

  const add = async () => { if (uid === '') return; try { await kbAcl.addGrant(kb.id, Number(uid), role); setUid(''); void q.refetch(); } catch (e) { reportError(e, '授权失败'); } };
  const revoke = async (g: KbGrant) => { try { await kbAcl.revokeGrant(kb.id, g.user_id); void q.refetch(); } catch (e) { reportError(e, '撤销失败'); } };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
  const [createOpen, setCreateOpen] = React.useState(false);

  const setVis = async (kb: KbAclItem, v: string) => { try { await kbAcl.setVisibility(kb.id, v); void q.refetch(); } catch (e) { reportError(e, '修改可见性失败'); } };
  const setOwner = async (kb: KbAclItem, ownerId: number | null) => { try { await kbAcl.setOwner(kb.id, ownerId); void q.refetch(); } catch (e) { reportError(e, '修改 owner 失败'); } };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">知识库授权</h2>
          <p className="mt-1 text-sm text-muted-foreground">管理全系统知识库:public 库所有登录用户可读；private 库仅 owner 与被授权者可访问。可改 owner、按 reader/editor 授权给任意用户。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} /> 刷新
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> 添加知识库
          </Button>
        </div>
      </div>
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
          {!q.isLoading && !kbs.length ? <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">暂无知识库，点「添加知识库」创建。</td></tr> : null}
        </tbody>
      </table>
      {q.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {grantsKb ? <GrantsDialog kb={grantsKb} users={users} onClose={() => setGrantsKb(null)} /> : null}
      {createOpen ? <CreateKbDialog users={users} onClose={() => setCreateOpen(false)} onCreated={() => void q.refetch()} /> : null}
    </div>
  );
};
