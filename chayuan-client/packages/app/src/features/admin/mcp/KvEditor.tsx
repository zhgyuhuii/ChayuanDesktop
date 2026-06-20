import * as React from 'react';
import { Button } from '@chayuan/ui';

/** key-value 编辑器(env_vars / headers 共用)。受控。 */
export const KvEditor: React.FC<{ value: Record<string, string>; onChange(v: Record<string, string>): void }> = ({ value, onChange }) => {
  const rows = Object.entries(value);
  const setRow = (i: number, k: string, v: string) => {
    const next: Record<string, string> = {};
    rows.forEach(([ok, ov], idx) => { if (idx === i) { if (k) next[k] = v; } else next[ok] = ov; });
    onChange(next);
  };
  return (
    <div className="space-y-1">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input className="w-1/3 rounded border p-1 text-xs" placeholder="KEY" value={k} onChange={(e) => setRow(i, e.target.value, v)} />
          <input className="flex-1 rounded border p-1 text-xs" placeholder="VALUE" value={v} onChange={(e) => setRow(i, k, e.target.value)} />
          <Button variant="ghost" onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }}>×</Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => onChange({ ...value, '': '' })}>+ 新增</Button>
    </div>
  );
};
