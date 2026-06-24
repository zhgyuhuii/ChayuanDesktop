/**
 * 文件「全文总结」对话框 —— 站在整篇做 map-reduce 归纳(方案A),区别于分块 top-k 检索。
 * 流程:打开即订阅后端流 → 进度(running)→ 超大文件 needs_confirm(给预估,用户确认再跑)
 * → 完成展示整篇摘要(可复制)→ 失败给错误。复用 @chayuan/ui Dialog。
 * DocumentKbDetail 复用于前端知识中心与后台知识库管理,故两处均自动具备此功能。
 */
import * as React from 'react';
import {
  Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@chayuan/ui';
import { copyText } from '@chayuan/platform-shared';
import { Check, Copy, Loader2, ScrollText } from 'lucide-react';
import { subscribeFileSummary, type FileSummaryFrame } from '@chayuan/api';

export interface FileSummaryDialogProps {
  kbName: string;
  fileName: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

type Phase =
  | { kind: 'running'; chunkCount?: number }
  | { kind: 'needs_confirm'; chunkCount: number; estCalls: number }
  | { kind: 'ok'; summary: string; cached: boolean }
  | { kind: 'error'; msg: string };

export const FileSummaryDialog: React.FC<FileSummaryDialogProps> = ({
  kbName, fileName, open, onOpenChange,
}) => {
  const [phase, setPhase] = React.useState<Phase>({ kind: 'running' });
  const [copied, setCopied] = React.useState(false);
  const unsubRef = React.useRef<null | (() => void)>(null);

  const start = React.useCallback(
    (confirmed: boolean) => {
      unsubRef.current?.();
      setPhase({ kind: 'running' });
      unsubRef.current = subscribeFileSummary(
        { knowledge_base_name: kbName, file_name: fileName, confirmed },
        (f: FileSummaryFrame) => {
          if (f.status === 'running') setPhase({ kind: 'running', chunkCount: f.chunk_count });
          else if (f.status === 'needs_confirm')
            setPhase({ kind: 'needs_confirm', chunkCount: f.chunk_count, estCalls: f.est_llm_calls });
          else if (f.status === 'ok')
            setPhase({ kind: 'ok', summary: f.summary, cached: !!f.cached });
          else if (f.status === 'error') setPhase({ kind: 'error', msg: f.msg });
        },
        (e) => setPhase({ kind: 'error', msg: e instanceof Error ? e.message : String(e) }),
      );
    },
    [kbName, fileName],
  );

  // 打开时启动;关闭时中止订阅。
  React.useEffect(() => {
    if (!open) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }
    start(false);
    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [open, start]);

  const onCopy = async () => {
    if (phase.kind !== 'ok') return;
    try { await copyText(phase.summary); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* 剪贴板不可用静默 */ }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-[min(720px,92vw)] max-w-[720px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-[var(--cy-border-subtle)] px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> 全文总结
          </DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase.kind === 'running' && (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>正在通览整篇并归纳…{phase.chunkCount ? `(共 ${phase.chunkCount} 块)` : ''}</span>
              <span className="text-xs">文件较长时需要多次模型调用,请稍候</span>
            </div>
          )}

          {phase.kind === 'needs_confirm' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-foreground">
                该文件较大(约 <b>{phase.chunkCount}</b> 块),整篇总结预计需要约
                <b> {phase.estCalls} </b>次模型调用,可能耗时较久。
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
                <Button size="sm" onClick={() => start(true)}>仍然总结</Button>
              </div>
            </div>
          )}

          {phase.kind === 'ok' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{phase.cached ? '（缓存)' : '整篇归纳结果'}</span>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  onClick={() => void onCopy()}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <div className="whitespace-pre-wrap rounded-lg border bg-[var(--cy-surface-1)] p-3 text-sm leading-relaxed text-foreground">
                {phase.summary || '(空)'}
              </div>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="space-y-3 py-6">
              <p className="text-sm text-destructive">总结失败:{phase.msg}</p>
              <Button size="sm" variant="outline" onClick={() => start(false)}>重试</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
