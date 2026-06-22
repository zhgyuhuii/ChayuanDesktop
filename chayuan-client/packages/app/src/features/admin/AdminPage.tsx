import * as React from 'react';
import { ExternalLink, Activity, Shield, Database, TrendingUp, Boxes, Server, Cloud, Users, Plug, Wrench, Radio, AppWindow, Lock, Gauge, Star, Layers, HardDrive, FolderTree, SlidersHorizontal, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, BookOpen, FileText, Cpu } from 'lucide-react';
import { Button, cn } from '@chayuan/ui';
import { deepLinkTrace } from '@chayuan/observability';
import { getPlatform, isWeb } from '@chayuan/platform-shared';
import { useAuthStore } from '../../store/auth';
import { useLocalTraces, useOutboxStat } from './useLocalTraces';
import { useLfHealth, useLfPrompts, useLfTraces } from './useLfApi';
import { ScoreTrend } from './ScoreTrend';
import { SystemServicesPage } from './SystemServicesPage';
import { DeploymentStatusPanel } from '../license/DeploymentStatusPanel';
import { UsersPage } from './users/UsersPage';
import { McpPage } from './mcp/McpPage';
import { ToolsBoard } from '../tools/ToolsBoard';
import { WsEndpointsPage } from './wsendpoints/WsEndpointsPage';
import { AppsPage } from './apps/AppsPage';
import { KbAclPage } from './kbacl/KbAclPage';
import { PerformancePage } from './performance/PerformancePage';
import { DefaultModelsPage } from './defaults/DefaultModelsPage';
import { MarketplacePage } from '../marketplace/MarketplacePage';
import { RedisConfigPage } from './infra/RedisConfigPage';
import { StorageConfigPage } from './infra/StorageConfigPage';
import { DatabaseConfigPage } from './infra/DatabaseConfigPage';
import { DataDirPage } from './infra/DataDirPage';
import { BasicSettingsPage } from './config/BasicSettingsPage';
import { SchemaForm } from './config/SchemaForm';
import { VectorStorePage } from './config/VectorStorePage';
import { KbManagePage } from './kbmanage/KbManagePage';
import { ServiceTopologyPage } from './services/ServiceTopologyPage';
import { RoleManagementPage } from './roles/RoleManagementPage';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { roles as rolesApi } from '@chayuan/api';
import { ConfirmRoot } from '../../store/confirmDialog';
import { PromptRoot } from '../../store/promptDialog';
import { ErrorDialogRoot } from '../shell/ErrorDialog';

export type AdminTab = 'traces' | 'outbox' | 'prompts' | 'scores' | 'platforms' | 'services' | 'deployment' | 'users' | 'mcp' | 'tools' | 'ws' | 'apps' | 'kbacl' | 'perf' | 'defaults' | 'redis' | 'storage' | 'database' | 'datadir' | 'basic' | 'kbcfg' | 'modelcfg' | 'prompttpl' | 'vstore' | 'kbmanage' | 'topology' | 'roles';

type AdminItem = { key: AdminTab; label: string; icon: React.ComponentType<{ className?: string }>; webOnly?: boolean; hidden?: boolean };
type AdminGroup = { title: string; items: AdminItem[] };

