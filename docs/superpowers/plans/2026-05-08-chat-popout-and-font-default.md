# Chat Popout + Font Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加全局聊天页拖出独立窗口按钮(单/多泳道通用)+ 全局默认字号 14 → 16,主窗口"非 detached lane = 0"自动跳 /home,Reattach 监听器全局化。

**Architecture:** 复用现有 `openDetachedLaneWindow` / `DETACHED_CHANNEL` 基础设施;新增 Chrome 层全局 reattach hook,把单泳道也纳入 detach 流程(沿用 lanes[0] 隐式 lane);ChatPage 顶栏右上加按钮。

**Tech Stack:** React 19 + Tanstack Router + Zustand + BroadcastChannel + Vitest

---

## File Structure

| 路径 | 改动类型 | 责任 |
|---|---|---|
| `packages/app/src/store/settings.ts` | 修改 | `FONT_DEFAULT 14 → 16` |
| `packages/app/src/store/__tests__/settings.test.ts` | 新建 | 锁定 FONT_DEFAULT 默认值 |
| `packages/app/src/features/model-arena/DetachedLaneRoute.tsx` | 修改 | 新增 `useGlobalDetachedLaneSync()` 导出 |
| `packages/app/src/router/Chrome.tsx` | 修改 | 调 `useGlobalDetachedLaneSync()` |
| `packages/app/src/features/chat/ChatPage.tsx` | 修改 | 顶栏按钮 + 0-active-lanes useEffect 跳 /home |

任务设计原则:每个 task 自带验证(typecheck / 测试 / 手动 smoke),可独立 commit。

---

## Task 1: 全局字号默认 14 → 16

**Files:**
- Modify: `packages/app/src/store/settings.ts:44`
- Test: `packages/app/src/store/__tests__/settings.test.ts`

- [ ] **Step 1: 写 vitest 测试锁定默认值**

新建 `packages/app/src/store/__tests__/settings.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings';

describe('settings store FONT_DEFAULT', () => {
  beforeEach(() => {
    // 清掉 zustand persist 让 store 回归初值
    globalThis.localStorage?.removeItem('cy.settings.v2');
  });

  it('全新初始化时 fontSize 为 16', () => {
    // 重新 import 强制初始化 — vitest 默认 module cache 无法直接 reload,
    // 退而求其次:reset() 走 DEFAULTS 恢复默认值
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().fontSize).toBe(16);
  });

  it('reset() 后 fontSize 落回 16', () => {
    useSettingsStore.getState().setFontSize(20);
    expect(useSettingsStore.getState().fontSize).toBe(20);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().fontSize).toBe(16);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm vitest run packages/app/src/store/__tests__/settings.test.ts
```
Expected: 两条用例全部 FAIL,断言 `fontSize` 是 14 不是 16(当前默认)。

- [ ] **Step 3: 改 FONT_DEFAULT**

修改 `packages/app/src/store/settings.ts` 第 44 行:

```ts
const FONT_DEFAULT = 16;
```

(原值是 14;只改这一行,其它不动)

- [ ] **Step 4: 运行测试,确认通过**

Run:
```bash
pnpm vitest run packages/app/src/store/__tests__/settings.test.ts
```
Expected: 两条用例 PASS。

- [ ] **Step 5: typecheck**

Run:
```bash
pnpm --filter @chayuan/app typecheck
```
Expected: 0 errors。

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/store/settings.ts \
        chayuan-client/packages/app/src/store/__tests__/settings.test.ts
git commit -m "$(cat <<'COMMIT'
feat(settings): 全局默认字号 14 → 16

更新 FONT_DEFAULT 类型默认值。已持久化的用户偏好(zustand persist)
不受影响,只影响新装 / reset()。配套加一条 vitest 锁定默认值。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 2: 导出 `useGlobalDetachedLaneSync` hook

**Files:**
- Modify: `packages/app/src/features/model-arena/DetachedLaneRoute.tsx`(末尾追加新 export)

- [ ] **Step 1: 读现有 useDetachedLaneSync 找参照**

已知:
- 文件 line 157 `useDetachedLaneSync(scope)` 用 `BroadcastChannel(DETACHED_CHANNEL)`
- 监听 `lane:reattach`,过滤 `msg.scope === scope` 后 `setDetached(scope, laneId, false)`
- 旧 hook 必须保留(MultiLaneShell 还在用,处理 `lane:patch` 模型同步)

- [ ] **Step 2: 在文件末尾追加 useGlobalDetachedLaneSync**

打开 `packages/app/src/features/model-arena/DetachedLaneRoute.tsx`,在文件最后(`openDetachedLaneWindow` 之后)追加:

