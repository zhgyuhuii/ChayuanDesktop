import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { TooltipProvider } from '@chayuan/ui';
import { configureClient } from '@chayuan/api';
import {
  configureObservability,
  Events,
  initSentry,
  logEvent,
  startWebVitals,
} from '@chayuan/observability';
import { getPlatform } from '@chayuan/platform-shared';
import { initI18n } from '@chayuan/i18n';
import { queryClient } from './lib/queryClient';
import { useAuthStore } from './store/auth';
import { useSettingsStore, resolveLocale } from './store/settings';
import { ThemeBridge } from './features/settings/ThemeBridge';
import { LocaleBridge } from './features/settings/LocaleBridge';
import { prefetchCatalog } from './features/catalog/useCatalog';
import { reportError } from './store/errorDialog';
import { useLoginModalStore } from './store/loginModal';
import { auth as authApi } from '@chayuan/api';
import { createAppRouter } from './router';
import { PreviewMount } from './features/preview';
import { LoginModal } from './features/auth/LoginModal';
import { ServerLoginModal } from './features/auth/ServerLoginModal';
import { useThinClientStore } from './store/thinClient';
import { FirstRunSetup } from './features/first-run/FirstRunSetup';
import { SidecarGate } from './features/first-run/SidecarGate';
import {
  isSingleMachineMode,
  useSingleMachineMode,
} from './features/first-run/useSingleMachineMode';

export interface ShellEnv {
  apiBase: string;
  /** 可选；缺省禁用 */
  sentryDsn?: string;
  langfuse: {
    enabled: boolean;
    host: string;
    publicKey: string;
    projectId: string;
    env?: 'dev' | 'staging' | 'prod';
  };
  /**
   * 瘦客户端模式：桌面安装包不带 sidecar python，启动时弹 ServerLoginModal
   * 让用户输入"服务器地址 + 凭据"。
   * 默认 false（向后兼容现有桌面构建）。
   */
  thinClient?: boolean;
}

/**
 * Shell：一次性引导（client / observability / theme），其余交给 TanStack Router。
 *
 * - router 实例 useRef，整个应用生命周期不重建。
 * - 所有页面切换通过 useNavigate；登录/admin 守卫在路由 beforeLoad 完成。
 */
