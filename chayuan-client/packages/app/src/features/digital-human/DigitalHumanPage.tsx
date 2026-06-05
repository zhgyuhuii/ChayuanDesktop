import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { digitalHuman } from '@chayuan/api';
import { PresetList } from './PresetList';
import { DhStudio } from './DhStudio';
import { DhTaskList } from './DhTaskList';
import { OnlineAvatarList } from './OnlineAvatarList';

type DhTab = 'studio' | 'videos' | 'online' | 'presets';
const TABS: DhTab[] = ['studio', 'videos', 'online', 'presets'];
const TAB_LABEL: Record<DhTab, string> = {
  studio: '工作台', videos: '数字人视频', online: '在线数字人', presets: '数字人设置',
};

export const DigitalHumanPage: React.FC = () => {
  const [tab, setTab] = React.useState<DhTab>('studio');
  const [genPresetId, setGenPresetId] = React.useState<string | undefined>(undefined);
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });
  const presets = presetsQ.data?.items ?? [];

  // 从「数字人设置」tab 的卡片点「生成」→ 带预设进工作台。
  const goGenerate = React.useCallback((presetId?: string) => {
    setGenPresetId(presetId);
    setTab('studio');
  }, []);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        {TABS.map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-8 rounded-md px-3 text-sm ${tab === k
              ? 'bg-[var(--cy-ink-700)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {/* 各 tab 全部常驻挂载,仅用 hidden 切换显示 → 切走再切回保持原状态(工作台选择/拖拽/滚动不丢) */}
      <div className={tab === 'studio' ? 'min-h-0 flex-1' : 'hidden'}>
        <DhStudio presets={presets} initialPresetId={genPresetId} onPublished={() => setTab('online')} onGenerated={() => setTab('videos')} />
      </div>
      <div className={tab === 'videos' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
        <DhTaskList />
      </div>
      <div className={tab === 'online' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
        <OnlineAvatarList />
      </div>
      <div className={tab === 'presets' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
        <PresetList presets={presets} onChanged={() => void presetsQ.refetch()} onGenerate={goGenerate} />
      </div>
    </div>
  );
};
