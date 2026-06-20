import * as React from 'react';
import { Button, Dialog, DialogContent, DialogTitle, Input } from '@chayuan/ui';
import { tools, type CustomToolSpec, type CustomToolProbeResult } from '@chayuan/api';

/** 测试自定义 HTTP 工具:按 params 输入 → 后端代入并发起 → 展示结果。 */
export const CustomToolTestDialog: React.FC<{ spec: CustomToolSpec; open: boolean; onOpenChange(v: boolean): void }> = ({ spec, open, onOpenChange }) => {
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<CustomToolProbeResult | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => { if (open) { setRes(null); setErr(null); setVals({}); } }, [open]);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await tools.testCustom(spec.name, vals)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const bodyText = res
    ? (res.body_kind === 'json' ? JSON.stringify(res.body, null, 2) : String(res.body ?? ''))
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>测试 · {spec.title || spec.name}</DialogTitle>
        <div className="space-y-2">
          {spec.params.length ? spec.params.map((p) => (
            <label key={p.name} className="block text-sm">
              {p.name}{p.required ? ' *' : ''}<span className="ml-1 text-xs text-muted-foreground">{p.type}{p.description ? ` · ${p.description}` : ''}</span>
              <Input value={vals[p.name] ?? (p.default != null ? String(p.default) : '')} placeholder={p.enum?.length ? `可选: ${p.enum.join(', ')}` : ''} onChange={(e) => setVals((s) => ({ ...s, [p.name]: e.target.value }))} />
            </label>
          )) : <p className="text-sm text-muted-foreground">该工具无参数。</p>}
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          {res ? (
            <div className="rounded-lg border p-2">
              <div className={`text-sm font-medium ${res.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                HTTP {res.status_code ?? 'ERR'} · {res.latency_ms}ms · {res.content_type || '-'} · {res.body_kind}
              </div>
              {res.url ? <div className="break-all text-xs text-muted-foreground">{res.url}</div> : null}
              {res.error ? <p className="text-sm text-destructive">{res.error}</p> : null}
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs">{bodyText}</pre>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button size="sm" disabled={busy} onClick={() => void run()}>{busy ? '调用中…' : '发起调用'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
