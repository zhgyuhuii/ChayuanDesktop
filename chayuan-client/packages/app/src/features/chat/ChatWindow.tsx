/**
 * 96 题:聊天窗口组件化。
 *
 * `<ChatWindow>` = 一个**完整、自包含**的对话单元:
 *   - 顶栏:模型选 + 高级参数(可选)
 *   - 中部:ConversationView(消息列表 + Composer + 流式)
 *   - 状态:scope 隔离 — 每个 ChatWindow 实例的 model/draft/KB 选择都独立
 *
 * 任意地方都可以放一个或多个,每个 scope 自己持久化到 localStorage 'cy.composer.<scope>'。
 *
 * 用法:
 *   // 默认(单例,沿用全局 store,零回归):
 *   <ChatWindow />
 *
 *   // 多个独立窗口:
 *   <ChatWindow scope="lane-x" conversationId={x.conversationId} />
 *   <ChatWindow scope="lane-y" conversationId={y.conversationId} />
 *
 * 这是模型对抗(Lane)的承载体,也可以被 KbBoard / Skill 等场景任意复用。
 *
 * 按次门控（chat）:
 *   每次 send 前调 consume('chat')。allowed=false → 弹购买弹层并阻止发送；
 *   allowed=true+source='free' → 允许发送，同日首次弹分享二维码；
 *   allowed=true+source!='free' → 直接发送。网络异常 fail-open。
 */
import * as React from 'react';
import {
  ComposerStoreContext, createComposerStore, useComposerStore,
  type ComposerSeed,
} from '../../store/composer';
import { useModelArenaStore } from '../../store/modelArena';
import { useLicenseStore, LicenseDialog, ShareDialog } from '../license';
import { ConversationView } from './ConversationView';
import { ModelPicker } from './ModelPicker';
import { AdvancedParams } from './AdvancedParams';

/** 同 app 同日首次弹分享弹层的 localStorage key */
function shareShownKey(app: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `usagegate:${app}:${ymd}`;
}

interface Props {
  /** 唯一 scope id;不传 → 用全局 useComposerStore(老 ChatPage 行为零回归) */
  scope?: string;
  /** 已存在的 conversation;null/undefined → ConversationView 草稿 lazy 创建 */
  conversationId?: string | null;
  /** ConversationView 创建会话后回调(用于 Tab 升级 path 等) */
  onConversationCreated?: (id: string, title: string) => void;
  /** 是否显示顶栏(默认 true)— Lane 内部已有 LaneHeader,可以关掉 */
  showHeader?: boolean;
  /** 自定义顶栏右侧附加内容 */
  headerExtra?: React.ReactNode;
  className?: string;
  /** 96 题:外部 send 拦截器(Arena 统一发送 fanout) */
  onBeforeSend?: (text: string) => boolean | Promise<boolean>;
  /** 96 题:暴露 sendMessage 给父级(Arena SendRegistry) */
  sendMessageRef?: React.MutableRefObject<((text: string) => Promise<void>) | null>;
}

export const ChatWindow: React.FC<Props> = ({
  scope, conversationId, onConversationCreated, showHeader = true,
  headerExtra, className, onBeforeSend: outerOnBeforeSend, sendMessageRef,
}) => {
  // 同一 scope 同一实例 — 用 useMemo 在 scope 不变时复用
  // 96 题:scope 给定时,从 ArenaStore.lastTouchedSeed 读 seed 初始化
  // (用户调整:加新道继承"最后一次操作"的 model + KB)
  const store = React.useMemo(
    () => {
      if (!scope) return useComposerStore;
      const seed = useModelArenaStore.getState().lastTouchedSeed ?? undefined;
      return createComposerStore(scope, seed ?? undefined);
    },
    [scope],
  );

  // 96 题:订阅本 scope 的 composer 变化,把 model/KB/深度思考 同步到 ArenaStore
  // 用作下次 addLane 的 seed
  React.useEffect(() => {
    if (!scope) return;  // 全局 scope 不参与 lastTouchedSeed
    const unsub = store.subscribe((s) => {
      const seed: ComposerSeed = {
        modelId: s.modelId,
        platformName: s.platformName,
        selectedKbs: s.selectedKbs,
        selectedKuIds: s.selectedKuIds,
        deepThink: s.deepThink,
        searchMode: s.searchMode,
        selectedTools: s.selectedTools,
        selectedMcps: s.selectedMcps,
      };
      useModelArenaStore.getState().setLastTouchedSeed(seed);
    });
    return () => unsub();
  }, [scope, store]);

  // ── 按次门控状态（chat）────────────────────────────────────────────────────
  const consume = useLicenseStore((s) => s.consume);
  const [buyOpen, setBuyOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [remaining, setRemaining] = React.useState(0);

  // onBeforeSend 包装:先跑 Arena 统一发送拦截，再跑 chat 门控。
  const onBeforeSend = React.useCallback(
    async (text: string): Promise<boolean> => {
      // Arena 统一发送拦截（unifiedSend ON 时，Lane 的 onBeforeSend 会抢先返回 true）。
      // 如果外部已经说"跳过本道"，我们也跳过（不重复门控）。
      if (outerOnBeforeSend) {
        const skip = await outerOnBeforeSend(text);
        if (skip) return true;
      }

      // chat 按次门控：fail-open（网络异常时允许发送）。
      try {
        const r = await consume('chat');
        if (!r.allowed) {
          // 额度耗尽 → 弹购买对话框，阻止发送。
          setBuyOpen(true);
          return true;
        }
        if (r.source === 'free') {
          setRemaining(r.remainingFree);
          // 同日首次免费执行 → 弹分享对话框。
          const key = shareShownKey('chat');
          const shown = (() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } })();
          if (!shown) {
            try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
            setShareOpen(true);
          }
        }
        return false; // 允许发送
      } catch {
        // fail-open：网络异常时不阻止发送。
        return false;
      }
    },
    [outerOnBeforeSend, consume],
  );

  return (
    <ComposerStoreContext.Provider value={store}>
      {/* 按次门控弹层 */}
      <LicenseDialog app="chat" open={buyOpen} onOpenChange={setBuyOpen} />
      <ShareDialog app="chat" open={shareOpen} onOpenChange={setShareOpen} remainingFree={remaining} />
      <ConversationView
        conversationId={conversationId ?? null}
        onConversationCreated={onConversationCreated}
        className={className}
        onBeforeSend={onBeforeSend}
        sendMessageRef={sendMessageRef}
        headerSlot={
          showHeader ? (
            <header className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <ModelPicker />
                <AdvancedParams />
              </div>
              {headerExtra && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {headerExtra}
                </div>
              )}
            </header>
          ) : undefined
        }
      />
    </ComposerStoreContext.Provider>
  );
};
