import * as React from 'react';
import { videoGeneration, type VgTimeline, type VgTimelineClip, type VgOverlay } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';
import { overlayPosAt } from './overlayEdit';
import type { SrtCue } from './srtParse';

/** 解析 clip 的可播放 URL(material_id → 素材文件;url → 直接用)。path/无 → null。 */
function clipUrl(c: VgTimelineClip): string | null {
  if (c.source.material_id) return videoGeneration.materialFileUrl(c.source.material_id);
  if (c.source.url) return c.source.url;
  return null;
}
const isImageUrl = (u: string) => /\.(jpg|jpeg|png|webp|bmp|gif)(\?|$)/i.test(u);
/** clip 是否图像:优先 kind(拖入时落库);否则靠 URL 扩展名(在线图片有扩展名)。
 *  material_id 文件 URL 无扩展名 → 老草稿无 kind 时返回 false,由 ClipMedia 的 onError 自愈兜底。 */
const clipIsImage = (c: VgTimelineClip, url: string) => (c.kind ? c.kind === 'image' : isImageUrl(url));
const TX_MS = 1000; // 转场时长(与 compose 的 1s 一致)

/** 片段入场转场 → 当前 playhead 的样式(opacity/transform)。none/超过转场窗口 → 空。 */
function transitionStyle(c: VgTimelineClip, playheadMs: number): React.CSSProperties {
  const tx = c.transition;
  if (!tx || tx === 'none') return {};
  const elapsed = playheadMs - c.track_start_ms;
  if (elapsed < 0 || elapsed >= TX_MS) return {};
  const p = Math.max(0, Math.min(1, elapsed / TX_MS)); // 0→1 入场进度
  if (tx === 'fade' || tx === 'shuffle') return { opacity: p };
  if (tx === 'slide_left') return { transform: `translateX(${(p - 1) * 100}%)` };
  if (tx === 'slide_right') return { transform: `translateX(${(1 - p) * 100}%)` };
  if (tx === 'slide_top') return { transform: `translateY(${(p - 1) * 100}%)` };
  if (tx === 'slide_bottom') return { transform: `translateY(${(1 - p) * 100}%)` };
  return {};
}

/** 取轨道上当前 playhead 命中的 clip。 */
function clipAt(clips: VgTimelineClip[] | undefined, playheadMs: number): VgTimelineClip | null {
  for (const c of clips ?? []) {
    const s = c.track_start_ms;
    if (playheadMs >= s && playheadMs < s + clipDurMs(c)) return c;
  }
  return null;
}

/** 视频元素:暂停时按 playhead seek 静帧;播放时真 play(),仅在漂移大时校正。
 *  原声:播放时按 clip.muted/volume 出声(暂停/拖动时静音,避免 seek 噪音);成片混音由后端 _build_extra_audios 负责。 */
const FrameVideo: React.FC<{ url: string; clip: VgTimelineClip; playheadMs: number; playing: boolean; className?: string; onMediaError?: () => void; onAspect?: (ar: number) => void }>
  = ({ url, clip, playheadMs, playing, className, onMediaError, onAspect }) => {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const v = ref.current; if (!v) return;
    // 播放时按 clip 设置出声;暂停/拖动时静音(逐帧 seek 不放原声)。volume 钳到 [0,1](轨道音量可到 1.5,HTMLMediaElement 上限 1)。
    v.muted = !playing || !!clip.muted;
    v.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
    const t = Math.max(0, (playheadMs - clip.track_start_ms) / 1000 + (clip.in_ms ?? 0) / 1000);
    if (playing) {
      if (v.paused) { try { if (t >= 0) v.currentTime = t; } catch { /* noop */ } void v.play().catch(() => undefined); }
      else if (Math.abs(v.currentTime - t) > 0.4) { try { v.currentTime = t; } catch { /* noop */ } }
    } else {
      if (!v.paused) v.pause();
      const apply = () => { if (Math.abs(v.currentTime - t) > 0.05) { try { v.currentTime = t; } catch { /* noop */ } } };
      if (v.readyState >= 1) apply(); else v.addEventListener('loadedmetadata', apply, { once: true });
    }
  }, [url, playheadMs, playing, clip.track_start_ms, clip.in_ms, clip.muted, clip.volume]);
  return <video ref={ref} src={url} preload="metadata" playsInline className={className} onError={() => onMediaError?.()}
    onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) onAspect?.(v.videoWidth / v.videoHeight); }} />;
};

