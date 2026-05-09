/**
 * 96 题:单永道(Lane)— 用 ChatWindow 提供完整聊天能力。
 *
 * 视觉:
 *   ┌────────────────────────────────┐
 *   │ ⮟ ⬈ X      (永道头:折叠/拖出/删) │
 *   ├────────────────────────────────┤
 *   │ <ChatWindow scope=lane.id>      │  ← 完整聊天窗口(模型/KB/深度思考/...)
 *   │   ConversationView(消息+Composer)│
 *   └────────────────────────────────┘
 *
 * 折叠时只显示头部一根竖条;拖出时主窗口不渲染(由父级处理)。
 */
import * as React from 'react';
import { ChevronDown, ChevronRight, ExternalLink, GripVertical, X } from 'lucide-react';
import { cn } from '@chayuan/ui';
import {
  selectScopedUnifiedSend, useModelArenaStore, type Lane as LaneState,
} from '../../store/modelArena';
import { useArenaScope } from '../../store/arenaScope';
import { ChatWindow } from '../chat/ChatWindow';
import { useArenaSendRegistry } from './MultiLaneShell';
import { useLaneSortable, useLaneResizer } from './useLaneDnD';
import { openDetachedLaneWindow } from './DetachedLaneRoute';

interface Props {
  lane: LaneState;
  index: number;
  isSingle: boolean;
  registerSendFn?: (laneId: string, fn: (text: string) => void) => void;
  unregisterSendFn?: (laneId: string) => void;
  /**
   * ChatWindow 内部 ConversationView lazy 创建会话后回调。
   * Lane 直接转发给 ChatWindow;父级(ChatPage / MultiLaneShell)用它升级 tab.path 等。
   */
  onConversationCreated?: (id: string, title: string) => void;
}

export function Lane({
  lane, index, isSingle, registerSendFn, unregisterSendFn, onConversationCreated,
}: Props): React.JSX.Element {
  const scope = useArenaScope();
  const removeLane = useModelArenaStore((s) => s.removeLane);
  const toggleCollapsed = useModelArenaStore((s) => s.toggleCollapsed);
  const setDetached = useModelArenaStore((s) => s.setDetached);
  const unifiedSend = useModelArenaStore(selectScopedUnifiedSend(scope));
  const { broadcast } = useArenaSendRegistry();
  const { dragHandleProps, laneContainerProps, isDragging, isDropTarget } =
    useLaneSortable(lane.id, index);

  // ChatWindow 内部 sendMessage 引用 — Lane 用它注册到 SendRegistry,
  // unifiedSend ON 时父级 broadcast 把 text 调用到所有 lane 的 sendMessage
  const sendMessageRef = React.useRef<((text: string) => Promise<void>) | null>(null);

  React.useEffect(() => {
    if (!registerSendFn) return;
    // 通过函数包装 ref → 注册 fn 始终调用最新 ref
    const fn = (text: string) => {
      const real = sendMessageRef.current;
      if (real) void real(text);
    };
    registerSendFn(lane.id, fn);
    return () => unregisterSendFn?.(lane.id);
  }, [lane.id, registerSendFn, unregisterSendFn]);

  // unifiedSend ON 时拦截:ChatWindow 内部调 sendMessage 之前问 onBeforeSend,
  // 我们说 "true 中止本道",改由 broadcast 把 text 发到所有 lane 各自的 sendMessage
  const onBeforeSend = React.useCallback(
    async (text: string): Promise<boolean> => {
      if (!unifiedSend) return false;
      // 先发本道(它的 sendMessageRef 被自己注册,broadcast 内含),所以直接 broadcast
      broadcast(text);
      return true;  // 中止 ChatWindow 内部本次单道 send,因为已经由 broadcast 触发了
    },
    [unifiedSend, broadcast],
  );

  // 折叠态 — 一根 48px 竖条
  if (lane.collapsed) {
    return (
      <div
        {...laneContainerProps}
        className={cn(
          'flex h-full w-12 flex-col items-center border-r bg-muted/30',
          isDragging && 'opacity-50',
          isDropTarget && 'border-l-2 border-l-primary',
        )}
      >
        <button
          type="button"
          onClick={() => toggleCollapsed(scope, lane.id)}
          className="mt-2 rounded p-1 hover:bg-accent"
          title="展开"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div
          className="mt-2 -rotate-90 whitespace-nowrap text-xs font-mono text-muted-foreground"
          style={{ writingMode: 'vertical-rl' as const }}
        >
          {(lane.modelId || '未选').slice(0, 24)}
        </div>
      </div>
    );
  }

  return (
    <div
      {...laneContainerProps}
      className={cn(
        // 单道(isSingle):无右侧分隔线、无 ring 装饰 — 视觉等价老 ChatPage
        'flex h-full min-w-0 flex-col bg-card transition-opacity',
        !isSingle && 'border-r',
        isDragging && 'opacity-50',
        !isSingle && isDropTarget && 'ring-2 ring-primary',
      )}
      style={lane.widthPx ? { width: `${lane.widthPx}px`, flex: '0 0 auto' } : { flex: '1 1 0' }}
    >
      {/* 单道:整个顶部工具条隐藏 — 折叠/拖出/关闭对单道无意义,而且会跟 ChatPage 顶栏重复;
          多道:工具条显示,折叠 / 拖出 / 关闭 / 拖动手柄齐全。 */}
      {!isSingle && (
        <div
          {...dragHandleProps}
          className="flex items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1 select-none"
          title="按住此区域拖动 → 调整顺序"
        >
          {/* 拖动手柄 — 左侧明显的 grip 图标 + 文字提示,告诉用户这里能拖。
              整条 div 都挂了 dragHandleProps,但只有这一块视觉上是"手柄"。 */}
          <span
            className="flex h-5 items-center gap-1 rounded px-1 text-[10px] text-muted-foreground/70 hover:text-foreground"
            aria-hidden
          >
            <GripVertical className="h-3 w-3" />
            <span className="truncate font-mono">{lane.modelId || '未选'}</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleCollapsed(scope, lane.id)}
            className="rounded p-1 hover:bg-accent"
            title="折叠"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={async () => {
              const ok = await openDetachedLaneWindow(scope, lane.id, lane.modelId, lane.conversationId);
              if (ok) setDetached(scope, lane.id, true);
            }}
            className="rounded p-1 hover:bg-accent"
            title="拖出独立窗口"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => removeLane(scope, lane.id)}
            className="rounded p-1 text-destructive hover:bg-accent"
            title="关闭永道"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 完整聊天窗口 — 用 lane.id 作 scope,model/draft/KB 各 lane 独立。
          showHeader=false:Lane 已经有自己的顶部工具条,且模型选择 / 高级参数
          已经在 ChatComposer 内部 + ChatPage 全局顶栏,这里再挂一份是冗余。 */}
      <div className="min-h-0 flex-1">
        <ChatWindow
          scope={`lane.${lane.id}`}
          conversationId={lane.conversationId}
          onConversationCreated={onConversationCreated}
          sendMessageRef={sendMessageRef}
          onBeforeSend={onBeforeSend}
          showHeader={false}
        />
      </div>
    </div>
  );
}


/** Lane 之间的可拖拽 resizer */
export function LaneResizer({ laneId }: { laneId: string }): React.JSX.Element {
  const { resizerProps } = useLaneResizer(laneId);
  return (
    <div
      {...resizerProps}
      className="group relative w-px shrink-0 bg-border hover:bg-primary"
      title="拖动调整宽度"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
