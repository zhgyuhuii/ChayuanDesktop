import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { digitalHuman, type DhTaskStatus } from '@chayuan/api';
import { DhProgressCard } from './DhProgressCard';

const stateText = (t: DhTaskStatus): string =>
  t.state === 'complete' ? '已完成'
    : t.state === 'failed' ? '失败'
    : t.state === 'canceled' ? '已取消'
    : `生成中 ${t.progress}%`;

const fmtTime = (ts?: number): string => {
  if (!ts) return '-';
  try { return new Date(ts * 1000).toLocaleString(); } catch { return '-'; }
};

/** 底部全宽任务列表:卡片视图(自动换行)/ 列表视图(时间·引擎·文案模型·脚本·状态·操作)可切换。 */
export const DhTaskList: React.FC = () => {
  const qc = useQueryClient();
  const [view, setView] = React.useState<'card' | 'list'>(
    () => (localStorage.getItem('dh.tasks.view') === 'list' ? 'list' : 'card'),
  );
  const setViewP = (v: 'card' | 'list') => { localStorage.setItem('dh.tasks.view', v); setView(v); };
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: digitalHuman.listTasks, refetchInterval: 3000 });
  const tasks = (tasksQ.data?.items ?? []).slice().reverse();
  const del = async (tid: string) => {
    try { await digitalHuman.deleteTask(tid); } finally { void qc.invalidateQueries({ queryKey: ['dh.tasks'] }); }
  };

  const tabBtn = (v: 'card' | 'list', label: string) => (
    <button type="button" onClick={() => setViewP(v)}
      className={`h-6 rounded px-2 text-xs ${view === v
        ? 'bg-[var(--cy-ink-700)] text-white'
        : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>{label}</button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--cy-border-subtle)] px-2 py-1">
        <span className="text-xs text-[var(--cy-text-tertiary)]">生成任务({tasks.length})</span>
        <div className="flex gap-1">{tabBtn('card', '卡片')}{tabBtn('list', '列表')}</div>
      </div>
      {tasks.length === 0 ? (
        <div className="flex flex-1 items-center px-3 text-xs text-[var(--cy-text-tertiary)]">暂无生成任务,点上方「生成数字人视频」开始</div>
      ) : view === 'card' ? (
        <div className="flex flex-1 flex-wrap content-start gap-3 overflow-y-auto p-2">
          {tasks.map((t) => (
            <div key={t.task_id} className="w-56 shrink-0 rounded-lg border border-[var(--cy-border-subtle)] p-2">
              <DhProgressCard taskId={t.task_id} onDelete={() => void del(t.task_id)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-2">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[var(--cy-text-tertiary)]">
                <th className="py-1 pr-3 font-normal">时间</th>
                <th className="py-1 pr-3 font-normal">引擎</th>
                <th className="py-1 pr-3 font-normal">文案模型</th>
                <th className="py-1 pr-3 font-normal">脚本</th>
                <th className="py-1 pr-3 font-normal">状态</th>
                <th className="py-1 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.task_id} className="border-t border-[var(--cy-border-subtle)] align-top text-[var(--cy-text-secondary)]">
                  <td className="py-1 pr-3 whitespace-nowrap">{fmtTime(t.created_at)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{t.engine || '-'}</td>
                  <td className="py-1 pr-3 max-w-[140px] truncate" title={t.script_model || ''}>{t.script_model || '手输'}</td>
                  <td className="py-1 pr-3 max-w-[280px] truncate" title={t.script || ''}>{t.script || '-'}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{stateText(t)}</td>
                  <td className="py-1">
                    <div className="flex gap-2">
                      {t.state === 'complete' && (
                        <a href={digitalHuman.taskFileUrl(t.task_id)} download className="text-[var(--cy-brand-500)] hover:underline">下载</a>
                      )}
                      <button type="button" onClick={() => void del(t.task_id)} className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-danger-500)]">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
