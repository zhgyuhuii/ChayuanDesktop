/**
 * 画幅选择器(分组 Popover)。预览右上角 + 对话框画幅设置复用同一组件。
 *
 * 合同(见 server schemas.resolve_resolution):画幅真源是可选的 video_width/
 * video_height(都 >0 时精确像素优先);video_aspect 作为兜底 + 旧消费方(脚本/
 * 图像比例)用,选预设/自定义时同步成最接近的 16:9 / 9:16 / 1:1。
 */
import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { VgVideoAspect } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';

interface Preset { w: number; h: number; ratio: string; label: string }
const GROUPS: Array<{ title: string; items: Preset[] }> = [
  { title: '竖屏', items: [
    { w: 1080, h: 1920, ratio: '9:16', label: '短视频' },
    { w: 1080, h: 1350, ratio: '4:5', label: 'Ins 竖图' },
    { w: 768, h: 1024, ratio: '3:4', label: '竖版' },
  ] },
  { title: '横屏', items: [
    { w: 1920, h: 1080, ratio: '16:9', label: '高清宽屏' },
    { w: 1280, h: 800, ratio: '16:10', label: '宽屏本' },
    { w: 1024, h: 768, ratio: '4:3', label: '显示器' },
    { w: 800, h: 600, ratio: '4:3', label: '小屏' },
    { w: 2560, h: 1080, ratio: '21:9', label: '电影宽幅' },
  ] },
  { title: '方形', items: [
    { w: 1080, h: 1080, ratio: '1:1', label: '方形' },
  ] },
];

/** 任意宽高 → 最接近的后端枚举(竖/横/方),供 video_aspect 兜底。 */
export function nearestAspect(w: number, h: number): VgVideoAspect {
  const r = w / h;
  if (r > 1.15) return '16:9';
  if (r < 0.87) return '9:16';
  return '1:1';
}

/** 当前生效宽高:显式 width/height 优先,否则按 aspect 给 1080p 等价值。 */
export function effectiveSize(aspect: VgVideoAspect, w?: number | null, h?: number | null): { w: number; h: number } {
  if (w && h && w > 0 && h > 0) return { w, h };
  if (aspect === '16:9') return { w: 1920, h: 1080 };
  if (aspect === '1:1') return { w: 1080, h: 1080 };
  return { w: 1080, h: 1920 };
}

export const VgAspectPicker: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const aspect = useVgComposer((s) => s.params.video_aspect);
  const vw = useVgComposer((s) => s.params.video_width);
  const vh = useVgComposer((s) => s.params.video_height);
  const patch = useVgComposer((s) => s.patchParams);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [cw, setCw] = React.useState('');
  const [ch, setCh] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const t = setTimeout(() => { window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey); }, 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const eff = effectiveSize(aspect, vw, vh);
  const isCustomActive = (p: Preset) => !!(vw && vh) && vw === p.w && vh === p.h;
  const isAspectActive = (p: Preset) => !vw && !vh && aspect === p.ratio;
  const active = (p: Preset) => isCustomActive(p) || isAspectActive(p);
  const curLabel = vw && vh ? `${vw}×${vh}` : `${aspect}`;

  const pickPreset = (p: Preset) => {
    patch({ video_aspect: p.ratio as VgVideoAspect, video_width: p.w, video_height: p.h });
    setOpen(false);
  };
  const applyCustom = () => {
    const w = parseInt(cw, 10); const h = parseInt(ch, 10);
    if (!w || !h || w < 16 || h < 16) return;
    patch({ video_aspect: nearestAspect(w, h), video_width: w, video_height: h });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] ${compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'} text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]`}
        title="画幅 / 分辨率">
        <span className="inline-block rounded-[2px] border border-current opacity-70"
          style={{ width: Math.max(8, Math.round(12 * Math.min(1, eff.w / eff.h))), height: Math.max(8, Math.round(12 * Math.min(1, eff.h / eff.w))) }} />
        {curLabel}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-[220] mt-1 w-60 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 shadow-xl">
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-1.5">
              <div className="mb-1 px-1 text-[10px] font-medium text-[var(--cy-text-tertiary)]">{g.title}</div>
              <div className="grid grid-cols-2 gap-1">
                {g.items.map((p) => (
                  <button key={`${p.w}x${p.h}`} type="button" onClick={() => pickPreset(p)}
                    className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors ${active(p) ? 'bg-[var(--cy-brand-500)] text-white' : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
                    <span className={`inline-block shrink-0 rounded-[2px] border ${active(p) ? 'border-white bg-white/30' : 'border-current opacity-60'}`}
                      style={{ width: Math.max(7, Math.round(13 * Math.min(1, p.w / p.h))), height: Math.max(7, Math.round(13 * Math.min(1, p.h / p.w))) }} />
                    <span className="min-w-0">
                      <span className="block leading-tight">{p.ratio}</span>
                      <span className="block leading-tight opacity-70">{p.w}×{p.h}</span>
                    </span>
                    {active(p) && <Check className="ml-auto h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-1 border-t border-[var(--cy-border-subtle)] pt-1.5">
            <div className="mb-1 px-1 text-[10px] font-medium text-[var(--cy-text-tertiary)]">自定义</div>
            <div className="flex items-center gap-1 px-1">
              <input type="number" value={cw} onChange={(e) => setCw(e.target.value)} placeholder="宽" min={16} max={7680}
                className="w-14 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 py-0.5 text-[11px] focus:border-[var(--cy-brand-400)] focus:outline-none" />
              <span className="text-[var(--cy-text-tertiary)]">×</span>
              <input type="number" value={ch} onChange={(e) => setCh(e.target.value)} placeholder="高" min={16} max={7680}
                className="w-14 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 py-0.5 text-[11px] focus:border-[var(--cy-brand-400)] focus:outline-none" />
              <button type="button" onClick={applyCustom}
                className="ml-auto rounded bg-[var(--cy-brand-500)] px-2 py-0.5 text-[11px] text-white hover:bg-[var(--cy-brand-600)]">应用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
