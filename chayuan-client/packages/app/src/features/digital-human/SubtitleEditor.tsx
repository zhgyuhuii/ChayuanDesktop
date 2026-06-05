import * as React from 'react';
import { digitalHuman, type DhSubtitleCue, type DhSubtitleStyle } from '@chayuan/api';

/** 工作台内就地编辑字幕:复用预设字幕全套设置(开关/位置/字号/颜色/描边)+ 逐条改文字/时间,
 *  应用后复用已生成片段只重跑 ffcompose 重烧字幕(不重跑 wav2lip)。 */
export const SubtitleEditor: React.FC<{
  taskId: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ taskId, onClose, onDone }) => {
  const [loading, setLoading] = React.useState(true);
  const [editable, setEditable] = React.useState(true);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [cues, setCues] = React.useState<DhSubtitleCue[]>([]);
  const [style, setStyle] = React.useState<DhSubtitleStyle>({});

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    digitalHuman
      .getTaskSubtitle(taskId)
      .then((r) => {
        if (!alive) return;
        setCues(r.cues || []);
        setStyle(r.style || {});
        setEditable(r.editable);
      })
      .catch((e) => alive && setErr(String((e as Error)?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const setSty = (p: Partial<DhSubtitleStyle>) => setStyle((s) => ({ ...s, ...p }));
  const setCue = (i: number, p: Partial<DhSubtitleCue>) =>
    setCues((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));
  const delCue = (i: number) => setCues((cs) => cs.filter((_, k) => k !== i));
  const ms2s = (ms: number) => (Math.max(0, ms || 0) / 1000).toFixed(2);
  const s2ms = (v: string) => Math.max(0, Math.round(parseFloat(v || '0') * 1000) || 0);

  const apply = async () => {
    setBusy(true);
    setErr('');
    try {
      await digitalHuman.resubtitleTask(taskId, cues, style);
      onDone();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const inp =
    'rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 py-1 text-xs text-[var(--cy-text-primary)]';

  if (loading) return <div className="text-xs text-[var(--cy-text-tertiary)]">读取字幕…</div>;
  if (!editable)
    return (
      <div className="flex flex-col gap-2 text-xs">
        <div className="text-[var(--cy-warning-600,#b45309)]">
          该任务的中间片段已清理,无法就地改字幕。请重新生成后再编辑(或用「去编辑合成」到时间轴)。
        </div>
        <div>
          <button type="button" onClick={onClose} className={`${inp} hover:bg-[var(--cy-surface-2)]`}>
            关闭
          </button>
        </div>
      </div>
    );

  const en = style.subtitle_enabled !== false;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-xs">
      {/* 样式(复用预设字幕设置) */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSty({ subtitle_enabled: !en })}
          className={`rounded-md border px-2 py-1 ${
            en
              ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
              : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)]'
          }`}
        >
          {en ? '字幕:开' : '字幕:关'}
        </button>
        {en && (
          <>
            <label className="flex items-center gap-1 text-[var(--cy-text-secondary)]">
              位置
              <select
                value={style.subtitle_position || 'bottom'}
                onChange={(e) => setSty({ subtitle_position: e.target.value })}
                className={inp}
              >
                <option value="top">顶部</option>
                <option value="center">居中</option>
                <option value="bottom">底部</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[var(--cy-text-secondary)]">
              字号
              <input
                type="number"
                min={12}
                max={120}
                value={style.font_size || 0}
                onChange={(e) => setSty({ font_size: parseInt(e.target.value || '0', 10) || 0 })}
                className={`${inp} w-16`}
              />
            </label>
            <label className="flex items-center gap-1 text-[var(--cy-text-secondary)]">
              字色
              <input
                type="color"
                value={style.text_fore_color || '#ffffff'}
                onChange={(e) => setSty({ text_fore_color: e.target.value })}
                className="h-6 w-8 rounded border border-[var(--cy-border-subtle)]"
              />
            </label>
            <label className="flex items-center gap-1 text-[var(--cy-text-secondary)]">
              描边
              <input
                type="color"
                value={style.stroke_color || '#000000'}
                onChange={(e) => setSty({ stroke_color: e.target.value })}
                className="h-6 w-8 rounded border border-[var(--cy-border-subtle)]"
              />
              <input
                type="number"
                min={0}
                max={8}
                value={style.stroke_width ?? 2}
                onChange={(e) => setSty({ stroke_width: parseInt(e.target.value || '0', 10) || 0 })}
                className={`${inp} w-12`}
              />
            </label>
          </>
        )}
      </div>

      {/* 逐条字幕 */}
      {en && (
        <div className="flex max-h-64 flex-col gap-1 overflow-auto">
          {cues.map((c, i) => (
            <div key={i} className="flex items-start gap-1">
              <input
                type="number"
                step={0.1}
                value={ms2s(c.start_ms)}
                onChange={(e) => setCue(i, { start_ms: s2ms(e.target.value) })}
                className={`${inp} w-14`}
                title="开始(秒)"
              />
              <input
                type="number"
                step={0.1}
                value={ms2s(c.end_ms)}
                onChange={(e) => setCue(i, { end_ms: s2ms(e.target.value) })}
                className={`${inp} w-14`}
                title="结束(秒)"
              />
              <textarea
                value={c.text}
                rows={1}
                onChange={(e) => setCue(i, { text: e.target.value })}
                className={`${inp} flex-1`}
              />
              <button
                type="button"
                onClick={() => delCue(i)}
                className={`${inp} text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]`}
                title="删除此条"
              >
                ✕
              </button>
            </div>
          ))}
          {cues.length === 0 && <div className="text-[var(--cy-text-tertiary)]">无字幕条目。</div>}
        </div>
      )}

      {err && <div className="text-[var(--cy-danger-500)]">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className="rounded-md bg-[var(--cy-brand-500)] px-3 py-1 text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
        >
          {busy ? '重渲染中…' : '应用并重渲染'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className={`${inp} hover:bg-[var(--cy-surface-2)] disabled:opacity-50`}
        >
          取消
        </button>
        <span className="text-[var(--cy-text-tertiary)]">复用已生成片段,仅重合成(不重跑形象推理)</span>
      </div>
    </div>
  );
};
