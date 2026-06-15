import * as React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';

/**
 * 通用「图标 -> 点开竖向滑条」弹层。基于项目 Radix Popover 封装(自带 Portal),
 * 弹层渲染到 body,不会被轨道头列的 overflow-hidden 裁剪(此前用 absolute 被裁,
 * 表现为「音量滑条被遮挡」)。Radix 负责点外关 / Esc / 碰撞翻转。
 * 竖向 range:标准 writing-mode:vertical-lr + direction:rtl(min 在下、max 在上),
 * 叠 WebkitAppearance:slider-vertical 兜底旧 WebKit。
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title ?? '调整'}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="inline-flex p-1 text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]"
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        className="flex w-auto flex-col items-center gap-1 rounded-lg p-2"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] tabular-nums text-[var(--cy-text-secondary)]">
          {format ? format(value) : String(value)}
        </span>
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
      </PopoverContent>
    </Popover>
  );
};
