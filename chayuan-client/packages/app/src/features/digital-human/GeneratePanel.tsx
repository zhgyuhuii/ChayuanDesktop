import * as React from 'react';
import { digitalHuman } from '@chayuan/api';
import type { DigitalHumanPreset } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { DhProgressCard } from './DhProgressCard';

export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[] }> = ({ presets }) => {
  const [pid, setPid] = React.useState('');
  const [text, setText] = React.useState('');
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!pid && presets[0]) setPid(presets[0].id); }, [presets, pid]);
  const gen = async () => {
    setBusy(true);
    try {
      const r = await digitalHuman.generate(pid, text);
      setTaskId(r.task_id);
    } catch (e) { reportError(e as Error, '数字人生成失败'); }
    finally { setBusy(false); }
  };
  if (presets.length === 0)
    return <div className="text-sm text-[var(--cy-text-tertiary)]">先到「我的数字人」新建一个数字人。</div>;
  return (
    <div className="space-y-3">
      <select value={pid} onChange={(e) => setPid(e.target.value)}
        className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]">
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder="输入口播文案…"
        className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm text-[var(--cy-text-primary)]" />
      <button onClick={() => void gen()} disabled={!pid || !text.trim() || busy}
        className="inline-flex h-8 items-center rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
        生成数字人视频
      </button>
      {taskId && <DhProgressCard taskId={taskId} />}
    </div>
  );
};
