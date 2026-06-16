/**
 * 对话内联产出面板:挂在某条 assistant 消息下方。
 * 可编辑提示词 + 类型设置(复用 ACTION_TYPES[type].Settings)+ 确定 → streamModality 生成
 * → 取首个 file part 产物 → 面板内播放/预览 + 下载,并回调 onArtifact 持久化到消息。
 */
import * as React from 'react';
import { Loader2, Play, X, Download, AlertTriangle } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { getClientConfig } from '@chayuan/api';
import { streamModality, isFilePart } from '@chayuan/transport';
import { reportError } from '../../../store/errorDialog';
import { downloadUrlAsFile } from '../../../lib/downloadMedia';
import { ACTION_TYPES } from './actionTypes';
import { useAvailableModelsByCapability, pickBestModel } from '../../home/capabilityCards/useAvailableModelsByCapability';
import type { ActionTypeKey } from './intentDetect';

export interface GeneratedArtifact { mediaType: string; url: string; metadata?: Record<string, unknown> }

export const MessageActionPanel: React.FC<{
  type: ActionTypeKey;
  initialPrompt: string;
  onClose: () => void;
  onArtifact: (a: GeneratedArtifact) => void;
}> = ({ type, initialPrompt, onClose, onArtifact }) => {
  const def = ACTION_TYPES[type];
  const [prompt, setPrompt] = React.useState(initialPrompt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [settings, setSettings] = React.useState<any>(def?.defaultSettings);
  const { byCap } = useAvailableModelsByCapability();
  const pickModels = def?.usesModelPicker ? (byCap.get(def.capability) ?? []) : [];
  const [pickedModel, setPickedModel] = React.useState<string>('');
  React.useEffect(() => {
    if (!def?.usesModelPicker) return;
    if (pickedModel) return;
    const best = pickBestModel(pickModels);
    if (best) setPickedModel(best.platform_name ? `${best.platform_name}::${best.id}` : best.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickModels.length]);
  const [refImg, setRefImg] = React.useState<{ mime: string; dataB64: string; preview: string } | null>(null);
  const refInputRef = React.useRef<HTMLInputElement | null>(null);
  const onPickRef = async (file: File | undefined) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf); const CH = 0x8000; let bin = '';
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
    const b64 = btoa(bin);
    setRefImg({ mime: file.type || 'image/png', dataB64: b64, preview: `data:${file.type || 'image/png'};base64,${b64}` });
  };
  const [busy, setBusy] = React.useState(false);
  const [artifact, setArtifact] = React.useState<GeneratedArtifact | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  if (!def) return null;
  const Settings = def.Settings;

  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text) { setErr('请输入要生成的内容'); return; }
    setBusy(true); setErr(null); setArtifact(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const baseUrl = getClientConfig().baseURL || '';
      const model = def.usesModelPicker ? pickedModel : def.buildModel(settings);
      if (!model) { setErr('请选择生成模型'); setBusy(false); return; }
      if (def.needsRefImage && !refImg) { setErr('请先上传参考图'); setBusy(false); return; }
      const stream = streamModality({
        model,
        prompt: text,
        params: def.buildParams(settings),
        attachments: refImg ? [{ mime: refImg.mime, dataB64: refImg.dataB64 }] : undefined,
        baseUrl,
      }, ctrl.signal);
      let found: GeneratedArtifact | null = null;
      for await (const ev of stream) {
        if (isFilePart(ev)) {
          const url = ev.url.startsWith('/') ? baseUrl.replace(/\/+$/, '') + ev.url : ev.url;
          found = { mediaType: ev.mediaType, url, metadata: ev.metadata };
          break;
        }
      }
      if (!found) { setErr('未产出内容,请重试或换引擎/模型'); return; }
      setArtifact(found);
      onArtifact(found);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setErr((e as Error).message || '生成失败');
      reportError(e as Error, '生成失败');
    } finally {
      setBusy(false); abortRef.current = null;
    }
  };

  const dlName = `${def.label}-${Date.now()}`;

  return (
    <div className="mt-2 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--cy-text-secondary)]">
        <def.icon className="h-3.5 w-3.5" /> {def.label}
        <button type="button" onClick={onClose} className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]" title="关闭">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
        className="mb-2 w-full resize-y rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs text-[var(--cy-text-primary)] focus-visible:outline-none"
        placeholder="要合成/生成的文字/提示词…" />
      {def.usesModelPicker && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
          <span className="opacity-60">模型</span>
          <select value={pickedModel} onChange={(e) => setPickedModel(e.target.value)}
            className="h-6 max-w-[16rem] rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 text-[10px] text-[var(--cy-text-primary)] focus-visible:outline-none">
            {pickModels.length === 0 && <option value="">(无可用模型,去模型厂商配置)</option>}
            {pickModels.map((m) => {
              const val = m.platform_name ? `${m.platform_name}::${m.id}` : m.id;
              return <option key={val} value={val}>{m.platform_display_name ? `${m.platform_display_name} · ${m.id}` : m.id}</option>;
            })}
          </select>
        </div>
      )}
      {def.needsRefImage && (
        <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--cy-text-secondary)]">
          <input ref={refInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { void onPickRef(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => refInputRef.current?.click()}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] px-2 text-[10px] hover:bg-[var(--cy-surface-2)]">
            上传参考图
          </button>
          {refImg && <img src={refImg.preview} alt="参考图" className="h-8 w-8 rounded object-cover" />}
        </div>
      )}
      <Settings value={settings} onChange={setSettings} />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => void onGenerate()} disabled={busy}
          className={cn('inline-flex h-7 items-center gap-1 rounded-lg px-3 text-xs font-medium text-white disabled:opacity-50',
            'bg-[var(--cy-brand-500)] hover:bg-[var(--cy-brand-600)]')}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? '生成中…' : '确定生成'}
        </button>
        {busy && (
          <button type="button" onClick={() => abortRef.current?.abort()}
            className="inline-flex h-7 items-center rounded-lg border border-[var(--cy-border-subtle)] px-3 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">取消</button>
        )}
        {err && <span className="inline-flex items-center gap-1 text-xs text-rose-600"><AlertTriangle className="h-3.5 w-3.5" />{err}</span>}
      </div>
      {artifact && (
        <div className="mt-2">
          {artifact.mediaType.startsWith('audio/') && <audio src={artifact.url} controls preload="metadata" className="w-full max-w-lg" />}
          {artifact.mediaType.startsWith('image/') && <img src={artifact.url} alt="产物" className="max-h-[40vh] rounded-lg" />}
          {artifact.mediaType.startsWith('video/') && <video src={artifact.url} controls preload="metadata" className="max-h-[40vh] w-full rounded-lg bg-black" />}
          <button type="button" onClick={() => void downloadUrlAsFile(dlName, artifact.url)}
            className="mt-1 inline-flex h-6 items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 text-[10px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
            <Download className="h-3 w-3" /> 下载
          </button>
        </div>
      )}
    </div>
  );
};
