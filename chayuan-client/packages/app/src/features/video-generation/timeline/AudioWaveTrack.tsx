import * as React from 'react';
import { Mic } from 'lucide-react';
import { TRACK_H } from './TrackHeader';

/**
 * 旁白轨:把生成的旁白当成一个「音频文件块」显示 —— 名称=主题名,宽度=旁白时长,
 * 块内铺波形(peaks)。没有时长时退回整宽波形(兼容)。
 */
export const AudioWaveTrack: React.FC<{
  peaks: number[];
  contentWidthPx: number;
  loading?: boolean;
  /** 旁白显示名(主题名);为空显示「旁白」。 */
  label?: string;
  /** 旁白时长(ms);>0 时按它定块宽。 */
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
        <div className="absolute left-1 top-1.5 flex h-8 items-center gap-1 overflow-hidden rounded border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)] px-1.5"
          style={{ width: blockW }} title={label || '旁白'}>
          {/* 波形铺底 */}
          {peaks.length > 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center opacity-50">
              {peaks.map((p, i) => {
                const bw = blockW / peaks.length;
                return (
                  <div key={i} style={{ width: bw }} className="flex h-full items-center justify-center">
                    <div style={{ height: `${Math.max(6, p * 80)}%`, width: Math.max(1, bw - 0.5) }}
                      className="rounded-sm bg-[var(--cy-brand-400)]" />
                  </div>
                );
              })}
            </div>
          )}
          <Mic className="z-10 h-3 w-3 shrink-0 text-[var(--cy-brand-600)]" />
          <span className="z-10 truncate text-[10px] font-medium text-[var(--cy-brand-700)]">{label || '旁白'}</span>
        </div>
      )}
    </div>
  );
};
