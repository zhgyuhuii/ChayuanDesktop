/**
 * 主页能力卡的"点击 → 开新对话"行为 — 纯函数,可复用、易测。
 *
 * 步骤(严格顺序,zustand 串行写入保证):
 *   1. setModel(modelId, platformName)        预选模型,ChatComposer mount 时直接见
 *   2. setActive(null)                          进入草稿模式,不绑老 conversation
 *   3. open('/chat', { forceNew:true, ... })   每次都开一个全新 tab,不复用旧 /chat
 *   4. navigate('/chat')                        切到这个 tab
 *
 * 为什么放在外部纯函数而不是 CapabilityCard 内部 closure:
 *   - 多张卡共享同一份"点击逻辑";写在 closure 里每张卡的 onClick 都会因为
 *     函数引用变化触发 React.memo 失效,所有卡都重渲染
 *   - 纯函数 + 用 useCallback 在父级稳定一次,所有 React.memo 卡片真正只在
 *     props(model 数量 / 状态)变化时重渲
 *   - 单测好写:不依赖 React 树
 */

import type { RawModelItem } from '@chayuan/api';
import type { ModalityCapability } from '@chayuan/transport';
import { useComposerStore } from '../../../store/composer';
import { useModelArenaStore } from '../../../store/modelArena';
import { useTabsStore } from '../../../store/tabs';
import { getCapabilityMeta } from '../../composer/modelCapabilityChip';

export interface StartCapabilityChatDeps {
  /** TanStack Router 的 navigate 函数(由调用方传,避免在纯函数里耦合 router) */
  navigate(to: string): void;
}

export interface StartCapabilityChatInput {
  cap: ModalityCapability;
  model: RawModelItem;
}


/**
 * 真正开新对话 — 调用方需已经确认该 cap 有可用模型(否则走 onNoModel 路径)。
 */
export function startCapabilityChat(
  input: StartCapabilityChatInput,
  deps: StartCapabilityChatDeps,
): void {
  const { cap, model } = input;
  const meta = getCapabilityMeta(cap);

  // 1. 预选模型 — ChatComposer 监听 composer.modelId,会自动联动 ComposerModeBadge /
  //    placeholder / submitLabel / 参数条
  const composer = useComposerStore.getState();
  composer.setModel(model.id, model.platform_name, cap); // 全局 store(非泳道场景用)
  // ⚠️ 对话页泳道用 scoped store(scope=lane.<id>),localStorage 持久、seed 不再应用,
  //    全局写它读不到。写一个「待应用」信号,由对话页 ChatComposer 挂载/变化时应用到
  //    自己的 scoped store(setModel + 清 KB)。这是真正能把模型/能力送进对话页的路径。
  composer.setPendingModelApply({
    modelId: model.id,
    platformName: model.platform_name,
    modelCapability: cap,
  });
  // 1a. ⚠️ 对话页每个泳道用的是 scoped composer store(scope=lane.id),初始值来自
  //     ArenaStore.lastTouchedSeed,**不读全局 store**。所以必须把模型+能力写进
  //     lastTouchedSeed,新开的对话泳道才会带上对应模型/模式;并清掉 KB(避免新
  //     能力 chat 继承知识库 → onlyChat 把 tts/t2i/t2v 等非对话模型打回对话模型)。
  useModelArenaStore.getState().setLastTouchedSeed({
    modelId: model.id,
    platformName: model.platform_name,
    modelCapability: cap,
    selectedKbs: [],
    selectedKuIds: [],
  });
  // 1b. 一次性能力提示 — 对话页模型下拉打开时据此预选能力标签(如"文生视频"),
  //     过滤出同能力模型;消费一次即由 ComposerModelPill 清掉(读全局 store)。
  composer.setCapabilityHint(cap);
  // 2. 草稿态 — 不绑老 conversation,handleSend 首发时再 lazy create
  composer.setActive(null);

  // 3. 新 tab — forceNew 确保跟现有 /chat tab 不复用(否则用户当前的草稿会被覆盖)
  const tabs = useTabsStore.getState();
  tabs.open('/chat', {
    title: `新对话 · ${meta.label}`,
    icon: 'message-square',
    forceNew: true,
  });

  // 4. 路由跳转
  deps.navigate('/chat');
}
