/**
 * 96-7:拖出后的独立窗口路由组件。
 *
 * 流程:
 *   1. 主窗 LaneHeader [⬈] → setDetached(laneId, true) →
 *      window.open('/arena/detached?lane=<id>', name, 'width=520,height=720')
 *   2. 子窗 mount → 从 URL ?lane=<id> 拿 laneId
 *   3. 直接渲染 <Lane lane={laneState} index={0} isSingle={true} />
 *      其中 laneState 通过 BroadcastChannel 与主窗双向同步
 *   4. 子窗 unload → broadcast('lane:reattach') → 主窗 setDetached(false)
 *
 * 状态同步策略(MVP):
 *   - 子窗有自己的局部 lane state(modelId / conversationId)
 *   - 主窗变更 → 主窗 useEffect subscribe arenaStore,变化时 broadcast 推过来
 *   - 子窗变更(如换模型)→ 子窗 broadcast 'lane:patch' 给主窗
 *
 * 简化:子窗的对话状态(messages)**完全独立**(自己的 useChayuanChat),
 * 不跨窗同步消息。两边各自 conversation 各自存(后端各自落库),
 * 用户希望"对话内容在两边都能看到"是 P2 范围。MVP:子窗就像新开的小聊天窗。
 */
import * as React from 'react';
import { ChatWindow } from '../chat/ChatWindow';
import { useModelArenaStore, type Lane as LaneState } from '../../store/modelArena';

const DETACHED_CHANNEL = 'chayuan.arena.detached';

interface DetachedMsg {
  type: 'lane:state' | 'lane:reattach' | 'lane:patch';
  /** v2:Arena 已 per-tab,主窗 reattach 时需要靠它定位回原 scope */
  scope: string;
  laneId: string;
  payload?: Partial<LaneState>;
}


export const DetachedLaneRoute: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const laneId = params.get('lane') || 'unknown';
  const scope = params.get('scope') || '';

  // 子窗自己持 lane state(由主窗推送初始值;关闭时通知主窗 reattach)
  const [lane, setLane] = React.useState<LaneState>(() => ({
    id: laneId,
    conversationId: null,
    modelId: null,
    collapsed: false,
    detached: true,
  }));

  // 设置子窗标题
  React.useEffect(() => {
    document.title = `察元对抗 — ${lane.modelId || laneId}`;
  }, [lane.modelId, laneId]);

  // BroadcastChannel 双向同步
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(DETACHED_CHANNEL);

    ch.onmessage = (ev: MessageEvent<DetachedMsg>) => {
      const msg = ev.data;
      if (!msg || msg.laneId !== laneId) return;
      if (msg.type === 'lane:state' && msg.payload) {
        setLane((prev) => ({ ...prev, ...msg.payload }));
      }
    };

    // 子窗 mount 后请求一次主窗推完整 state
    ch.postMessage({ type: 'lane:patch', scope, laneId, payload: { detached: true } });

    // 子窗关闭 → 通知主窗 reattach(setDetached(false) + 渲染)
    const onUnload = () => {
      try {
        ch.postMessage({ type: 'lane:reattach', scope, laneId });
      } catch {}
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      ch.close();
    };
  }, [laneId, scope]);

  // 子窗变更 → 推主窗
  const onLanePatch = React.useCallback((patch: Partial<LaneState>) => {
    setLane((prev) => ({ ...prev, ...patch }));
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(DETACHED_CHANNEL);
      try {
        ch.postMessage({ type: 'lane:patch', scope, laneId, payload: patch });
      } finally {
        ch.close();
      }
    }
  }, [laneId, scope]);

  // Detached 状态下 Lane.isSingle=true → 不显示 [X] [⬈] 按钮(避免再嵌套)
  // 渲染需要把 lane.detached=false 让 Lane 不进折叠空白态
  return (
    <div className="flex h-screen w-screen flex-col">
      <header className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
        <div className="text-xs text-muted-foreground">
          独立窗口 · 关闭即还原到主窗口
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          lane: {laneId}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <DetachedLaneInner lane={{ ...lane, detached: false }} onPatch={onLanePatch} />
      </div>
    </div>
  );
};


