import * as React from 'react';
import { TRACK_H } from './TrackHeader';

/** 旁白波形轨:peaks 是 0~1 数组,按内容宽均匀铺竖条。 */
export const AudioWaveTrack: React.FC<{
  peaks: number[];
  contentWidthPx: number;
  loading?: boolean;
}> = ({ peaks, contentWidthPx, loading }) => (
  <div
    className="relative overflow-hidden border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
    style={{ height: TRACK_H, width: contentWidthPx }}
  >
    {loading && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">生成中…</span>}
    {!loading && peaks.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">旁白(渲染后生成)</span>}
    {!loading && peaks.length > 0 && (
      <div className="flex h-full items-center">
        {peaks.map((p, i) => {
          const w = contentWidthPx / peaks.length;
          return (
            <div key={i} style={{ width: w }} className="flex h-full items-center justify-center">
              <div style={{ height: `${Math.max(6, p * 90)}%`, width: Math.max(1, w - 0.5) }}
                className="rounded-sm bg-[var(--cy-brand-400)]" />
            </div>
          );
        })}
      </div>
    )}
  </div>
);