// 管理员专属菜单(分组)。默认落「用户与权限 · 用户」。
const ADMIN_GROUPS: AdminGroup[] = [
  { title: '用户与权限', items: [
    { key: 'users', label: '用户', icon: Users },
    { key: 'roles', label: '角色', icon: Shield },
    { key: 'kbacl', label: 'KB 授权', icon: Lock },
    { key: 'apps', label: '应用', icon: AppWindow },
  ] },
  { title: '模型与服务', items: [
    { key: 'defaults', label: '默认模型', icon: Star },
    { key: 'platforms', label: '模型平台', icon: Boxes },
    { key: 'mcp', label: 'MCP', icon: Plug },
    { key: 'tools', label: '工具', icon: Wrench },
    { key: 'modelcfg', label: '模型参数', icon: Cpu },
    { key: 'prompttpl', label: 'Prompt 模板', icon: FileText },
    // WS 端点:从主菜单隐藏(#8),仍可经 URL /admin/ws 访问。
    { key: 'ws', label: 'WS 端点', icon: Radio, hidden: true },
    { key: 'services', label: '系统服务', icon: Server },
    { key: 'topology', label: '服务状态', icon: Gauge },
  ] },
  { title: '知识库', items: [
    { key: 'kbcfg', label: '知识库配置', icon: BookOpen },
    { key: 'vstore', label: '向量库', icon: Database },
    { key: 'kbmanage', label: '知识库管理', icon: BookOpen },
  ] },
  { title: '监控', items: [
    { key: 'traces', label: '最近 Trace', icon: Activity },
    { key: 'scores', label: 'Scores', icon: TrendingUp },
    { key: 'perf', label: '性能', icon: Gauge },
    { key: 'outbox', label: 'Outbox', icon: Database },
    { key: 'prompts', label: 'Prompt', icon: Shield },
  ] },
  { title: '基础设施', items: [
    { key: 'basic', label: '基础配置', icon: SlidersHorizontal },
    { key: 'database', label: '数据库', icon: Database },
    { key: 'redis', label: 'Redis', icon: Layers },
    { key: 'storage', label: '对象存储', icon: HardDrive },
    { key: 'datadir', label: '数据目录', icon: FolderTree },
  ] },
  { title: '部署', items: [
    { key: 'deployment', label: '部署授权', icon: Cloud, webOnly: true },
  ] },
];

const ADMIN_LABELS: Record<string, string> = Object.fromEntries(
  ADMIN_GROUPS.flatMap((g) => g.items.map((it) => [it.key, it.label])),
);
const KNOWN_TABS = new Set<AdminTab>(ADMIN_GROUPS.flatMap((g) => g.items.map((it) => it.key)));
const normTab = (t?: string): AdminTab => (t && KNOWN_TABS.has(t as AdminTab) ? (t as AdminTab) : 'users');

const LS_COLLAPSED = 'cy-admin-sidebar-collapsed';
const LS_GROUPS = 'cy-admin-collapsed-groups';

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * AdminPage —— 管理员独立控制台(整屏,脱离消费端 Chrome)。
 * 左侧管理员专属分组菜单(可整栏折叠为 icon / 分组可展开收起) + 顶栏 + 当前域内容。
 * 由顶层路由 /admin/$tab 渲染;域组件全部复用。
 */
