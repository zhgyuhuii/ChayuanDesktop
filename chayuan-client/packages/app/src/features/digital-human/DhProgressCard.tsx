import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { digitalHuman } from '@chayuan/api';
import { useVgComposer } from '../video-generation/store/vgComposer';

/** 单个生成任务卡片:视频在上,文字操作(下载/去编辑合成/删除)在下方一排。
 *  字幕只在工作台生成前编辑(预设字幕设置),成片上不再提供编辑字幕。 */
export const DhProgressCard: React.FC<{ taskId: string; onDelete?: () => void }> = ({ taskId, onDelete }) => {
  const [sending, setSending] = React.useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onToTimeline = async () => {
    setSending(true);
    try {
      const r = await digitalHuman.taskToTimeline(taskId);
      useVgComposer.getState().patchParams({ timeline: r.timeline as never });
      void queryClient.invalidateQueries({ queryKey: ['vg.materials'] });
      void navigate({ to: '/video-generation/timeline' as never });
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

  // 操作改为纯文字链接(无按钮容器)。
  const linkCls = 'text-[var(--cy-brand-500)] hover:underline';
  const delBtn = onDelete ? (
    <button type="button" onClick={onDelete}
      className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-danger-500)] hover:underline">删除</button>
  ) : null;

  if (!st) return <div className="text-xs text-[var(--cy-text-tertiary)]">排队中…</div>;
  if (st.state === 'failed') {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <div className="text-rose-600">失败:{st.error}</div>
        {delBtn && <div className="flex gap-2">{delBtn}</div>}
      </div>
    );
  }
  if (st.state === 'complete') {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <video src={digitalHuman.taskFileUrl(taskId)} controls className="w-full rounded-md" />
        <div className="flex flex-wrap items-center gap-3">
          <a href={digitalHuman.taskFileUrl(taskId)} download className={linkCls}>下载</a>
          <button type="button" onClick={onToTimeline} disabled={sending}
            className={`${linkCls} disabled:opacity-50`}>{sending ? '准备中…' : '去编辑合成'}</button>
          {delBtn}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="text-[var(--cy-text-secondary)]">生成中… {st.progress}%</div>
      {delBtn && <div className="flex gap-2">{delBtn}</div>}
    </div>
  );
};
