import * as React from 'react';
import { Upload, Library, Play, Trash2 } from 'lucide-react';

export interface TrackMenuCtx {
  x: number;
  y: number;
  track: 'video' | 'audio' | 'subtitle';
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
    // 只在左键点击 / Esc 关闭。不监听 contextmenu —— 否则"再次右键"会与新菜单打开抢
    // 同一事件(先 set 新 ctx 又被关闭监听 set null),导致第 2 次起右键菜单出不来。
    // 延迟一帧注册,避免捕获到打开本菜单的这次 click/contextmenu。
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const id = window.setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]';
  return (
    <div
      className="fixed z-[300] min-w-[140px] overflow-hidden rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] py-1 shadow-xl"
      style={{ left: ctx.x, top: ctx.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {ctx.track !== 'subtitle' && (
        <>
          <button type="button" className={item} onClick={() => { onUploadLocal(); onClose(); }}>
            <Upload className="h-3.5 w-3.5" /> 从本地上传
          </button>
          <button type="button" className={item} onClick={() => { onAddFromLibrary(); onClose(); }}>
            <Library className="h-3.5 w-3.5" /> 从素材库添加
          </button>
          <button type="button" className={item} onClick={() => { onPreview(); onClose(); }}>
            <Play className="h-3.5 w-3.5" /> 试听本轨
          </button>
        </>
      )}
      {ctx.clipId && (
        <button type="button" className={`${item} text-rose-600 hover:bg-rose-50`} onClick={() => { onDeleteClip(ctx.clipId!); onClose(); }}>
          <Trash2 className="h-3.5 w-3.5" /> {ctx.track === 'subtitle' ? '删除此字幕' : '删除此片段'}
        </button>
      )}
    </div>
  );
};
