# 设计:聊天页面级"拖出独立窗口"按钮 + 全局字号默认 16px

- **状态**:Draft
- **作者**:Claude(协助 zhgyuhuii 制定)
- **日期**:2026-05-08
- **影响代码库**:`chayuan-client`(纯前端,无后端改动)

## 1. 背景与目标

`chayuan-desktop` 单机版聊天页(`ChatPage`)已有"模型对抗 / 多泳道"基础设施:每条 `Lane` 头部带 `[折叠 / 拖出独立窗口 / 关闭]` 三键。但:

- **单泳道**(占 95% 日常使用)直接渲染 `ChatWindow`,**没有 Lane 包装,没有拖出按钮**
- 多泳道下虽然每条 Lane 有按钮,但用户希望页面顶栏也有一个统一入口
- 现有 `FONT_DEFAULT = 14`,用户希望默认 16px

本设计在不动后端的前提下,把这两点一次落地:

1. `FONT_DEFAULT` 14 → 16
2. `ChatPage` 顶栏右上角加全局"拖出独立窗口"按钮,单泳道 / 多泳道都可用,弹出后主窗口按规则收尾

## 2. 非目标(明确不做)

- 不重做 detach 基础设施(已有 `openDetachedLaneWindow` / `DetachedLaneRoute` / `useCrossWindowSync`,直接复用)
- 不重排 Lane 头部按钮(`折叠 / 拖出 / 关闭`三件套保留)
- 不引入新的多窗口管理面板(那是另一个项目)

## 3. 现状关键模块

| 模块 | 路径 | 角色 |
|---|---|---|
| `settings` store | `packages/app/src/store/settings.ts` | 持有 `fontSize`(zustand persist),写 `documentElement.style.fontSize` 接管 root rem |
| `ChatPage` | `packages/app/src/features/chat/ChatPage.tsx` | 单/多泳道分流:`isMultiLane ? <MultiLaneShell/> : <ChatWindow/>` |
| `MultiLaneShell` | `packages/app/src/features/model-arena/MultiLaneShell.tsx` | 多泳道横向布局,处理 reattach 信号 |
| `Lane` | `packages/app/src/features/model-arena/Lane.tsx` | 单条 lane,头部含拖出按钮(`!isSingle` 时显示) |
| `DetachedLaneRoute` | `packages/app/src/features/model-arena/DetachedLaneRoute.tsx` | 独立窗口路由,内含 `DETACHED_CHANNEL` BroadcastChannel + `useDetachedLaneSync(scope)` |
| `openDetachedLaneWindow` | 同上文件 line 188 | `window.open('/arena/detached?lane=...&scope=...')` 开 webview + 推 `lane:state` 初值 |
| `useModelArenaStore` | `packages/app/src/store/modelArena.ts` | 多泳道状态;含 `lanes` / `setDetached` / `lastTouchedSeed` / `selectScopedLanes` 等 selector |
| `useCrossWindowSync` | `packages/app/src/features/shell/useCrossWindowSync.ts` | (与本设计无关)走另一条 `'chayuan'` 频道做 query invalidation;不复用 |

## 4. 设计

### 4.1 全局字号默认

- 把 `FONT_DEFAULT` 14 → 16(`packages/app/src/store/settings.ts:44`)
- **不**触碰已持久化的 `fontSize`:zustand persist 已有的用户偏好继续沿用
- 设置页(`SettingsAsPage`)字号滑块 12-22 范围不变,仅默认中心点上移
- "恢复默认"按钮(`settings.reset()`)走类型默认 → 16

### 4.2 ChatPage 页级拖出按钮

#### 4.2.1 位置

`ChatPage` 顶栏右上角,与现有 `ModelPicker` 同区。新增 `<ExternalLink>` 图标按钮,`title="拖出独立窗口"`。

#### 4.2.2 哪条 lane 被弹出

- **单泳道**:那条唯一的 chat(对应 `scope='global'` 或当前 tab scope)
- **多泳道**:**第一条非 detached 的 lane**

  v1 取"first non-detached lane"是为了避免引入新状态。等用户反馈再考虑跟踪 `focusedLaneId`(显式 click 一条 lane 时记录)。