```ts
/**
 * Chrome 层全局 reattach 监听 — 跨路由生命周期不解绑。
 *
 * 与 ``useDetachedLaneSync(scope)`` 区别:
 *   - per-scope 版本仅在 MultiLaneShell 挂载时活跃,且只处理本 scope
 *   - global 版本不过滤 scope,只处理 reattach,并在主窗当前在 /home 时跳回 /chat
 *
 * 设计:Chrome 是路由 Outlet 的父容器,生命周期 = 整个 app,适合全局订阅。
 */
export function useGlobalDetachedLaneSync(): void {
  const navigate = useNavigate();
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(DETACHED_CHANNEL);
    ch.onmessage = (ev: MessageEvent<DetachedMsg>) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'lane:reattach') return;
      useModelArenaStore.getState().setDetached(msg.scope, msg.laneId, false);
      // 用户在 /home 时关掉独立窗口意味着想回到聊天 — 自动 nav 回 /chat
      // (检查 typeof window 是因为 SSR / 测试环境无 window)
      if (typeof window !== 'undefined' && window.location.pathname === '/home') {
        void navigate({ to: '/chat' });
      }
    };
    return () => ch.close();
  }, [navigate]);
}
```

- [ ] **Step 3: 确认 useNavigate import 存在,不存在则补**

文件顶部应已 import `useNavigate from '@tanstack/react-router'`。如果没有,加:

```ts
import { useNavigate } from '@tanstack/react-router';
```

(查现有 import block,新增 export 不需要重排其它内容)

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm --filter @chayuan/app typecheck
```
Expected: 0 errors。

- [ ] **Step 5: commit**

```bash
git add chayuan-client/packages/app/src/features/model-arena/DetachedLaneRoute.tsx
git commit -m "$(cat <<'COMMIT'
feat(arena): 导出 useGlobalDetachedLaneSync — 跨路由 reattach 监听

新增 Chrome 层用 hook,不过滤 scope,只处理 lane:reattach。
原来的 useDetachedLaneSync(scope) 留下处理 lane:patch 模型同步,
两条路径不冲突:setDetached(false) 幂等,先后到达都安全。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 3: Chrome 调用 `useGlobalDetachedLaneSync`

**Files:**
- Modify: `packages/app/src/router/Chrome.tsx`

- [ ] **Step 1: 找到 Chrome 顶部已有 import 区**

打开 `packages/app/src/router/Chrome.tsx`,定位 import 区(行号约 1-30)。

- [ ] **Step 2: 加 import 与 hook 调用**

在 imports 区追加:

```ts
import { useGlobalDetachedLaneSync } from '../features/model-arena/DetachedLaneRoute';
```

在 `Chrome` 组件函数体顶部(line 47 区左右,组件 `() => {` 之后第一行)追加:

```ts
  // Chrome 是 Router Outlet 的父容器,挂这里 = 整个 app 生命周期都监听 reattach
  useGlobalDetachedLaneSync();
```

- [ ] **Step 3: typecheck**

Run:
```bash
pnpm --filter @chayuan/app typecheck
```
Expected: 0 errors。

- [ ] **Step 4: 手动 smoke**

(现阶段没有 detach 触发入口,先确认没回归)
```bash
pnpm dev:web
```
浏览器打开 http://localhost:3000,确认 chrome shell 渲染正常,console 无 BroadcastChannel 报错。

- [ ] **Step 5: commit**

```bash
git add chayuan-client/packages/app/src/router/Chrome.tsx
git commit -m "$(cat <<'COMMIT'
feat(chrome): 挂全局 useGlobalDetachedLaneSync — reattach 不再丢

Chrome 是 Router Outlet 的父,生命周期 = app,挂在这里保证用户从任何
路由(/chat / /home / /marketplace 等)关闭独立窗口都能正确 reattach。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 4: ChatPage 顶栏拖出按钮

**Files:**
- Modify: `packages/app/src/features/chat/ChatPage.tsx`

- [ ] **Step 1: 加 imports**

打开 `packages/app/src/features/chat/ChatPage.tsx`,在现有 import 区追加:

```ts
import { ExternalLink } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { openDetachedLaneWindow } from '../model-arena/DetachedLaneRoute';
```

- [ ] **Step 2: 在 ChatPage 组件内部加 onPopout 回调**

在 `useArenaScope()` 与 `useModelArenaStore` 取数那段之后(line 50 左右),组件函数体内追加:

```ts
  const navigate = useNavigate();
  const setDetached = useModelArenaStore((s) => s.setDetached);

  /**
   * 页级"拖出独立窗口"按钮的 onClick:
   *   - 单泳道:lanes[0] 就是 main 道,直接 detach 它(不在 lanes 里硬编码 'main')
   *   - 多泳道:取第一条非 detached 的 lane(v1 简化:不跟踪 focused)
   *   - detach 后由 §0 effect 监听 active 数 = 0 跳 /home,本回调不重复跳
   */
  const onPopout = React.useCallback(() => {
    const target = lanes.find((l) => !l.detached);
    if (!target) return;
    openDetachedLaneWindow(scope, target.id, target.modelId);
    setDetached(scope, target.id, true);
  }, [lanes, scope, setDetached]);
