/**
 * PresetEditor — 新建 / 编辑一个数字人预设。
 *
 * 包含:名字 input、形象选择器(grid + 上传 tile)、音色绑定(VoicePicker)、保存/取消。
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { digitalHuman, type DigitalHumanPreset, type DhVoiceProvider, type DhAvatar,
  type AvatarSlot, type DhComposeMode, type DhLayout } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { VoicePicker, type VoicePickerValue } from '../video-generation/VoicePicker';
import { confirmDialog } from '../../store/confirmDialog';
import { CanvasStage } from './CanvasStage';
import { GROUPS as ASPECT_GROUPS } from '../video-generation/VgAspectPicker';
import { videoGeneration, type VgFontItem } from '@chayuan/api';

interface PresetEditorProps {
  initial?: DigitalHumanPreset;
  onSaved: () => void;
  onCancel: () => void;
}

export const PresetEditor: React.FC<PresetEditorProps> = ({ initial, onSaved, onCancel }) => {
  const qc = useQueryClient();

  const [name, setName] = React.useState(initial?.name ?? '');
  const [avatarRef, setAvatarRef] = React.useState(initial?.avatar_ref ?? '');
  const [voice, setVoice] = React.useState<VoicePickerValue>({
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
  const avatarFileRef = React.useRef<HTMLInputElement | null>(null);

  const avatarsQ = useQuery({
    queryKey: ['dh.avatars'],
    queryFn: digitalHuman.listAvatars,
    staleTime: 2 * 60 * 1000,
  });
  const avatars = avatarsQ.data?.items ?? [];

  const fontsQ = useQuery({ queryKey: ['vg.fonts'], queryFn: () => videoGeneration.listFonts() });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];

  // 找到当前选中形象,用于提交时写 avatar_kind
  const selectedAvatar = avatars.find((a) => a.ref === avatarRef);

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
  const addIfAbsentAndFocus = (a: DhAvatar) => {
    setSlots((prev) => (prev.some((x) => x.ref === a.ref)
      ? prev
      : [...prev, { ref: a.ref, kind: a.kind, label: a.name, lines: '' }]));
    setFocusedRef(a.ref);
  };
  // 移出阵容(不删除形象资产),点序号徽标触发。
  const removeFromCast = (ref: string) => {
    setSlots((prev) => prev.filter((x) => x.ref !== ref));
    setFocusedRef((cur) => (cur === ref ? '' : cur));
  };

  // 默认聚焦:多形象 -> 第一个 slot;单形象 -> 当前 avatarRef。
  React.useEffect(() => {
    if (isMulti) {
      if (!slots.some((s2) => s2.ref === focusedRef)) {
        setFocusedRef(slots[0]?.ref ?? '');
      }
    } else if (focusedRef !== avatarRef) {
      setFocusedRef(avatarRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMulti, slots, avatarRef]);

  const canSave = name.trim().length > 0 && !saving && (
    composeMode === 'single' ? avatarRef.length > 0 : slots.length >= 2
  );

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const body: Partial<DigitalHumanPreset> = composeMode === 'single'
        ? {
            name: name.trim(),
            avatar_ref: avatarRef,
            avatar_kind: selectedAvatar?.kind ?? 'image',
            compose_mode: 'single',
            avatars: [],
            video_width: canvas.w,
            video_height: canvas.h,
            subtitle: sub,
            voice_provider: voice.voice_provider as DigitalHumanPreset['voice_provider'],
            voice_name: voice.voice_name,
          }
        : {
            name: name.trim(),
            avatar_ref: slots[0]?.ref ?? '',
            avatar_kind: slots[0]?.kind ?? 'image',
            compose_mode: composeMode,
            layout,
            avatars: slots,
            video_width: canvas.w,
            video_height: canvas.h,
            subtitle: sub,
            voice_provider: voice.voice_provider as DigitalHumanPreset['voice_provider'],
            voice_name: voice.voice_name,
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
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4">
      <h3 className="text-sm font-medium text-[var(--cy-text-primary)]">
        {initial ? '编辑数字人' : '新建数字人'}
      </h3>

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
                  onClick={() => (isMulti ? addIfAbsentAndFocus(a) : setAvatarRef(a.ref))}
                  title={a.name}
                  className={cn(
                    'h-16 w-16 overflow-hidden rounded-lg border transition-colors',
                    (isMulti ? focusedRef === a.ref : avatarRef === a.ref)
                      ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-400)]'
                      : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-300)]',
                    isMulti && focusedRef === a.ref && 'ring-[var(--cy-brand-600)] ring-offset-1',
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

      {/* 单形象:可视化预览(单形象占满画面,位置无意义,只读预览) */}
      {!isMulti && avatarRef && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">预览</label>
          <div
            className="mx-auto h-48 overflow-hidden rounded-lg bg-black"
            style={{ aspectRatio: `${canvas.w} / ${canvas.h}` }}
          >
            {(selectedAvatar?.kind ?? 'image') === 'video'
              ? <video src={digitalHuman.avatarFileUrl(avatarRef)} muted loop autoPlay playsInline className="h-full w-full object-cover" />
              : <img src={digitalHuman.avatarFileUrl(avatarRef)} alt={name} className="h-full w-full object-cover" />}
          </div>
        </div>
      )}

      {/* 多形象:位置可视化(始终显示;无角色时给空态提示,避免一片空白) */}
      {isMulti && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">位置(拖拽角色到画面对应处)</label>
          <div className="relative h-48">
            <CanvasStage width={canvas.w} height={canvas.h} roles={slots}
              onChange={(ref, pos) => setSlotField(ref, pos)} />
            {slots.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-[var(--cy-text-tertiary)]">
                点上方形象格子加入角色(数字=出场顺序,需 ≥2 个)
              </div>
            )}
          </div>
        </div>
      )}

      {/* 聚焦角色 配置(多形象 master-detail:仅显示当前聚焦角色) */}
      {isMulti && slots.length > 0 && (() => {
        const fSlot = slots.find((s2) => s2.ref === focusedRef) ?? slots[0];
        const fIdx = slots.findIndex((x) => x.ref === fSlot.ref) + 1;
        return (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 rounded-md border border-[var(--cy-border-subtle)] p-2">
              <div className="flex items-center gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-[9px] text-white">{fIdx}</span>
                <input type="text" value={fSlot.name ?? ''}
                  onChange={(e) => setSlotField(fSlot.ref, { name: e.target.value })}
                  placeholder="昵称(如 小李)"
                  className="h-7 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-[11px] text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:outline-none" />
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
            </div>
          </div>
        );
      })()}

      {/* 音色绑定(仅单形象;多形象的音色在上方聚焦角色配置里) */}
      {!isMulti && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">音色</label>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
            <VoicePicker value={voice} onChange={setVoice} />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2">
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
  );
};
