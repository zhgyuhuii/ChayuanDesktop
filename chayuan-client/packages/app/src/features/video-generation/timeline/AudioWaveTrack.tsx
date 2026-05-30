import * as React from 'react';
import { Mic } from 'lucide-react';
import { TRACK_H } from './TrackHeader';

/**
 * 旁白轨:生成的旁白当成一个「音频文件块」—— 宽度=旁白时长,块内居中对称波形
 * (心电图样:每个峰值竖条上下对称),左上角小角标显主题名。
 */
export const AudioWaveTrack: React.FC<{
  peaks: number[];
  contentWidthPx: number;
  loading?: boolean;
  label?: string;
  durationMs?: number;
  pxPerSec?: number;
}> = ({ peaks, contentWidthPx, loading, label, durationMs, pxPerSec }) => {
  const hasAudio = (durationMs ?? 0) > 0 || peaks.length > 0;
  const blockW = durationMs && pxPerSec
    ? Math.max(48, (durationMs / 1000) * pxPerSec)
    : contentWidthPx - 8;

  return (
    <div className="relative overflow-hidden border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {loading && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">生成中…</span>}
      {!loading && !hasAudio && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">旁白(生成后显示)</span>}
      {!loading && hasAudio && (
        <div className="absolute left-1 top-1.5 h-9 overflow-hidden rounded border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)]"
          style={{ width: blockW }} title={label || '旁白'}>
          {/* 居中对称波形(心电图样);无 peaks 时显一条基线 */}
          <div className="absolute inset-0 flex items-center gap-px px-0.5">
            {(peaks.length ? peaks : new Array(Math.max(1, Math.round(blockW / 3))).fill(0.04)).map((p, i, arr) => {
              const bw = blockW / arr.length;
              return (
                <div key={i} style={{ width: Math.max(1, bw - 1), height: `${Math.max(8, Math.min(96, p * 150))}%` }}
                  className="shrink-0 rounded-full bg-[var(--cy-brand-500)]/80" />
              );
            })}
          </div>
          {/* 名称小角标 */}
          <span className="absolute left-1 top-0.5 inline-flex max-w-[70%] items-center gap-0.5 rounded bg-[var(--cy-brand-600)] px-1 text-[9px] font-medium text-white">
            <Mic className="h-2.5 w-2.5 shrink-0" /> <span className="truncate">{label || '旁白'}</span>
          </span>
        </div>
      )}
    </div>
  );
};
