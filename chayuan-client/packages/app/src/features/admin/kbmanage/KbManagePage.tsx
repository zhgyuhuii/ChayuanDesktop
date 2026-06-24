/**
 * KbManagePage —— 管理控制台「知识库管理」域。
 * 复用前端知识中心的 KbCard 卡片界面;数据走 knowledgeUniverse.list()(admin 用户后端
 * 自动返回**全部** KB)。点卡片进入详情:授权(复用 GrantsDialog) + 文件 / 分片管理(admin 独有)。
 * 顶部「添加知识库」复用 KbAclPage 的 CreateKbDialog。
 */
import * as React from 'react';
import {
  knowledgeUniverse, kbAcl, kb,
  type KuItem, type KbAclItem, type KbAclUser, type KbFile, type KbFileChunk,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Plus, ArrowLeft, FileText, Trash2, Save, Lock, ChevronRight } from 'lucide-react';
import { KbCard } from '../../kb/KbCard';
import { CreateKbDialog } from '../kbacl/KbAclPage';
import { GrantsDialog } from './GrantsDialog';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';

export const KbManagePage: React.FC = () => {
  // 全部 KB(admin 视角)+ ACL 映射(用于授权按钮拿 numeric kb_id / users)
  const [kus, setKus] = React.useState<KuItem[]>([]);
  const [aclByName, setAclByName] = React.useState<Record<string, KbAclItem>>({});
  const [users, setUsers] = React.useState<KbAclUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [grantsAcl, setGrantsAcl] = React.useState<KbAclItem | null>(null);
  const [sel, setSel] = React.useState<KuItem | null>(null);

  // 详情:文件 / 分片
  const [files, setFiles] = React.useState<KbFile[]>([]);
  const [selFile, setSelFile] = React.useState('');
  const [chunks, setChunks] = React.useState<KbFileChunk[]>([]);
  const [editable, setEditable] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [loadingFiles, setLoadingFiles] = React.useState(false);
  const [loadingChunks, setLoadingChunks] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [list, acl] = await Promise.all([knowledgeUniverse.list(), kbAcl.list()]);
      setKus(list);
      setUsers(acl.users);
      setAclByName(Object.fromEntries(acl.kbs.map((k) => [k.kb_name, k])));
    } catch (e) {
      reportError(e, '读取知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const openKb = async (ku: KuItem) => {
    setSel(ku);
    setSelFile(''); setChunks([]); setFiles([]);
    if (ku.kind !== 'document') return; // 仅文档库有文件/分片
    setLoadingFiles(true);
    try { setFiles(await kb.listFiles(ku.name)); }
    catch (e) { reportError(e, '读取文件失败'); }
    finally { setLoadingFiles(false); }
  };

  const pickFile = async (fileName: string) => {
    if (!sel) return;
    setSelFile(fileName); setChunks([]); setDirty(false); setLoadingChunks(true);
    try {
      const r = await kb.listFileChunks({ knowledge_base_name: sel.name, file_name: fileName });
      setChunks(r.chunks); setEditable(r.editable);
    } catch (e) { reportError(e, '读取分片失败'); }
    finally { setLoadingChunks(false); }
  };
  const editChunk = (idx: number, text: string) => { setChunks((cs) => cs.map((c, i) => (i === idx ? { ...c, text } : c))); setDirty(true); };
  const delChunk = async (idx: number) => {
    if (!(await confirmDialog('删除该分片后需保存才会重新向量化生效。', { title: '删除分片？', danger: true }))) return;
    setChunks((cs) => cs.filter((_, i) => i !== idx)); setDirty(true);
  };
  const saveChunks = async () => {
    if (!sel || !chunks.length) return;
    if (!(await confirmDialog('保存会把当前分片整文件重新向量化,耗时较长。', { title: '保存并重新向量化？' }))) return;
    setBusy(true);
    try {
      await kb.saveFileChunks({ knowledge_base_name: sel.name, file_name: selFile, chunks: chunks.map((c) => ({ chunk_id: c.chunk_id, text: c.text, metadata: c.metadata })) });
      notifySuccess('已保存并重新向量化'); setDirty(false); await pickFile(selFile);
    } catch (e) { reportError(e, '保存失败'); }
    finally { setBusy(false); }
  };

  // ── 详情视图 ──
  if (sel) {
    const acl = aclByName[sel.name];
    return (
      <div className="flex h-full min-h-0 flex-col p-4">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSel(null)}><ArrowLeft className="mr-1 h-4 w-4" /> 返回</Button>
          <span className="text-sm font-semibold">{sel.display_name || sel.name}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] dark:bg-zinc-800">{sel.kind}</span>
          <span className="text-[11px] opacity-50">{sel.visibility} · owner {sel.owner_id ?? '—'}</span>
          <span className="flex-1" />
          {acl ? (
            <Button size="sm" variant="outline" onClick={() => setGrantsAcl(acl)}><Lock className="mr-1.5 h-4 w-4" /> 授权</Button>
          ) : null}
        </div>
        {sel.kind !== 'document' ? (
          <div className="rounded-md bg-zinc-100 px-3 py-2 text-xs opacity-60 dark:bg-zinc-800">该类型知识库无文件/分片管理;可用上方「授权」管理访问权限。</div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3">
            <div className="flex min-h-0 flex-col rounded-lg border border-[var(--cy-border-subtle)]">
              <div className="px-3 py-2 text-xs font-semibold">文件({files.length})</div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2">
                {loadingFiles && <div className="px-2 py-4 text-xs opacity-50">加载中…</div>}
                {files.map((f) => (
                  <button key={f.file_name} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--cy-surface-2)] ${selFile === f.file_name ? 'bg-[var(--cy-brand-500)]/12 text-[var(--cy-brand-600)]' : ''}`} onClick={() => void pickFile(f.file_name)}>
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-50" /><span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                  </button>
                ))}
                {!loadingFiles && !files.length && <div className="px-2 py-4 text-xs opacity-50">无文件</div>}
              </div>
            </div>
            <div className="flex min-h-0 flex-col rounded-lg border border-[var(--cy-border-subtle)]">
              <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-3 py-2">
                <span className="min-w-0 text-xs">{selFile ? <span className="flex items-center gap-1 opacity-70"><span className="truncate font-medium">{selFile}</span><ChevronRight className="h-3 w-3" /><span className="opacity-50">{chunks.length} 片</span></span> : <span className="opacity-50">选择文件查看分片</span>}</span>
                {selFile && editable && <Button size="sm" onClick={() => void saveChunks()} disabled={busy || !dirty}><Save className="mr-1.5 h-4 w-4" /> 保存{dirty ? '(已改)' : ''}</Button>}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
                {loadingChunks && <div className="text-xs opacity-50">加载分片中…</div>}
                {chunks.map((c, idx) => (
                  <div key={c.chunk_id || idx} className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] opacity-50">
                      <span>#{idx + 1}{c.chunk_id ? ` · ${c.chunk_id.slice(0, 8)}` : ''}</span>
                      {editable && <button className="text-rose-500 hover:text-rose-600" onClick={() => void delChunk(idx)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    <textarea className="w-full resize-y rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800" rows={Math.min(8, Math.max(2, Math.ceil((c.text?.length || 0) / 60)))} value={c.text} readOnly={!editable} onChange={(e) => editChunk(idx, e.target.value)} />
                  </div>
                ))}
                {!loadingChunks && selFile && !chunks.length && <div className="text-xs opacity-50">该文件暂无分片</div>}
              </div>
            </div>
          </div>
        )}
        {grantsAcl ? <GrantsDialog kb={grantsAcl} users={users} onClose={() => setGrantsAcl(null)} /> : null}
      </div>
    );
  }

  // ── 网格视图(复用知识中心 KbCard,全部 KB) ──
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">知识库管理</h2>
          <p className="mt-1 text-sm text-muted-foreground">全系统知识库(管理员视角)。点卡片进入:授权 / 文件 / 分片管理。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> 添加知识库</Button>
        </div>
      </div>
      {loading && !kus.length ? (
        <div className="py-12 text-center text-sm opacity-60">加载中…</div>
      ) : !kus.length ? (
        <div className="py-12 text-center text-sm opacity-60">暂无知识库,点「添加知识库」创建。</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {kus.map((ku, i) => (
            <KbCard key={ku.ku_id} kb={ku} selected={false} index={i} onToggle={() => {}} onOpen={() => void openKb(ku)} />
          ))}
        </div>
      )}
      {createOpen ? <CreateKbDialog users={users} onClose={() => setCreateOpen(false)} onCreated={() => void load()} /> : null}
    </div>
  );
};
