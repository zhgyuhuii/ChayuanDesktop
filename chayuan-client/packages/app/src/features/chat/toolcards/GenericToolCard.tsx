import * as React from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ToolCallProps } from './registry';

/** 兜底卡：任何未知工具都用它，展示原始入参与结果 JSON。 */
export const GenericToolCard: React.FC<ToolCallProps> = ({ name, args, result, status }) => {
  const argsText = React.useMemo(() => formatJson(args), [args]);
  const resultText = React.useMemo(() => formatJson(result), [result]);

  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        {status === 'start' || status === 'delta' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : status === 'end' ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{name}</span>
        <span className="text-muted-foreground">
          {status === 'start' || status === 'delta' ? '调用中…' : status === 'end' ? '已完成' : ''}
        </span>
      </div>
      {argsText && <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{argsText}</pre>}
      {resultText && (
        <pre className="mt-1 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px]">{resultText}</pre>
      )}
    </div>
  );
};

function formatJson(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
