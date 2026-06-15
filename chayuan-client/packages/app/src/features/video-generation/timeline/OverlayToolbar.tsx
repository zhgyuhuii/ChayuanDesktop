import * as React from 'react';
import { MousePointer2, Type, Square, Circle, Minus, MoveUpRight, Smile, Grid2x2 } from 'lucide-react';
import type { VgOverlay } from '@chayuan/api';

/** 预览最左竖向工具条:点元素类型在 playhead 处新建叠加元素。A 期只「文字」可用,其余占位灰显。 */
export const OverlayToolbar: React.FC<{
  onAdd: (type: VgOverlay['type']) => void;
}> = ({ onAdd }) => {
  const items: { type: VgOverlay['type'] | 'select'; icon: React.ReactNode; label: string; enabled: boolean }[] = [
    { type: 'select', icon: <MousePointer2 className="h-4 w-4" />, label: '选择/移动', enabled: true },
    { type: 'text', icon: <Type className="h-4 w-4" />, label: '文字', enabled: true },
    { type: 'rect', icon: <Square className="h-4 w-4" />, label: '矩形(即将上线)', enabled: false },
    { type: 'ellipse', icon: <Circle className="h-4 w-4" />, label: '椭圆(即将上线)', enabled: false },
    { type: 'line', icon: <Minus className="h-4 w-4" />, label: '直线(即将上线)', enabled: false },
    { type: 'arrow', icon: <MoveUpRight className="h-4 w-4" />, label: '箭头(即将上线)', enabled: false },
    { type: 'image', icon: <Smile className="h-4 w-4" />, label: '贴纸/图片(即将上线)', enabled: false },
    { type: 'mosaic', icon: <Grid2x2 className="h-4 w-4" />, label: '马赛克(即将上线)', enabled: false },
  ];
  return (
    <div className="absolute left-0 top-0 z-[30] flex w-9 flex-col items-center gap-0.5 rounded-r-md bg-black/40 py-1 backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button key={it.type} type="button" title={it.label} aria-label={it.label}
          disabled={!it.enabled}
          onClick={() => { if (it.enabled && it.type !== 'select') onAdd(it.type as VgOverlay['type']); }}
          className={'inline-flex h-7 w-7 items-center justify-center rounded text-white/90 transition-colors ' +
            (it.enabled ? 'hover:bg-white/20' : 'cursor-not-allowed opacity-35')}>
          {it.icon}
        </button>
      ))}
    </div>
  );
};
