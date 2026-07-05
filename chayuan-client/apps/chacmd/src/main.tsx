import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { setPlatform } from '@chayuan/platform-shared';
import { createWebPlatform } from '@chayuan/platform-web';
import { Shell } from '@chayuan/app';
import { chacmdBrand } from '@chayuan/chacmd-features';
import '@chayuan/ui/styles.css';
import { ensureSplash, hideSplash } from './splash';

// ChaCMD 指挥台 SKU 入口。
// 与 apps/web 的唯一区别：给 Shell 注入 env.brand = chacmdBrand（§3.7 注入 seam）——
// 落地页从 /home 改到 /command（指挥大屏），路由扩展注入 /command。
// 首启门（FirstRunSetup→SidecarGate→登录）仍由 Shell 内部处理，本入口不碰，天然不绕过。
ensureSplash();

const APP_VERSION =
  // @ts-expect-error injected by vite define
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';

// 桌面 Tauri 打包时走瘦壳/单机由构建参数决定；web 预览默认非瘦客户端。
// 单机 sqlite 语义要求：desktop 构建保持 thinClient=false + 带 sidecar（见部署文档）。
const THIN_CLIENT = (() => {
  const fromEnv = String(import.meta.env.VITE_THIN_CLIENT || '') === '1';
  if (fromEnv) return true;
  if (typeof window !== 'undefined' && window.location?.search) {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('thinClient') === '1';
  }
  return false;
})();

const platform = createWebPlatform({
  appName: 'ChaCMD 指挥台',
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
        brand: chacmdBrand,
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

(window as unknown as { __cyHideSplash?: () => void }).__cyHideSplash = hideSplash;
window.setTimeout(hideSplash, 8000);
