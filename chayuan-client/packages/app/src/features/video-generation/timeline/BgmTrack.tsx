import * as React from 'react';
import { Music } from 'lucide-react';
import { TRACK_H } from './TrackHeader';

export const BgmTrack: React.FC<{
  bgmName: string | null;
  contentWidthPx: number;
}> = ({ bgmName, contentWidthPx }) => (
  <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
    style={{ height: TRACK_H, width: contentWidthPx }}>
    {bgmName ? (
      <div className="absolute inset-x-1 top-1.5 flex h-8 items-center gap-1 overflow-hidden rounded border border-emerald-300 bg-emerald-50 px-2 text-[10px] text-emerald-800">
        <Music className="h-3 w-3 shrink-0" /> <span className="truncate">{bgmName}</span>
      </div>
    ) : (
      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">无背景音乐</span>
    )}
  </div>
);
