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
  const [replacing, setReplacing] = React.useState<string | null>(null);
  const [composeMode, setComposeMode] = React.useState<DhComposeMode>(initial?.compose_mode ?? 'single');
  const [layout, setLayout] = React.useState<DhLayout>(initial?.layout ?? 'side');
  const [slots, setSlots] = React.useState<AvatarSlot[]>(initial?.avatars ?? []);
  const avatarFileRef = React.useRef<HTMLInputElement | null>(null);
  const composeFileRef = React.useRef<HTMLInputElement | null>(null);

  const avatarsQ = useQuery({
    queryKey: ['dh.avatars'],
    queryFn: digitalHuman.listAvatars,
    staleTime: 2 * 60 * 1000,
  });
  const avatars = avatarsQ.data?.items ?? [];

  // 找到当前选中形象,用于提交时写 avatar_kind
  const selectedAvatar = avatars.find((a) => a.ref === avatarRef);

  const onUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      const a = await digitalHuman.uploadAvatar(f);
      if (replacing) {
        const old = avatars.find((x) => x.ref === replacing);
        if (old && old.source === 'user') {
          try { await digitalHuman.deleteAvatar(old.name); } catch { /* 删旧失败不阻断 */ }
        }
        setReplacing(null);
      }
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
      await qc.invalidateQueries({ queryKey: ['dh.avatars'] });
    } catch (err) {
      reportError(err as Error, '删除形象失败');
    } finally {
      setDeleting(null);
    }
  };

  const onReplaceClick = (a: DhAvatar) => { setReplacing(a.ref); avatarFileRef.current?.click(); };

  const isMulti = composeMode !== 'single';
  const inSlots = (ref: string) => slots.some((x) => x.ref === ref);
  const toggleSlot = (a: DhAvatar) =>
    setSlots((prev) => (prev.some((x) => x.ref === a.ref)
      ? prev.filter((x) => x.ref !== a.ref)
      : [...prev, { ref: a.ref, kind: a.kind, label: a.name, lines: '' }]));
  const setSlotLines = (ref: string, lines: string) =>
    setSlots((prev) => prev.map((x) => (x.ref === ref ? { ...x, lines } : x)));

  const onComposeReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    try {
      const a = await digitalHuman.composeReference(files);
      await qc.invalidateQueries({ queryKey: ['dh.avatars'] });
      if (isMulti) {
        setSlots((prev) => [...prev, { ref: a.ref, kind: a.kind, label: a.name, lines: '' }]);
      } else {
        setAvatarRef(a.ref);
      }
    } catch (err) {
      reportError(err as Error, '合成参考图失败');
    } finally {
      setUploading(false);
    }
  };

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
                  onClick={() => (isMulti ? toggleSlot(a) : setAvatarRef(a.ref))}
                  title={a.name}
                  className={cn(
                    'h-16 w-16 overflow-hidden rounded-lg border transition-colors',
                    (isMulti ? inSlots(a.ref) : avatarRef === a.ref)
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
                  <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-[9px] text-white">
                    {slots.findIndex((x) => x.ref === a.ref) + 1}
                  </span>
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
        {selectedAvatar?.source === 'user' && (
          <button
            type="button"
            onClick={() => selectedAvatar && onReplaceClick(selectedAvatar)}
            className="self-start text-[11px] text-[var(--cy-brand-600)] hover:underline"
          >
            替换当前形象
          </button>
        )}
        <button type="button" onClick={() => composeFileRef.current?.click()} disabled={uploading}
          className="self-start text-[11px] text-[var(--cy-brand-600)] hover:underline disabled:opacity-50">
          多照合一(多张照片挑最佳)
        </button>
        <input ref={composeFileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={onComposeReference} />
      </div>

      {/* 同框版式 */}
      {composeMode === 'coframe' && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">版式</label>
          <div className="flex gap-1.5 text-[11px]">
            {(([['side', '并排'], ['pip', '画中画'], ['main_minor', '主+角']]) as [DhLayout, string][]).map(([l, zh]) => (
              <button key={l} type="button" onClick={() => setLayout(l)}
                className={cn('rounded-md border px-2 py-1',
                  layout === l
                    ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                    : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
                {zh}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 各形象台词(多形象) */}
      {isMulti && slots.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[var(--cy-text-secondary)]">各形象台词(空=用统一文案)</label>
          {slots.map((sl, i) => (
            <div key={sl.ref} className="flex items-center gap-2">
              <span className="w-4 text-[11px] text-[var(--cy-text-tertiary)]">{i + 1}</span>
              <input type="text" value={sl.lines ?? ''}
                onChange={(e) => setSlotLines(sl.ref, e.target.value)}
                placeholder={sl.label || sl.ref}
                className="h-7 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-[11px] text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:outline-none" />
            </div>
          ))}
        </div>
      )}

      {/* 音色绑定 */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--cy-text-secondary)]">音色</label>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
          <VoicePicker value={voice} onChange={setVoice} />
        </div>
      </div>

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