/** 图/视频自适应:按 isImage 初始渲染;加载出错(老草稿无 kind、类型判错)自愈切换。 */
const ClipMedia: React.FC<{ url: string; clip: VgTimelineClip; playheadMs: number; playing: boolean; className?: string; isImage: boolean; onAspect?: (ar: number) => void }>
  = ({ url, clip, playheadMs, playing, className, isImage, onAspect }) => {
  const [mode, setMode] = React.useState<'image' | 'video'>(isImage ? 'image' : 'video');
  React.useEffect(() => { setMode(isImage ? 'image' : 'video'); }, [isImage, url]);
  if (mode === 'image') {
    return <img src={url} alt="" draggable={false} className={className} onError={() => setMode('video')}
      onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) onAspect?.(im.naturalWidth / im.naturalHeight); }} />;
  }
  return <FrameVideo url={url} clip={clip} playheadMs={playheadMs} playing={playing} className={className} onMediaError={() => setMode('image')} onAspect={onAspect} />;
};

/**
 * 实时预览画布 = PhotoShop 式分层:每条视频轨都是一个独立图层,按自己的 x/y/scale
 * 定位(无 transform 默认满画幅),层级 = 轨道列表顺序(越靠上 = 越上层,遮盖下层),
 * 其余透明。黑色仅作底(没有任何画面处显黑)。每个图层悬停显边框+四角控制点,可拖移/缩放。
 */
/** 叠加元素入场/出场淡入淡出 → 当前 playhead 的不透明度系数(0-1)。 */
function overlayAnimFactor(ov: VgOverlay, playheadMs: number): number {
  const ad = (ov.anim_dur ?? 0.5) * 1000;
  if (ad <= 0) return 1;
  const el = playheadMs - ov.track_start_ms;
  const rem = ov.track_start_ms + ov.duration_ms - playheadMs;
  let f = 1;
  if (ov.anim_in === 'fade' && el < ad) f = Math.max(0, Math.min(1, el / ad));
  if (ov.anim_out === 'fade' && rem < ad) f = Math.min(f, Math.max(0, Math.min(1, rem / ad)));
  return f;
}

