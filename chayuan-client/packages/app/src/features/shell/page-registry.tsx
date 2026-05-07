/**
 * 路径 → 页面组件 注册表(M1 多 Tab 工作区核心)。
 *
 * 设计:
 *   - 每个一级路径对应一个 lazy 加载的页面组件;
 *   - render() 返回 ReactNode,以及 onActivate(可选)用于 Tab 激活时同步副作用
 *     (例:Chat 路径同步 composerStore.activeConversationId)。
 *
 * 添加新页型:
 *   1. 在 routes 文件夹写好 PageComponent;
 *   2. 在此追加 RouteEntry;
 *   3. Sidebar 里加 NavLink 调用 useTabsStore.open(path)。
 */

import * as React from 'react';
import { tabsStaticTitle } from './tab-titles';

export interface RouteParams {
  [key: string]: string;
}

export interface RouteEntry {
  /** 静态前缀(优先精确匹配)或正则 */
  pattern: RegExp;
  /** 返回 React 节点 */
  render(params: RouteParams, path: string): React.ReactNode;
  /** Tab 激活时执行的副作用(此处可读取 store 设置 active 资源 id 等) */
  onActivate?(params: RouteParams, path: string): void;
  /** Tab 默认标题(可被 open 时的 opts.title 覆盖)*/
  defaultTitle?: string;
  /** 默认图标(lucide 名);Sidebar / TabBar 都可读 */
  defaultIcon?: string;
}

