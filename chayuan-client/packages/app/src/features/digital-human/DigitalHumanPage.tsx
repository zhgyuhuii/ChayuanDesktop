import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@chayuan/ui';
import { digitalHuman } from '@chayuan/api';
import { PresetList } from './PresetList';
import { DhStudio } from './DhStudio';
import { DhTaskList } from './DhTaskList';
import { OnlineAvatarList } from './OnlineAvatarList';

type DhTab = 'studio' | 'videos' | 'online';
const TAB_LABEL: Record<DhTab, string> = { studio: '工作台', videos: '数字人视频', online: '在线数字人' };

export const DigitalHumanPage: React.FC = () => {
  const [tab, setTab] = React.useState<DhTab>('studio');
  const [genPresetId, setGenPresetId] = React.useState<string | undefined>(undefined);
  // 「我的数字人」配置移到右上角齿轮弹窗(数字人设置)。
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });
  const presets = presetsQ.data?.items ?? [];

  const goGenerate = React.useCallback((presetId?: string) => {
    setGenPresetId(presetId);
    setTab('studio');
    setSettingsOpen(false);
  }, []);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        {(['studio', 'videos', 'online'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-8 rounded-md px-3 text-sm ${tab === k
              ? 'bg-[var(--cy-ink-700)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
            {TAB_LABEL[k]}
          </button>
        ))}
        {/* 右上角:数字人设置(原「我的数字人」卡片/列表) */}
        <button type="button" title="数字人设置" onClick={() => setSettingsOpen(true)}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--cy-border-subtle)] px-3 text-sm text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
          <Settings className="h-4 w-4" />
          数字人设置
        </button>
      </div>

      {tab === 'studio' ? (
        <DhStudio presets={presets} initialPresetId={genPresetId} onPublished={() => setTab('online')} />
      ) : tab === 'videos' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DhTaskList />
        </div>
      ) : (
        <OnlineAvatarList />
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogTitle>数字人设置</DialogTitle>
          <div className="mt-2 max-h-[70vh] overflow-y-auto pr-1">
            <PresetList presets={presets} onChanged={() => void presetsQ.refetch()} onGenerate={goGenerate} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
