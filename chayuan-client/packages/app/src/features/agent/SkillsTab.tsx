import { type Skill, externalAgents } from '@chayuan/api';
import { cn } from '@chayuan/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { BilingualText } from './BilingualText';

type Mode = 'installed' | 'market';

/** 单个技能卡片：名称 + verified、版本、描述（机翻）、权限原文 chip、安装/卸载。 */
const SkillCard: React.FC<{
  systemId: string;
  skill: Skill;
  onChanged: () => void;
}> = ({ systemId, skill, onChanged }) => {
  const [descZh, setDescZh] = React.useState<string | undefined>(undefined);
  const [installing, setInstalling] = React.useState(false);
  const [installError, setInstallError] = React.useState<string | null>(null);

  // 异步取描述机翻；权限原文不机翻。
  React.useEffect(() => {
    let cancelled = false;
    const text = skill.description;
    if (!text) {
      setDescZh(undefined);
      return;
    }
    externalAgents
      .translate(systemId, {
        skillId: skill.id,
        field: 'description',
        version: skill.version,
        text,
        lang: 'zh',
      })
      .then((t) => {
        if (!cancelled) setDescZh(t);
      })
      .catch(() => {
        if (!cancelled) setDescZh(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [systemId, skill.id, skill.version, skill.description]);

  const uninstall = useMutation({
    mutationFn: () => externalAgents.uninstallSkill(systemId, skill.id),
    onSettled: () => onChanged(),
  });

  const handleInstall = React.useCallback(() => {
    setInstalling(true);
    setInstallError(null);
    const unsub = externalAgents.subscribeSkillInstall(systemId, skill.id, {
      onDone: () => {
        setInstalling(false);
        unsub();
        onChanged();
      },
      onError: (e: unknown) => {
        setInstalling(false);
        setInstallError(e instanceof Error ? e.message : '安装失败');
        unsub();
      },
    });
  }, [systemId, skill.id, onChanged]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-medium">
            <span className="truncate">{skill.name}</span>
            {skill.verified ? (
              <span className="text-xs text-emerald-500" title="官方认证">
                ✓
              </span>
            ) : null}
          </div>
          <div className="text-xs text-slate-400">v{skill.version}</div>
        </div>
        {skill.installed ? (
          <button
            type="button"
            disabled={uninstall.isPending}
            onClick={() => uninstall.mutate()}
            className="shrink-0 rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            {uninstall.isPending ? '卸载中…' : '卸载'}
          </button>
        ) : (
          <button
            type="button"
            disabled={installing}
            onClick={handleInstall}
            className="shrink-0 rounded-md border border-[var(--cy-brand-300)] px-2 py-1 text-xs text-[var(--cy-brand-600)] hover:bg-[var(--cy-brand-50)] disabled:opacity-50"
          >
            {installing ? '安装中…' : '安装'}
          </button>
        )}
      </div>

      <div className="text-sm text-[var(--cy-text-secondary)]">
        <BilingualText original={skill.description} translated={descZh} />
      </div>

      {skill.permissions.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {skill.permissions.map((perm: string) => (
            <span
              key={perm}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
            >
              {perm}
            </span>
          ))}
        </div>
      ) : null}

      {installError ? <div className="text-xs text-rose-500">{installError}</div> : null}
    </div>
  );
};

export const SkillsTab: React.FC<{ systemId: string }> = ({ systemId }) => {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<Mode>('installed');
  const [q, setQ] = React.useState('');

  const installed = useQuery({
    queryKey: ['agent', systemId, 'skills', 'installed'],
    queryFn: () => externalAgents.listSkills(systemId),
    enabled: mode === 'installed',
  });

  const market = useQuery({
    queryKey: ['agent', systemId, 'skills', 'market', q],
    queryFn: () => externalAgents.searchSkills(systemId, q),
    enabled: mode === 'market' && q.length > 0,
  });

  const onChanged = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['agent', systemId, 'skills'] });
  }, [qc, systemId]);

  const active = mode === 'installed' ? installed : market;
  const skills: Skill[] = active.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--cy-border-subtle)] p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setMode('installed')}
            className={cn(
              'rounded-md px-3 py-1',
              mode === 'installed'
                ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]'
                : 'text-slate-500',
            )}
          >
            已安装
          </button>
          <button
            type="button"
            onClick={() => setMode('market')}
            className={cn(
              'rounded-md px-3 py-1',
              mode === 'market'
                ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]'
                : 'text-slate-500',
            )}
          >
            技能市场
          </button>
        </div>
        {mode === 'market' ? (
          <input
            type="text"
            value={q}
            placeholder="搜索技能…"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            className="flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm"
          />
        ) : null}
      </div>

      {active.isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400">加载中…</div>
      ) : active.isError ? (
        <div className="py-6 text-center text-sm text-rose-500">
          {active.error instanceof Error ? active.error.message : '加载失败'}
        </div>
      ) : mode === 'market' && q.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">输入关键字搜索技能</div>
      ) : skills.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">
          {mode === 'installed' ? '暂无已安装技能' : '没有匹配的技能'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {skills.map((s) => (
            <SkillCard key={s.id} systemId={systemId} skill={s} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
};
