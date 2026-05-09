import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { setPlatform } from '@chayuan/platform-shared';
import { createWebPlatform } from '@chayuan/platform-web';
import { Shell } from '@chayuan/app';
import '@chayuan/ui/styles.css';

const APP_VERSION =
  // @ts-expect-error injected by vite define
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';

// 瘦客户端模式标志：
// * 编译期：``VITE_THIN_CLIENT=1`` （桌面瘦壳走这条）；
// * 运行期：URL 带 ``?thinClient=1`` （Playwright e2e 用这条，不必另起 vite）。
const THIN_CLIENT = (() => {
  const fromEnv = String(import.meta.env.VITE_THIN_CLIENT || '') === '1';
  if (fromEnv) return true;
  if (typeof window !== 'undefined' && window.location?.search) {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('thinClient') === '1';
  }
  return false;
})();

// baseURL 取空串时,fetch 走同源相对路径:
//   - dev 模式:vite dev server 5173 端口的 proxy 把 /v1/* 等转发到 62581(见 vite.config.ts)
//   - prod 模式:nginx/任意反代把 client 与 server 部署到同 host
// VITE_API_BASE 显式覆盖优先(用于跨主机部署)
const platform = createWebPlatform({
  appName: '察元 AI',
  appVersion: APP_VERSION,
  defaultApiBase: import.meta.env.VITE_API_BASE || '',
});
setPlatform(platform);

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <Shell
      env={{
        apiBase: import.meta.env.VITE_API_BASE || '',
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

// 启动 splash 退场:等下一帧 React 已经把首屏 paint 上去后再淡出,避免
// 「splash 消失 + 业务首帧」之间出现一帧空白。CSS transition 360ms 完成
// 后从 DOM 删除,彻底放掉动画线程。
requestAnimationFrame(() => {
  const splash = document.getElementById('chayuan-splash');
  if (!splash) return;
  splash.classList.add('cy-splash-fading');
  setTimeout(() => splash.remove(), 420);
});
