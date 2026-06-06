/**
 * PresetEditor — 新建 / 编辑一个数字人预设。
 *
 * 包含:名字 input、形象选择器(grid + 上传 tile)、音色绑定(VoicePicker)、保存/取消。
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@chayuan/ui';
import { digitalHuman, models, knowledgeUniverse, type DigitalHumanPreset, type DhVoiceProvider, type DhAvatar,
  type AvatarSlot, type DhComposeMode, type DhLayout, type RawModelItem, type KuItem } from '@chayuan/api';
import type { ModalityCapability } from '@chayuan/transport';
import { reportError } from '../../store/errorDialog';
import { VoicePicker, type VoicePickerValue } from '../video-generation/VoicePicker';
import { confirmDialog } from '../../store/confirmDialog';
import { CanvasStage } from './CanvasStage';
import { GROUPS as ASPECT_GROUPS } from '../video-generation/VgAspectPicker';
import { videoGeneration, type VgFontItem } from '@chayuan/api';
import { ModelMenuList, displayLabel } from '../composer/ModelMenuList';
import { CHAT_CAPABILITIES } from '../composer/modelCapabilityChip';
import { useResolveLogo } from '../catalog/useLogos';
import { KnowledgePickerPill } from '../composer/KnowledgePickerPill';

/** 对话模型存为 `platform_name::id`(无 platform 退化成裸 id),与后端路由一致。 */
function encodeModel(m: RawModelItem): string {
  return m.platform_name ? `${m.platform_name}::${m.id}` : m.id;
}
function decodeModel(v: string | null): { platform?: string; id: string } {
  if (!v) return { id: '' };
  const i = v.indexOf('::');
  return i >= 0 ? { platform: v.slice(0, i), id: v.slice(i + 2) } : { id: v };
}

interface PresetEditorProps {
  initial?: DigitalHumanPreset;
  onSaved: () => void;
  onCancel: () => void;
}

