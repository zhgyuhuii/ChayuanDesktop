/**
 * 桌面专属集成 hook：
 *
 * - 全局快捷键 ⌘+Shift+Space → 打开 / 收起主窗口（通过 cy:open-cmdk）
 * - 全局快捷键 ⌘+Shift+S → 截图并粘贴到 composer
 * - 监听 cy:new-chat（来自托盘菜单）→ 路由跳新对话
 * - 流式完成且窗口最小化时 → 系统通知
 *
 * 仅在 platform.kind === 'desktop' 时挂载；Web 端 noop。
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getPlatform, isDesktop } from '@chayuan/platform-shared';
import { useComposerStore } from '../../store/composer';
// upsertConversation 之前在 onNewChat 预建会话用,改草稿模式后已不需要

export function useDesktopIntegrations(): void {
  const navigate = useNavigate();

  // 全局快捷键
  React.useEffect(() => {
    if (!isDesktop()) return;
    const platform = getPlatform();
    if (!platform.shortcut) return;

    const offers: Array<Promise<() => Promise<void>>> = [];
    offers.push(
      platform.shortcut.register('CmdOrCtrl+Shift+Space', () => {
        // 让 CommandPalette 自己监听该事件；与 ⌘K 复用
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
      }),
    );
    if (platform.capture) {
      offers.push(
        platform.shortcut.register('CmdOrCtrl+Shift+S', async () => {
          try {
            const blob = await platform.capture!.screenshot();
            // 粘贴到 composer：转 File → 走 useAttachments 不容易（需要在 composer 范围）；
            // 简化路径：派发自定义事件，由 ChatPage 拦截
            const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
            window.dispatchEvent(new CustomEvent('cy:paste-image', { detail: { file } }));
          } catch (e) {
            console.warn('screenshot failed', e);
          }
        }),
      );
    }
    return () => {
      offers.forEach((p) => p.then((off) => off()).catch(() => undefined));
    };
  }, []);

  // 来自 Rust 托盘的事件
  React.useEffect(() => {
    if (!isDesktop()) return;
    const onNewChat = async () => {
      // 草稿模式:不预建会话,等用户首次发消息时 ChatPage.handleSend 才 lazy upsert,
      // 与 Sidebar.onNewChat 一致;空对话不污染历史。
      useComposerStore.getState().setActive(null);
      void navigate({ to: '/chat' as never });
    };

    // Tauri 通过 webview emit;用 listen API。
    // app 包不直接依赖 @tauri-apps/api(它在 platform-tauri),走动态字符串 import 绕过 TS 模块解析。
    let cleanup: (() => void) | null = null;
    void (async () => {
      try {
        const winName = '@tauri-apps' + '/api/window';
        const winMod = (await import(/* @vite-ignore */ winName)) as {
          getCurrentWindow: () => {
            listen: (event: string, cb: () => void) => Promise<() => void>;
          };
        };
        const win = winMod.getCurrentWindow();
        const off = await win.listen('cy:new-chat', () => void onNewChat());
        cleanup = off;
      } catch {
        /* noop in non-tauri */
      }
    })();
    return () => cleanup?.();
  }, [navigate]);

  // 流式完成 + 窗口不可见 → 系统通知,提醒用户回来看
  // 订阅 composer.isStreaming 的 true → false 跳变;只在 document.hidden / 失焦时通知
  React.useEffect(() => {
    if (!isDesktop()) return;
    const platform = getPlatform();
    if (!platform.notify) return;

    let lastIsStreaming = useComposerStore.getState().isStreaming;
    const unsub = useComposerStore.subscribe((state) => {
      const cur = state.isStreaming;
      const prev = lastIsStreaming;
      lastIsStreaming = cur;
      // 只关心 true → false 完成跳变
      if (!(prev && !cur)) return;
      // 窗口可见且聚焦 → 用户在看,不打扰
      const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      const focused = typeof document !== 'undefined' && document.hasFocus();
      if (visible && focused) return;
      void platform.notify
        .show('察元 AI', '回答已生成,点击窗口查看')
        .catch((e) => console.warn('[notify] failed', e));
    });
    return () => unsub();
  }, []);
}
