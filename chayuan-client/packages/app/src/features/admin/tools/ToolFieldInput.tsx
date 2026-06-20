import * as React from 'react';
import type { ToolField } from '@chayuan/api';

/** 按 field.widget 渲染受控控件。model_select 暂退化为文本输入(模型名)。 */
export const ToolFieldInput: React.FC<{ field: ToolField; value: unknown; onChange(v: unknown): void }> = ({ field, value, onChange }) => {
  const common = 'mt-1 w-full rounded border p-2 text-sm';
  switch (field.widget) {
    case 'switch':
      return <input type="checkbox" className="mt-2 h-4 w-4" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'number':
      return <input type="number" className={common} value={value == null ? '' : Number(value)} min={field.min ?? undefined} max={field.max ?? undefined} step={field.step ?? undefined} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'select':
      return (
        <select className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      );
    case 'password':
      return <input type="password" className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'textarea':
      return <textarea className={common} rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'model_select':
      return <input className={common} value={String(value ?? '')} placeholder={`模型名${field.model_type ? `(${field.model_type})` : ''}`} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className={common} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
};
