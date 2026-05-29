import * as React from 'react';

export const TRACK_H = 44; // 每轨高度(px),四轨共用

export const TrackHeader: React.FC<{ label: string; icon?: React.ReactNode; action?: React.ReactNode }> = ({ label, icon, action }) => (
  <div
    className="flex items-center gap-1.5 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-[11px] text-[var(--cy-text-secondary)]"
    style={{ height: TRACK_H }}
  >
    {icon}
    <span className="truncate">{label}</span>
    {action && <span className="ml-auto">{action}</span>}
  </div>
);
