/**
 * 文件(quant)选择对话框 —— 当一个仓库含多个可运行文件(如多档 .gguf 量化)时,
 * 让用户挑选具体下载哪个文件 + 可选 revision,再交给安装任务。
 *
 * 打开时拉 ``modelHub.detail`` 取仓库文件清单,只列可运行文件(runnable)。
 * 调用方约定:只有「可运行文件 >= 2」时才需要弹本框;0/1 个时调用方应直接
 * onPick(undefined) 走默认下载(后端自行选文件),不弹。
 *
 * props:
 *   - card:    目标模型卡片(取 source / model_id)
 *   - route:   HF 线路提示(hf-mirror / official),透传给 detail
 *   - token:   可选源端 token(私有仓 / 限流),透传给 detail
 *   - onPick:  用户确认选择 → (file, revision)。file=具体 rfilename。
 *   - onClose: 关闭(取消)。
 */

import { type HubModelCard, modelHub } from '@chayuan/api';
import {
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Loader2 } from 'lucide-react';
import * as React from 'react';
import { formatBytes } from './ModelHubRow';

export interface HubFilePickerDialogProps {
  card: HubModelCard;
  route?: string;
  token?: string;
  onPick(file: string | undefined, revision?: string): void;
  onClose(): void;
}

export const HubFilePickerDialog: React.FC<HubFilePickerDialogProps> = ({
  card,
  route,
  token,
  onPick,
  onClose,
}) => {
  const [revision, setRevision] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['model-hub.detail', card.source, card.model_id, revision || null],
    queryFn: () =>
      modelHub.detail({
        source: card.source,
        modelId: card.model_id,
        revision: revision || undefined,
        route,
        token,
      }),
  });

  const runnableFiles = React.useMemo(
    () => (detailQuery.data ?? []).filter((f) => f.runnable),
    [detailQuery.data],
  );

  const rev = revision.trim() || undefined;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="!w-[min(520px,calc(100vw-32px))] !max-w-[520px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="text-base font-semibold">
            选择下载文件
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--cy-text-primary)]" title={card.model_id}>
              {card.display_name || card.model_id}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--cy-text-tertiary)]">
              该仓库含多个可运行文件,请选择一个具体量化 / 权重文件下载。
            </div>
          </div>

          {/* revision 可选输入 */}
          <label className="flex items-center gap-2 text-xs text-[var(--cy-text-secondary)]">
            <span className="shrink-0">分支 / revision</span>
            <input
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="留空=默认(main / master)"
              className="h-7 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-xs text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
            />
          </label>

          {/* 文件清单 */}
          <div className="max-h-[40vh] min-h-[80px] overflow-y-auto rounded-lg border border-[var(--cy-border-subtle)]">
            {detailQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--cy-text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载文件清单
              </div>
            ) : detailQuery.error ? (
              <div className="px-3 py-6 text-center text-xs text-amber-600">
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : '文件清单获取失败'}
              </div>
            ) : runnableFiles.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--cy-text-tertiary)]">
                未发现可运行文件
              </div>
            ) : (
              <ul className="divide-y divide-[var(--cy-border-subtle)]">
                {runnableFiles.map((f) => {
                  const active = selected === f.rfilename;
                  return (
                    <li key={f.rfilename}>
                      <button
                        type="button"
                        onClick={() => setSelected(f.rfilename)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          active
                            ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                            : 'text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-1)]',
                        )}
                      >
                        <FileDown className="h-3.5 w-3.5 shrink-0 text-[var(--cy-text-tertiary)]" />
                        <span className="min-w-0 flex-1 truncate" title={f.rfilename}>
                          {f.rfilename}
                        </span>
                        <span className="shrink-0 text-[var(--cy-text-tertiary)]">
                          {formatBytes(f.size_bytes)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onPick(selected, rev)}
            className="rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            下载该文件
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
