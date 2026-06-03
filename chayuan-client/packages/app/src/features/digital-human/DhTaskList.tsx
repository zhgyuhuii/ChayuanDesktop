import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { digitalHuman } from '@chayuan/api';
import { DhProgressCard } from './DhProgressCard';

/** 底部全宽任务列表:横向排列,每条含 DhProgressCard(下载/去编辑合成)+ 删除。 */
export const DhTaskList: React.FC = () => {
  const qc = useQueryClient();
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: digitalHuman.listTasks, refetchInterval: 3000 });
  const tasks = (tasksQ.data?.items ?? []).slice().reverse();
  const del = async (tid: string) => {
    try { await digitalHuman.deleteTask(tid); } finally { void qc.invalidateQueries({ queryKey: ['dh.tasks'] }); }
  };
  return (
    <div className="flex h-full items-stretch gap-3 overflow-x-auto p-2">
      {tasks.length === 0 && (
        <div className="flex items-center px-2 text-xs text-[var(--cy-text-tertiary)]">暂无生成任务,点上方「生成数字人视频」开始</div>
      )}
      {tasks.map((t) => (
        <div key={t.task_id} className="relative w-48 shrink-0">
          <DhProgressCard taskId={t.task_id} />
          <button type="button" onClick={() => void del(t.task_id)} title="删除"
            className="absolute right-1 top-1 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/75">
            删除
          </button>
        </div>
      ))}
    </div>
  );
};
