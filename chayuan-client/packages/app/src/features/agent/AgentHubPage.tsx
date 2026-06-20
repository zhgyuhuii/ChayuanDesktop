import { type AgentStatus, externalAgents } from '@chayuan/api';
import { cn } from '@chayuan/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { confirmDialog } from '../../store/confirmDialog';
import { SkillsTab } from './SkillsTab';
import { branchOf, toneOf } from './agentStatus';

type SystemId = 'openclaw' | 'hermes';

const SYSTEMS: ReadonlyArray<{ id: SystemId; label: string }> = [
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'hermes', label: 'Hermes' },
];

function formatUptime(seconds?: number): string {
  if (seconds === undefined || seconds < 0) return '-';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** 未安装：流式安装日志 + 开始安装按钮。 */
const InstallHero: React.FC<{ systemId: SystemId; onInstalled: () => void }> = ({
  systemId,
  onInstalled,
}) => {
  const [installing, setInstalling] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const unsubRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    return () => {
      unsubRef.current?.();
    };
  }, []);

  const start = React.useCallback(() => {
    setInstalling(true);
    setError(null);
    setLogs([]);
    const unsub = externalAgents.subscribeInstall(systemId, {
      onLog: (line: string) => setLogs((prev) => [...prev, line]),
      onDone: () => {
        setInstalling(false);
        unsub();
        onInstalled();
      },
      onError: (e: unknown) => {
        setInstalling(false);
        setError(e instanceof Error ? e.message : '安装失败');
        unsub();
      },
    });
    unsubRef.current = unsub;
  }, [systemId, onInstalled]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-6">
      <div>
        <h3 className="text-lg font-semibold">未安装</h3>
        <p className="text-sm text-[var(--cy-text-secondary)]">
          该外部 Agent 尚未安装到本机，点击下方按钮开始安装。
        </p>
      </div>
      <div>
        <button
          type="button"
          disabled={installing}
          onClick={start}
          className="rounded-lg bg-[var(--cy-brand-600)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {installing ? '安装中…' : '开始安装'}
        </button>
      </div>
      {logs.length > 0 ? (
        <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
          {logs.join('\n')}
        </pre>
      ) : null}
      {error ? <div className="text-sm text-rose-500">{error}</div> : null}
    </div>
  );
};

