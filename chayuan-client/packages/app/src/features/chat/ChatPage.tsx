/**
 * 主对话页 — 现在是 ConversationView 的薄壳:
 *   - 顶栏(模型选择 / 高级参数 / Stream 指标 / Artifact 切换)
 *   - 草稿模式首发回调里把 tab path 升级 /chat → /chat/<id>
 *   - 消息状态机 / 落库 / 草稿 lazy 创建会话 等都委托给 ConversationView
 *
 * 重构动机:KbDetail / Skill / 多模态对话页 都需要"消息列表 + 输入框"形态,
 * 全部共享 ConversationView,行为一致 + 修一处即修所有,不必各自再写一份。
 */

import * as React from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { AdvancedParams } from './AdvancedParams';
import { StreamMetrics } from './StreamMetrics';
import { ConversationView } from './ConversationView';
import { useArtifactStore } from '../../store/artifact';
import { useTabsStore } from '../../store/tabs';
import {
  selectScopedIsMultiLane, selectScopedLanes, selectScopedUnifiedSend, useModelArenaStore,
} from '../../store/modelArena';
import { useArenaScope } from '../../store/arenaScope';
import { MultiLaneShell } from '../model-arena/MultiLaneShell';
import { openDetachedLaneWindow } from '../model-arena/DetachedLaneRoute';

export interface ChatPageProps {
  /**
   * 当前 tab 渲染的会话 id。由 page-registry 从 tab.path 解析后传入:
   *   - `/chat` → null(草稿模式,首发消息时 lazy 建会话)
   *   - `/chat/<id>` → 该 id
   *
   * 为什么不读全局 useComposerStore.activeConversationId:
   * 多个 chat tab 共享 __global__ scope 的 composer store,激活某 tab 时
   * setActive 会污染其它后台 tab,导致"两个 tab 显示同一会话"。tab.path 才是
   * 各 tab 独立的真源,通过 prop 注入能保证渲染严格按 tab 隔离。
   */
  conversationId: string | null;
}

