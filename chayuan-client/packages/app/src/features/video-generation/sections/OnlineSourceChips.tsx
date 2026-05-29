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
            {cfgByName.get(editing)?.has_api_key && (
              <span className="ml-1 text-emerald-600">
                已配置(出于安全不回显;留空保存=保持不变,填写则覆盖)
              </span>
            )}
          </p>
          <div className="flex items-start gap-2">
            <textarea
              autoFocus
              rows={2}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="API Key — 可填多个(每行一个 / 逗号分隔),合成时自动轮换"
              className="flex-1 resize-y rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 font-mono"
            />
            <button
              type="button"
              onClick={async () => {
                const trimmed = keyDraft.trim();
                // 出于安全不回显已存 key;留空 = 保持原 key 不变(不传 api_key,
                // 否则后端会把已配的 key 清空)。填了才覆盖。
                await mut.mutateAsync({
                  source_name: editing, enabled: true,
                  ...(trimmed ? { api_key: trimmed } : {}),
                });
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
            存储在 sqlite，仅本机访问。多个 Key 会被轮换调用(对齐原项目)。
            {editing === 'ytdlp' && '注：yt-dlp 不需要 Key。'}
          </p>
        </div>
      )}
    </div>
  );
};