export const PresetEditor: React.FC<PresetEditorProps> = ({ initial, onSaved, onCancel }) => {
  const qc = useQueryClient();

  const [name, setName] = React.useState(initial?.name ?? '');
  const [welcome, setWelcome] = React.useState(initial?.welcome ?? '');
  const [avatarRef, setAvatarRef] = React.useState(initial?.avatar_ref ?? '');
  const [voice] = React.useState<VoicePickerValue>({
    voice_provider: (initial?.voice_provider ?? 'piper') as DhVoiceProvider,
    voice_name: initial?.voice_name ?? '',
  });
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [composeMode, setComposeMode] = React.useState<DhComposeMode>(initial?.compose_mode ?? 'single');
  const [layout] = React.useState<DhLayout>(initial?.layout ?? 'side');
  const [slots, setSlots] = React.useState<AvatarSlot[]>(initial?.avatars ?? []);
  const [focusedRef, setFocusedRef] = React.useState<string>('');
  const [canvas, setCanvas] = React.useState<{ w: number; h: number }>({
    w: initial?.video_width ?? 720, h: initial?.video_height ?? 1280,
  });
  const [sub, setSub] = React.useState({
    subtitle_enabled: initial?.subtitle_enabled ?? true,
    subtitle_position: (initial?.subtitle_position ?? 'bottom') as 'top' | 'bottom' | 'center' | 'custom',
    font_name: initial?.font_name ?? '',
    font_size: initial?.font_size ?? 60,
    text_fore_color: initial?.text_fore_color ?? '#FFFFFF',
    stroke_color: initial?.stroke_color ?? '#000000',
    stroke_width: initial?.stroke_width ?? 1.5,
    text_background_color: initial?.text_background_color ?? true,
  });
  const setSubF = (patch: Partial<typeof sub>) => setSub((s) => ({ ...s, ...patch }));
  // 对话模型 + 知识库绑定 + 两个"允许实时/生成时更改"开关
  const [bindModel, setBindModel] = React.useState(initial?.model ?? '');       // platform::id
  const [bindKuIds, setBindKuIds] = React.useState<string[]>(initial?.ku_ids ?? []);
  const [allowModelOverride, setAllowModelOverride] = React.useState(initial?.allow_model_override ?? true);
  const [allowKbOverride, setAllowKbOverride] = React.useState(initial?.allow_kb_override ?? true);
  // 抠像:制作时勾选 → 在线数字人对话页的形象自动去纯色背景(无需再去卡片点 ✂️)
  const [greenscreen, setGreenscreen] = React.useState(initial?.is_greenscreen ?? false);
  const [modelPickOpen, setModelPickOpen] = React.useState(false);
  const resolveLogo = useResolveLogo();
  const avatarFileRef = React.useRef<HTMLInputElement | null>(null);

  const avatarsQ = useQuery({
    queryKey: ['dh.avatars'],
    queryFn: digitalHuman.listAvatars,
    staleTime: 2 * 60 * 1000,
  });
  const avatars = avatarsQ.data?.items ?? [];

  const fontsQ = useQuery({ queryKey: ['vg.fonts'], queryFn: () => videoGeneration.listFonts() });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];

  // 对话模型选择 — 复用 GeneratePanel 同款(ModelMenuList + platform::id 编码 + CHAT 能力过滤)。
  const modelsQ = useQuery({ queryKey: ['v1.models'], queryFn: () => models.list(), staleTime: 5 * 60 * 1000 });
  const allModels: RawModelItem[] = React.useMemo(
    () => (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm'),
    [modelsQ.data],
  );
  const chatCapFilter = CHAT_CAPABILITIES as ReadonlySet<ModalityCapability>;
  const curBindModel = decodeModel(bindModel);
  const currentBindModel = allModels.find(
    (m) => m.id === curBindModel.id && (curBindModel.platform ? m.platform_name === curBindModel.platform : true),
  );
  // 失效检测:绑了 model 但在可用列表里找不到(被卸载)。
  const modelInvalid = !!bindModel && !modelsQ.isLoading && !currentBindModel;
  const bindModelLabel = currentBindModel
    ? displayLabel(currentBindModel)
    : (curBindModel.id
        ? (modelInvalid ? `⚠ ${curBindModel.id}(已失效)` : curBindModel.id)
        : (modelsQ.isLoading ? '加载中…' : '默认对话模型'));
  // 失效检测:绑的 ku_id 在可用列表里缺失(被删)。
  const kbsQ = useQuery({ queryKey: ['v1.knowledgeUniverse.list'], queryFn: () => knowledgeUniverse.list(), staleTime: 5 * 60 * 1000 });
  const kbList: KuItem[] = kbsQ.data ?? [];
  const missingKuIds = React.useMemo(() => {
    if (!bindKuIds.length || kbsQ.isLoading) return [];
    const avail = new Set(kbList.map((k) => k.ku_id));
    return bindKuIds.filter((id) => !avail.has(id));
  }, [bindKuIds, kbList, kbsQ.isLoading]);

  // 找到当前选中形象,用于提交时写 avatar_kind

  const onUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      const a = await digitalHuman.uploadAvatar(f);
      await qc.invalidateQueries({ queryKey: ['dh.avatars'] });
      setAvatarRef(a.ref);
    } catch (err) {
      reportError(err as Error, '上传形象失败');
    } finally {
      setUploading(false);
    }
  };

  const onDeleteAvatar = async (a: DhAvatar) => {
    const ok = await confirmDialog(`确定删除形象「${a.name}」?`);
    if (!ok) return;
    setDeleting(a.ref);
    try {
      await digitalHuman.deleteAvatar(a.name);
      if (avatarRef === a.ref) setAvatarRef('');
      setSlots((prev) => prev.filter((sl) => sl.ref !== a.ref));
      setFocusedRef((cur) => (cur === a.ref ? '' : cur));
      await qc.invalidateQueries({ queryKey: ['dh.avatars'] });
    } catch (err) {
      reportError(err as Error, '删除形象失败');
    } finally {
      setDeleting(null);
    }
  };

  const isMulti = composeMode !== 'single';
  const inSlots = (ref: string) => slots.some((x) => x.ref === ref);
  const setSlotField = (ref: string, patch: Partial<AvatarSlot>) =>
    setSlots((prev) => prev.map((x) => (x.ref === ref ? { ...x, ...patch } : x)));
  const setSlotVoice = (ref: string, v: VoicePickerValue) =>
    setSlots((prev) => prev.map((x) => (x.ref === ref
      ? { ...x, voice_provider: v.voice_provider, voice_name: v.voice_name } : x)));
  const slotVoiceValue = (sl: AvatarSlot): VoicePickerValue => ({
    voice_provider: (sl.voice_provider || voice.voice_provider) as VoicePickerValue['voice_provider'],
    voice_name: sl.voice_provider ? (sl.voice_name || '') : voice.voice_name,
  });

  // 多形象:点格子 = 加入阵容(若未加入)并聚焦;已在阵容则只聚焦,不移除。
  // 昵称自动预填「角色N」省去强制摩擦(name 必填仅多角色),用户可再改。
  const addIfAbsentAndFocus = (a: DhAvatar) => {
    setSlots((prev) => (prev.some((x) => x.ref === a.ref)
      ? prev
      : [...prev, { ref: a.ref, kind: a.kind, label: a.name, lines: '', name: a.name || ('角色' + (prev.length + 1)) }]));
    setFocusedRef(a.ref);
  };
  // 移出阵容(不删除形象资产),点序号徽标触发。
  const removeFromCast = (ref: string) => {
    setSlots((prev) => prev.filter((x) => x.ref !== ref));
    setFocusedRef((cur) => (cur === ref ? '' : cur));
  };

  // 单形象:点格子 = 替换为该形象(恰好 1 个 slot),并聚焦。统一走 slot 模型,
  // 复用多形象的聚焦配置(语言在音色前)+ 可拖拽缩放画布。
  const pickSingle = (a: DhAvatar) => {
    setSlots([{ ref: a.ref, kind: a.kind, label: a.name, lines: '' }]);
    setAvatarRef(a.ref);
    setFocusedRef(a.ref);
  };

  // 默认聚焦:单/多形象统一 -> 第一个 slot(单形象=恰好 1 个 slot)。
  React.useEffect(() => {
    const first = slots[0];
    if (first && !slots.some((s2) => s2.ref === focusedRef)) {
      setFocusedRef(first.ref);
    } else if (!slots.length && focusedRef) {
      setFocusedRef('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  // 昵称必填仅对多角色(coframe/sequential)生效——名字会烧成画面标签区分角色;
  // 单形象是干净口播,不强制昵称、也不烧名字。
  const allNamed = composeMode === 'single' ? true : slots.every((s) => (s.name ?? '').trim().length > 0);
  const canSave = name.trim().length > 0 && !saving && allNamed && (
    composeMode === 'single' ? slots.length >= 1 : slots.length >= 2
  );

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // 单/多形象统一:avatars=slots(单=1 个),首槽音色镜像到预设级,后端单形象路径读 avatar_ref。
      const body: Partial<DigitalHumanPreset> = {
        name: name.trim(),
        welcome: welcome.trim(),
        avatar_ref: slots[0]?.ref ?? '',
        avatar_kind: slots[0]?.kind ?? 'image',
        compose_mode: composeMode,
        layout,
        avatars: slots,
        video_width: canvas.w,
        video_height: canvas.h,
        subtitle: sub,
        voice_provider: (slots[0]?.voice_provider || voice.voice_provider) as DigitalHumanPreset['voice_provider'],
        voice_name: slots[0]?.voice_name || voice.voice_name,
        model: bindModel,
        ku_ids: bindKuIds,
        allow_model_override: allowModelOverride,
        allow_kb_override: allowKbOverride,
        is_greenscreen: greenscreen,
      };
      if (initial) {
        await digitalHuman.updatePreset(initial.id, body);
      } else {
        await digitalHuman.createPreset(body);
      }
      onSaved();
    } catch (err) {
      reportError(err as Error, initial ? '更新数字人失败' : '创建数字人失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <h3 className="shrink-0 text-sm font-medium text-[var(--cy-text-primary)]">
        {initial ? '编辑数字人' : '新建数字人'}
      </h3>
      {/* 左:设置(滚动) · 右:预览(与工作台一致) */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto pr-1">

      {/* 名字 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">名字</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="给数字人起个名字"
          className={cn(
            'h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]',
            'px-2 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)]',
            'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
          )}
        />
      </div>

      {/* 欢迎语(在线数字人开场白) */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">欢迎语<span className="ml-1 text-[var(--cy-text-tertiary)]">(在线对话页进入时的开场白)</span></label>
        <textarea
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          placeholder="例如:欢迎来到直播间~ 有什么想了解的尽管问我"
          rows={2}
          className={cn(
            'rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] resize-none',
            'px-2 py-1.5 text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)]',
            'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
          )}
        />
      </div>

      {/* 合成模式 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">合成模式</label>
        <div className="flex gap-1.5 text-[11px]">
          {(([['single', '单形象'], ['coframe', '多人同框'], ['sequential', '分段轮流']]) as [DhComposeMode, string][]).map(([m, zh]) => (
            <button key={m} type="button" onClick={() => setComposeMode(m)}
              className={cn('rounded-md border px-2 py-1',
                composeMode === m
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
              {zh}
            </button>
          ))}
        </div>
        {isMulti && (
          <span className="text-[10px] text-[var(--cy-text-tertiary)]">点形象格子多选(数字=出场顺序),需 ≥2 个</span>
        )}
      </div>

      {/* 画布尺寸 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">画布</label>
        <div className="flex flex-col gap-1">
          {ASPECT_GROUPS.map((g) => (
            <div key={g.title} className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 text-[10px] text-[var(--cy-text-tertiary)]">{g.title}</span>
              {g.items.map((it) => (
                <button key={it.w + 'x' + it.h} type="button" onClick={() => setCanvas({ w: it.w, h: it.h })}
                  title={`${it.w}×${it.h} (${it.ratio})`}
                  className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
                    canvas.w === it.w && canvas.h === it.h
                      ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                      : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
                  <span className="inline-block rounded-[2px] border border-current opacity-70"
                    style={{ width: Math.max(8, Math.round(12 * Math.min(1, it.w / it.h))), height: Math.max(8, Math.round(12 * Math.min(1, it.h / it.w))) }} />
                  {it.label}
                </button>
              ))}
            </div>
          ))}
          <span className="text-[10px] text-[var(--cy-text-tertiary)]">{canvas.w}×{canvas.h}</span>
        </div>
      </div>

      {/* 抠像:制作时勾选 → 在线对话页形象自动去纯色背景 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">在线形象抠像</label>
        <button type="button" onClick={() => setGreenscreen(!greenscreen)}
          className={cn('self-start rounded-md border px-2 py-1 text-[10px]',
            greenscreen ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)]')}
          title="开启后,在线数字人对话页的形象会去掉纯色背景(仅留人像);需形象为纯色/绿幕底">
          {greenscreen ? '抠像:开(去纯色背景)' : '抠像:关'}
        </button>
      </div>

      {/* 字幕设置 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">字幕</label>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--cy-text-tertiary)]">
          <button type="button" onClick={() => setSubF({ subtitle_enabled: !sub.subtitle_enabled })}
            className={cn('rounded-md border px-2 py-1',
              sub.subtitle_enabled ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)]')}>
            {sub.subtitle_enabled ? '字幕:开' : '字幕:关'}
          </button>
          {sub.subtitle_enabled && (<>
            <select value={sub.subtitle_position} onChange={(e) => setSubF({ subtitle_position: e.target.value as typeof sub.subtitle_position })}
              className="h-6 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 text-[10px]">
              <option value="bottom">底部</option>
              <option value="center">居中</option>
              <option value="top">顶部</option>
            </select>
            <select value={sub.font_name} onChange={(e) => setSubF({ font_name: e.target.value })}
              title="字体(系统字体)"
              className="h-6 w-24 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 text-[10px]">
              {fonts.length === 0 && <option value={sub.font_name}>{fontsQ.isLoading ? '加载中…' : '(无字体)'}</option>}
              {fonts.map((f) => <option key={f.name} value={f.name} title={f.label ?? f.name}>{f.label ?? f.name}</option>)}
            </select>
            <label className="inline-flex items-center gap-1">字号
              <input type="number" min={12} max={200} value={sub.font_size}
                onChange={(e) => setSubF({ font_size: Math.max(12, Math.min(200, parseInt(e.target.value, 10) || 60)) })}
                className="h-6 w-12 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 text-[10px]" /></label>
            <label className="inline-flex items-center gap-1">字色
              <input type="color" value={sub.text_fore_color} onChange={(e) => setSubF({ text_fore_color: e.target.value })} className="h-6 w-6 rounded" /></label>
            <label className="inline-flex items-center gap-1">描边
              <input type="color" value={sub.stroke_color} onChange={(e) => setSubF({ stroke_color: e.target.value })} className="h-6 w-6 rounded" /></label>
            <label className="inline-flex items-center gap-1">描边宽
              <input type="number" min={0} max={10} step={0.5} value={sub.stroke_width}
                onChange={(e) => setSubF({ stroke_width: Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)) })}
                className="h-6 w-12 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 text-[10px]" /></label>
            <button type="button" onClick={() => setSubF({ text_background_color: !(sub.text_background_color === true) })}
              className={cn('rounded-md border px-2 py-1', sub.text_background_color === true ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'border-[var(--cy-border-subtle)]')}>
              {sub.text_background_color === true ? '背景:开' : '背景:关'}
            </button>
          </>)}
        </div>
      </div>

      {/* 知识库 | 对话模型 | 允许更改 — 一行(预设全局区,各角色配置之上) */}
      <div className="flex flex-wrap items-start gap-4">
        {/* 知识库(在模型前) */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">知识库</label>
          <div className="flex flex-wrap items-center gap-2">
            <KnowledgePickerPill value={bindKuIds} onChange={setBindKuIds} />
          </div>
          {missingKuIds.length > 0 && (
            <span className="text-[11px] text-[var(--cy-danger-500)]">⚠ 绑定的知识库已失效(被删除 {missingKuIds.length} 个),请重新绑定。</span>
          )}
        </div>
        {/* 对话模型 */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">对话模型</label>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu open={modelPickOpen} onOpenChange={setModelPickOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button"
                  className="inline-flex h-8 min-w-[10em] items-center gap-1.5 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
                  title="绑定默认对话模型(留空=用全局默认)">
                  <span className="max-w-[160px] truncate">{bindModelLabel}</span>
                  <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12}
                className="z-[260] w-80 overflow-hidden p-0">
                <ModelMenuList
                  models={allModels}
                  currentId={curBindModel.id}
                  currentPlatform={curBindModel.platform}
                  allowCapabilities={chatCapFilter}
                  resolveLogo={resolveLogo}
                  emptyLabel={modelsQ.isLoading ? '加载中…' : '无可用模型'}
                  onPick={(m) => { if (m.available === false) return; setBindModel(encodeModel(m)); setModelPickOpen(false); }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {bindModel && (
              <button type="button" onClick={() => setBindModel('')}
                className="text-[11px] text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">清除</button>
            )}
          </div>
          {modelInvalid && (
            <span className="text-[11px] text-[var(--cy-danger-500)]">⚠ 绑定的模型已失效(被卸载),请重新绑定。</span>
          )}
        </div>
        {/* 允许更改(两个独立开关,放模型后) */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">允许更改</label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
            <input type="checkbox" checked={allowModelOverride} onChange={(e) => setAllowModelOverride(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--cy-brand-500)]" />
            实时/生成时改模型
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
            <input type="checkbox" checked={allowKbOverride} onChange={(e) => setAllowKbOverride(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--cy-brand-500)]" />
            实时/生成时改知识库
          </label>
        </div>
      </div>

      {/* 形象选择器 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">形象</label>
        {avatarsQ.isLoading ? (
          <div className="flex items-center gap-1 text-[11px] text-[var(--cy-text-tertiary)]">
            <Loader2 className="h-3 w-3 animate-spin" /> 加载形象…
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {avatars.map((a) => (
              <div key={a.ref} className="group relative">
                <button
                  type="button"
                  onClick={() => (isMulti ? addIfAbsentAndFocus(a) : pickSingle(a))}
                  title={a.name}
                  className={cn(
                    'h-16 w-16 overflow-hidden rounded-lg border transition-colors',
                    focusedRef === a.ref
                      ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-400)]'
                      : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-300)]',
                  )}
                >
                  {a.kind === 'video' ? (
                    <video
                      src={digitalHuman.avatarFileUrl(a.ref)}
                      muted
                      preload="metadata"
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img
                      src={digitalHuman.avatarFileUrl(a.ref)}
                      alt={a.name}
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                  )}
                </button>
                {a.source === 'user' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteAvatar(a); }}
                    disabled={deleting === a.ref}
                    title="删除"
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--cy-danger-500)] text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
                {isMulti && inSlots(a.ref) && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeFromCast(a.ref); }}
                    title="点序号移出阵容(不删除形象)"
                    className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-[9px] text-white hover:bg-[var(--cy-danger-500)]"
                  >
                    {slots.findIndex((x) => x.ref === a.ref) + 1}
                  </button>
                )}
              </div>
            ))}
            {/* 上传 tile */}
            <button
              type="button"
              onClick={() => avatarFileRef.current?.click()}
              disabled={uploading}
              title="上传自定义形象"
              className="flex h-16 w-16 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--cy-border-subtle)] text-[10px] text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50"
            >
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Plus className="h-4 w-4" /><span>上传</span></>
              }
            </button>
            <input
              ref={avatarFileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={onUploadAvatar}
            />
          </div>
        )}
      </div>

      {/* 聚焦角色 配置(单/多形象统一:显示当前聚焦角色;语言在音色前) */}
      {slots.length > 0 && (() => {
        const fSlot = slots.find((s2) => s2.ref === focusedRef) ?? slots[0];
        if (!fSlot) return null;
        const fIdx = slots.findIndex((x) => x.ref === fSlot.ref) + 1;
        return (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 rounded-md border border-[var(--cy-border-subtle)] p-2">
              <div className="flex items-center gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-[9px] text-white">{fIdx}</span>
                <input type="text" value={fSlot.name ?? ''}
                  onChange={(e) => setSlotField(fSlot.ref, { name: e.target.value })}
                  placeholder="昵称(如 小李)"
                  className={cn('h-7 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-[11px] text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:outline-none',
                    composeMode !== 'single' && !(fSlot.name ?? '').trim() && 'border-[var(--cy-danger-500)]')} />
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--cy-text-tertiary)]">
                <select value={fSlot.language ?? ''}
                  onChange={(e) => setSlotField(fSlot.ref, { language: e.target.value })}
                  title="语言(影响可选音色)"
                  className="h-6 w-16 shrink-0 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 text-[10px] text-[var(--cy-text-primary)] focus-visible:outline-none">
                  <option value="">自动</option>
                  <option value="zh-CN">中文</option>
                  <option value="en-US">英文</option>
                  <option value="ja-JP">日文</option>
                </select>
                <VoicePicker value={slotVoiceValue(fSlot)} onChange={(v) => setSlotVoice(fSlot.ref, v)} language={fSlot.language} />
                <span>语速</span>
                <input type="range" min={0.5} max={1.5} step={0.05} value={fSlot.voice_rate ?? 1}
                  onChange={(e) => setSlotField(fSlot.ref, { voice_rate: Number(e.target.value) })} className="w-16" />
                <span>{(fSlot.voice_rate ?? 1).toFixed(2)}</span>
                <span>音量</span>
                <input type="range" min={0} max={1.5} step={0.05} value={fSlot.voice_volume ?? 1}
                  onChange={(e) => setSlotField(fSlot.ref, { voice_volume: Number(e.target.value) })} className="w-16" />
                <span>{(fSlot.voice_volume ?? 1).toFixed(2)}</span>
              </div>
              {/* 角色人设/语气(多角色生成时注入 prompt) */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[var(--cy-text-tertiary)]">人设/语气</label>
                <textarea value={fSlot.persona ?? ''}
                  onChange={(e) => setSlotField(fSlot.ref, { persona: e.target.value })}
                  placeholder="人设/语气,如:热情主播,口语化"
                  rows={2}
                  className="rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 py-1 text-[11px] text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none" />
              </div>
            </div>
          </div>
        );
      })()}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2">
        {!allNamed && composeMode !== 'single' && <span className="text-[10px] text-[var(--cy-danger-500)]">每个形象必须填昵称</span>}
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md px-3 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!canSave}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--cy-brand-500)] px-4 text-sm text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {initial ? '保存' : '创建'}
        </button>
      </div>
        </div>

        {/* 右:预览(拖拽调位置 / 四角缩放,与工作台一致) */}
        <div className="relative flex min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--cy-surface-2)] p-4">
          <CanvasStage width={canvas.w} height={canvas.h} roles={slots}
            onChange={(ref, pos) => setSlotField(ref, pos)} />
          {slots.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-[var(--cy-text-tertiary)]">
              {isMulti ? '点左侧形象格子加入角色(数字=出场顺序,需 ≥2 个)' : '点左侧形象选择一个'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
