import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { digitalHuman } from '@chayuan/api';
import { useVgComposer } from '../video-generation/store/vgComposer';

export const DhProgressCard: React.FC<{ taskId: string }> = ({ taskId }) => {
  const [sentToTimeline, setSentToTimeline] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const navigate = useNavigate();
  const onToTimeline = async () => {
    setSending(true);
    try {
      const r = await digitalHuman.taskToTimeline(taskId);
      if (r.timeline) {
        // 预载到 VG 时间轴编辑器(改字幕→VG 稳健渲染重出)
        useVgComposer.getState().patchParams({ timeline: r.timeline as never });
        void navigate({ to: '/video-generation/timeline' as never });
      } else {
        setSentToTimeline(true);
      }
    } catch {
      // 忽略:失败时按钮恢复可重试
    } finally {
      setSending(false);
    }
  };
  const q = useQuery({
    queryKey: ['dh.task', taskId],
    queryFn: () => digitalHuman.taskStatus(taskId),
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      return s === 'complete' || s === 'failed' || s === 'canceled' ? false : 1000;
    },
  });
  const st = q.data;
  if (!st) return <div className="text-xs text-[var(--cy-text-tertiary)]">排队中…</div>;
  if (st.state === 'failed') return <div className="text-xs text-rose-600">失败:{st.error}</div>;
  if (st.state === 'complete') {
    return (
      <div className="flex items-center gap-3 text-xs">
        <video src={digitalHuman.taskFileUrl(taskId)} controls className="h-40 rounded-md" />
        <a href={digitalHuman.taskFileUrl(taskId)} download
          className="inline-flex h-7 items-center rounded-md bg-[var(--cy-brand-500)] px-3 text-white hover:bg-[var(--cy-brand-600)]">下载</a>
        <button type="button" onClick={onToTimeline} disabled={sending || sentToTimeline}
          className="inline-flex h-7 items-center rounded-md border border-[var(--cy-border-subtle)] px-3 text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
          {sentToTimeline ? '已送到素材库' : sending ? '准备中…' : '在时间轴编辑(改字幕重出)'}
        </button>
      </div>
    );
  }
  return <div className="text-xs text-[var(--cy-text-secondary)]">生成中… {st.progress}%</div>;
};
