/**
 * AI 视频生成页（文生视频 / 图生视频）。
 *
 * 页面壳：保留顶栏标题 + 路由容器，表单/逻辑/结果全部由 AiVideoGenerator 承载。
 */
import * as React from 'react';
import { Film } from 'lucide-react';
import { AiVideoGenerator } from './AiVideoGenerator';
import { ingestAiVideo } from './ingestAiVideo';

export const AiVideoPage: React.FC = () => {
  const [lastVideoUrl, setLastVideoUrl] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [imported, setImported] = React.useState(false);
  const [importErr, setImportErr] = React.useState<string | null>(null);

  // lastVideoUrl 变化（新生成）时重置导入态
  React.useEffect(() => {
    setImported(false);
    setImportErr(null);
  }, [lastVideoUrl]);

  const onImport = async () => {
    if (!lastVideoUrl) return;
    setImporting(true);
    setImportErr(null);
    try {
      await ingestAiVideo(lastVideoUrl);
      setImported(true);
    } catch (e) {
      setImportErr((e as Error).message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--cy-surface-base)]">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-5 py-3">
        <Film className="h-4 w-4 text-[var(--cy-brand-500)]" />
        <h1 className="text-sm font-semibold text-[var(--cy-text-primary)]">AI 视频生成</h1>
      </div>

      {/* 主体：AiVideoGenerator 撑满剩余空间 */}
      <div className="flex min-h-0 flex-1 overflow-hidden p-5">
        <div className="flex w-full flex-col">
          <AiVideoGenerator onGenerated={setLastVideoUrl} />
          {lastVideoUrl && (
            <div className="mt-3 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void onImport()}
                disabled={importing || imported}
                className="inline-flex h-8 w-fit items-center gap-1 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 text-xs text-[var(--cy-text-secondary)] transition-colors hover:border-[var(--cy-brand-400)] hover:text-[var(--cy-text-primary)] disabled:opacity-60"
              >
                {imported ? '已导入素材库' : importing ? '导入中…' : '导入素材库'}
              </button>
              {imported && (
                <p className="text-[11px] text-[var(--cy-text-tertiary)]">
                  可在「视频编辑 → 素材库 → 我的素材」里使用
                </p>
              )}
              {importErr && (
                <p className="text-[11px] text-[var(--cy-danger-500)]">{importErr}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