#### 4.2.3 onClick 行为

按现有签名 `openDetachedLaneWindow(scope, laneId, modelId?)` 走(它内部用 `window.open(/arena/detached?lane=...&scope=...)` 开 webview;通过 `DETACHED_CHANNEL` BroadcastChannel 推 `lane:state` 初始化模型):

```
1. 取目标 lane 的 (laneId, modelId, scope)
2. 调 openDetachedLaneWindow(scope, laneId, modelId)
3. setDetached(scope, laneId, true) — 主窗口该 lane 折叠/隐藏
4. 检查 lanes 中"非 detached"剩余数:
   - = 0 → navigate({ to: '/home' }) 主窗口跳首页
   - > 0 → 留在 ChatPage,继续显示剩余 lanes
```

注:`openDetachedLaneWindow` 不接 `conversationId` 参数;独立窗口的 `DetachedLaneRoute` 自己从 `useModelArenaStore` 拿 lane 状态(包括 conversationId)。无需改它的签名。

#### 4.2.4 单泳道特殊处理

单泳道下不存在 `lanes` 数组(模型对抗未启用)。需要把"单泳道"作为隐式 lane 处理:

- 给单泳道造一个虚拟 `laneId='main'`,seed 取自 `composer.modelId`
- 走相同的 `openDetachedLaneWindow('global','main',...)`
- 弹出后,因为单泳道默认就是 1,detach 后剩余 = 0 → 直接 `navigate('/home')`

### 4.3 0 lanes 兜底跳 home

不仅页级按钮的最后一次 detach 触发跳 home,**任何路径**让 `lanes` 中"非 detached"数量降到 0 时(包括用户在多泳道里逐个 detach 完所有)都该跳 home。

实现:在 `ChatPage` 用 `useEffect` 监听 `selectScopedLanes(scope)`(已有 selector,返回该 scope 全量 lanes),内部 `filter(l => !l.detached).length === 0` 时 `navigate('/home')`。当 scope 是单泳道隐式 lane 时(下文 §4.2.4),同样用一个布尔 `mainHasDetachedSingle` 状态判断。

### 4.4 Reattach 支持

用户关闭独立窗口想回主窗口的流程:

#### 4.4.1 现状

- `MultiLaneShell.tsx:50` 已 `useDetachedLaneSync(scope)`,内部对 `DETACHED_CHANNEL` BroadcastChannel 订阅,过滤 `msg.scope === scope` 后 `setDetached(scope, laneId, false)`
- `DetachedLaneRoute.tsx:74` 子窗 `beforeunload` 时已 `ch.postMessage({ type: 'lane:reattach', scope, laneId })`,这套链路完整
- **问题**:`useDetachedLaneSync` 挂在 `MultiLaneShell` 内;单泳道走 `<ChatWindow/>` 不渲染 `MultiLaneShell` → 没监听器。页级按钮 detach 后又 nav `/home` → `ChatPage` 卸载 → 即便有 `MultiLaneShell` 也跟着没了

#### 4.4.2 解决方式

新增 `useGlobalDetachedLaneSync()`(无 scope 过滤,处理所有 reattach 消息;放在 `Shell.tsx` 顶层):

```ts
React.useEffect(() => {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(DETACHED_CHANNEL);
  ch.onmessage = (ev) => {
    const msg = ev.data;
    if (msg?.type !== 'lane:reattach') return;
    useModelArenaStore.getState().setDetached(msg.scope, msg.laneId, false);
    // 如果当前在 /home 而该 reattach 是用户预期"回到聊天",nav 回 /chat
    if (window.location.pathname === '/home') {
      navigate({ to: '/chat' });
    }
  };
  return () => ch.close();
}, []);
```

- Shell 层挂载 → 整个 app 生命周期内一直监听
- 旧的 `useDetachedLaneSync(scope)` 在 `MultiLaneShell` 里**保留**(per-scope 处理 `lane:patch` model 同步,这部分跟 reattach 无关) → 不冲突,只是 reattach 路径走到 Shell 层时已被处理一次,scope-level 再处理 `setDetached(false)` 也是幂等的

