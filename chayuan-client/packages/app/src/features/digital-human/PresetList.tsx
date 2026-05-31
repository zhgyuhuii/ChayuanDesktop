/**
 * PresetList — 数字人预设列表 + 编辑/删除/新建。
 *
 * 若 editing 不为 null,内联渲染 PresetEditor;否则显示预设卡片网格。
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Pencil, Trash2, Plus, Loader2, Radio, Sparkles } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { digitalHuman, type DigitalHumanPreset } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { confirmDialog } from '../../store/confirmDialog';
import { PresetEditor } from './PresetEditor';

interface PresetListProps {
  presets: DigitalHumanPreset[];
  onChanged: () => void;
  /** 点卡片「生成」→ 切到生成 tab 并预选该数字人 */
  onGenerate?: (presetId: string) => void;
}

export const PresetList: React.FC<PresetListProps> = ({ presets, onChanged, onGenerate }) => {
  const navigate = useNavigate();
  const [editing, setEditing] = React.useState<DigitalHumanPreset | 'new' | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const onDelete = async (p: DigitalHumanPreset) => {
    if (!(await confirmDialog(`删除数字人"${p.name}"?不可恢复。`, { danger: true }))) return;
    setDeletingId(p.id);
    try {
      await digitalHuman.deletePreset(p.id);
      onChanged();
    } catch (err) {
      reportError(err as Error, '删除数字人失败');
    } finally {
      setDeletingId(null);
    }
  };

  if (editing !== null) {
    return (
      <PresetEditor
        initial={editing === 'new' ? undefined : editing}
        onSaved={() => { setEditing(null); onChanged(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {presets.map((p) => (
        <div
          key={p.id}
          className={cn(
            'flex w-40 flex-col gap-2 rounded-xl border border-[var(--cy-border-subtle)]',
            'bg-[var(--cy-surface-1)] p-3 text-[var(--cy-text-primary)]',
          )}
        >
          {/* 缩略图:图像形象用 <img>,视频形象用 <video> 首帧 */}
          <div className="aspect-video w-full overflow-hidden rounded-md bg-[var(--cy-surface-2)]">
            {p.avatar_kind === 'image' ? (
              <img src={digitalHuman.avatarFileUrl(p.avatar_ref)} alt={p.name} draggable={false}
                className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <video src={digitalHuman.avatarFileUrl(p.avatar_ref)} muted preload="metadata" draggable={false}
                className="h-full w-full object-cover" />
            )}
          </div>
          <span className="truncate text-sm font-medium" title={p.name}>{p.name}</span>
          <span className="truncate text-[10px] text-[var(--cy-text-tertiary)]" title={p.voice_name || p.voice_provider}>
            {p.voice_name || p.voice_provider}
          </span>
          {/* 快捷入口:实时对话 / 生成 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void navigate({ to: '/digital-human/live' as never })}
              title="进入实时对话"
              className="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-md bg-[var(--cy-brand-500)] text-[10px] text-white hover:bg-[var(--cy-brand-600)]"
            >
              <Radio className="h-3 w-3" /> 实时对话
            </button>
            <button
              type="button"
              onClick={() => onGenerate?.(p.id)}
              title="去生成口播视频"
              className="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-md border border-[var(--cy-border-strong)] text-[10px] text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
            >
              <Sparkles className="h-3 w-3" /> 生成
            </button>
          </div>
          {/* 管理:编辑 / 删除 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(p)}
              title="编辑"
              className="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-md border border-[var(--cy-border-subtle)] text-[10px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
            >
              <Pencil className="h-3 w-3" /> 编辑
            </button>
            <button
              type="button"
              onClick={() => void onDelete(p)}
              disabled={deletingId === p.id}
              title="删除"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              {deletingId === p.id
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Trash2 className="h-3 w-3" />}
            </button>
          </div>
        </div>
      ))}

      {/* + 新建数字人 tile */}
      <button
        type="button"
        onClick={() => setEditing('new')}
        className={cn(
          'flex h-[12.5rem] w-40 flex-col items-center justify-center gap-1 rounded-xl',
          'border border-dashed border-[var(--cy-border-subtle)] text-[var(--cy-text-tertiary)]',
          'hover:border-[var(--cy-brand-400)] hover:text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)]',
          'transition-colors',
        )}
      >
        <Plus className="h-5 w-5" />
        <span className="text-xs">新建数字人</span>
      </button>
    </div>
  );
};