```

- [ ] **Step 3: 加 0-active-lanes useEffect 跳 /home**

在 `useEffect(() => { if (lanes.length === 0) ...resetToSingleLane }` 之后追加:

```ts
  // 非 detached lane 数 = 0 → 主窗口聊天页空,跳 /home
  // (单泳道 detach / 多泳道全 detach 都走这条)
  React.useEffect(() => {
    const activeCount = lanes.filter((l) => !l.detached).length;
    if (activeCount === 0 && lanes.length > 0) {
      void navigate({ to: '/home' });
    }
  }, [lanes, navigate]);
```

注意条件 `lanes.length > 0`:刚启动时 lanes 可能是空数组(交给上面那个 effect 触发 resetToSingleLane),不要在这条 effect 里跳 /home。

- [ ] **Step 4: 在 renderTopActions 加按钮**

定位 `renderTopActions` 函数(line 62 左右),在最后一个 `<button>添加</button>` 之前插入新按钮(`AdvancedParams` 之前更合理):

```tsx
      <button
        type="button"
        onClick={onPopout}
        title="拖出独立窗口"
        aria-label="拖出独立窗口"
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
```

放到 AdvancedParams 之前 / "添加" 之前,顺序变成:
```
[Artifact 切换?] [☐ 统一发送?] [拖出 ⬈] [高级] [+ 添加]
```

- [ ] **Step 5: typecheck**

Run:
```bash
pnpm --filter @chayuan/app typecheck
```
Expected: 0 errors。

- [ ] **Step 6: 手动 smoke**

```bash
pnpm dev:web   # 或 pnpm dev:desktop
```

测试矩阵(对照 spec §5 行为矩阵):
1. **单泳道 detach**:进 /chat,顶栏点 ⬈ → 应弹出独立窗口 + 主窗口跳 /home
2. **多泳道 detach 部分**:点 + 添加 → 添加 1-2 条 lane;在顶栏点 ⬈ → 弹出第一条 lane + 主窗口剩余 lanes 渲染正常
3. **多泳道 detach 全部**:对每条 lane 用其头部按钮分别 detach → 主窗口最后会跳 /home(active count 降到 0)
4. **Reattach**:关闭任一独立窗口 → 主窗口对应 lane 重新可见;若主窗在 /home → nav 回 /chat

- [ ] **Step 7: commit**

```bash
git add chayuan-client/packages/app/src/features/chat/ChatPage.tsx
git commit -m "$(cat <<'COMMIT'
feat(chat): ChatPage 顶栏右上角拖出独立窗口按钮

新增页级 [⬈] 按钮,单/多泳道通用:点击 detach 当前 / 第一条非 detached
lane,主窗口非 detached lane 数降到 0 时自动 navigate('/home')。

修法:
  - onPopout 找 lanes.find(!detached) → openDetachedLaneWindow + setDetached(true)
  - 单独 useEffect 监 lanes 变化,filter 非 detached.length === 0 跳 /home
    (条件 lanes.length > 0 防止初始化空数组误判)
  - 顶栏渲染顺序:[Artifact?] [统一发送?] [⬈] [高级] [+ 添加]

不影响 Lane 头部原有 [折叠 / 拖出 / 关闭] 三件套。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 5: 推送 + 最终验收

**Files:** 无新改动,只是把所有 commit 推到远端 + 跑全量 check。

- [ ] **Step 1: 全包 typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm typecheck
```
Expected: 全 monorepo 0 errors。

- [ ] **Step 2: 跑 vitest 全量**

```bash
pnpm vitest run
```
Expected: 已有测试 + 新加的 settings 测试全 pass。

- [ ] **Step 3: 推送**

```bash
cd /work/chayuan-desktop
git push origin main
```

- [ ] **Step 4: 验收对照 spec §10**

- [ ] `pnpm typecheck` 0 错误
- [ ] 全新装(localStorage 空)字号 16px
- [ ] 单泳道点页级按钮 → 主跳 `/home`,独立窗口显示同会话
- [ ] 多泳道(2+ lanes)点页级按钮 → 主剩 N-1,独立窗口显示首条 lane
- [ ] 多泳道全部 detach → 主跳 `/home`
- [ ] 关闭独立窗口 → lane 回主窗口;若主在 `/home` → nav `/chat`

每条勾选时同时记录验证方式(devtools / 浏览器 / 桌面壳)。

---

## 自检 / 自我 review

(plan 写完后跑一遍,无遗漏即可)

- ✓ Spec §1-§9 每一节都有对应 task:§1 字号 → Task 1;§2 ChatPage 按钮 → Task 4;§4.4 reattach → Task 2+3;§4.3 0-lanes 跳 home → Task 4;§5 行为矩阵验收 → Task 4 step 6 + Task 5 step 4
- ✓ 没有 TBD / TODO / 占位文字
- ✓ 类型一致:`scope: string` / `laneId: string` / `lanes: Lane[]` 全局一致
- ✓ 函数签名:`openDetachedLaneWindow(scope, laneId, modelId?)` 与现有代码一致
- ✓ commit 频次:5 个独立 commit,DRY/YAGNI/TDD