export const ChatPage: React.FC<ChatPageProps> = ({ conversationId }) => {
  const activeId = conversationId;
  const artifactOpen = useArtifactStore((s) => s.open);
  const setArtifactOpen = useArtifactStore((s) => s.setOpen);
  const artifactCount = useArtifactStore((s) => Object.keys(s.items).length);

  // ChatPage 专属副作用:草稿模式首发后,把当前 tab 的 path 从 /chat 升到 /chat/<id>,
  // reload / 切回该 tab 时 onActivate 能恢复 activeConversationId。
  const onConversationCreated = React.useCallback((id: string, title: string) => {
    const tabs = useTabsStore.getState();
    const cur = tabs.activeId
      ? tabs.tabs.find((tt) => tt.id === tabs.activeId)
      : undefined;
    if (cur && cur.path === '/chat') {
      tabs.updatePath(cur.id, `/chat/${encodeURIComponent(id)}`, title);
    }
  }, []);

  // 96 题:多永道(model arena)接入。单道时 UI 完全等价之前(零回归);
  // 多道时切到 MultiLaneShell 横向布局。
  // v2:状态按 tab.id 分桶,各 tab 独立 lanes / unifiedSend。
  const scope = useArenaScope();
  const isMulti = useModelArenaStore(selectScopedIsMultiLane(scope));
  const addLane = useModelArenaStore((s) => s.addLane);
  const lanes = useModelArenaStore(selectScopedLanes(scope));
  const unifiedSend = useModelArenaStore(selectScopedUnifiedSend(scope));
  const setUnifiedSend = useModelArenaStore((s) => s.setUnifiedSend);
  const setDetached = useModelArenaStore((s) => s.setDetached);
  const navigate = useNavigate();

  // lanes 数组空(本 scope 未初始化 / 用户全删完)→ 自动重建 main 道,避免空白页
  React.useEffect(() => {
    if (lanes.length === 0) {
      useModelArenaStore.getState().resetToSingleLane(scope);
    }
  }, [lanes.length, scope]);

  // 非 detached lane 数 = 0 → 主窗口聊天页空,跳 /home
  // (单泳道 detach / 多泳道全 detach 都走这条;条件 lanes.length > 0 防止
  //  初始化空数组误触,那条由上面的 resetToSingleLane effect 接管)
  React.useEffect(() => {
    const activeCount = lanes.filter((l) => !l.detached).length;
    if (activeCount === 0 && lanes.length > 0) {
      void navigate({ to: '/home' });
    }
  }, [lanes, navigate]);

  /**
   * 页级"拖出独立窗口"按钮的 onClick:
   *   - 单泳道:lanes[0] 就是 main 道,直接 detach 它
   *   - 多泳道:取第一条非 detached 的 lane(v1 简化:不跟踪 focused)
   *   - detach 后由上面 effect 监听 active 数 = 0 跳 /home,本回调不重复跳
   */
  const onPopout = React.useCallback(() => {
    const target = lanes.find((l) => !l.detached);
    if (!target) return;
    openDetachedLaneWindow(scope, target.id, target.modelId);
    setDetached(scope, target.id, true);
  }, [lanes, scope, setDetached]);

  // 顶栏右侧:[Artifact 切换?] [☐ 统一发送(仅多道显示)] [高级] [+ 添加]
  // 顶栏左侧不放任何东西 — ModelPicker 已在 ChatComposer 内部,顶栏只留功能控件
  const renderTopActions = (showUnified: boolean) => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <ChatPageMetrics />
      {artifactCount > 0 && (
        <button
          type="button"
          onClick={() => setArtifactOpen(!artifactOpen)}
          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          {artifactOpen ? '收起' : '展开'} Artifact ({artifactCount})
        </button>
      )}
      {showUnified && (
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs select-none hover:bg-accent">
          <input
            type="checkbox"
            checked={unifiedSend}
            onChange={(e) => setUnifiedSend(scope, e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span>统一发送</span>
        </label>
      )}
      <button
        type="button"
        onClick={onPopout}
        title="拖出独立窗口"
        aria-label="拖出独立窗口"
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <AdvancedParams />
      <button
        type="button"
        onClick={() => addLane(scope)}
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
        title="添加永道(模型对抗)"
      >
        <Plus className="h-3.5 w-3.5" />
        添加
      </button>
    </div>
  );

  const singleLanePane = (
    <ConversationView
      conversationId={activeId}
      onConversationCreated={onConversationCreated}
      headerSlot={
        <header className="flex items-center justify-end border-b px-6 py-2">
          {renderTopActions(/* showUnified */ false)}
        </header>
      }
    />
  );

  if (isMulti) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-end border-b px-6 py-2">
          {renderTopActions(/* showUnified */ true)}
        </header>
        <div className="min-h-0 flex-1">
          <MultiLaneShell singleLaneFallback={singleLanePane} />
        </div>
      </div>
    );
  }

  return <MultiLaneShell singleLaneFallback={singleLanePane} />;
};

/**
 * StreamMetrics 需要从 chat state 拿数据;但我们把状态机放在 ConversationView
 * 里了。简单方案:让指标条只显示静态信息(消息数我们这层拿不到),或后续把
 * chat.isStreaming 通过 context 暴露出来。当前 KISS,先放一个空的占位
 * — 90% 的体验仍在 ConversationView 内部完整保留(StreamMetrics 是 nice-to-have)。
 *
 * TODO(若用户反馈想恢复指标条):在 ConversationView 加 onStateChange 回调,
 * 把 isStreaming / startedAt / firstTokenAt 上抛父级。
 */
const ChatPageMetrics: React.FC = () => {
  return (
    <StreamMetrics
      active={false}
      text=""
      startedAt={null}
      firstTokenAt={null}
    />
  );
};
