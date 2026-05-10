import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { setPlatform } from '@chayuan/platform-shared';
import { createTauriPlatform } from '@chayuan/platform-tauri';
import { Shell } from '@chayuan/app';
import '@chayuan/ui/styles.css';
import { ensureSplash, hideSplash } from './splash';

// 入口最早调用:HTML 已经内联 splash 时本函数 no-op;任何原因导致 dist
// HTML 缺失 splash 节点时(stale -BundleOnly 缓存 / 第三方注入器 / SSR
// mismatch …) 这里立刻程序化补一个,确保用户看到的"首屏永远不空白"。
// 与 #app 同级 sibling,DOM 顺序在前。
ensureSplash();

const APP_VERSION =
  // @ts-expect-error injected by vite define
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';

// 瘦客户端模式（thin desktop）：
// 通过 ``VITE_THIN_CLIENT=1`` 在构建时切换到 "登录到远端服务器" 形态。
// 在这种形态下：
//   * 不附带任何 Python sidecar（产物只有 webview shell + js bundle，~15 MB）
//   * 启动后弹出 ``ServerLoginModal``，由用户填入远端服务地址 + 凭据
//   * 默认 ``apiBase`` 留空（让 ``apiBaseOverride`` 接管）
//
// 单机桌面默认形态(THIN_CLIENT=0):sidecar 永远跑在 127.0.0.1:62581(sidecar.rs
// 写死的 DEFAULT_PORT,IP 固定),写死即可,不再走 SidecarGate → apiBaseOverride
// 这条间接链路 — 减少首屏 race。VITE_API_BASE 仍然支持在 dev 时本地覆盖。
const THIN_CLIENT = String(import.meta.env.VITE_THIN_CLIENT || '') === '1';
const SINGLE_MACHINE_BASE = 'http://127.0.0.1:62581';
const FALLBACK_API_BASE =
  import.meta.env.VITE_API_BASE || (THIN_CLIENT ? '' : SINGLE_MACHINE_BASE);

// 暴露给 Shell:首次 useLayoutEffect 时调用,与 React 首屏 paint 自然 crossfade,
// 避免「splash 已淡出 + React 还没挂」的一帧空白窗口。8 秒安全兜底,防止
// 极端情况下(异步 import 失败 / sidecar 卡死)splash 永远停在屏幕上。
(window as unknown as { __cyHideSplash?: () => void }).__cyHideSplash = hideSplash;
window.setTimeout(hideSplash, 8000);

(async () => {
  const platform = await createTauriPlatform({
    appName: '察元 AI',
    appVersion: APP_VERSION,
    defaultApiBase: FALLBACK_API_BASE,
  });
  setPlatform(platform);

  const root = createRoot(document.getElementById('app')!);
  root.render(
    <React.StrictMode>
      <Shell
        env={{
          apiBase: FALLBACK_API_BASE,
          thinClient: THIN_CLIENT,
          langfuse: {
            enabled: !!import.meta.env.VITE_LF_PUBLIC_KEY,
            host: import.meta.env.VITE_LF_HOST ?? '',
            publicKey: import.meta.env.VITE_LF_PUBLIC_KEY ?? '',
            projectId: import.meta.env.VITE_LF_PROJECT_ID ?? '',
            env: (import.meta.env.MODE as 'dev' | 'staging' | 'prod') ?? 'dev',
          },
        }}
      />
    </React.StrictMode>,
  );
})();
