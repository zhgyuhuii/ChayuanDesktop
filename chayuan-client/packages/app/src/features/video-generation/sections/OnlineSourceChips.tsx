/**
 * 在线素材源 chip 列表 — 用户在 MaterialsSection 里选择当前主源。
 *
 * 未配 Key 的源:橙色 AlertCircle 提示;Settings2 齿轮点开 inline 表单录 Key,
 * POST /api/v1/video-generation/sources/config。
 */
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { videoGeneration, type VgSourceConfig } from '@chayuan/api';

const KNOWN_SOURCES = [
  { name: 'pexels',   label: 'Pexels',   needsKey: true },
  { name: 'pixabay',  label: 'Pixabay',  needsKey: true },
  { name: 'unsplash', label: 'Unsplash', needsKey: true },
  { name: 'youtube',  label: 'YouTube',  needsKey: true },
  { name: 'vimeo',    label: 'Vimeo',    needsKey: true },
  { name: 'ytdlp',    label: 'yt-dlp (通用 URL)', needsKey: false },
];

export const OnlineSourceChips: React.FC<{
  selected: string;
  onSelect: (name: string) => void;
}> = ({ selected, onSelect }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['vg.sources.config'],
    queryFn: () => videoGeneration.listSourceConfigs(false),
    staleTime: 30_000,
  });
  const configs = q.data?.items ?? [];
  const cfgByName = new Map<string, VgSourceConfig>(configs.map((c) => [c.source_name, c]));

  const [editing, setEditing] = React.useState<string | null>(null);
  const [keyDraft, setKeyDraft] = React.useState('');

  const mut = useMutation({
    mutationFn: (args: Parameters<typeof videoGeneration.upsertSourceConfig>[0]) =>
      videoGeneration.upsertSourceConfig(args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vg.sources.config'] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {KNOWN_SOURCES.map((s) => {
          const c = cfgByName.get(s.name);
          const hasKey = c?.has_api_key || !s.needsKey;
          return (
            <button key={s.name} type="button" onClick={() => onSelect(s.name)}
              className={
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ' +
                (selected === s.name
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')
              }
            >
              {s.label}
              {!hasKey && <AlertCircle className="h-3 w-3 text-amber-500" />}
              {hasKey && s.needsKey && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              {s.needsKey && (
                <span
                  onClick={(e) => { e.stopPropagation(); setEditing(s.name); setKeyDraft(''); }}
                  className="ml-1 cursor-pointer text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]"
                >
                  <Settings2 className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {editing && (
        <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-xs">
          <p className="mb-1.5">
            为 <b>{editing}</b> 设置 API Key:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              autoFocus
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="API Key / Access Token"
              className="flex-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
            />
            <button
              type="button"
              onClick={async () => {
                await mut.mutateAsync({ source_name: editing, enabled: true, api_key: keyDraft });
                setEditing(null);
              }}
              className="rounded bg-[var(--cy-brand-500)] px-2 py-1 font-medium text-white hover:bg-[var(--cy-brand-600)]"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded border border-[var(--cy-border-subtle)] px-2 py-1"
            >
              取消
            </button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
            存储在 sqlite，仅本机访问。{editing === 'ytdlp' && '注：yt-dlp 不需要 Key。'}
          </p>
        </div>
      )}
    </div>
  );
};
