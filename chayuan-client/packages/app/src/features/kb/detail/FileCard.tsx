/**
 * FileCard —— 文件列表卡片(窄列 / narrow 模式使用)。
 *
 * 字段和操作与 FileRow 完全对应:
 *   - 文件名、入库状态 + chunk 数、大小
 *   - 操作:预览 / 下载 / 总结全文(optional) / 查看切片 / 重建向量(mine-only) / 删除(mine-only)
 *
 * 视觉:圆角边框卡片,hover 浅色背景;三行布局
 *   Row1: checkbox + 图标 + 文件名(break-all)
 *   Row2: 入库状态 chip / 进度 · N 块 · 大小
 *   Row3: 操作按钮
 */

import * as React from 'react';
import { Download, Eye, FileText, Layers, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { cn } from '@chayuan/ui';
import type { DocumentFile } from '@chayuan/api';
import { kb as kbApi, getAccessToken, getClientConfig } from '@chayuan/api';
import { usePreviewStore } from '../../preview';

interface FileProgressState {
  label: string;
  pct: number;
  tone: 'running' | 'done' | 'error';
}

interface ReindexTaskState {
  taskId: string;
  mode?: 'upload' | 'reindex';
  queue?: string;
  state?: string;
  fileCount?: number;
  fileNames?: string[];
  processed?: number;
  okCount?: number;
  currentFile?: string;
  failedFiles?: Record<string, string>;
  error?: string;
}

function fileIngestProgress(fileName: string, task: ReindexTaskState | null): FileProgressState | null {
  if (!task || !task.fileNames?.includes(fileName)) return null;
  const terminal = ['success', 'partial_success', 'failed'].includes(task.state || '');
  const failed = Boolean(task.failedFiles?.[fileName]);
  if (failed) return { label: '入库失败', pct: 100, tone: 'error' };
  const idx = task.fileNames.indexOf(fileName);
  const processed = task.processed ?? 0;
  if (terminal || processed > idx) {
    return { label: task.mode === 'upload' ? '入库完成' : '重建完成', pct: 100, tone: 'done' };
  }
  if (task.currentFile === fileName) {
    const total = Math.max(1, task.fileCount ?? task.fileNames.length);
    const pct = Math.max(6, Math.min(98, Math.round(((idx + 0.5) / total) * 100)));
    return { label: task.mode === 'upload' ? '正在入库…' : '正在重建…', pct, tone: 'running' };
  }
  return { label: '等待入库…', pct: 3, tone: 'running' };
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function buildDocUrl(
  kbName: string,
  fileName: string,
  action: 'preview_doc' | 'download_doc',
): Promise<string | null> {
  const cfg = getClientConfig();
  const base = (cfg.baseURL || '').replace(/\/+$/, '');
  const tok = await getAccessToken();
  const qs = new URLSearchParams({ knowledge_base_name: kbName, file_name: fileName });
  if (tok) qs.set('token', tok);
  return `${base}/knowledge_base/${action}?${qs.toString()}`;
}

export interface FileCardProps {
  file: DocumentFile;
  kbName: string;
  ingestTask: ReindexTaskState | null;
  mine: boolean;
  selected: boolean;
  onToggle(): void;
  onChunks(): void;
  onReindex(): void;
  onDelete(): void;
  onSummarize?: () => void;
}

export const FileCard: React.FC<FileCardProps> = ({
  file,
  kbName,
  ingestTask,
  mine,
  selected,
  onToggle,
  onChunks,
  onReindex,
  onDelete,
  onSummarize,
}) => {
  const openPreview = usePreviewStore((s) => s.open);
  const progress = fileIngestProgress(file.file_name, ingestTask);

  const onPreview = () => {
    openPreview({
      source: 'kb-doc',
      kbName,
      fileName: file.file_name,
      fileSize: file.file_size ?? undefined,
    });
  };

  const onDownload = async () => {
    const url = await buildDocUrl(kbName, file.file_name, 'download_doc');
    if (!url) return;
    if (typeof window !== 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      a.click();
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border bg-[var(--cy-surface-base)] p-2.5 transition-colors',
        'hover:bg-[var(--cy-surface-1)] hover:border-[var(--cy-brand-300)]',
        selected
          ? 'border-[var(--cy-brand-500)] ring-1 ring-[var(--cy-brand-300)]'
          : 'border-[var(--cy-border-subtle)]',
      )}
    >
      {/* Row 1: checkbox + icon + filename */}
      <div className="flex items-start gap-2">
        <span onClick={(e) => e.stopPropagation()} className="mt-0.5 flex-shrink-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`选择 ${file.file_name}`}
          />
        </span>
        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--cy-text-tertiary)]" />
        <button
          type="button"
          onClick={onPreview}
          className="min-w-0 flex-1 break-all text-left text-xs font-medium text-[var(--cy-text-primary)] hover:text-[var(--cy-brand-600)]"
          title={file.file_name}
        >
          {file.file_name}
        </button>
      </div>

      {/* Row 2: status chip · chunks · size */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[var(--cy-text-tertiary)]">
        {progress ? (
          <span className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
            progress.tone === 'error'
              ? 'bg-red-50 text-red-600'
              : progress.tone === 'done'
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-[var(--cy-surface-2)] text-[var(--cy-text-secondary)]',
          )}>
            {progress.label}
            <span className="font-mono">{progress.pct}%</span>
          </span>
        ) : (
          <span className={cn(
            'inline-flex rounded px-1.5 py-0.5',
            file.in_db
              ? 'bg-sky-50 text-sky-700'
              : 'bg-[var(--cy-surface-2)] text-[var(--cy-text-tertiary)]',
          )}>
            {file.in_db ? '已索引' : '未索引'}
          </span>
        )}
        {file.in_db && file.doc_count != null && (
          <span>{file.doc_count} 块</span>
        )}
        {file.file_size != null && file.file_size > 0 && (
          <span>{formatBytes(file.file_size)}</span>
        )}
      </div>

      {/* Row 3: action buttons */}
      <div className="mt-2 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onPreview}
          aria-label="预览"
          title="预览"
          className="rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void onDownload()}
          aria-label="下载"
          title="下载"
          className="rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        {onSummarize && (
          <button
            type="button"
            onClick={onSummarize}
            aria-label="总结全文"
            title="总结全文(站在整篇归纳)"
            className="rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
          >
            <ScrollText className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onChunks}
          aria-label="查看切片"
          title="查看切片"
          className="rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
        >
          <Layers className="h-3.5 w-3.5" />
        </button>
        {mine && (
          <button
            type="button"
            onClick={onReindex}
            aria-label="重新生成向量"
            title="删除旧向量并重新生成"
            className="rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
        {mine && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="删除"
            title="删除这个文件"
            className="rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-red-500/10 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
