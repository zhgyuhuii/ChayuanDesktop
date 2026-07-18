/**
 * 一键清理本地模型 —— 列出「可删除」的本地模型，多选后批量卸载。
 *
 * - 数据源：`runtimeModels.list()`（= /runtime/models，local_index 直出）。
 * - 只列**可删除**：排除内置只读模型（`relpath` 以 `bundled/` 开头，后端
 *   `is_bundled_readonly` 同口径拒卸），内置的 6 个模型不显示。
 * - 删除：复用 `modelHub.uninstall`（POST /admin/models/uninstall）。后端
 *   `resolve_model_dir` 只按「模型文件夹名」匹配、不看 source，故 repoId 传
 *   relpath 中文件的父目录名即可；`in_use` 时自动带 force 重试。
 */
import { modelHub, runtimeModels, type LocalModelEntry } from '@chayuan/api';
import { cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import * as React from 'react';
import { formatBytes } from './ModelHubRow';

/** relpath 形如 `<cap>/<repo_dir>/[nested/]<file>`；取文件的父目录名交给 uninstall。 */
function repoIdFromRelpath(relpath: string): string {
  const parts = String(relpath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2] ?? '';
  return parts[parts.length - 1] ?? '';
}

function shortName(modelId: string): string {
  const s = String(modelId || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return s.split('/').pop() || s;
}

export interface ModelCleanupDialogProps {
  onClose(): void;
  onMutated?(): void;
}

export const ModelCleanupDialog: React.FC<ModelCleanupDialogProps> = ({ onClose, onMutated }) => {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const q = useQuery({
    queryKey: ['runtime.models', 'cleanup'],
    queryFn: () => runtimeModels.list({}),
  });

  // 只列可删除：排除内置只读（relpath 以 bundled/ 开头）
  const items = React.useMemo<LocalModelEntry[]>(
    () =>
      (q.data?.items ?? []).filter(
        (e) => !String(e.relpath || '').replace(/\\/g, '/').startsWith('bundled/'),
      ),
    [q.data],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((e) => e.model_id)));

  const selectedItems = items.filter((e) => selected.has(e.model_id));
  const selectedBytes = selectedItems.reduce((s, e) => s + (e.size_bytes || 0), 0);

  const onClean = async () => {
    if (!selectedItems.length || busy) return;
    setBusy(true);
    setMsg('');
    let okCount = 0;
    let freed = 0;
    const failed: string[] = [];
    for (const e of selectedItems) {
      const repoId = repoIdFromRelpath(e.relpath);
      try {
        let res = await modelHub.uninstall({ source: e.source_tag, repoId });
        if (!res.ok && res.reason === 'in_use') {
          res = await modelHub.uninstall({ source: e.source_tag, repoId, force: true });
        }
        if (res.ok) {
          okCount += 1;
          freed += res.freed_bytes || 0;
        } else {
          failed.push(`${shortName(e.model_id)}（${res.reason || '失败'}）`);
        }
      } catch {
        failed.push(shortName(e.model_id));
      }
    }
    setBusy(false);
    setSelected(new Set());
    void q.refetch();
    onMutated?.();
    setMsg(
      `已清理 ${okCount} 个，释放 ${formatBytes(freed)}` +
        (failed.length ? `；失败 ${failed.length} 个：${failed.join('、')}` : ''),
    );
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="!w-[min(560px,calc(100vw-32px))] !max-w-[560px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="text-base font-semibold">清理本地模型</DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--cy-text-tertiary)]">
            <span>仅列出可删除的模型；内置模型不可删、不显示。</span>
            {items.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[var(--cy-brand-600)] hover:underline"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            )}
          </div>

          <div className="max-h-[50vh] min-h-[80px] overflow-y-auto rounded-lg border border-[var(--cy-border-subtle)]">
            {q.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--cy-text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载本地模型
              </div>
            ) : q.error ? (
              <div className="px-3 py-10 text-center text-xs text-amber-600">
                本地模型清单获取失败
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-[var(--cy-text-tertiary)]">
                没有可清理的本地模型（内置模型不计）。
              </div>
            ) : (
              <ul className="divide-y divide-[var(--cy-border-subtle)]">
                {items.map((e) => {
                  const active = selected.has(e.model_id);
                  return (
                    <li key={e.model_id}>
                      <label
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs',
                          active ? 'bg-[var(--cy-brand-50)]' : 'hover:bg-[var(--cy-surface-1)]',
                        )}
                      >
                        <input type="checkbox" checked={active} onChange={() => toggle(e.model_id)} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span
                            className="min-w-0 truncate text-[var(--cy-text-primary)]"
                            title={e.model_id}
                          >
                            {shortName(e.model_id)}
                          </span>
                          <span className="text-[10px] text-[var(--cy-text-tertiary)]">{e.capability}</span>
                        </span>
                        <span className="shrink-0 text-[var(--cy-text-tertiary)]">
                          {formatBytes(e.size_bytes)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {msg && <p className="mt-2 text-xs text-[var(--cy-text-secondary)]">{msg}</p>}
        </div>

        <DialogFooter className="gap-2 border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]"
          >
            关闭
          </button>
          <button
            type="button"
            disabled={!selectedItems.length || busy}
            onClick={() => void onClean()}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            清理选中
            {selectedItems.length ? `（${selectedItems.length}，${formatBytes(selectedBytes)}）` : ''}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
