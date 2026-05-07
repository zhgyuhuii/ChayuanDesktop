/**
 * 96-4 + 96-5:多永道容器。
 *
 * 单道(默认状态)→ 退化成"零边距透明壳",视觉等价老 ChatPage,零回归。
 * 多道 → 横向布局 + 顶部统一发送 toggle + 拖出窗口由父级处理。
 *
 * "+ 加道" 按钮由父级 Header 控制(点 [+] → arenaStore.addLane(),本壳自动响应)。
 *
 * 统一发送 dispatcher:
 *   每个 Lane mount 时把自己的 sendMessage 注册到本壳的 fanout 表;
 *   用户在任一 Lane Composer 提交 + unifiedSend=ON 时,壳并发触发所有 lane
 *   的 sendMessage(各自 fetch + SSE,不互相阻塞)。
 *
 * lanes 数组空(用户删完了)→ store 自动重建一道,不会出现空白页。
 */
import * as React from 'react';
import {
  selectScopedIsMultiLane, selectScopedLanes, useModelArenaStore,
} from '../../store/modelArena';
import { useArenaScope } from '../../store/arenaScope';
import { Lane, LaneResizer } from './Lane';
import { useDetachedLaneSync } from './DetachedLaneRoute';

/** Map<laneId, sendFn> — 注入给所有 Lane 子组件;统一发送时遍历调用 */
type SendRegistry = Map<string, (text: string) => void>;
const SendRegistryContext = React.createContext<{
  register: (laneId: string, fn: (text: string) => void) => void;
  unregister: (laneId: string) => void;
  /** unifiedSend ON 时调它:并发广播到所有非 detached lane(folded 也发) */
  broadcast: (text: string, originLaneId?: string) => void;
}>({
  register: () => {},
  unregister: () => {},
  broadcast: () => {},
});

export const useArenaSendRegistry = () => React.useContext(SendRegistryContext);

interface Props {
  /** 单道时渲染的 fallback(老 ChatPage 内容) */
  singleLaneFallback: React.ReactNode;
}

export function MultiLaneShell({ singleLaneFallback }: Props): React.JSX.Element {
  const scope = useArenaScope();
  const lanes = useModelArenaStore(selectScopedLanes(scope));
  const isMulti = useModelArenaStore(selectScopedIsMultiLane(scope));

  // 96-7:监听拖出窗口的 reattach 信号 + 双向 patch(scope 用作回路 key)
  useDetachedLaneSync(scope);

  // sendFn 注册表(Map 引用稳定,不靠 React state)
  const sendRegistryRef = React.useRef<SendRegistry>(new Map());

  const register = React.useCallback((laneId: string, fn: (t: string) => void) => {
    sendRegistryRef.current.set(laneId, fn);
  }, []);

  const unregister = React.useCallback((laneId: string) => {
    sendRegistryRef.current.delete(laneId);
  }, []);

  const broadcast = React.useCallback((text: string, originLaneId?: string) => {
    // 当前实现:统一发送 ON 时,所有 active lane(包括 origin)并发发送;
    // OFF 时由各 lane Composer 自己发送,不走此处
    const activeLanes = useModelArenaStore.getState().getActiveLanes(scope);
    activeLanes.forEach((l) => {
      const fn = sendRegistryRef.current.get(l.id);
      fn?.(text);
    });
  }, [scope]);

  const ctxValue = React.useMemo(
    () => ({ register, unregister, broadcast }),
    [register, unregister, broadcast],
  );

  // ---- 单道(默认):透明壳 + fallback,等价老 ChatPage ----
  if (!isMulti) {
    return (
      <SendRegistryContext.Provider value={ctxValue}>
        {singleLaneFallback}
      </SendRegistryContext.Provider>
    );
  }

  // ---- 多道:横向布局(统一发送 toggle 已移到 ChatPage header)----
  return (
    <SendRegistryContext.Provider value={ctxValue}>
      <div className="flex h-full flex-col">
        <div className="flex h-full min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          {(() => {
            const visibleLanes = lanes.filter((l) => !l.detached);
            return visibleLanes.map((lane, idx) => (
              <React.Fragment key={lane.id}>
                <Lane
                  lane={lane}
                  index={idx}
                  isSingle={false}
                  registerSendFn={register}
                  unregisterSendFn={unregister}
                />
                {idx < visibleLanes.length - 1 && (
                  <LaneResizer laneId={lane.id} />
                )}
              </React.Fragment>
            ));
          })()}
        </div>
      </div>
    </SendRegistryContext.Provider>
  );
}


// 注:统一发送 toggle 已移到 ChatPage header(用户调整)
// 多道时显示在右上角 [+ 添加] 左侧;单道时不显示
