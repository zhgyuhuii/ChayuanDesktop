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

/**
 * splash 收尾 — 双轨:
 *   ① **独立 splashscreen 窗口** (推荐):tauri.conf.json 配两个 window,
 *     主窗口初始 visible:false,前端首屏 paint 后 invoke('chayuan_close_splashscreen')
 *     → Rust 端 close splash + show main。这是用户感知的"启动动画"主路径,
 *     完全不受 vite bundle 下载时长影响。
 *   ② **inline splash DOM**(legacy):index.html 内嵌的 #chayuan-splash,
 *     在主窗口已经显示后,React 接管 DOM 时 hideSplash() fade out 它。
 *     新方案下主窗口启动是 invisible,这条路其实只对 web app 和 thin client
 *     模式有意义。保留以免回退。
 *
 * 30 秒兜底:Rust 端独立 timer 也兜底(setup 里 spawn 的 thread),双保险。
 */
async function dismissSplash(): Promise<void> {
  hideSplash();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('chayuan_close_splashscreen');
  } catch (e) {
    // 非 Tauri 环境(web/dev preview)或 command 未注册 — 静默,inline splash 已 fade
    console.debug('[splash] close_splashscreen invoke 不可达:', e);
  }
}
(window as unknown as { __cyHideSplash?: () => void }).__cyHideSplash =
  dismissSplash;
window.setTimeout(dismissSplash, 8000);

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
