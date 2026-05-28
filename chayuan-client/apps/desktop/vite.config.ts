import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) =>
  path.resolve(__dirname, `../../packages/${name}/src/index.ts`);

/**
 * @chayuan/* workspace 包统一别名到源码 src/index.ts(同 apps/web)。
 * 解决 Windows + pnpm + Vite 走 symlink 链时偶发的解析失败。
 *
 * 注意:subpath alias 必须排在裸路径正则前面 — Vite 按声明序匹配。
 * `@chayuan/ui/styles.css` 不能走 package.json#exports:Tauri WebView2
 * + pnpm symlink 下 subpath 解析会偶发拿不到,导致 Tailwind 整片不生效。
 */
const chayuanAliases = [
  {
    find: '@chayuan/ui/styles.css',
    replacement: path.resolve(__dirname, '../../packages/ui/src/styles/globals.css'),
  },
  { find: /^@chayuan\/api$/, replacement: pkg('api') },
  { find: /^@chayuan\/app$/, replacement: pkg('app') },
  { find: /^@chayuan\/design-tokens$/, replacement: pkg('design-tokens') },
  { find: /^@chayuan\/i18n$/, replacement: pkg('i18n') },
  { find: /^@chayuan\/observability$/, replacement: pkg('observability') },
  { find: /^@chayuan\/platform-shared$/, replacement: pkg('platform-shared') },
  { find: /^@chayuan\/platform-tauri$/, replacement: pkg('platform-tauri') },
  { find: /^@chayuan\/transport$/, replacement: pkg('transport') },
  { find: /^@chayuan\/ui$/, replacement: pkg('ui') },
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: chayuanAliases },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: process.env.TAURI_DEV_HOST || false,
      // 阻断 file watcher 进 src-tauri:Rust 编译产物 + PyInstaller 打的
      // chayuan-server bundle 都在那下面,nicegui Jinja 模板 / playwright /
      // setuptools fixture html 全是非 JS 内容,被 watcher 触发 HMR 会让
      // esbuild 反复尝试解析 → 报 "Expected identifier but found {"。
      watch: {
        ignored: [
          '**/src-tauri/target/**',
          '**/src-tauri/chayuan-server/**',
          '**/src-tauri/bundled_models/**',
          '**/src-tauri/gen/**',
        ],
      },
    },
    // 锁死 optimizeDeps 入口扫描范围 — 默认会 glob root 下 **/*.html,把
    // src-tauri/chayuan-server/_internal/{nicegui,setuptools,playwright}/**/*.html
    // 抓进来当 entry,nicegui 模板含 Jinja {{ ... }} 让 esbuild 解析报语法错。
    // 显式指定 index.html 后,vite 只用它作 entry 跟随 import 链,不再 glob。
    //
    // exclude: workspace 包(@chayuan/*)已经在 resolve.alias 里指到源码
    // src/index.ts,不需要 esbuild 当 npm package 预构建。每次 dev 启动
    // 跳过它们能省 cold-start 几秒,且避免源码改动触发依赖重新优化引发的
    // 504 Outdated Optimize Dep / full reload 抖动。
    optimizeDeps: {
      entries: ['index.html'],
      exclude: [
        '@chayuan/api',
        '@chayuan/app',
        '@chayuan/design-tokens',
        '@chayuan/i18n',
        '@chayuan/observability',
        '@chayuan/platform-shared',
        '@chayuan/platform-tauri',
        '@chayuan/transport',
        '@chayuan/ui',
      ],
    },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
      target:
        process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      outDir: 'dist',
    },
    define: {
      __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || '0.1.0'),
    },
  };
});
