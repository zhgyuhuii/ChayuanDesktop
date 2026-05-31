import * as React from 'react';
import { Film, ChevronUp, ChevronDown, Sparkles, FileText, Captions, Volume2, Type, Music, Loader2, SlidersHorizontal } from 'lucide-react';

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
  // 「设置」下拉:把语音/字幕/背景音乐三个次要项收进溢出菜单,缩短工具栏宽度。
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    const t = setTimeout(() => { window.addEventListener('mousedown', close); window.addEventListener('keydown', onKey); }, 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
  const activeLabel = SETTINGS.find(([k]) => k === settingsPanel)?.[1];

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">
        <Film className="h-4 w-4" /> 时间轴
      </h2>
      <button type="button" onClick={onToggleCollapse} title={timelineCollapsed ? '展开时间轴' : '折叠时间轴'}
        className="inline-flex h-7 items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
        {timelineCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} {timelineCollapsed ? '展开' : '折叠'}
      </button>

      {/* 组 1:脚本 / 字幕 编辑(主操作,整体换行不拆) */}
      <div className="inline-flex items-center gap-2">
        <button type="button" onClick={onScriptGen} className={editBtn}>
          <Sparkles className="h-3.5 w-3.5" /> 生成脚本
        </button>
        <button type="button" onClick={onScriptEdit} className={editBtn}>
          <FileText className="h-3.5 w-3.5" /> 编辑脚本
        </button>
        <button type="button" onClick={onSubtitleEdit} className={editBtn}>
          <Captions className="h-3.5 w-3.5" /> 编辑字幕
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-[var(--cy-border-subtle)]" />

      {/* 组 2:设置溢出菜单(语音 / 字幕 / 背景音乐) */}
      <div ref={menuRef} className="relative inline-flex">
        <button type="button" onClick={() => setMenuOpen((v) => !v)}
          title="语音 / 字幕 / 背景音乐 设置"
          className={'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs transition-colors ' +
            (settingsPanel
              ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
              : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')}>
          <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" />
          {activeLabel ?? '设置'}
          <ChevronDown className={'h-3 w-3 transition-transform ' + (menuOpen ? 'rotate-180' : '')} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-1 shadow-lg">
            {SETTINGS.map(([k, label, Icon]) => (
              <button key={k} type="button"
                onClick={() => { onSettingsPanel(settingsPanel === k ? null : k); setMenuOpen(false); }}
                className={'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ' +
                  (settingsPanel === k
                    ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                    : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
                <Icon className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" /> {label}
                {settingsPanel === k && <span className="ml-auto text-[10px] text-[var(--cy-brand-600)]">已开</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={onSubmit} disabled={submitting || !canSubmit}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交合成
      </button>
    </div>
  );
};
