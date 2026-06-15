import * as React from 'react';

/**
 * 通用「图标 → 点开竖向滑条」弹层。复用 VgAspectPicker 的开/点外关/Esc 范式,
 * 用于轨道头音量等空间紧张处(竖排省横向地方)。
 * 竖向 range:标准 writing-mode:vertical-lr + direction:rtl(min 在下、max 在上),
 * 叠 WebkitAppearance:slider-vertical 兜底旧 WebKit(桌面 WebKitGTK 重建后需验证)。
 */
export const VerticalSliderPopover: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  icon: React.ReactNode;
  title?: string;
  format?: (v: number) => string;
}> = ({ value, min, max, step, onChange, icon, title, format }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex"
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <button type="button" title={title} aria-label={title ?? '调整'} onClick={() => setOpen((v) => !v)}
        className="inline-flex p-1 text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">
        {icon}
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-[220] mb-1 flex -translate-x-1/2 flex-col items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 shadow-xl">
          <span className="text-[10px] tabular-nums text-[var(--cy-text-secondary)]">{format ? format(value) : String(value)}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-24 accent-[var(--cy-brand-500)] [direction:rtl] [writing-mode:vertical-lr]"
            style={{ WebkitAppearance: 'slider-vertical' } as React.CSSProperties}
          />
        </div>
      )}
    </span>
  );
};
