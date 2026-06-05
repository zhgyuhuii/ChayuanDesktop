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

type SearchMode = 'all' | 'script' | 'role' | 'model';
const MODE_LABEL: Record<SearchMode, string> = { all: '全部', script: '脚本', role: '角色', model: '模型' };

/** 数字人视频:卡片 / 列表展示,顶部可按 脚本 / 角色 / 模型 搜索。 */
export const DhTaskList: React.FC = () => {
  const qc = useQueryClient();
  const [view, setView] = React.useState<'card' | 'list'>(
    () => (localStorage.getItem('dh.tasks.view') === 'list' ? 'list' : 'card'),
  );
  const setViewP = (v: 'card' | 'list') => { localStorage.setItem('dh.tasks.view', v); setView(v); };
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: digitalHuman.listTasks, refetchInterval: 3000 });
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });

  // preset_id -> 数字人名 + 角色名(供按角色 / 数字人搜索)
  const presetMap = React.useMemo(() => {
    const m = new Map<string, string>();
    (presetsQ.data?.items ?? []).forEach((p) => {
      const roles = (p.avatars ?? []).map((a) => a.name || '').filter(Boolean).join(' ');
      m.set(p.id, `${p.name || ''} ${roles}`.trim());
    });
    return m;
  }, [presetsQ.data]);

  const [q, setQ] = React.useState('');
  const [mode, setMode] = React.useState<SearchMode>('all');

  const allTasks = React.useMemo(() => (tasksQ.data?.items ?? []).slice().reverse(), [tasksQ.data]);
  const tasks = React.useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return allTasks;
    return allTasks.filter((t) => {
      const script = `${t.script || ''} ${(t.segments ?? []).map((s) => s.text || '').join(' ')}`;
      const role = presetMap.get(t.preset_id || '') || '';
      const model = t.script_model || '';
      const hay = mode === 'script' ? script
        : mode === 'role' ? role
          : mode === 'model' ? model
            : `${script} ${role} ${model}`;
      return hay.toLowerCase().includes(kw);
    });
  }, [allTasks, q, mode, presetMap]);

  const del = async (tid: string) => {
    try { await digitalHuman.deleteTask(tid); } finally { void qc.invalidateQueries({ queryKey: ['dh.tasks'] }); }
  };

  const tabBtn = (v: 'card' | 'list', label: string) => (
    <button type="button" onClick={() => setViewP(v)}
      className={`h-7 rounded px-2 text-xs ${view === v
        ? 'bg-[var(--cy-ink-700)] text-white'
        : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>{label}</button>
  );

  const inpCls = 'h-7 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-xs text-[var(--cy-text-primary)] outline-none';

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 顶部:搜索 + 视图切换(无外层大容器) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--cy-text-tertiary)]">数字人视频({tasks.length})</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索视频…"
          className={`${inpCls} w-48`} />
        <select value={mode} onChange={(e) => setMode(e.target.value as SearchMode)} className={inpCls}>
          {(['all', 'script', 'role', 'model'] as const).map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-1">{tabBtn('card', '卡片')}{tabBtn('list', '列表')}</div>
      </div>

      {tasks.length === 0 ? (
        <div className="px-1 py-6 text-xs text-[var(--cy-text-tertiary)]">
          {q.trim() ? '没有匹配的视频。' : '暂无生成任务,去「工作台」生成数字人视频。'}
        </div>
      ) : view === 'card' ? (
        <div className="flex flex-1 flex-wrap content-start gap-3 overflow-y-auto">
          {tasks.map((t) => (
            <div key={t.task_id} className="w-56 shrink-0 rounded-lg border border-[var(--cy-border-subtle)] p-2">
              <DhProgressCard taskId={t.task_id} onDelete={() => void del(t.task_id)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[var(--cy-text-tertiary)]">
                <th className="py-1 pr-3 font-normal">时间</th>
                <th className="py-1 pr-3 font-normal">数字人/角色</th>
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
                  <td className="py-1 pr-3 max-w-[160px] truncate" title={presetMap.get(t.preset_id || '') || ''}>{presetMap.get(t.preset_id || '') || '-'}</td>
                  <td className="py-1 pr-3 max-w-[140px] truncate" title={t.script_model || ''}>{t.script_model || '手输'}</td>
                  <td className="py-1 pr-3 max-w-[280px] truncate" title={t.script || ''}>{t.script || '-'}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{stateText(t)}</td>
                  <td className="py-1">
                    <div className="flex gap-3">
                      {t.state === 'complete' && (
                        <a href={digitalHuman.taskFileUrl(t.task_id)} download className="text-[var(--cy-brand-500)] hover:underline">下载</a>
                      )}
                      <button type="button" onClick={() => void del(t.task_id)} className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-danger-500)] hover:underline">删除</button>
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
