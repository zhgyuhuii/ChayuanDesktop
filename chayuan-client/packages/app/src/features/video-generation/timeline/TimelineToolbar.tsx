import * as React from 'react';
import { Film, ChevronUp, ChevronDown, Sparkles, Wand2, FileText, Captions, Volume2, Type, Music, Loader2 } from 'lucide-react';

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

// icon-only ghost:动作类(无选中态)
const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)] transition-colors';
// icon-only 开关:设置类(单选,选中=brand-50)
const iconToggle = (active: boolean) =>
  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ' +
  (active
    ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]'
    : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]');

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
        <button type="button" onClick={onScriptGen} className={iconBtn} title="生成脚本" aria-label="生成脚本">
          <Wand2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={onScriptEdit} className={iconBtn} title="编辑脚本" aria-label="编辑脚本">
          <FileText className="h-4 w-4" />
        </button>
        <button type="button" onClick={onSubtitleEdit} className={iconBtn} title="编辑字幕" aria-label="编辑字幕">
          <Captions className="h-4 w-4" />
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
              title={`${label}设置`} aria-label={`${label}设置`}
              className={iconToggle(active)}>
              <Icon className="h-4 w-4" />
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
