import * as React from 'react';
import { digitalHuman } from '@chayuan/api';
import type { DigitalHumanPreset } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { DhProgressCard } from './DhProgressCard';

type Template = 'corner' | 'bg' | 'side';
const TEMPLATE_LABELS: Record<Template, string> = {
  corner: '角落小窗',
  bg: '居中讲解',
  side: '左侧出镜',
};

export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[] }> = ({ presets }) => {
  const [pid, setPid] = React.useState('');
  const [text, setText] = React.useState('');
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // product image state
  const [productRef, setProductRef] = React.useState<string | null>(null);
  const [productName, setProductName] = React.useState<string | null>(null);
  const [uploadingProduct, setUploadingProduct] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // template state (only relevant when productRef is set)
  const [template, setTemplate] = React.useState<Template>('corner');

  React.useEffect(() => { if (!pid && presets[0]) setPid(presets[0].id); }, [presets, pid]);

  const handleProductFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // reset so the same file can be re-selected after removal
    e.target.value = '';
    setUploadingProduct(true);
    try {
      const r = await digitalHuman.uploadProduct(file);
      setProductRef(r.ref);
      setProductName(r.name);
      setTemplate('corner');
    } catch (err) {
      reportError(err as Error, '商品图上传失败');
    } finally {
      setUploadingProduct(false);
    }
  };

  const removeProduct = () => {
    setProductRef(null);
    setProductName(null);
  };

  const gen = async () => {
    setBusy(true);
    try {
      const r = await digitalHuman.generate(
        pid,
        text,
        productRef ? { product_image: productRef, template } : undefined,
      );
      setTaskId(r.task_id);
    } catch (e) { reportError(e as Error, '数字人生成失败'); }
    finally { setBusy(false); }
  };

  if (presets.length === 0)
    return <div className="text-sm text-[var(--cy-text-tertiary)]">先到「我的数字人」新建一个数字人。</div>;

  return (
    <div className="space-y-3">
      <select value={pid} onChange={(e) => setPid(e.target.value)}
        className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]">
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder="输入口播文案…"
        className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)]" />

      {/* Product image upload row */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleProductFileChange(e)}
        />
        {productRef ? (
          <>
            <span className="max-w-[160px] truncate text-sm text-[var(--cy-text-primary)]">{productName}</span>
            <button
              onClick={removeProduct}
              className="text-sm text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]">
              移除
            </button>
          </>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingProduct}
            className="inline-flex h-8 items-center rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            {uploadingProduct ? '上传中…' : '上传商品图（可选）'}
          </button>
        )}
      </div>

      {/* Template picker — only shown when a product image is selected */}
      {productRef && (
        <div className="flex gap-2">
          {(Object.keys(TEMPLATE_LABELS) as Template[]).map((t) => (
            <button
              key={t}
              onClick={() => setTemplate(t)}
              className={`h-8 rounded-md px-3 text-sm ${template === t
                ? 'bg-[var(--cy-ink-700)] text-white'
                : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
              {TEMPLATE_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      <button onClick={() => void gen()} disabled={!pid || !text.trim() || busy}
        className="inline-flex h-8 items-center rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
        生成数字人视频
      </button>

      {taskId && <DhProgressCard taskId={taskId} />}
    </div>
  );
};