/**
 * 子窗 Lane 内嵌 wrapper — 把 onPatch 注入到 Lane 的 setModel 等操作。
 *
 * 当前最简实现:子窗 Lane 直接调用父 onPatch 修改本地 state,与主窗同步通过
 * channel.postMessage 完成。Lane 内部仍走 useModelArenaStore 的方法 — 但子窗
 * 的 store 与主窗是同一份(同 origin)?**不是** — 浏览器不同 window 的 JS 全局
 * 完全隔离,每个 tab 自己的 zustand store 实例独立。
 *
 * 因此子窗其实有自己的 ArenaStore — 但只用来渲染那一道 lane,操作通过
 * onPatch 桥接到主窗。
 *
 * MVP:不接 useModelArenaStore — Lane 组件强依赖它会出问题。后续 P2 可以做
 * "scoped store" 让 Lane 既能用全局也能用注入。
 */
function DetachedLaneInner({
  lane,
  onPatch: _onPatch,
}: {
  lane: LaneState;
  onPatch: (patch: Partial<LaneState>) => void;
}): React.JSX.Element {
  // 子窗用 ChatWindow,scope = lane.id,各自有独立的 composer 持久化 key
  return (
    <ChatWindow
      scope={`lane.${lane.id}`}
      conversationId={lane.conversationId}
    />
  );
}


// ---------------------------------------------------------------------------
// 主窗:监听 BroadcastChannel,reattach 时 setDetached(false)
// ---------------------------------------------------------------------------

/**
 * 在主窗 layout 顶层调用一次 — 监听子窗关闭事件并自动 reattach。
 * v2:scope 参数传当前 tab.id,只处理本 scope 的消息(其他 tab 的 detach 事件不串)。
 */
export function useDetachedLaneSync(scope: string): void {
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(DETACHED_CHANNEL);
    ch.onmessage = (ev: MessageEvent<DetachedMsg>) => {
      const msg = ev.data;
      if (!msg || msg.scope !== scope) return;
      if (msg.type === 'lane:reattach') {
        useModelArenaStore.getState().setDetached(scope, msg.laneId, false);
      }
      if (msg.type === 'lane:patch' && msg.payload) {
        const lanes = useModelArenaStore.getState().byTabId[scope]?.lanes ?? [];
        const lane = lanes.find((l) => l.id === msg.laneId);
        if (lane && msg.payload.modelId !== undefined) {
          useModelArenaStore.getState().setModel(scope, msg.laneId, msg.payload.modelId ?? null);
        }
      }
    };
    return () => ch.close();
  }, [scope]);
}


/**
 * 触发拖出 — 由 LaneHeader [⬈] 按钮调用。
 *
 * 主窗:
 *   1. setDetached(scope, laneId, true) → MultiLaneShell 不再渲染该 lane
 *   2. window.open('/arena/detached?lane=<id>&scope=<id>', name, features)
 *      name 用 laneId,重复点不会再开多个窗;scope 传给子窗,reattach 时回路用
 */
export function openDetachedLaneWindow(scope: string, laneId: string, modelId?: string | null): Window | null {
  const url = `/arena/detached?lane=${encodeURIComponent(laneId)}&scope=${encodeURIComponent(scope)}`;
  const features = 'width=520,height=720,resizable=yes,scrollbars=yes';
  const win = window.open(url, `arena-${laneId}`, features);
  // 把当前 model 等初始 state 推过去(BroadcastChannel 微秒级延迟)
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(DETACHED_CHANNEL);
    setTimeout(() => {
      try {
        ch.postMessage({
          type: 'lane:state', scope, laneId,
          payload: { modelId: modelId ?? null },
        });
      } finally {
        ch.close();
      }
    }, 200);  // 等子窗 mount 后再推
  }
  return win;
}
