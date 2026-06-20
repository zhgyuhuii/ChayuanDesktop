import * as React from 'react';
import { Button } from '@chayuan/ui';
import { tools, type ToolCard } from '@chayuan/api';
import { ToolFieldInput } from './ToolFieldInput';

export const ToolSettingsDialog: React.FC<{ card: ToolCard; onClose(): void; onSaved(): void }> = ({ card, onClose, onSaved }) => {
  const [enabled, setEnabled] = React.useState(card.enabled);
  const [desc, setDesc] = React.useState(card.description_override ?? '');
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    card.fields.forEach((f) => { init[f.path] = card.defaults?.[f.path] ?? f.value ?? f.default; });
    return init;
  });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await tools.updateConfig(card.key, { enabled, description_override: desc.trim() === card.description.trim() ? '' : desc, values });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm(`重置工具 ${card.title} 的配置为默认?`)) return;
    setBusy(true);
    try { await tools.deleteConfig(card.key); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-[var(--cy-surface-base,#fff)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{card.title}</h2>
        <div className="text-xs text-muted-foreground">{card.category} · {card.key}</div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用</label>
        <label className="mt-3 block text-sm">描述(覆盖)
          <textarea className="mt-1 w-full rounded border p-2 text-sm" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <button className="text-xs text-sky-600" onClick={() => setDesc(card.description)}>恢复默认描述</button>
        {card.fields.length ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {card.fields.map((f) => (
              <label key={f.path} className="block text-sm">{f.label}{f.help ? <span className="ml-1 text-xs text-muted-foreground">{f.help}</span> : null}
                <ToolFieldInput field={f} value={values[f.path]} onChange={(v) => setValues((s) => ({ ...s, [f.path]: v }))} />
              </label>
            ))}
          </div>
        ) : null}
        {err ? <p className="mt-2 text-sm text-destructive">{err}</p> : null}
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={() => void reset()}>重置为默认</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