export const LivePreviewCanvas: React.FC<{
  timeline: VgTimeline;
  playheadMs: number;
  playing?: boolean;
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number; rotation?: number; flip_h?: boolean; flip_v?: boolean; opacity?: number }) => void;
  cropEditingClipId?: string | null;
  onCrop?: (clipId: string, crop: { x: number; y: number; w: number; h: number }) => void;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string | null) => void;
  backgroundColor?: string;
  overlays?: VgOverlay[];
  selectedOverlayIds?: string[];
  onSelectOverlay?: (id: string | null, additive?: boolean) => void;
  onOverlayTransform?: (id: string, tf: Partial<VgOverlay>) => void;
  cues?: SrtCue[];
}> = ({ timeline, playheadMs, playing = false, onTransform, cropEditingClipId = null, onCrop, selectedClipId = null, onSelectClip, backgroundColor = '#000000', overlays, selectedOverlayIds = [], onSelectOverlay, onOverlayTransform, cues }) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  // 媒体自然宽高比(w/h)按 clipId 缓存:full(满画幅)态据此把图层框收到「视频实际显示区」,
  // 否则外框=整画布=全屏、与视频比例不符(就是「拖一下才契合」的根因)。
  const [mediaAR, setMediaAR] = React.useState<Record<string, number>>({});
  const reportAR = React.useCallback((id: string, ar: number) => {
    if (!ar || !isFinite(ar) || ar <= 0) return;
    setMediaAR((m) => (Math.abs((m[id] ?? 0) - ar) < 1e-3 ? m : { ...m, [id]: ar }));
  }, []);
  // 画布自身宽高比(把视频 contain 进画布算实际显示区要用),随容器尺寸变化更新。
  const [canvasAR, setCanvasAR] = React.useState(16 / 9);
  React.useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setCanvasAR(r.width / r.height); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 叠加文字编辑态:**双击**才进编辑(contentEditable),单击只选中/可拖。
  const [editingOvId, setEditingOvId] = React.useState<string | null>(null);
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const cue = (cues ?? []).find((c) => playheadMs >= c.startMs && playheadMs < c.endMs);
  const anyVisible = videoTracks.some((tr) => clipAt(tr.clips, playheadMs));

  type Corner = 'nw' | 'ne' | 'sw' | 'se';
  const drag = (e: React.PointerEvent, clipId: string, mode: 'move' | Corner, cur: { x: number; y: number; scale: number }) => {
    e.preventDefault(); e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect(); if (!box) return;
    const sx = e.clientX; const sy = e.clientY;
    const isLeft = mode === 'nw' || mode === 'sw';
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width; const dy = (ev.clientY - sy) / box.height;
      if (mode === 'move') { onTransform(clipId, { x: cur.x + dx, y: cur.y + dy }); return; }
      if (isLeft) onTransform(clipId, { scale: cur.scale - dx, x: cur.x + dx });
      else onTransform(clipId, { scale: cur.scale + dx });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const CORNERS: { c: Corner; cls: string }[] = [
    { c: 'nw', cls: '-top-1.5 -left-1.5 cursor-nwse-resize' },
    { c: 'ne', cls: '-top-1.5 -right-1.5 cursor-nesw-resize' },
    { c: 'sw', cls: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
    { c: 'se', cls: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
  ];
  // 裁剪框拖拽:归一到该图层显示框(= 源帧,与后端 cropped 同基准);clamp 走父级 patchClip。
  const dragCrop = (e: React.PointerEvent, clipId: string, mode: 'move' | Corner, cur: { x: number; y: number; w: number; h: number }) => {
    e.preventDefault(); e.stopPropagation();
    const layerEl = (e.currentTarget as HTMLElement).closest('[data-cy-layer]') as HTMLElement | null;
    const rect = layerEl?.getBoundingClientRect(); if (!rect || !onCrop) return;
    const sx = e.clientX; const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width; const dy = (ev.clientY - sy) / rect.height;
      if (mode === 'move') { onCrop(clipId, { x: cur.x + dx, y: cur.y + dy, w: cur.w, h: cur.h }); return; }
      let { x, y, w, h } = cur;
      if (mode === 'se') { w = cur.w + dx; h = cur.h + dy; }
      else if (mode === 'nw') { x = cur.x + dx; y = cur.y + dy; w = cur.w - dx; h = cur.h - dy; }
      else if (mode === 'ne') { y = cur.y + dy; w = cur.w + dx; h = cur.h - dy; }
      else { x = cur.x + dx; w = cur.w - dx; h = cur.h + dy; }  // sw
      onCrop(clipId, { x, y, w, h });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // 旋转手柄:按指针相对层中心的角度算 rotation(顶部为 0°),Shift 吸附 15°。
  const dragRotate = (e: React.PointerEvent, clipId: string) => {
    e.preventDefault(); e.stopPropagation();
    const layerEl = (e.currentTarget as HTMLElement).closest('[data-cy-layer]') as HTMLElement | null;
    const r = layerEl?.getBoundingClientRect(); if (!r) return;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const move = (ev: PointerEvent) => {
      let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      onTransform(clipId, { rotation: Math.max(-180, Math.min(180, Math.round(deg))) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // 叠加元素拖拽(归一到画布框);move 改 x/y,四角改 w/h,旋转改 rotation。
  const dragOv = (e: React.PointerEvent, id: string, mode: 'move' | Corner, cur: { x: number; y: number; w: number; h: number }) => {
    e.preventDefault(); e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect(); if (!box || !onOverlayTransform) return;
    const sx = e.clientX; const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width; const dy = (ev.clientY - sy) / box.height;
      if (mode === 'move') { onOverlayTransform(id, { x: cur.x + dx, y: cur.y + dy }); return; }
      let { x, y, w, h } = cur;
      if (mode === 'se') { w = cur.w + dx; h = cur.h + dy; }
      else if (mode === 'nw') { x = cur.x + dx; y = cur.y + dy; w = cur.w - dx; h = cur.h - dy; }
      else if (mode === 'ne') { y = cur.y + dy; w = cur.w + dx; h = cur.h - dy; }
      else { x = cur.x + dx; w = cur.w - dx; h = cur.h + dy; }
      onOverlayTransform(id, { x, y, w, h });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const dragOvRotate = (e: React.PointerEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('[data-cy-overlay]') as HTMLElement | null;
    const r = el?.getBoundingClientRect(); if (!r || !onOverlayTransform) return;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const move = (ev: PointerEvent) => {
      let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      onOverlayTransform(id, { rotation: Math.max(-180, Math.min(180, Math.round(deg))) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const activeOverlays = (overlays || []).filter((ov) => playheadMs >= ov.track_start_ms && playheadMs < ov.track_start_ms + ov.duration_ms);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden" style={{ background: backgroundColor }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelectClip?.(null); }}>
      {!anyVisible && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">拖素材到视频轨即可预览</div>
      )}
      {/* 每条视频轨 = 一个图层;列表越靠上 zIndex 越高(在前,遮盖靠下) */}
      {videoTracks.map((tr, i) => {
        const c = clipAt(tr.clips, playheadMs);
        if (!c) return null;
        const url = clipUrl(c); if (!url) return null;
        const x = c.x ?? 0; const y = c.y ?? 0; const scale = c.scale ?? 1; // 无 transform = 满画幅
        const full = x === 0 && y === 0 && scale >= 0.999;
        const editing = cropEditingClipId === c.id;       // 裁剪编辑态:显示完整源 + 裁剪框
        const sel = selectedClipId === c.id;
        const cr = c.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        // full(满画幅)态:把图层框收到「视频按 contain 进画布后的居中显示区」,使选择外框/手柄
        // 一加进来就贴合视频比例(不再默认全屏、不用拖一下)。比例未知(媒体未加载)先满画幅兜底。
        const ar = mediaAR[c.id];
        let posStyle: React.CSSProperties;
        if (full && ar && ar > 0) {
          if (ar >= canvasAR) { const fh = canvasAR / ar; posStyle = { left: 0, top: `${(1 - fh) * 50}%`, width: '100%', height: `${fh * 100}%` }; }
          else { const fw = ar / canvasAR; posStyle = { top: 0, left: `${(1 - fw) * 50}%`, height: '100%', width: `${fw * 100}%` }; }
        } else if (full) {
          posStyle = { inset: 0 };
        } else {
          posStyle = { left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%` };
        }
        posStyle.zIndex = 10 + (videoTracks.length - i);
        return (
          <div key={c.id} data-cy-layer className={'group absolute ' + (editing ? '' : 'cursor-move')}
            style={{
              ...posStyle,
              opacity: c.opacity ?? 1, // 预览反映片段不透明度(主轨 clip 不会被设 opacity → 1)
              filter: c.color ? `brightness(${c.color.brightness ?? 1}) contrast(${c.color.contrast ?? 1}) saturate(${c.color.saturation ?? 1})` : undefined, // 调色预览(CSS 近似成片 numpy)
              // 几何(P2):非裁剪态套 rotate/flip + crop 的 clip-path;裁剪态显示完整源便于拖框
              ...(editing ? {} : {
                transform: `rotate(${c.rotation ?? 0}deg) scaleX(${c.flip_h ? -1 : 1}) scaleY(${c.flip_v ? -1 : 1})`,
                clipPath: c.crop
                  ? `inset(${c.crop.y * 100}% ${(1 - (c.crop.x + c.crop.w)) * 100}% ${(1 - (c.crop.y + c.crop.h)) * 100}% ${c.crop.x * 100}%)`
                  : undefined,
              }),
              ...transitionStyle(c, playheadMs), // #26 实时模拟入场转场(fade/slide)
            }}
            onPointerDown={editing ? undefined : (e) => { onSelectClip?.(c.id); drag(e, c.id, 'move', { x, y, scale }); }}>
            <ClipMedia url={url} clip={c} playheadMs={playheadMs} playing={playing} isImage={clipIsImage(c, url)}
              onAspect={(a) => reportAR(c.id, a)}
              className={full ? 'pointer-events-none h-full w-full object-contain' : 'pointer-events-none w-full'} />
            {!editing && (
              <>
                {/* 选中或悬停显边框 + 四角缩放点 */}
                <span className={'pointer-events-none absolute inset-0 border-2 ' + (sel ? 'border-[var(--cy-brand-500)]' : 'border-transparent group-hover:border-[var(--cy-brand-500)]')} />
                {CORNERS.map(({ c: corner, cls }) => (
                  <span key={corner} onPointerDown={(e) => drag(e, c.id, corner, { x, y, scale })}
                    className={`absolute h-3 w-3 rounded-full border border-white bg-[var(--cy-brand-600)] ${sel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${cls}`} />
                ))}
                {sel && (
                  /* 旋转手柄(层内顶部,直接操作不挡控制条;翻转/裁剪/透明度移到预览头部工具条) */
                  <span onPointerDown={(e) => dragRotate(e, c.id)} title="旋转(Shift 吸附 15°)"
                    className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-white bg-[var(--cy-brand-600)] shadow" style={{ top: 6 }} />
                )}
              </>
            )}
            {editing && (
              // 裁剪框:box-shadow 大扩散 = 框外变暗(被画布 overflow-hidden 裁到画布边);可拖移 + 四角缩放
              <div className="absolute cursor-move border-2 border-[var(--cy-brand-500)]"
                style={{ left: `${cr.x * 100}%`, top: `${cr.y * 100}%`, width: `${cr.w * 100}%`, height: `${cr.h * 100}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
                onPointerDown={(e) => dragCrop(e, c.id, 'move', cr)}>
                {CORNERS.map(({ c: corner, cls }) => (
                  <span key={corner} onPointerDown={(e) => dragCrop(e, c.id, corner, cr)}
                    className={`absolute h-3 w-3 rounded-full border border-white bg-[var(--cy-brand-600)] ${cls}`} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {/* 叠加元素(A 期文字):命中时间段才渲染;选中显几何手柄;双击文字改字 */}
      {activeOverlays.map((ov) => {
        const sel = selectedOverlayIds.includes(ov.id);
        const editing = editingOvId === ov.id && sel;
        const opos = (ov.keyframes && ov.keyframes.length >= 2) ? overlayPosAt(ov, playheadMs) : { x: ov.x, y: ov.y, w: ov.w, h: ov.h };
        return (
          <div key={ov.id} data-cy-overlay className={'absolute ' + (sel ? '' : 'cursor-move')}
            style={{
              left: `${opos.x * 100}%`, top: `${opos.y * 100}%`, width: `${opos.w * 100}%`, height: `${opos.h * 100}%`,
              transform: `rotate(${ov.rotation ?? 0}deg)`, opacity: (ov.opacity ?? 1) * overlayAnimFactor(ov, playheadMs), zIndex: 150 + (ov.z ?? 0),
            }}
            onPointerDown={(e) => { if (!sel) onSelectOverlay?.(ov.id, e.ctrlKey || e.metaKey); dragOv(e, ov.id, 'move', { x: ov.x, y: ov.y, w: ov.w, h: ov.h }); }}
            onClick={(e) => { if (e.ctrlKey || e.metaKey) onSelectOverlay?.(ov.id, true); }}>
            {ov.type === 'text' && (
              <div
                contentEditable={editing}
                suppressContentEditableWarning
                onDoubleClick={(e) => { const el = e.currentTarget as HTMLElement; setEditingOvId(ov.id); requestAnimationFrame(() => el.focus()); }}
                onBlur={(e) => { setEditingOvId((cur) => (cur === ov.id ? null : cur)); onOverlayTransform?.(ov.id, { text: (e.currentTarget.textContent || '').trim() }); }}
                onPointerDown={(e) => { if (editing) e.stopPropagation(); }}
                className={'flex h-full w-full items-center outline-none ' + (editing ? 'cursor-text' : '')}
                style={{
                  color: ov.text_color || '#fff', fontSize: `${(ov.font_size ?? 48) / 10}cqw`,
                  fontFamily: ov.font_name || undefined,
                  textAlign: (ov.align as 'left' | 'center' | 'right') || 'center',
                  justifyContent: ov.align === 'left' ? 'flex-start' : ov.align === 'right' ? 'flex-end' : 'center',
                  WebkitTextStroke: (ov.stroke_width ?? 0) > 0 ? `${ov.stroke_width}px ${ov.stroke_color || '#000'}` : undefined,
                  background: ov.bg || undefined,
                  textShadow: '0 1px 2px rgba(0,0,0,.6)', containerType: 'inline-size',
                } as React.CSSProperties}
              >
                {ov.text}
              </div>
            )}
            {(ov.type === 'rect' || ov.type === 'ellipse') && (
              <div className="pointer-events-none h-full w-full" style={{
                background: ov.fill || 'transparent',
                border: (ov.stroke_width ?? 0) > 0 ? `${ov.stroke_width}px solid ${ov.stroke_color || '#fff'}` : 'none',
                borderRadius: ov.type === 'ellipse' ? '50%' : (ov.corner_radius || 0),
              }} />
            )}
            {ov.type === 'image' && ov.src && (
              <img src={videoGeneration.overlayImageFileUrl(ov.src)} alt="" draggable={false}
                className="pointer-events-none h-full w-full object-contain" />
            )}
            {ov.type === 'mosaic' && (
              <div className="pointer-events-none h-full w-full border border-white/40"
                style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', background: 'rgba(255,255,255,0.04)' } as React.CSSProperties} />
            )}
            {(ov.type === 'line' || ov.type === 'arrow') && (
              <svg className="pointer-events-none h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <line x1={2} y1={50} x2={ov.type === 'arrow' ? 88 : 98} y2={50}
                  stroke={ov.stroke_color || '#fff'} strokeWidth={ov.stroke_width || 3} vectorEffect="non-scaling-stroke" />
                {ov.type === 'arrow' && (
                  <polygon points="98,50 86,42 86,58" fill={ov.stroke_color || '#fff'} />
                )}
              </svg>
            )}
            {sel && (
              <span className="pointer-events-none absolute inset-0 border-2 border-[var(--cy-brand-500)]" />
            )}
            {sel && selectedOverlayIds.length === 1 && (
              <>
                {CORNERS.map(({ c: corner, cls }) => (
                  <span key={corner} onPointerDown={(e) => dragOv(e, ov.id, corner, { x: ov.x, y: ov.y, w: ov.w, h: ov.h })}
                    className={`absolute h-3 w-3 rounded-full border border-white bg-[var(--cy-brand-600)] ${cls}`} />
                ))}
                <span onPointerDown={(e) => dragOvRotate(e, ov.id)} title="旋转"
                  className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-white bg-[var(--cy-brand-600)] shadow" style={{ top: 4 }} />
              </>
            )}
          </div>
        );
      })}

      {/* 字幕叠层:当前 playhead 命中的 cue,底部居中(与画面/音频同 playhead → 可核对对齐) */}
      {cue && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[6%] z-[200] flex justify-center px-[6%]">
          <span className="max-w-full whitespace-pre-wrap rounded bg-black/55 px-2 py-0.5 text-center text-[clamp(11px,3.2vw,18px)] leading-snug text-white"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,.9)' }}>
            {cue.text}
          </span>
        </div>
      )}
    </div>
  );
};
