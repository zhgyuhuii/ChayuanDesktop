import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { digitalHuman, models } from '@chayuan/api';
import type { DigitalHumanPreset, RawModelItem } from '@chayuan/api';
import type { ModalityCapability } from '@chayuan/transport';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@chayuan/ui';
import { reportError } from '../../store/errorDialog';
import { promptDialog } from '../../store/promptDialog';
import { confirmDialog } from '../../store/confirmDialog';
import { useUsageGate, UsageGateDialogs } from '../license';
import { ModelMenuList, displayLabel } from '../composer/ModelMenuList';
import { CHAT_CAPABILITIES, inferCapability } from '../composer/modelCapabilityChip';
import { useResolveLogo } from '../catalog/useLogos';
import { KnowledgePickerPill } from '../composer/KnowledgePickerPill';
import { DhProgressCard } from './DhProgressCard';
import {
  effectiveModel,
  effectiveKuIds,
  showModelPicker,
  showKbPicker,
} from './usePresetBinding';

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

/** 脚本模型存为 `platform_name::id`(无 platform 退化成裸 id),与后端路由一致。 */
function encodeModel(m: RawModelItem): string {
  return m.platform_name ? `${m.platform_name}::${m.id}` : m.id;
}
function decodeModel(v: string | null): { platform?: string; id: string } {
  if (!v) return { id: '' };
  const i = v.indexOf('::');
  return i >= 0 ? { platform: v.slice(0, i), id: v.slice(i + 2) } : { id: v };
}

