import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { digitalHuman } from '@chayuan/api';
import { PresetList } from './PresetList';
import { DhStudio } from './DhStudio';
import { OnlineAvatarList } from './OnlineAvatarList';

type DhTab = 'studio' | 'manage' | 'online';
const TAB_LABEL: Record<DhTab, string> = { studio: '工作台', manage: '我的数字人', online: '在线数字人' };

export const DigitalHumanPage: React.FC = () => {
  const [tab, setTab] = React.useState<DhTab>('studio');
  const [genPresetId, setGenPresetId] = React.useState<string | undefined>(undefined);
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });
  const avatarsQ = useQuery({ queryKey: ['dh.avatars'], queryFn: digitalHuman.listAvatars });
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: digitalHuman.listTasks, refetchInterval: 3000 });
  const presets = presetsQ.data?.items ?? [];
  const presetCount = presetsQ.data?.count ?? presets.length;
  const avatarCount = avatarsQ.data?.count ?? 0;
  const activeCount = tasksQ.data?.active ?? 0;

  const goGenerate = React.useCallback((presetId?: string) => {
    setGenPresetId(presetId);
    setTab('studio');
  }, []);

  return (
    <div className="flex h-full flex-col p-4">
      {/* 状态概览条 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--cy-text-tertiary)]">
        <span><b className="text-[var(--cy-text-secondary)]">{presetCount}</b> 个数字人</span>
        <span className="h-3 w-px bg-[var(--cy-border-subtle)]" />
        <span><b className="text-[var(--cy-text-secondary)]">{avatarCount}</b> 个形象素材</span>
        {activeCount > 0 && (
          <>
            <span className="h-3 w-px bg-[var(--cy-border-subtle)]" />
            <span className="inline-flex items-center gap-1 text-[var(--cy-brand-600)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              <b>{activeCount}</b> 个生成任务进行中
            </span>
          </>
        )}
      </div>
      <div className="mb-3 flex gap-2">
        {(['studio', 'manage', 'online'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-8 rounded-md px-3 text-sm ${tab === k
              ? 'bg-[var(--cy-ink-700)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>
      {tab === 'studio'
        ? <DhStudio presets={presets} initialPresetId={genPresetId} onPublished={() => setTab('online')} />
        : tab === 'manage'
          ? <PresetList presets={presets} onChanged={() => void presetsQ.refetch()} onGenerate={goGenerate} />
          : <OnlineAvatarList />}
    </div>
  );
};
