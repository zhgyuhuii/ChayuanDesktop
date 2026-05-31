import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { digitalHuman } from '@chayuan/api';
import { PresetList } from './PresetList';
import { GeneratePanel } from './GeneratePanel';

export const DigitalHumanPage: React.FC = () => {
  const [tab, setTab] = React.useState<'manage' | 'generate'>('manage');
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });
  const presets = presetsQ.data?.items ?? [];
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex gap-2">
        {(['manage', 'generate'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-8 rounded-md px-3 text-sm ${tab === k
              ? 'bg-[var(--cy-ink-700)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
            {k === 'manage' ? '我的数字人' : '生成'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void navigate({ to: '/digital-human/live' as never })}
          className="ml-auto h-8 rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white hover:bg-[var(--cy-brand-600)]"
        >
          实时对话
        </button>
      </div>
      {tab === 'manage'
        ? <PresetList presets={presets} onChanged={() => void presetsQ.refetch()} />
        : <GeneratePanel presets={presets} />}
    </div>
  );
};
