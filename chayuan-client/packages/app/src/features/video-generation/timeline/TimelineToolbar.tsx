import * as React from 'react';
import { Film, ChevronUp, ChevronDown, Sparkles, FileText, Captions, Volume2, Type, Music, Loader2 } from 'lucide-react';

interface TimelineToolbarProps {
  timelineCollapsed: boolean;
  onToggleCollapse: () => void;
  onScriptGen: () => void;
  onScriptEdit: () => void;
  onSubtitleEdit: () => void;
  settingsPanel: 'speech' | 'subtitle' | 'bgm' | null;
  onSettingsPanel: (k: 'speech' | 'subtitle' | 'bgm' | null) => void;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
}

const SETTINGS = [
  ['speech', '语音', Volume2],
  ['subtitle', '字幕', Type],
  ['bgm', '背景音乐', Music],
] as const;

const editBtn =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]';

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  timelineCollapsed,
  onToggleCollapse,
  onScriptGen,
  onScriptEdit,
  onSubtitleEdit,
  settingsPanel,
  onSettingsPanel,
  submitting,
  canSubmit,
  onSubmit,
}) => {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">
        <Film className="h-4 w-4" /> 时间轴
      </h2>
      <button type="button" onClick={onToggleCollapse} title={timelineCollapsed ? '展开时间轴' : '折叠时间轴'}
        className="inline-flex h-7 items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
        {timelineCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} {timelineCollapsed ? '展开' : '折叠'}
      </button>

      {/* 脚本/字幕编辑 + 语音/字幕/背景音乐(单选),同一行 */}
      <div className="inline-flex flex-wrap items-center gap-2">
        <button type="button" onClick={onScriptGen} className={editBtn}>
          <Sparkles className="h-3.5 w-3.5" /> 生成脚本
        </button>
        <button type="button" onClick={onScriptEdit} className={editBtn}>
          <FileText className="h-3.5 w-3.5" /> 编辑脚本
        </button>
        <button type="button" onClick={onSubtitleEdit} className={editBtn}>
          <Captions className="h-3.5 w-3.5" /> 编辑字幕
        </button>

        <span className="mx-0.5 h-5 w-px bg-[var(--cy-border-subtle)]" />

        {/* 语音 / 字幕 / 背景音乐:单选 —— 选中其一即在工具栏上方显示对应设置组件,其余隐藏;
            再点选中项则收起(settingsPanel=null)。单选语义由 settingsPanel 单值天然保证。 */}
        {SETTINGS.map(([k, label, Icon]) => {
          const active = settingsPanel === k;
          return (
            <button key={k} type="button"
              onClick={() => onSettingsPanel(active ? null : k)}
              aria-pressed={active}
              title={`${label}设置`}
              className={'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors ' +
                (active
                  ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-strong)] text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]')}>
              <Icon className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" /> {label}
            </button>
          );
        })}
      </div>

      <button type="button" onClick={onSubmit} disabled={submitting || !canSubmit}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交合成
      </button>
    </div>
  );
};
