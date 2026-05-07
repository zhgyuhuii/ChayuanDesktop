/**
 * Sidecar 启动门禁(Phase 3)。
 *
 * 在 ``FirstRunSetup`` 之后、主路由之前;Shell 把数据目录交给 sidecar,
 * 这里负责显示进度/失败 UI 并在 ``ready`` 后回调 ``onReady(baseUrl)``。
 *
 * 行为:
 *   - ``platform.sidecar`` 不存在(Web 构建)→ 直接 onReady,使用默认 ``baseUrl``
 *     (兜底:Web 构建一般不依赖本地后端,Shell 已有 ``apiBaseOverride`` 路径)
 *   - ``status() === 'disabled'``(dev 模式)→ 直接 onReady,前端走 7861 等
 *     开发者自己跑 ``poetry run chayuan start -a``
 *   - 否则:订阅事件 + 调 ``start()``,UI 显示启动日志,直至 state=ready 调
 *     ``onReady``;state=failed 时停在错误屏(显示退出码 / 最后 log + "重试")
 */

import { Button } from '@chayuan/ui';
import { AlertTriangle, Loader2 } from 'lucide-react';
import * as React from 'react';
import { getPlatform } from '@chayuan/platform-shared';
import type { SidecarStatus } from '@chayuan/platform-shared';

export interface SidecarGateProps {
  /** FirstRunSetup 选定的数据目录;sidecar 通过 CHAYUAN_ROOT 注入子进程 */
  dataDir: string;
  /** sidecar ready 后回调,Shell 据此 configureClient + 挂主路由 */
  onReady(baseUrl: string): void;
}

export const SidecarGate: React.FC<SidecarGateProps> = ({ dataDir, onReady }) => {
  const [status, setStatus] = React.useState<SidecarStatus | null>(null);
  const [logTail, setLogTail] = React.useState<string[]>([]);
  const onReadyRef = React.useRef(onReady);
  React.useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const startOnce = React.useCallback(async () => {
    const sidecar = getPlatform().sidecar;
    if (!sidecar) {
      // Web / 未注入 → 直接放行(默认 apiBase 由 ShellEnv 提供)
      onReadyRef.current('');
      return;
    }
    try {
      const initial = await sidecar.status();
      setStatus(initial);
      // 已 ready / disabled:直接放行
      if (initial.state === 'ready' || initial.state === 'disabled') {
        onReadyRef.current(initial.baseUrl);
        return;
      }
      const next = await sidecar.start({ dataDir });
      setStatus(next);
      if (next.state === 'ready' || next.state === 'disabled') {
        onReadyRef.current(next.baseUrl);
      }
    } catch (e) {
      setStatus((s) =>
        s
          ? { ...s, state: 'failed', error: (e as Error)?.message ?? String(e) }
          : null,
      );
    }
  }, [dataDir]);

  React.useEffect(() => {
    const sidecar = getPlatform().sidecar;
    if (!sidecar) {
      // Web → 立即放行
      onReadyRef.current('');
      return;
    }
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await sidecar.subscribe({
        onState: async (state) => {
          // 状态变化:重新拉一次 status 拿最新 baseUrl / error
          const cur = await sidecar.status().catch(() => null);
          if (cur) setStatus(cur);
          if (state === 'ready' || state === 'disabled') {
            onReadyRef.current(cur?.baseUrl ?? '');
          }
        },
        onLog: (line) => {
          setLogTail((prev) => {
            const next = [...prev, line];
            return next.length > 8 ? next.slice(next.length - 8) : next;
          });
        },
      });
      await startOnce();
    })();
    return () => {
      try {
        unlisten?.();
      } catch {
        /* noop */
      }
    };
  }, [startOnce]);

  // 渲染:starting / failed
  const state = status?.state ?? 'idle';

  if (state === 'failed') {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-[var(--cy-surface-2,#f8fafc)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(248,113,113,0.10),transparent_32%),radial-gradient(circle_at_75%_75%,rgba(251,146,60,0.10),transparent_30%)]" />
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-3xl border border-[var(--cy-border-subtle,#e2e8f0)] bg-[var(--cy-surface-base,#fff)]/95 p-8 shadow-[var(--cy-shadow-lg,0_24px_80px_rgba(15,23,42,0.12))] backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500 text-white">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-[var(--cy-text-primary,#0f172a)]">
                  后端服务启动失败
                </h1>
                <p className="text-xs text-[var(--cy-text-tertiary,#94a3b8)]">
                  数据目录:{status?.dataDir || dataDir}
                </p>
              </div>
            </div>
            {status?.error && (
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[var(--cy-surface-1,#f1f5f9)] p-3 text-xs text-[var(--cy-text-secondary,#475569)]">
                {status.error}
              </pre>
            )}
            {logTail.length > 0 && (
              <details className="mt-3 text-xs text-[var(--cy-text-tertiary,#64748b)]">
                <summary className="cursor-pointer">最近日志(8 行)</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--cy-surface-1,#f1f5f9)] p-3">
                  {logTail.join('\n')}
                </pre>
              </details>
            )}
            <div className="mt-6 flex justify-end">
              <Button size="sm" onClick={() => void startOnce()}>
                重试启动
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[var(--cy-surface-2,#f8fafc)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(99,102,241,0.10),transparent_32%),radial-gradient(circle_at_75%_75%,rgba(14,165,233,0.10),transparent_30%)]" />
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-[var(--cy-border-subtle,#e2e8f0)] bg-[var(--cy-surface-base,#fff)]/95 p-8 shadow-[var(--cy-shadow-lg,0_24px_80px_rgba(15,23,42,0.12))] backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--cy-brand-500,#6366f1)]" />
            <div>
              <h1 className="text-base font-semibold text-[var(--cy-text-primary,#0f172a)]">
                正在启动后端服务...
              </h1>
              <p className="text-xs text-[var(--cy-text-tertiary,#94a3b8)]">
                首次启动需要 10-30 秒(数据库迁移 / 索引初始化)
              </p>
            </div>
          </div>
          {logTail.length > 0 && (
            <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--cy-surface-1,#f1f5f9)] p-3 text-[10px] text-[var(--cy-text-tertiary,#64748b)]">
              {logTail.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
