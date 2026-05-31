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
      <button type="button" onClick={onScriptGen}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
        <Sparkles className="h-3.5 w-3.5" /> 生成脚本
      </button>
      <button type="button" onClick={onScriptEdit}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
        <FileText className="h-3.5 w-3.5" /> 编辑脚本
      </button>
      <button type="button" onClick={onSubtitleEdit}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
        <Captions className="h-3.5 w-3.5" /> 编辑字幕
      </button>
      {/* 语音 / 字幕 / 背景音乐 设置 chip —— 与上面按钮同排,点击向上展开面板 */}
      <span className="mx-0.5 h-5 w-px bg-[var(--cy-border-subtle)]" />
      {([['speech', '语音', Volume2], ['subtitle', '字幕', Type], ['bgm', '背景音乐', Music]] as const).map(([k, label, Icon]) => (
        <button key={k} type="button" onClick={() => onSettingsPanel(settingsPanel === k ? null : k)}
          className={'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs transition-colors ' +
            (settingsPanel === k
              ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
              : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')}>
          <Icon className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" /> {label}
          <ChevronDown className={'h-3 w-3 transition-transform ' + (settingsPanel === k ? 'rotate-180' : '')} />
        </button>
      ))}
      <button type="button" onClick={onSubmit} disabled={submitting || !canSubmit}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交合成
      </button>
    </div>
  );
};