/** 配置区：getConfig 载入 + raw / soul 两个 textarea + setConfig 保存。 */
const ConfigSection: React.FC<{ systemId: SystemId }> = ({ systemId }) => {
  const [raw, setRaw] = React.useState('');
  const [soul, setSoul] = React.useState('');
  const [format, setFormat] = React.useState('yaml');
  const [saved, setSaved] = React.useState(false);
  const rawId = React.useId();
  const soulId = React.useId();

  const cfg = useQuery({
    queryKey: ['agent', systemId, 'config'],
    queryFn: () => externalAgents.getConfig(systemId),
    staleTime: 10_000,
    retry: 0,
  });

  React.useEffect(() => {
    if (cfg.data) {
      setRaw(cfg.data.raw);
      setSoul(cfg.data.soul ?? '');
      setFormat(cfg.data.format || 'yaml');
    }
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () => externalAgents.setConfig(systemId, { raw, soul: soul || undefined, format }),
    onSuccess: () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">配置</h4>
        <span className="text-xs text-slate-400">{format}</span>
      </div>
      {cfg.isLoading ? (
        <div className="text-sm text-slate-400">加载配置…</div>
      ) : cfg.isError ? (
        <div className="text-sm text-rose-500">
          {cfg.error instanceof Error ? cfg.error.message : '配置加载失败'}
        </div>
      ) : (
        <>
          <label htmlFor={rawId} className="text-xs text-slate-500">
            原始配置（raw）
          </label>
          <textarea
            id={rawId}
            value={raw}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRaw(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 font-mono text-xs"
          />
          <label htmlFor={soulId} className="text-xs text-slate-500">
            人设 / 灵魂（soul）
          </label>
          <textarea
            id={soulId}
            value={soul}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSoul(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="rounded-lg bg-[var(--cy-brand-600)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? '保存中…' : '保存配置'}
            </button>
            {saved ? <span className="text-xs text-emerald-500">已保存</span> : null}
            {save.isError ? (
              <span className="text-xs text-rose-500">
                {save.error instanceof Error ? save.error.message : '保存失败'}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};

/** 运行日志面板：subscribeLogs 累积行。 */
const LogsPanel: React.FC<{ systemId: SystemId }> = ({ systemId }) => {
  const [lines, setLines] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLines([]);
    setError(null);
    const unsub = externalAgents.subscribeLogs(systemId, {
      onLine: (line: string) => setLines((prev) => [...prev.slice(-499), line]),
      onError: (e: unknown) => setError(e instanceof Error ? e.message : '日志流断开'),
    });
    return () => unsub();
  }, [systemId]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4">
      <h4 className="text-sm font-semibold">运行日志</h4>
      {error ? <div className="text-xs text-rose-500">{error}</div> : null}
      <pre className="max-h-72 min-h-[6rem] overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
        {lines.length > 0 ? lines.join('\n') : '等待日志…'}
      </pre>
    </div>
  );
};

export const AgentHubPage: React.FC = () => {
  const qc = useQueryClient();
  const [system, setSystem] = React.useState<SystemId>('openclaw');

  const statusKey = React.useMemo(() => ['agent', system, 'status'], [system]);

  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => externalAgents.status(system),
    staleTime: 3000,
    refetchInterval: 5000,
    retry: 0,
  });

  const invalidateStatus = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['agent', system, 'status'] });
  }, [qc, system]);

  const startM = useMutation({
    mutationFn: () => externalAgents.start(system),
    onSettled: () => invalidateStatus(),
  });
  const stopM = useMutation({
    mutationFn: () => externalAgents.stop(system),
    onSettled: () => invalidateStatus(),
  });
  const restartM = useMutation({
    mutationFn: () => externalAgents.restart(system),
    onSettled: () => invalidateStatus(),
  });
  const uninstallM = useMutation({
    mutationFn: () => externalAgents.uninstall(system),
    onSettled: () => invalidateStatus(),
  });

  const handleUninstall = React.useCallback(async () => {
    const ok = await confirmDialog('确定要卸载该外部 Agent 吗？此操作不可撤销。', {
      title: '卸载确认',
      confirmText: '卸载',
      danger: true,
    });
    if (ok) uninstallM.mutate();
  }, [uninstallM]);

  const data: AgentStatus | undefined = status.data;
  const branch = data ? branchOf(data) : null;
  const tone = data ? toneOf(data) : 'muted';

  const toneClass =
    tone === 'success'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'idle'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-500';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">外部 Agent</h2>
          <p className="text-sm text-[var(--cy-text-secondary)]">
            托管 OpenClaw / Hermes：安装、启停、配置、技能管理。
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--cy-border-subtle)] p-0.5 text-sm">
          {SYSTEMS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSystem(s.id)}
              className={cn(
                'rounded-md px-3 py-1.5',
                system === s.id
                  ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]'
                  : 'text-slate-500',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {status.isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">加载状态…</div>
      ) : status.isError ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <div className="text-sm text-rose-500">
            {status.error instanceof Error ? status.error.message : '状态加载失败'}
          </div>
          <button
            type="button"
            onClick={() => status.refetch()}
            className="rounded-lg border border-[var(--cy-border-subtle)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]"
          >
            重试
          </button>
        </div>
      ) : !data || branch === 'not_installed' ? (
        <InstallHero systemId={system} onInstalled={invalidateStatus} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4">
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', toneClass)}>
              {branch === 'running' ? '运行中' : '已停止'}
            </span>
            {data.version ? <span className="text-xs text-slate-400">v{data.version}</span> : null}
            {branch === 'running' ? (
              <>
                <span className="text-xs text-slate-500">PID {data.pid ?? '-'}</span>
                <span className="text-xs text-slate-500">
                  运行 {formatUptime(data.uptime_seconds)}
                </span>
                <span className="text-xs text-slate-500">健康 {data.health}</span>
              </>
            ) : null}
            {data.detail ? <span className="text-xs text-slate-400">{data.detail}</span> : null}

            <div className="ml-auto flex items-center gap-2">
              {branch === 'running' ? (
                <>
                  <button
                    type="button"
                    disabled={restartM.isPending}
                    onClick={() => restartM.mutate()}
                    className="rounded-lg border border-[var(--cy-border-subtle)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)] disabled:opacity-50"
                  >
                    {restartM.isPending ? '重启中…' : '重启'}
                  </button>
                  <button
                    type="button"
                    disabled={stopM.isPending}
                    onClick={() => stopM.mutate()}
                    className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {stopM.isPending ? '停止中…' : '停止'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={startM.isPending}
                    onClick={() => startM.mutate()}
                    className="rounded-lg bg-[var(--cy-brand-600)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {startM.isPending ? '启动中…' : '启动'}
                  </button>
                  <button
                    type="button"
                    disabled={uninstallM.isPending}
                    onClick={handleUninstall}
                    className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {uninstallM.isPending ? '卸载中…' : '卸载'}
                  </button>
                </>
              )}
            </div>
          </div>

          {branch === 'running' ? <LogsPanel systemId={system} /> : null}

          <ConfigSection systemId={system} />

          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">技能</h3>
            <SkillsTab systemId={system} />
          </div>
        </div>
      )}
    </div>
  );
};
