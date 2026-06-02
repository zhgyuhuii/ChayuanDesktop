import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { digitalHuman } from '@chayuan/api';
import type { DigitalHumanPreset } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { promptDialog } from '../../store/promptDialog';
import { useUsageGate, UsageGateDialogs } from '../license';
import { DhProgressCard } from './DhProgressCard';

type Template = 'corner' | 'bg' | 'side';
const TEMPLATE_LABELS: Record<Template, string> = {
  corner: '角落小窗',
  bg: '居中讲解',
  side: '左侧出镜',
};

type EngineId = 'wav2lip' | 'sadtalker' | 'musetalk';

const DEFAULT_ENGINES: Array<{ id: EngineId; label: string; kind: 'cpu' | 'gpu'; installed: boolean }> = [
  { id: 'wav2lip', label: 'Wav2Lip', kind: 'cpu', installed: true },
];

export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[]; initialPresetId?: string; onPresetChange?: (pid: string) => void }> = ({ presets, initialPresetId, onPresetChange }) => {
  const [pid, setPid] = React.useState(initialPresetId ?? '');
  const [text, setText] = React.useState('');
  // coframe(#6):每角色一串文案,index 对应角色
  const [coframeScripts, setCoframeScripts] = React.useState<string[]>([]);
  // sequential(#7):外层 index=角色,内层=该角色的多个段
  const [seqSegments, setSeqSegments] = React.useState<string[][]>([]);
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // engine state
  const [engine, setEngine] = React.useState<EngineId>('wav2lip');

  // product image state
  const [productRef, setProductRef] = React.useState<string | null>(null);
  const [productName, setProductName] = React.useState<string | null>(null);
  const [uploadingProduct, setUploadingProduct] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // template state (only relevant when productRef is set)
  const [template, setTemplate] = React.useState<Template>('corner');

  // matte (green-screen keying) — only relevant when productRef is set
  const [matte, setMatte] = React.useState(false);

  // 按次门控（avatar: 数字人合成）
  const gate = useUsageGate('avatar');

  const navigate = useNavigate();
  const [scripting, setScripting] = React.useState(false);
  const refVideoRef = React.useRef<HTMLInputElement>(null);
  const onAiScript = async () => {
    const subject = await promptDialog('输入主题,AI 生成口播文案:');
    if (!subject || !subject.trim()) return;
    setScripting(true);
    try {
      const r = await digitalHuman.generateScript(subject.trim());
      if (r.script) setText(r.script);
    } catch (e) { reportError(e as Error, 'AI 生成文案失败'); }
    finally { setScripting(false); }
  };
  const onRefVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setScripting(true);
    try {
      const r = await digitalHuman.scriptFromVideo(f);
      if (r.script) setText(r.script);
    } catch (err) { reportError(err as Error, '参考视频生成文案失败'); }
    finally { setScripting(false); }
  };

  const enginesQ = useQuery({ queryKey: ['dh.engines'], queryFn: digitalHuman.listEngines });
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: digitalHuman.listTasks, refetchInterval: 3000 });
  const recentTasks = (tasksQ.data?.items ?? []).filter((t) => t.task_id !== taskId).slice(-8).reverse();
  const engines = enginesQ.data?.items ?? DEFAULT_ENGINES;

  const engineInstalled = engines.find((e) => e.id === engine)?.installed ?? (engine === 'wav2lip');

  const curPreset = presets.find((p) => p.id === pid);
  const mode = curPreset?.compose_mode ?? 'single';
  const roles = curPreset?.avatars ?? [];

  React.useEffect(() => { if (!pid && presets[0]) setPid(presets[0].id); }, [presets, pid]);
  React.useEffect(() => { if (pid) onPresetChange?.(pid); }, [pid, onPresetChange]);

  // 角色数变化时对齐多角色脚本状态长度(coframe / sequential)
  const roleCount = roles.length;
  React.useEffect(() => {
    setCoframeScripts((prev) => {
      if (prev.length === roleCount) return prev;
      const next = prev.slice(0, roleCount);
      while (next.length < roleCount) next.push('');
      return next;
    });
    setSeqSegments((prev) => {
      if (prev.length === roleCount) return prev;
      const next = prev.slice(0, roleCount);
      while (next.length < roleCount) next.push(['']);
      return next;
    });
  }, [roleCount]);

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
    setMatte(false);
  };

  // 实际生成逻辑（门控通过后执行）
  const doGen = async () => {
    setBusy(true);
    try {
      let modeFields: {
        script?: string;
        role_scripts?: string[];
        role_segments?: Array<{ role_index: number; text: string }>;
      };
      if (mode === 'coframe') {
        modeFields = { role_scripts: coframeScripts };
      } else if (mode === 'sequential') {
        const maxLen = Math.max(0, ...seqSegments.map((a) => a.length));
        const roleSegments: { role_index: number; text: string }[] = [];
        for (let k = 0; k < maxLen; k++) {
          for (let i = 0; i < seqSegments.length; i++) {
            const t = (seqSegments[i]?.[k] ?? '').trim();
            if (t) roleSegments.push({ role_index: i, text: t });
          }
        }
        modeFields = { role_segments: roleSegments };
      } else {
        modeFields = { script: text };
      }
      const opts = {
        engine,
        ...(productRef ? { product_image: productRef, template, matte } : {}),
        ...modeFields,
      };
      const r = await digitalHuman.generate(pid, text, opts);
      setTaskId(r.task_id);
    } catch (e) { reportError(e as Error, '数字人生成失败'); }
    finally { setBusy(false); }
  };

  // 带门控的生成入口
  const gen = () => gate.guard(doGen);

  // 各 mode 是否有可生成内容
  const canGenerate =
    mode === 'coframe'
      ? coframeScripts.some((t) => t.trim())
      : mode === 'sequential'
        ? seqSegments.some((segs) => segs.some((t) => t.trim()))
        : text.trim().length > 0;

  if (presets.length === 0)
    return <div className="text-sm text-[var(--cy-text-tertiary)]">先到「我的数字人」新建一个数字人。</div>;

  return (
    <div className="space-y-3">
      {/* 按次门控弹层 */}
      <UsageGateDialogs app="avatar" gate={gate} />

      {/* Engine picker row */}
      <div>
        <div className="mb-1 text-xs text-[var(--cy-text-tertiary)]">画质引擎</div>
        <div className="flex flex-wrap gap-2">
          {engines.map((e) => (
            <button
              key={e.id}
              onClick={() => setEngine(e.id as EngineId)}
              className={`h-8 rounded-md px-3 text-sm ${engine === e.id
                ? 'bg-[var(--cy-ink-700)] text-white'
                : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
              {e.label}
              {!e.installed && (
                <span className="ml-1 text-xs text-[var(--cy-text-tertiary)]">· 未安装</span>
              )}
            </button>
          ))}
        </div>
        {!engineInstalled && (
          <div className="mt-1 flex items-center gap-2 text-sm text-[var(--cy-text-secondary)]">
            <span>该引擎运行时未安装（需 GPU）。</span>
            <button
              onClick={() => void navigate({ to: '/marketplace' as never })}
              className="text-[var(--cy-brand-500)] hover:underline">
              去模型广场安装
            </button>
          </div>
        )}
      </div>

      <select value={pid} onChange={(e) => setPid(e.target.value)}
        className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]">
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder="输入口播文案…"
        className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)]" />
      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={onAiScript} disabled={scripting}
          className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
          {scripting ? '生成中…' : '✨ AI 生成文案'}
        </button>
        <button type="button" onClick={() => refVideoRef.current?.click()} disabled={scripting}
          className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
          🎬 参考视频生成稿
        </button>
        <input ref={refVideoRef} type="file" accept="video/*,audio/*" className="hidden" onChange={onRefVideo} />
      </div>

      {mode === 'coframe' && roles.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-[var(--cy-text-tertiary)]">同框台词(每角色一段,各用各自音色)</div>
          {roles.map((r, i) => (
            <div key={r.ref} className="flex flex-col gap-1">
              <div className="text-xs font-medium text-[var(--cy-text-secondary)]">{r.name || ('角色' + (i + 1))}</div>
              <textarea value={coframeScripts[i] ?? ''} rows={2}
                onChange={(e) => setCoframeScripts((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })}
                placeholder={`${r.name || ('角色' + (i + 1))} 的台词`}
                className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:outline-none" />
            </div>
          ))}
        </div>
      )}

      {mode === 'sequential' && roles.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-[var(--cy-text-tertiary)]">分段台词(每角色可加多段,按段序在角色间轮流播放)</div>
          {roles.map((r, i) => (
            <div key={r.ref} className="flex flex-col gap-1 rounded-md border border-[var(--cy-border-subtle)] p-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[var(--cy-text-secondary)]">{r.name || ('角色' + (i + 1))}</div>
                <button type="button"
                  onClick={() => setSeqSegments((prev) => {
                    const next = prev.map((segs, ri) => (ri === i ? [...segs, ''] : segs));
                    return next;
                  })}
                  className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-0.5 text-xs text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)]">
                  + 添加一段
                </button>
              </div>
              {(seqSegments[i] ?? ['']).map((seg, k) => (
                <div key={k} className="flex items-start gap-1">
                  <textarea value={seg} rows={2}
                    onChange={(e) => setSeqSegments((prev) => prev.map((segs, ri) => (
                      ri === i ? segs.map((sv, sk) => (sk === k ? e.target.value : sv)) : segs
                    )))}
                    placeholder={`第 ${k + 1} 段`}
                    className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:outline-none" />
                  {(seqSegments[i]?.length ?? 0) > 1 && (
                    <button type="button"
                      onClick={() => setSeqSegments((prev) => prev.map((segs, ri) => (
                        ri === i ? segs.filter((_, sk) => sk !== k) : segs
                      )))}
                      className="mt-1 shrink-0 rounded-md border border-[var(--cy-border-subtle)] px-2 py-0.5 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                      删
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

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

      {/* Matte toggle — only shown when a product image is selected */}
      {productRef && (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={matte}
            onChange={(e) => setMatte(e.target.checked)}
            className="h-4 w-4 accent-[var(--cy-brand-500)]"
          />
          <span className="text-sm text-[var(--cy-text-primary)]">绿幕抠像</span>
          <span className="text-xs text-[var(--cy-text-tertiary)]">人像需绿幕底最佳</span>
        </label>
      )}

      <button onClick={() => void gen()} disabled={!pid || !canGenerate || busy || !engineInstalled}
        className="inline-flex h-8 items-center rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
        生成数字人视频
      </button>

      {taskId && <DhProgressCard taskId={taskId} />}
      {recentTasks.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[var(--cy-border-subtle)] pt-2">
          <div className="text-xs text-[var(--cy-text-tertiary)]">最近任务</div>
          {recentTasks.map((t) => (
            <DhProgressCard key={t.task_id} taskId={t.task_id} />
          ))}
        </div>
      )}
    </div>
  );
};