export const AdminPage: React.FC<{ tab?: AdminTab }> = ({ tab: tabProp }) => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [tab, setTab] = React.useState<AdminTab>(normTab(tabProp));
  const [collapsed, setCollapsed] = React.useState<boolean>(() => readBool(LS_COLLAPSED));
  const [closedGroups, setClosedGroups] = React.useState<Set<string>>(() => readSet(LS_GROUPS));
  // RBAC #2:按当前用户角色的模块门控菜单。admin → is_admin=true → 不过滤(allowed=null)。
  const myModules = useQuery({
    queryKey: ['admin', 'my-modules'],
    queryFn: () => rolesApi.myModules(),
    staleTime: 60_000,
    retry: 0,
  });
  const allowedModules: Set<string> | null =
    myModules.data && myModules.data.is_admin === false ? new Set(myModules.data.modules) : null;

  React.useEffect(() => {
    setTab(normTab(tabProp));
  }, [tabProp]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem(LS_COLLAPSED, n ? '1' : '0');
      } catch { /* ignore */ }
      return n;
    });
  };
  const toggleGroup = (title: string) => {
    setClosedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(title)) n.delete(title);
      else n.add(title);
      try {
        localStorage.setItem(LS_GROUPS, JSON.stringify(Array.from(n)));
      } catch { /* ignore */ }
      return n;
    });
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Shield className="h-8 w-8" />
        <p>需要管理员权限才能访问</p>
        <Button variant="outline" size="sm" onClick={() => void navigate({ to: '/home' })}>
          返回首页
        </Button>
      </div>
    );
  }

  const select = (k: AdminTab) => {
    setTab(k);
    void navigate({ to: '/admin/$tab', params: { tab: k } });
  };
  const doLogout = async () => {
    await logout();
    void navigate({ to: '/login' });
  };

  return (
    <div
      className={cn(
        'grid h-screen w-screen overflow-hidden bg-[var(--cy-surface-2)] text-[var(--cy-text-primary)]',
        collapsed ? 'grid-cols-[60px_1fr]' : 'grid-cols-[240px_1fr]',
      )}
    >
      {/* 左:管理员专属菜单 */}
      <aside className="flex h-full min-h-0 flex-col border-r border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
        <div className={cn('flex items-center px-3 py-4', collapsed ? 'justify-center' : 'justify-between px-4')}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[var(--cy-brand-500)]" />
              <span className="text-sm font-semibold">管理控制台</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? '展开菜单' : '折叠菜单'}
            className="rounded-md p-1.5 opacity-60 transition-colors hover:bg-[var(--cy-surface-2)] hover:opacity-100"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-auto px-2 pb-4">
          {ADMIN_GROUPS.map((g) => {
            const items = g.items.filter((it) => !it.hidden && (!it.webOnly || isWeb()) && (allowedModules === null || allowedModules.has(it.key)));
            if (!items.length) return null;
            const groupClosed = !collapsed && closedGroups.has(g.title);
            return (
              <div key={g.title} className="mb-3">
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.title)}
                    className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-medium uppercase tracking-wide opacity-50 transition-opacity hover:opacity-80"
                  >
                    <span>{g.title}</span>
                    {groupClosed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                )}
                {!groupClosed &&
                  items.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => select(it.key)}
                      title={collapsed ? it.label : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                        collapsed && 'justify-center',
                        tab === it.key
                          ? 'bg-[var(--cy-brand-500)]/12 font-medium text-[var(--cy-brand-600)]'
                          : 'hover:bg-[var(--cy-surface-2)]',
                      )}
                    >
                      <it.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{it.label}</span>}
                    </button>
                  ))}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* 右:顶栏 + 内容 */}
      <div className="grid min-h-0 min-w-0 grid-rows-[48px_1fr] overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-5">
          <div className="text-sm font-semibold">{ADMIN_LABELS[tab] ?? '管理'}</div>
          <div className="flex items-center gap-3">
            <span className="text-xs opacity-60">{user.username}</span>
            <Button variant="ghost" size="sm" onClick={() => void navigate({ to: '/home' })}>
              返回前台
            </Button>
            <Button variant="outline" size="sm" onClick={() => void doLogout()}>
              退出登录
            </Button>
          </div>
        </header>
        <div className="min-h-0 overflow-auto bg-[var(--cy-surface-base)]">
          {tab === 'traces' && <TraceList />}
          {tab === 'outbox' && <OutboxView />}
          {tab === 'scores' && <ScoreTrend />}
          {tab === 'prompts' && <PromptList />}
          {tab === 'basic' && <BasicSettingsPage />}
          {tab === 'kbcfg' && <SchemaForm file="kb_settings" />}
          {tab === 'vstore' && <VectorStorePage />}
          {tab === 'kbmanage' && <KbManagePage />}
          {tab === 'modelcfg' && <SchemaForm file="model_settings" />}
          {tab === 'prompttpl' && <SchemaForm file="prompt_settings" />}
          {tab === 'defaults' && <DefaultModelsPage />}
          {tab === 'platforms' && <MarketplacePage embedded />}
          {tab === 'services' && <SystemServicesPage />}
          {tab === 'topology' && <ServiceTopologyPage />}
          {tab === 'users' && <UsersPage />}
          {tab === 'roles' && <RoleManagementPage />}
          {tab === 'mcp' && <McpPage />}
          {tab === 'tools' && <ToolsBoard selectable={false} />}
          {tab === 'ws' && <WsEndpointsPage />}
          {tab === 'apps' && <AppsPage />}
          {tab === 'kbacl' && <KbAclPage />}
          {tab === 'perf' && <PerformancePage />}
          {tab === 'redis' && <RedisConfigPage />}
          {tab === 'storage' && <StorageConfigPage />}
          {tab === 'database' && <DatabaseConfigPage />}
          {tab === 'datadir' && <DataDirPage />}
          {tab === 'deployment' && <DeploymentStatusPanel />}
        </div>
      </div>

      {/* 控制台脱离 Chrome,需自挂确认/输入/错误弹窗根,否则域内确认框无处渲染 */}
      <ConfirmRoot />
      <PromptRoot />
      <ErrorDialogRoot />
    </div>
  );
};

