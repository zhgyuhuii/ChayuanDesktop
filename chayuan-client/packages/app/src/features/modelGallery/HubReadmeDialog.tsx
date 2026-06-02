/**
 * 模型 README 预览对话框 —— 评审「能用→好用」分水岭之一:让用户在安装前
 * 看清模型卡片说明(用途 / 用法 / 许可 / 基准等)。
 *
 * 懒加载:仅在用户点「详情」打开本框时才调 ``modelHub.readme``(useQuery 默认
 * 只在挂载后 fetch),不预取、不阻塞列表。
 *
 * 渲染:复用全站统一的 ``StreamMarkdown``(marked + DOMPurify 白名单净化,
 * 与主对话气泡 / 帮助页同款),不引入新的 markdown 依赖。
 *
 * 容错:单源 502 / 空 README 时给友好降级文案(「暂无说明」/「加载失败」),
 * 并提供「在源站打开」外链兜底(HF mirror 或 ModelScope 仓库页)。
 */

import { type HubModelCard, modelHub } from '@chayuan/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import * as React from 'react';
import { StreamMarkdown } from '../../lib/markdown';

export interface HubReadmeDialogProps {
  card: HubModelCard;
  /** HF 线路提示(mirror / official),透传给 readme 取数。 */
  route?: string;
  /** 源端可选 token(私有 / 限流),透传给 readme 取数。 */
  token?: string;
  onClose(): void;
}

/** 源站仓库页地址(README 取不到时的外链兜底)。 */
function repoUrl(card: HubModelCard, route?: string): string {
  if (card.source === 'modelscope') {
    return `https://www.modelscope.cn/models/${card.model_id}`;
  }
  const host = route === 'official' ? 'https://huggingface.co' : 'https://hf-mirror.com';
  return `${host}/${card.model_id}`;
}

export const HubReadmeDialog: React.FC<HubReadmeDialogProps> = ({
  card,
  route,
  token,
  onClose,
}) => {
  // 懒加载:本框挂载即取(调用方仅在点开时才挂载本组件)。
  const q = useQuery({
    queryKey: ['model-hub.readme', card.source, card.model_id, route ?? null],
    queryFn: () =>
      modelHub.readme({
        source: card.source,
        modelId: card.model_id,
        route,
        token,
      }),
    staleTime: 5 * 60_000,
  });

  const url = repoUrl(card, route);
  const readme = q.data ?? '';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="!w-[min(760px,calc(100vw-32px))] !max-w-[760px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base font-semibold">
            <span className="min-w-0 truncate" title={card.model_id}>
              {card.display_name || card.model_id}
            </span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              title="在源站打开"
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-normal text-[var(--cy-text-tertiary)] hover:text-[var(--cy-brand-600)]"
            >
              <ExternalLink className="h-3 w-3" />
              源站
            </a>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] min-h-[160px] overflow-y-auto px-5 py-4">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--cy-text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载模型说明
            </div>
          ) : q.error ? (
            <div className="py-10 text-center text-xs text-amber-600">
              README 加载失败,可
              <a href={url} target="_blank" rel="noreferrer noopener" className="mx-1 underline hover:text-[var(--cy-brand-600)]">
                在源站查看
              </a>
              。
            </div>
          ) : readme.trim() ? (
            <StreamMarkdown content={readme} streaming={false} />
          ) : (
            <div className="py-10 text-center text-xs text-[var(--cy-text-tertiary)]">
              该模型暂无 README 说明,可
              <a href={url} target="_blank" rel="noreferrer noopener" className="mx-1 underline hover:text-[var(--cy-brand-600)]">
                在源站查看
              </a>
              。
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
