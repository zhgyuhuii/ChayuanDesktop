import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { setPlatform } from '@chayuan/platform-shared';
import { createTauriPlatform } from '@chayuan/platform-tauri';
import { Shell } from '@chayuan/app';
import '@chayuan/ui/styles.css';

const APP_VERSION =
  // @ts-expect-error injected by vite define
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';

// 瘦客户端模式（thin desktop）：
// 通过 ``VITE_THIN_CLIENT=1`` 在构建时切换到 "登录到远端服务器" 形态。
// 在这种形态下：
//   * 不附带任何 Python sidecar（产物只有 webview shell + js bundle，~15 MB）
//   * 启动后弹出 ``ServerLoginModal``，由用户填入远端服务地址 + 凭据
//   * 默认 ``apiBase`` 留空（让 ``apiBaseOverride`` 接管）
const THIN_CLIENT = String(import.meta.env.VITE_THIN_CLIENT || '') === '1';
const FALLBACK_API_BASE =
  import.meta.env.VITE_API_BASE || (THIN_CLIENT ? '' : 'http://127.0.0.1:7861');

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