#### 4.4.3 边界

- 主窗口聊天有内容(已经新建会话 / 多 lane)**且**用户从独立窗口 reattach:reattach 的 lane 加回 lanes 列表(`setDetached=false`),不破坏其它 lane
- 独立窗口直接关闭浏览器 / 用户点 X(非 reattach 路径):需要 webview 的 `CloseRequested` 监听器 broadcast reattach,确保不丢内容(已有部分实现,这里只需确保 listener 在 Shell 层永不解绑)

## 5. 行为矩阵

| 场景 | 触发 | 主窗口结果 | 独立窗口结果 |
|---|---|---|---|
| 单泳道 + 页级按钮 | click | 跳 `/home` | 打开,显示该 chat |
| 多泳道(N lanes) + 页级按钮 | click | 显示剩 N-1 lanes | 打开,显示首条非 detached lane |
| 多泳道 + Lane 头部按钮 | click | 显示剩 N-1 lanes | 打开,显示该 lane |
| detach 完所有 lane | 任意路径 | 跳 `/home` | 各自独立窗口 |
| 关闭独立窗口 | unload / X | 该 lane 回 ChatPage `setDetached=false`;若主在 `/home` 则 nav 回 `/chat` | 关闭 |

## 6. 测试要点

- 字号默认:全新 install + 未持久化 → 16px;已有用户(localStorage 有 `cy.settings.v2.fontSize=14`)→ 仍 14
- 单泳道 detach → 主窗口 location 变 `/home`
- 多泳道 (3 lanes) 逐个 detach:第 1/第 2 detach → 仍在 ChatPage,第 3 detach → 跳 `/home`
- Reattach:从独立窗口关闭 → 主窗口该 lane 重新可见;若主在 `/home` → 跳回 `/chat`
- BroadcastChannel listener 切路由不解绑(Shell 层挂载)

## 7. 风险与已知约束

- **Tauri WebviewWindow 创建失败**(权限 / 资源不足):现 `openDetachedLaneWindow` 返回 null,UI 静默失败。改进:click 失败 toast 报错(可选)
- **多窗口字号同步**:独立窗口加载新页面时读 settings store 同样 persist 出来的 fontSize → 自动一致,无需额外处理
- **生产 zustand persist 版本号**:若改 `FONT_DEFAULT` 同时变 schema,会让旧持久化失效。本次只改默认值,store 结构不动 → 无版本变更需要

## 8. 关键文件改动一览

```
packages/app/src/store/settings.ts                      # FONT_DEFAULT 14 → 16
packages/app/src/features/chat/ChatPage.tsx             # 页级拖出按钮 + 0 lanes useEffect
packages/app/src/features/model-arena/DetachedLaneRoute.tsx  # 导出 useGlobalDetachedLaneSync
packages/app/src/Shell.tsx                              # 调 useGlobalDetachedLaneSync()
```

注:不动 `Lane.tsx` 头部按钮(单条 detach 流程不变),不动 `MultiLaneShell.tsx`(per-scope `useDetachedLaneSync` 保留处理 `lane:patch`)。

## 9. 不在本次范围

- `lastTouchedLaneId` / 显式 focused lane 跟踪(若用户反馈再加)
- 拖出窗口的多窗口管理面板(列出 / 切换 / 全部回收)
- 字号 per-route 覆盖(全局即可)

## 10. 验收清单

- [ ] `pnpm typecheck` 0 错误
- [ ] 全新装(localStorage 空)字号 16px
- [ ] 单泳道点页级按钮 → 主跳 `/home`,独立窗口显示同会话
- [ ] 多泳道(2+ lanes)点页级按钮 → 主剩 N-1,独立窗口显示首条 lane
- [ ] 多泳道全部 detach → 主跳 `/home`
- [ ] 关闭独立窗口 → lane 回主窗口;若主在 `/home` → nav `/chat`