export const Shell: React.FC<{ env: ShellEnv }> = ({ env }) => {
  const routerRef = React.useRef<ReturnType<typeof createAppRouter> | null>(null);
  if (!routerRef.current) routerRef.current = createAppRouter(queryClient);

  const telemetry = useSettingsStore((s) => s.telemetry);
  const apiOverride = useSettingsStore((s) => s.apiBaseOverride);
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrated = useAuthStore((s) => s.hydrated);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const authRequired = useLoginModalStore((s) => s.authRequired);
  const locale = useSettingsStore((s) => s.locale);
  const thinClientEnabled = !!env.thinClient;
  const setThinClientEnabled = useThinClientStore((s) => s.setEnabled);
  const requireServerLoginGate = useThinClientStore((s) => s.requireServerLoginGate);
  const finishServerLogin = useThinClientStore((s) => s.finishServerLogin);
  const requireServerLogin = useThinClientStore((s) => s.requireServerLogin);

  // 同步初始化 i18n;在 Router 渲染前完成,避免空翻译闪烁。
  // initI18n 是幂等的,locale 变化时由 LocaleBridge 接管。
  // 'system' 偏好在此解析为具体 AppLocale。
  const [i18nReady, setI18nReady] = React.useState(false);
  React.useEffect(() => {
    void initI18n({ locale: resolveLocale(locale) }).then(() => setI18nReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 瘦客户端模式：
  //   * 启动时如果 ``apiBaseOverride`` 还没配置（没填过服务器地址），弹 ServerLoginModal；
  //   * 已经填过 + 已登录：直接进入应用；
  //   * 已经填过但未登录：进入应用后由现有 LoginModal 接管。
  React.useEffect(() => {
    setThinClientEnabled(thinClientEnabled);
    if (!thinClientEnabled) return;
    if (!hydrated) return;
    const hasServer = !!(apiOverride && apiOverride.trim());
    if (!hasServer) {
      requireServerLoginGate();
    } else if (!isLoggedIn) {
      requireServerLoginGate();
    } else {
      finishServerLogin();
    }
  }, [
    thinClientEnabled, hydrated, apiOverride, isLoggedIn,
    setThinClientEnabled, requireServerLoginGate, finishServerLogin,
  ]);

  // 单机模式 sidecar 永远跑在 127.0.0.1:7861,baseURL 直接走 env.apiBase
  // (= apps/desktop/src/main.tsx 里写死的 SINGLE_MACHINE_BASE)。
  // apiBaseOverride 只在 thin-client / 多用户场景下生效,避免 SidecarGate 异步
  // 设置 override 与 first-render configureClient 之间的 race(导致前几次请求
  // 拼空 baseURL → ipc.localhost/plugin:* 假象)。
  const sm = isSingleMachineMode();

  // 同步早配置:client.ts cfg.baseURL 默认是 '',如果只在 useEffect 里 configureClient,
  // 子组件 mount 时如果有 useQuery 提前打的请求(react-query 在 mount 时立刻发),
  // 那一波拿到的 cfg.baseURL 是空,请求拼成相对路径走到 ipc.localhost。
  // useState 的 initializer 只跑一次,在 children 渲染之前就完成 — 关键的零延迟点。
  React.useState(() => {
    const effectiveBase = sm ? env.apiBase : (apiOverride || env.apiBase);
    configureClient({ baseURL: effectiveBase, timeoutMs: 30_000 });
    return null;
  });

  React.useEffect(() => {
    const p = getPlatform();
    const effectiveBase = sm ? env.apiBase : (apiOverride || env.apiBase);
    configureClient({ baseURL: effectiveBase, timeoutMs: 30_000 });
    configureObservability({
      enabled: telemetry && env.langfuse.enabled,
      host: env.langfuse.host,
      publicKey: env.langfuse.publicKey,
      projectId: env.langfuse.projectId,
      release: p.runtime.release,
      env: env.langfuse.env,
    });
    if (telemetry && env.sentryDsn) {
      void initSentry({
        enabled: true,
        dsn: env.sentryDsn,
        release: p.runtime.release,
        env: (env.langfuse.env ?? 'dev') as 'dev' | 'staging' | 'prod',
      });
    }
    if (telemetry) void startWebVitals();
    void hydrate();
    logEvent(Events.AppBoot, { metadata: { release: p.runtime.release, kind: p.kind } });
  }, [env, telemetry, apiOverride, hydrate, sm]);

  React.useEffect(() => {
    if (isLoggedIn) void prefetchCatalog(queryClient);
  }, [isLoggedIn]);

  // 探测后端鉴权策略:auth_required=true 且未登录 → 全局门禁 + lock 登录弹框。
  // hydrate 完成后才判断,避免有效 token 被误锁
  React.useEffect(() => {
    if (!hydrated) return;
    // 单机模式:后端 ``apply_single_machine`` 已经把 AUTH_REQUIRED 关掉,
    // 这里跳过 ``/auth/config`` 探测,直接置零防止任何 lock 触发。
    if (isSingleMachineMode()) {
      const { setLocked, setAllowRegistration, setAuthRequired } =
        useLoginModalStore.getState();
      setAuthRequired(false);
      setLocked(false);
      setAllowRegistration(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await authApi.config();
        if (cancelled) return;
        const { lock, setLocked, setAllowRegistration, setAuthRequired } = useLoginModalStore.getState();
        setAllowRegistration(cfg.auth_allow_registration);
        setAuthRequired(Boolean(cfg.auth_required));
        if (cfg.auth_required && !useAuthStore.getState().isLoggedIn) {
          lock();
        } else {
          setLocked(false);
        }
      } catch {
        // 拉不到配置当作非强制,但必须显式结束 policy 探测,避免卡白屏。
        useLoginModalStore.getState().setAuthRequired(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 登录后 isLoggedIn 切 true → 重跑一次,把 lock 解掉
  }, [hydrated, isLoggedIn]);

  const authGateActive = authRequired === true && !isLoggedIn;

  React.useEffect(() => {
    if (authGateActive) {
      queryClient.clear();
      useLoginModalStore.getState().lock();
    }
  }, [authGateActive]);

  // 兜底未捕获错误,统一弹 ErrorDialog;避免裸 alert / 浏览器空白
  React.useEffect(() => {
    const onUnhandled = (e: PromiseRejectionEvent) => {
      // BizError.kind === 'auth' 不弹:LoginModal 已经在路由守卫里接管
      const reason = e.reason as { kind?: string } | undefined;
      if (reason?.kind === 'auth') return;
      reportError(e.reason, '未处理的异常');
    };
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, '运行时错误');
    window.addEventListener('unhandledrejection', onUnhandled);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('error', onError);
    };
  }, []);

  // 单机版首启动门禁(Phase 1 + Phase 3):
  //   1) 数据目录未选定前先弹 FirstRunSetup
  //   2) 选定后由 SidecarGate 启起 chayuan-server 子进程,等 /healthz 就绪
  //   3) 都就绪了再挂主路由,避免业务请求打到没拿到 CHAYUAN_ROOT 的 sidecar。
  // Web 构建直接放行(``platform.dataDir`` / ``platform.sidecar`` 为 undefined)。
  const [dataDirReady, setDataDirReady] = React.useState(false);
  const [dataDirPath, setDataDirPath] = React.useState<string>('');
  const [sidecarReady, setSidecarReady] = React.useState(false);
  const handleDataDirConfigured = React.useCallback(
    (s: { path: string }) => {
      setDataDirPath(s.path);
      setDataDirReady(true);
    },
    [],
  );
  const handleSidecarReady = React.useCallback(
    (baseUrl: string) => {
      // 已知 sidecar baseUrl(disabled / web 时为空字符串)→ 覆盖 apiBaseOverride,
      // useEffect 监听到变更会自动重新 configureClient。
      if (baseUrl) {
        useSettingsStore.getState().setApiBaseOverride(baseUrl);
      }
      setSidecarReady(true);
    },
    [],
  );

  // **必须**在任何 early return 之前调用所有 hook,否则首次/后续 render
  // 之间 hook 数量不一致,React 抛 #310 (Rendered more hooks than during the
  // previous render)。useSingleMachineMode 内部调 useThinClientStore (zustand
  // hook),也算 hook。 — 单机版 v0 排查白屏踩到的坑。
  const singleMachine = useSingleMachineMode();

  if (!i18nReady || !hydrated || authRequired === null) {
    return <AuthBootScreen />;
  }

  if (!dataDirReady) {
    return <FirstRunSetup onConfigured={handleDataDirConfigured} />;
  }

  if (!sidecarReady) {
    return <SidecarGate dataDir={dataDirPath} onReady={handleSidecarReady} />;
  }

  // 瘦客户端门禁：在 ServerLoginModal 闭合前不挂载主路由（避免业务请求打到没配置的 baseURL）
  const thinClientGateActive = thinClientEnabled && requireServerLogin;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeBridge />
        <LocaleBridge />
        {thinClientGateActive ? (
          <ThinClientGateBackdrop />
        ) : authGateActive ? (
          <AuthRequiredMask />
        ) : (
          <>
            <RouterProvider router={routerRef.current} />
            <PreviewMount />
          </>
        )}
        {thinClientEnabled && <ServerLoginModal />}
        {!singleMachine && <LoginModal />}
      </TooltipProvider>
    </QueryClientProvider>
  );
};

const ThinClientGateBackdrop: React.FC = () => (
  <div className="relative h-screen w-screen overflow-hidden bg-[var(--cy-surface-2,#f8fafc)]">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(99,102,241,0.10),transparent_32%),radial-gradient(circle_at_75%_75%,rgba(14,165,233,0.10),transparent_30%)]" />
  </div>
);

const AuthBootScreen: React.FC = () => (
  <div className="relative h-screen w-screen overflow-hidden bg-[var(--cy-surface-2,#f8fafc)]">
    <div
      className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_30%_25%,rgba(99,102,241,0.18),transparent_38%),radial-gradient(circle_at_75%_75%,rgba(14,165,233,0.18),transparent_35%)]"
      style={{ animationDuration: '6s' }}
    />
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
      <div className="relative">
        <div
          className="absolute -inset-6 animate-ping rounded-full bg-[var(--cy-brand-500,#6366f1)]/30 blur-2xl"
          style={{ animationDuration: '2.4s' }}
        />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--cy-brand-500,#6366f1)] to-[var(--cy-brand-700,#4338ca)] text-2xl font-bold text-white shadow-[0_12px_40px_rgba(99,102,241,0.45)]">
          察
        </div>
      </div>
      <p className="text-sm text-[var(--cy-text-secondary,#64748b)]">
        正在初始化
        <span className="ml-0.5 inline-flex">
          <span className="animate-bounce" style={{ animationDelay: '-0.3s' }}>.</span>
          <span className="animate-bounce" style={{ animationDelay: '-0.15s' }}>.</span>
          <span className="animate-bounce">.</span>
        </span>
      </p>
    </div>
  </div>
);

const AuthRequiredMask: React.FC = () => (
  <div className="relative h-screen w-screen overflow-hidden bg-[var(--cy-surface-2,#f8fafc)]">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.08),transparent_32%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.08),transparent_30%)]" />
    <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
      <div className="max-w-md rounded-3xl border border-[var(--cy-border-subtle,#e2e8f0)] bg-[var(--cy-surface-base,#fff)]/80 p-8 shadow-[var(--cy-shadow-lg,0_24px_80px_rgba(15,23,42,0.12))] backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--cy-brand-500,#6366f1)] text-lg font-bold text-white">
          察
        </div>
        <h1 className="text-xl font-semibold text-[var(--cy-text-primary,#0f172a)]">需要登录后使用</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--cy-text-secondary,#475569)]">
          当前系统已开启登录验证。登录前不会加载或展示任何业务数据。
        </p>
      </div>
    </div>
  </div>
);