const HomePage = React.lazy(() =>
  import('../home/HomePage').then((m) => ({ default: m.HomePage })),
);
const ChatPage = React.lazy(() =>
  import('../chat/ChatPage').then((m) => ({ default: m.ChatPage })),
);
const KbPage = React.lazy(() =>
  import('../kb/KbBoard').then((m) => ({ default: m.KbBoard })),
);
const KbDetailPage = React.lazy(() =>
  import('../kb/detail/KbDetailPage').then((m) => ({ default: m.KbDetailPage })),
);
const MarketplacePage = React.lazy(() =>
  import('../marketplace/MarketplacePage').then((m) => ({ default: m.MarketplacePage })),
);
const HistoryPage = React.lazy(() =>
  import('../history/HistoryPage').then((m) => ({ default: m.HistoryPage })),
);
const AnnotationPage = React.lazy(() =>
  import('../annotation/AnnotationPage').then((m) => ({ default: m.AnnotationPage })),
);
const SettingsAsPage = React.lazy(() =>
  import('../placeholders/SettingsAsPage').then((m) => ({ default: m.SettingsAsPage })),
);
const McpPage = React.lazy(() =>
  import('../mcp/McpBoard').then((m) => ({ default: m.McpBoard })),
);
const ToolsPage = React.lazy(() =>
  import('../tools/ToolsBoard').then((m) => ({ default: m.ToolsBoard })),
);
const AdminPage = React.lazy(() =>
  import('../admin/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const SkillTemplate = React.lazy(() =>
  import('../skill/SkillTemplate').then((m) => ({ default: m.SkillTemplate })),
);

export const ROUTE_ENTRIES: ReadonlyArray<RouteEntry> = [
  {
    pattern: /^\/home$/,
    render: () => <HomePage />,
    defaultTitle: 'nav.home',
    defaultIcon: 'home',
  },
  {
    pattern: /^\/chat$/,
    render: () => <ChatPage />,
    onActivate: () => {
      // 草稿入口:清空 activeConversationId,让 ChatPage 渲染欢迎屏。
      // 用户首次发消息时 handleSend 才 lazy upsert + 把本 tab 的 path
      // 替换成 /chat/<id>,reload 后能正确定位到该会话。
      void import('../../store/composer').then(({ useComposerStore }) => {
        useComposerStore.getState().setActive(null);
      });
    },
    defaultTitle: 'nav.newChat',
    defaultIcon: 'message-square',
  },
  {
    pattern: /^\/chat\/(?<id>[^/]+)$/,
    render: () => <ChatPage />,
    onActivate: (params) => {
      // 同步 composerStore;ChatPage 内部据此恢复历史消息
      const id = params.id;
      if (!id) return;
      void import('../../store/composer').then(({ useComposerStore }) => {
        useComposerStore.getState().setActive(id);
      });
    },
    defaultIcon: 'message-square',
  },
  {
    pattern: /^\/kb$/,
    render: () => <KbPage />,
    defaultTitle: 'nav.knowledge',
    defaultIcon: 'library',
  },
  {
    // 单个 KB 独立 Tab(由 KbBoard 卡片点击触发)
    // ku_id 形如 'doc:foo' / 'src:42';URL-encoded 后做 path param,所以用 [^/]+
    pattern: /^\/kb\/(?<kuId>[^/]+)$/,
    render: (params) => <KbDetailPage kuId={decodeURIComponent(params.kuId ?? '')} />,
    onActivate: (params) => {
      // 进入 KB tab 时把 composer 选中态锁到当前 KB,顶部 picker / 底部 ask 都跟着走
      const id = decodeURIComponent(params.kuId ?? '');
      if (!id) return;
      void import('../../store/composer').then(({ useComposerStore }) => {
        useComposerStore.getState().setKuIds([id]);
      });
    },
    defaultIcon: 'library',
  },
  {
    pattern: /^\/marketplace$/,
    render: () => <MarketplacePage />,
    defaultTitle: 'nav.modelMarket',
    defaultIcon: 'box',
  },
  {
    pattern: /^\/history$/,
    render: () => <HistoryPage />,
    defaultTitle: 'nav.history',
    defaultIcon: 'clock',
  },
  {
    pattern: /^\/annotation$/,
    render: () => <AnnotationPage />,
    defaultTitle: '训练数据中心',
    defaultIcon: 'tag',
  },
  {
    pattern: /^\/settings$/,
    render: () => <SettingsAsPage />,
    defaultTitle: 'nav.settings',
    defaultIcon: 'settings',
  },
  {
    pattern: /^\/mcp$/,
    render: () => <McpPage />,
    defaultTitle: 'mcp.title',
    defaultIcon: 'plug',
  },
  {
    pattern: /^\/tools$/,
    render: () => <ToolsPage />,
    defaultTitle: 'tools.title',
    defaultIcon: 'wrench',
  },
  {
    pattern: /^\/skill\/(?<slug>[^/]+)$/,
    render: (params) => <SkillTemplate slug={params.slug ?? ''} />,
    defaultIcon: 'message-square',
  },
  {
    pattern: /^\/admin\/(?<tab>traces|outbox|prompts|platforms)$/,
    render: (params) => (
      <AdminPage
        tab={(params.tab ?? 'traces') as 'traces' | 'outbox' | 'prompts' | 'scores' | 'platforms'}
        onClose={() => history.back()}
      />
    ),
    defaultIcon: 'shield',
  },
];

/** 解析 path,返回 entry + params;命中不到时返回 null */
export function resolveRoute(
  path: string,
): { entry: RouteEntry; params: RouteParams } | null {
  const pathname = path.split(/[?#]/, 1)[0] || path;
  for (const entry of ROUTE_ENTRIES) {
    const m = entry.pattern.exec(pathname);
    if (m) {
      const params: RouteParams = { ...(m.groups ?? {}) };
      return { entry, params };
    }
  }
  return null;
}

/** 由 path 推导默认 title;未命中返回原 path */
export function deriveTitle(path: string): string {
  const r = resolveRoute(path);
  if (!r) return path;
  return r.entry.defaultTitle ?? tabsStaticTitle(path) ?? path;
}

/** 由 path 推导默认图标 key */
export function deriveIcon(path: string): string | undefined {
  return resolveRoute(path)?.entry.defaultIcon;
}
