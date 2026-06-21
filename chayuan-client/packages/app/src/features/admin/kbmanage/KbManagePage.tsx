/**
 * KbManagePage —— 管理控制台「知识库管理」域(S2)。
 * admin 视角:三栏 全部知识库(含 owner/可见性) → 文件 → 分片(查看/编辑/删除 + 保存重向量化)。
 * 复用既有 REST:kbAcl.list(全部 KB)、kb.listFiles、kb.listFileChunks、kb.saveFileChunks。
 * 分片「保存」会把当前列表整文件重新向量化;「删除」=从列表去掉后保存。
 */
import * as React from 'react';
import { kbAcl, kb, type KbAclItem, type KbAclUser, type KbFile, type KbFileChunk } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Save, Trash2, FileText, Database, ChevronRight, Lock, Globe } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';

const PANE = 'flex min-h-0 flex-col border-r border-[var(--cy-border-subtle)]';
const ROW =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--cy-surface-2)]';

export const KbManagePage: React.FC = () => {
  const [kbs, setKbs] = React.useState<KbAclItem[]>([]);
  const [users, setUsers] = React.useState<KbAclUser[]>([]);
  const [selKb, setSelKb] = React.useState<string>('');
  const [files, setFiles] = React.useState<KbFile[]>([]);
  const [selFile, setSelFile] = React.useState<string>('');
  const [chunks, setChunks] = React.useState<KbFileChunk[]>([]);
  const [editable, setEditable] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [loadingKb, setLoadingKb] = React.useState(true);
  const [loadingFiles, setLoadingFiles] = React.useState(false);
  const [loadingChunks, setLoadingChunks] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const userLabel = React.useCallback(
    (id: number | null) => (id == null ? '（无主）' : users.find((u) => u.id === id)?.label ?? `#${id}`),
    [users],
  );

  const loadKbs = React.useCallback(async () => {
    setLoadingKb(true);
    try {
      const r = await kbAcl.list();
      setKbs(r.kbs);
      setUsers(r.users);
    } catch (e) {
      reportError(e, '读取知识库列表失败');
    } finally {
      setLoadingKb(false);
    }
  }, []);

  React.useEffect(() => {
    void loadKbs();
  }, [loadKbs]);

  const pickKb = async (name: string) => {
    setSelKb(name);
    setSelFile('');
    setChunks([]);
    setFiles([]);
    setLoadingFiles(true);
    try {
      setFiles(await kb.listFiles(name));
    } catch (e) {
      reportError(e, '读取文件列表失败');
    } finally {
      setLoadingFiles(false);
    }
  };

  const pickFile = async (fileName: string) => {
    setSelFile(fileName);
    setChunks([]);
    setDirty(false);
    setLoadingChunks(true);
    try {
      const r = await kb.listFileChunks({ knowledge_base_name: selKb, file_name: fileName });
      setChunks(r.chunks);
      setEditable(r.editable);
    } catch (e) {
      reportError(e, '读取分片失败');
    } finally {
      setLoadingChunks(false);
    }
  };

  const editChunk = (idx: number, text: string) => {
    setChunks((cs) => cs.map((c, i) => (i === idx ? { ...c, text } : c)));
    setDirty(true);
  };
  const delChunk = async (idx: number) => {
    if (!(await confirmDialog('删除该分片后需保存才会重新向量化生效。', { title: '删除分片？', danger: true }))) return;
    setChunks((cs) => cs.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const save = async () => {
    if (!chunks.length) {
      reportError(new Error('分片不能为空'), '无法保存');
      return;
    }
    if (!(await confirmDialog('保存会把当前分片列表整文件重新向量化,耗时较长。', { title: '保存并重新向量化？' }))) return;
    setBusy(true);
    try {
      await kb.saveFileChunks({
        knowledge_base_name: selKb,
        file_name: selFile,
        chunks: chunks.map((c) => ({ chunk_id: c.chunk_id, text: c.text, metadata: c.metadata })),
      });
      notifySuccess('已保存并重新向量化');
      setDirty(false);
      await pickFile(selFile);
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_240px_1fr]">
      {/* 全部知识库 */}
      <div className={PANE}>
        <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" /> 全部知识库({kbs.length})
          </span>
          <button onClick={() => void loadKbs()} className="opacity-50 hover:opacity-100">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingKb ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2">
          {kbs.map((k) => (
            <button
              key={k.id}
              className={`${ROW} ${selKb === k.kb_name ? 'bg-[var(--cy-brand-500)]/12 text-[var(--cy-brand-600)]' : ''}`}
              onClick={() => void pickKb(k.kb_name)}
            >
              {k.visibility === 'public' ? (
                <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : (
                <Lock className="h-3.5 w-3.5 shrink-0 opacity-40" />
              )}
              <span className="min-w-0 flex-1 truncate">{k.kb_name}</span>
              <span className="shrink-0 text-[10px] opacity-40">{userLabel(k.owner_id)}</span>
            </button>
          ))}
          {!loadingKb && !kbs.length && <div className="px-2 py-4 text-xs opacity-50">暂无知识库</div>}
        </div>
      </div>

      {/* 文件 */}
      <div className={PANE}>
        <div className="px-3 py-2 text-xs font-semibold">
          {selKb ? `文件(${files.length})` : '选择知识库'}
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2">
          {loadingFiles && <div className="px-2 py-4 text-xs opacity-50">加载中…</div>}
          {files.map((f) => (
            <button
              key={f.file_name}
              className={`${ROW} ${selFile === f.file_name ? 'bg-[var(--cy-brand-500)]/12 text-[var(--cy-brand-600)]' : ''}`}
              onClick={() => void pickFile(f.file_name)}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-50" />
              <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
              {typeof f.doc_count === 'number' && <span className="shrink-0 text-[10px] opacity-40">{f.doc_count}片</span>}
            </button>
          ))}
          {selKb && !loadingFiles && !files.length && <div className="px-2 py-4 text-xs opacity-50">无文件</div>}
        </div>
      </div>

      {/* 分片 */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-2">
          <div className="min-w-0 text-xs">
            {selFile ? (
              <span className="flex items-center gap-1 opacity-70">
                <span className="truncate">{selKb}</span>
                <ChevronRight className="h-3 w-3 shrink-0" />
                <span className="truncate font-medium">{selFile}</span>
                <span className="ml-1 shrink-0 opacity-50">· {chunks.length} 片</span>
              </span>
            ) : (
              <span className="opacity-50">选择文件查看分片</span>
            )}
          </div>
          {selFile && editable && (
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
              <Save className="mr-1.5 h-4 w-4" /> 保存{dirty ? '(已改)' : ''}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {loadingChunks && <div className="text-xs opacity-50">加载分片中…</div>}
          {!loadingChunks && selFile && !editable && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              当前账号不可编辑分片(需管理员)。
            </div>
          )}
          {chunks.map((c, idx) => (
            <div key={c.chunk_id || idx} className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] opacity-50">
                <span>#{idx + 1}{c.chunk_id ? ` · ${c.chunk_id.slice(0, 8)}` : ''}</span>
                {editable && (
                  <button className="text-rose-500 hover:text-rose-600" onClick={() => void delChunk(idx)} title="删除分片">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <textarea
                className="w-full resize-y rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800"
                rows={Math.min(10, Math.max(2, Math.ceil((c.text?.length || 0) / 60)))}
                value={c.text}
                readOnly={!editable}
                onChange={(e) => editChunk(idx, e.target.value)}
              />
            </div>
          ))}
          {!loadingChunks && selFile && !chunks.length && <div className="text-xs opacity-50">该文件暂无分片</div>}
        </div>
      </div>
    </div>
  );
};
