import * as React from 'react';
import { Upload, Library, Play, Trash2 } from 'lucide-react';

export interface TrackMenuCtx {
  x: number;
  y: number;
  track: 'video' | 'audio';
  clipId?: string;
}

/** 轨道右键菜单:从本地上传 / 从素材库添加 / 试听 / 删除(仅 clip 上)。 */
export const TrackContextMenu: React.FC<{
  ctx: TrackMenuCtx;
  onUploadLocal: () => void;
  onAddFromLibrary: () => void;
  onPreview: () => void;
  onDeleteClip: (clipId: string) => void;
  onClose: () => void;
}> = ({ ctx, onUploadLocal, onAddFromLibrary, onPreview, onDeleteClip, onClose }) => {
  React.useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [onClose]);

  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]';
  return (
    <div
      className="fixed z-[300] min-w-[140px] overflow-hidden rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] py-1 shadow-xl"
      style={{ left: ctx.x, top: ctx.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className={item} onClick={() => { onUploadLocal(); onClose(); }}>
        <Upload className="h-3.5 w-3.5" /> 从本地上传
      </button>
      <button type="button" className={item} onClick={() => { onAddFromLibrary(); onClose(); }}>
        <Library className="h-3.5 w-3.5" /> 从素材库添加
      </button>
      <button type="button" className={item} onClick={() => { onPreview(); onClose(); }}>
        <Play className="h-3.5 w-3.5" /> 试听本轨
      </button>
      {ctx.clipId && (
        <button type="button" className={`${item} text-rose-600 hover:bg-rose-50`} onClick={() => { onDeleteClip(ctx.clipId!); onClose(); }}>
          <Trash2 className="h-3.5 w-3.5" /> 删除此片段
        </button>
      )}
    </div>
  );
};
