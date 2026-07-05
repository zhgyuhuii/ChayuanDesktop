export { Shell, type ShellEnv } from './Shell';
// SKU 注入 seam 公开面（§3.7）：新 SKU 用这些类型构造 brand + routeExtensions
export type { BrandConfig } from './brand/types';
export type { RouteEntry, RouteParams } from './features/shell/page-registry';
export { ScreenshotOverlayApp } from './features/composer/ScreenshotOverlayApp';
export { useAuthStore } from './store/auth';
export { useComposerStore } from './store/composer';
export { useSettingsStore, type ThemeMode } from './store/settings';
export { ChatPage } from './features/chat/ChatPage';
export { useChayuanChat } from './features/chat/useChayuanChat';
export type { ChatMessage } from './features/chat/useChayuanChat';
export {
  registerToolCard,
  registerToolCardPattern,
  ToolCallCard,
  type ToolCard,
  type ToolCallProps,
} from './features/chat/toolcards/registry';
