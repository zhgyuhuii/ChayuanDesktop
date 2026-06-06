import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogTitle } from '@chayuan/ui';
import { digitalHuman } from '@chayuan/api';
import { useVgComposer } from '../video-generation/store/vgComposer';
import { notifySuccess } from '../../store/errorDialog';

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
  const [scriptOpen, setScriptOpen] = React.useState(false);
  // 成片脚本:优先 task.script,空则用多角色各段文本拼接。
  const scriptText = (st?.script || '').trim()
    || (st?.segments ?? []).map((s) => (s.text || '').trim()).filter(Boolean).join('\n');
  const copyScript = async () => {
    try { await navigator.clipboard?.writeText(scriptText); notifySuccess('脚本已复制'); }
    catch { /* 复制失败忽略 */ }
  };

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
        {/* 脚本:下方一行,点击弹出完整脚本可复制 */}
        {scriptText && (
          <button type="button" onClick={() => setScriptOpen(true)}
            className="truncate text-left text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)] hover:underline"
            title="点击查看完整脚本">
            📝 {scriptText.replace(/\n/g, ' ')}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <a href={digitalHuman.taskFileUrl(taskId)} download className={linkCls}>下载</a>
          <button type="button" onClick={onToTimeline} disabled={sending}
            className={`${linkCls} disabled:opacity-50`}>{sending ? '准备中…' : '去编辑合成'}</button>
          {delBtn}
        </div>
        <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
          <DialogContent className="max-w-lg">
            <DialogTitle>脚本</DialogTitle>
            <div className="mt-2 max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3 text-sm text-[var(--cy-text-primary)]">
              {scriptText}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setScriptOpen(false)}
                className="h-8 rounded-md px-3 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">关闭</button>
              <button type="button" onClick={() => void copyScript()}
                className="h-8 rounded-md bg-[var(--cy-brand-500)] px-4 text-sm text-white hover:bg-[var(--cy-brand-600)]">复制</button>
            </div>
          </DialogContent>
        </Dialog>
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
