/**
 * 画幅 chip — 3 按钮 9:16 / 16:9 / 1:1,写 vgComposer.params.video_aspect。
 * 在 VgComposerToolbar 里用,VgChatPage 顶栏显式露出。
 */
import * as React from 'react';
import { useVgComposer } from './store/vgComposer';

const ASPECTS = [
  { v: '9:16' as const, label: '竖' },
  { v: '16:9' as const, label: '横' },
  { v: '1:1'  as const, label: '方' },
];

export const VgAspectChip: React.FC = () => {
  const aspect = useVgComposer((s) => s.params.video_aspect);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-0.5 text-xs">
      {ASPECTS.map((a) => (
        <button
          key={a.v}
          type="button"
          onClick={() => patch({ video_aspect: a.v })}
          className={
            'rounded px-1.5 py-0.5 transition-colors ' +
            (aspect === a.v
              ? 'bg-[var(--cy-brand-500)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')
          }
          title={`画幅 ${a.v}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
};