/** 按中文/英文句末标点和换行切句,去掉空白片段(标点保留在句尾)。 */
function splitSentences(s: string): string[] {
  return (s || '')
    .split(/(?<=[。！？!?\n])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 与后端 _split_string_by_punctuations 对齐:按中英文标点切句(标点不保留),
    用于「播放顺序预览」让所见即所得。coframe 后端按此切句再交织。 */
function splitByPunct(s: string): string[] {
  if (!s) return [];
  return s
    .split(/[?,.、;:!…？，。；：！]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export type PreviewItem = { roleName: string; text: string };
/** 算最终播放顺序(只读预览):
    - coframe:各角色框各自按句切分,再按句序在角色间交织(甲1,乙1,甲2,乙2,…),与后端 plan 一致。
    - sequential:已拼的段序(按段轮流,跳过空段),与 doGen role_segments 顺序一致。 */
export function previewOrder(
  mode: string,
  coframeScripts: string[],
  seqSegments: string[][],
  roleNames: string[],
): PreviewItem[] {
  const out: PreviewItem[] = [];
  const nm = (i: number) => roleNames[i] || ('角色' + (i + 1));
  if (mode === 'coframe') {
    const per = roleNames.map((_, i) => splitByPunct(coframeScripts[i] ?? ''));
    const maxk = per.reduce((m, p) => Math.max(m, p.length), 0);
    for (let k = 0; k < maxk; k++) {
      for (let i = 0; i < per.length; i++) {
        const seg = per[i]?.[k];
        if (seg !== undefined) out.push({ roleName: nm(i), text: seg });
      }
    }
  } else if (mode === 'sequential') {
    const maxLen = seqSegments.reduce((m, a) => Math.max(m, a.length), 0);
    for (let k = 0; k < maxLen; k++) {
      for (let i = 0; i < seqSegments.length; i++) {
        const t = (seqSegments[i]?.[k] ?? '').trim();
        if (t) out.push({ roleName: nm(i), text: t });
      }
    }
  }
  return out;
}

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

  // product image / video state
  const [productRef, setProductRef] = React.useState<string | null>(null);
  const [productName, setProductName] = React.useState<string | null>(null);
  const [productKind, setProductKind] = React.useState<'image' | 'video' | null>(null);
  const [uploadingProduct, setUploadingProduct] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 文案生成模型选择(挂商品图时收窄到 VLM)
  const [scriptModel, setScriptModel] = React.useState<string | null>(null);
  // 文案生成知识库选择(受控);选预设时预填预设 ku_ids
  const [scriptKuIds, setScriptKuIds] = React.useState<string[]>([]);
  const [pickOpen, setPickOpen] = React.useState(false);
  const resolveLogo = useResolveLogo();
  const modelsQ = useQuery({
    queryKey: ['v1.models'],
    queryFn: () => models.list(),
    staleTime: 5 * 60 * 1000,
  });

  // template state (only relevant when productRef is set)
  const [template, setTemplate] = React.useState<Template>('corner');

  // matte (green-screen keying) — only relevant when productRef is set
  const [matte, setMatte] = React.useState(false);

  // 按次门控（avatar: 数字人合成）
  const gate = useUsageGate('avatar');

  const navigate = useNavigate();
  const [scripting, setScripting] = React.useState(false);
  const refVideoRef = React.useRef<HTMLInputElement>(null);
  // AI 生成/参考视频得到整篇文案后,按当前合成模式分发:
  // single 写全局 text;coframe 把整篇按句切分后【均分成 N 段连续块】,角色 i 拿第 i 段连贯段落
  //   (后端 plan 仍按句交织作单一真源,角色框是连贯段落使交织结果可预期 / 所见即所得);
  // sequential 仍按段序轮流进各角色段(分段轮流本就交替)。
  // 覆盖前若各角色框已有非空内容,先确认,避免冲掉用户手改。
  const distributeScript = async (script: string) => {
    setText(script);
    if (roleCount <= 0) return;
    const hasManual =
      mode === 'coframe'
        ? coframeScripts.some((t) => (t ?? '').trim())
        : mode === 'sequential'
          ? seqSegments.some((segs) => segs.some((t) => (t ?? '').trim()))
          : false;
    if (hasManual) {
      const ok = await confirmDialog('AI 生成将覆盖各角色框已填内容,继续?');
      if (!ok) return;
    }
    const sents = splitSentences(script);
    if (mode === 'coframe') {
      const M = sents.length;
      const chunkSize = Math.max(1, Math.ceil(M / roleCount));
      const next = Array.from({ length: roleCount }, (_, i) =>
        sents.slice(i * chunkSize, (i + 1) * chunkSize).join(''));
      setCoframeScripts(next);
    } else if (mode === 'sequential') {
      const next = Array.from({ length: roleCount }, (_, i) => {
        const mine = sents.filter((_, k) => k % roleCount === i);
        return mine.length ? mine : [''];
      });
      setSeqSegments(next);
    }
  };
  const onAiScript = async () => {
    const subject = await promptDialog('输入主题,AI 生成口播文案:');
    if (!subject || !subject.trim()) return;
    setScripting(true);
    try {
      const preset = presets.find((p) => p.id === pid);
      const r = await digitalHuman.generateScript(subject.trim(), {
        model: effectiveModel(preset, scriptModel ?? '') || undefined,
        productRef: productRef ?? undefined,
        kuIds: effectiveKuIds(preset, scriptKuIds),
      });
      if (r.script) await distributeScript(r.script);
    } catch (e) {
      reportError(
        e as Error,
        productRef
          ? 'AI 生成文案失败:请选支持视觉(VLM)的模型,或去模型广场安装'
          : 'AI 生成文案失败:请先在模型厂商配置默认对话模型',
      );
    } finally { setScripting(false); }
  };
  const onRefVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setScripting(true);
    try {
      const r = await digitalHuman.scriptFromVideo(f);
      if (r.script) await distributeScript(r.script);
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

  // 选/切预设时,用预设绑定预填文案生成模型与知识库
  React.useEffect(() => {
    const p = presets.find((x) => x.id === pid);
    setScriptModel(p?.model ?? null);
    setScriptKuIds(p?.ku_ids ?? []);
    // 仅在预设切换时预填,避免覆盖用户手动改动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

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
      setProductKind(r.kind === 'video' ? 'video' : 'image');
      setTemplate('corner');
    } catch (err) {
      reportError(err as Error, '商品上传失败');
    } finally {
      setUploadingProduct(false);
    }
  };

  const removeProduct = () => {
    setProductRef(null);
    setProductName(null);
    setProductKind(null);
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
      // effectiveText:发给后端的全局 text(过 max_length 校验 + 派生字幕/时间轴)。
      // 多角色模式 text 全局为空,这里按模式拼出有效文案。
      let effectiveText: string;
      if (mode === 'coframe') {
        modeFields = { role_scripts: coframeScripts };
        effectiveText = coframeScripts.filter((s) => s.trim()).join('\n');
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
        effectiveText = roleSegments.map((s) => s.text).join('\n');
      } else {
        modeFields = { script: text };
        effectiveText = text;
      }
      const opts = {
        engine,
        ...(productRef ? { product_image: productRef, template, matte } : {}),
        ...modeFields,
      };
      const r = await digitalHuman.generate(pid, effectiveText, opts);
      setTaskId(r.task_id);
    } catch (e) { reportError(e as Error, '数字人生成失败'); }
    finally { setBusy(false); }
  };

  // 带门控的生成入口
  const gen = () => gate.guard(doGen);

  // ── 文案生成模型选择 ─────────────────────────────────────────
  // 挂了商品图时,文案生成需要看图 → 只允许视觉语言(VLM)模型;否则允许 chat+vl。
  const hasImage = !!productRef;
  const allModels: RawModelItem[] = React.useMemo(
    () => (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm'),
    [modelsQ.data],
  );
  const capFilter = React.useMemo<ReadonlySet<ModalityCapability>>(
    () => (hasImage ? new Set<ModalityCapability>(['vl']) : CHAT_CAPABILITIES),
    [hasImage],
  );
  // 当前可选模型(应用 capability 过滤);用于"有无 VLM"判定。
  const vlModels = React.useMemo(
    () => allModels.filter((m) => inferCapability(m) === 'vl'),
    [allModels],
  );
  const noVlmModel = hasImage && !modelsQ.isLoading && vlModels.length === 0;
  const curModel = decodeModel(scriptModel);
  const currentModel = allModels.find(
    (m) => m.id === curModel.id && (curModel.platform ? m.platform_name === curModel.platform : true),
  );
  const currentModelLabel = currentModel
    ? displayLabel(currentModel)
    : (curModel.id || (modelsQ.isLoading ? '加载中…' : '默认模型'));

  // 播放顺序预览(只读):反映最终合成后片段播放顺序,让用户「所见即所得」。
  const roleNames = roles.map((r, i) => r.name || ('角色' + (i + 1)));
  const orderPreview = React.useMemo(
    () => previewOrder(mode, coframeScripts, seqSegments, roleNames),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, coframeScripts, seqSegments, roleNames.join('\u0001')],
  );

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
              去模型厂商配置
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
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={onAiScript} disabled={scripting || noVlmModel}
          className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
          {scripting ? '生成中…' : '✨ AI 生成文案'}
        </button>
        <button type="button" onClick={() => refVideoRef.current?.click()} disabled={scripting}
          className="rounded-md border border-[var(--cy-border-subtle)] px-2 py-1 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
          🎬 参考视频生成稿
        </button>
        <input ref={refVideoRef} type="file" accept="video/*,audio/*" className="hidden" onChange={onRefVideo} />
        {/* 文案生成模型选择 — 复用会话里的分组折叠 + 厂商图标选择器(ModelMenuList)。
            挂商品图时(hasImage)收窄到 VLM,让文案能"看图说话"。预设锁定模型时隐藏。 */}
        {showModelPicker(curPreset) && (
          <DropdownMenu open={pickOpen} onOpenChange={setPickOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button"
                className="inline-flex h-7 min-w-[10em] items-center gap-1.5 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
                title={hasImage ? '挂商品图时仅可选视觉(VLM)模型' : '文案生成模型'}>
                <span className="max-w-[140px] truncate">{currentModelLabel}</span>
                <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12}
              className="z-[260] w-80 overflow-hidden p-0">
              <ModelMenuList
                models={allModels}
                currentId={curModel.id}
                currentPlatform={curModel.platform}
                allowCapabilities={capFilter}
                resolveLogo={resolveLogo}
                emptyLabel={
                  modelsQ.isLoading
                    ? '加载中…'
                    : hasImage
                      ? '未检测到图像对话(VLM)模型'
                      : '无可用模型'
                }
                emptyAction={
                  hasImage ? (
                    <button type="button"
                      onClick={() => { setPickOpen(false); void navigate({ to: '/model-gallery' as never }); }}
                      className="text-[var(--cy-brand-500)] hover:underline">
                      去模型广场安装
                    </button>
                  ) : undefined
                }
                onPick={(m) => { if (m.available === false) return; setScriptModel(encodeModel(m)); setPickOpen(false); }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* 文案生成知识库选择(受控);预设锁定知识源时隐藏。 */}
        {showKbPicker(curPreset) && (
          <KnowledgePickerPill side="bottom" align="start" value={scriptKuIds} onChange={setScriptKuIds} />
        )}
      </div>
      {noVlmModel && (
        <div className="flex items-center gap-2 text-xs text-[var(--cy-text-secondary)]">
          <span>未检测到图像对话(VLM)模型,无法基于商品图生成文案。</span>
          <button type="button" onClick={() => void navigate({ to: '/model-gallery' as never })}
            className="text-[var(--cy-brand-500)] hover:underline">
            去模型广场安装
          </button>
        </div>
      )}

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

      {/* 播放顺序预览(只读):同框=按句交织顺序;分段=段序轮流。反映最终「所得」。 */}
      {mode !== 'single' && roles.length > 0 && orderPreview.length > 0 && (
        <div className="rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-2)] p-2">
          <div className="mb-1 text-xs text-[var(--cy-text-tertiary)]">
            {mode === 'coframe' ? '播放顺序预览(同框按句交织)' : '播放顺序预览(分段轮流)'}
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-[var(--cy-text-secondary)]">
            {orderPreview.map((it, i) => (
              <div key={i} className="truncate">
                <span className="text-[var(--cy-text-tertiary)]">{'\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2469'[i] ?? (i + 1) + '.'}</span>{' '}
                <span className="font-medium text-[var(--cy-text-primary)]">{it.roleName}</span>
                <span className="text-[var(--cy-text-tertiary)]">: </span>
                {it.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product image upload row */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => void handleProductFileChange(e)}
        />
        {productRef ? (
          <>
            <span className="text-sm" aria-hidden>{productKind === 'video' ? '🎬' : '🖼️'}</span>
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
            {uploadingProduct ? '上传中…' : '上传商品图 / 视频（可选）'}
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
