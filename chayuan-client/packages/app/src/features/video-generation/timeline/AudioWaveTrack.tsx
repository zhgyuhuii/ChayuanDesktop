import * as React from 'react';
import { Mic } from 'lucide-react';
import { TRACK_H } from './TrackHeader';

/** 由 peaks(0~1)生成填充式对称波形 SVG path(viewBox: N×100,中线 50,上下各 ±48)。 */
function waveformPath(peaks: number[]): string {
  const n = peaks.length;
  const top = peaks.map((p, i) => `L ${i} ${(50 - Math.min(1, p) * 48).toFixed(1)}`);
  const bot: string[] = [];
  for (let i = n - 1; i >= 0; i--) bot.push(`L ${i} ${(50 + Math.min(1, peaks[i]!) * 48).toFixed(1)}`);
  return `M 0 50 ${top.join(' ')} L ${n - 1} 50 ${bot.join(' ')} Z`;
}

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
      {!loading && hasAudio && (
        <div className="absolute left-1 top-1.5 h-9 overflow-hidden rounded border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)]"
          style={{ width: blockW }} title={label || '旁白'}>
          {/* 填充式对称波形图(SVG,沿块宽拉伸);无 peaks 时显中线 */}
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${Math.max(2, peaks.length)} 100`} preserveAspectRatio="none">
            {peaks.length > 1 ? (
              <path d={waveformPath(peaks)} fill="var(--cy-brand-500)" opacity={0.85} />
            ) : (
              <line x1={0} y1={50} x2={Math.max(2, peaks.length)} y2={50} stroke="var(--cy-brand-400)" strokeWidth={2} />
            )}
          </svg>
          {/* 名称小角标 */}
          <span className="absolute left-1 top-0.5 inline-flex max-w-[70%] items-center gap-0.5 rounded bg-[var(--cy-brand-600)] px-1 text-[9px] font-medium text-white">
            <Mic className="h-2.5 w-2.5 shrink-0" /> <span className="truncate">{label || '旁白'}</span>
          </span>
        </div>
      )}
    </div>
  );
};