const TabButton: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon: Icon, label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
    )}
  >
    <Icon className="h-4 w-4" />
    {label}
  </button>
);

const TraceList: React.FC = () => {
  // 先尝试调后端代理；失败 fallback 到本地聚合
  const remote = useLfTraces({ limit: 100 });
  const local = useLocalTraces();
  const health = useLfHealth();
  const open = (traceId: string) => {
    const url = deepLinkTrace(traceId);
    if (url) void getPlatform().shell.openExternal(url);
  };

  const remoteOk = remote.data?.data && remote.data.data.length > 0;
  if (remote.isLoading && !remote.data) {
    return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-1.5 text-xs">
        <span>
          数据源：
          <span className="ml-1 font-medium">{remoteOk ? 'Langfuse 代理' : '本地聚合（fallback）'}</span>
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium',
            health.data?.reachable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
          )}
        >
          Langfuse {health.data?.reachable ? '在线' : '不可达'}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/60 text-xs">
          <tr>
            <th className="px-4 py-2 text-left">时间</th>
            <th className="px-4 py-2 text-left">名称 / 会话</th>
            <th className="px-4 py-2 text-left">用户</th>
            <th className="px-4 py-2 text-left">延迟</th>
            <th className="px-4 py-2 text-left">trace_id</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {remoteOk
            ? remote.data!.data.map((t) => (
                <tr key={t.id} className="border-b hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {t.timestamp ? new Date(t.timestamp).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {t.name ?? 'chat'}
                    {t.sessionId && <span className="ml-1 text-xs text-muted-foreground">· {t.sessionId.slice(0, 8)}</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{t.userId ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{typeof t.latency === 'number' ? `${(t.latency * 1000).toFixed(0)}ms` : '—'}</td>
                  <td className="px-4 py-2 font-mono text-[10px]">{t.id.slice(0, 8)}…</td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" onClick={() => open(t.id)} aria-label="在 Langfuse 查看">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            : local.data?.map((r) => (
                <tr key={r.traceId} className="border-b hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{r.conversationTitle ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">本地</td>
                  <td className="px-4 py-2 text-xs">—</td>
                  <td className="px-4 py-2 font-mono text-[10px]">{r.traceId.slice(0, 8)}…</td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" onClick={() => open(r.traceId)} aria-label="在 Langfuse 查看">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
          {!remoteOk && !local.data?.length && (
            <tr>
              <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                暂无 trace
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const OutboxView: React.FC = () => {
  const q = useOutboxStat();
  return (
    <div className="space-y-3 p-6">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs text-muted-foreground">待上传事件</div>
        <div className="mt-1 text-3xl font-bold">
          {q.data?.pending ?? 0}
          <span className="ml-2 text-xs text-muted-foreground">条</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          每 30s 自动 flush；如长期 &gt; 100，请检查 Langfuse 服务可达性。
        </p>
      </div>
    </div>
  );
};

const PromptList: React.FC = () => {
  const q = useLfPrompts({ limit: 100 });
  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;
  if (q.isError) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        无法加载 prompt 列表（后端 /admin/prompts 不可达）。
      </div>
    );
  }
  const prompts = q.data?.data ?? [];
  if (!prompts.length) return <div className="p-6 text-sm text-muted-foreground">暂无 prompt</div>;
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-muted/60 text-xs">
        <tr>
          <th className="px-4 py-2 text-left">名称</th>
          <th className="px-4 py-2 text-left">版本</th>
          <th className="px-4 py-2 text-left">标签</th>
          <th className="px-4 py-2 text-left">最后更新</th>
        </tr>
      </thead>
      <tbody>
        {prompts.map((p) => (
          <tr key={p.name} className="border-b hover:bg-muted/30">
            <td className="px-4 py-2 font-medium">{p.name}</td>
            <td className="px-4 py-2">v{Math.max(0, ...(p.versions ?? [0]))}</td>
            <td className="px-4 py-2">
              {(p.labels ?? []).map((l) => (
                <span key={l} className="mr-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {l}
                </span>
              ))}
            </td>
            <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
              {p.lastUpdated ? new Date(p.lastUpdated).toLocaleString() : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
