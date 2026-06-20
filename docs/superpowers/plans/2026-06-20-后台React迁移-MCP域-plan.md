# 后台 React 迁移·MCP 域 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。Steps 用 `- [ ]`。

**Goal:** 在 AdminPage 加「MCP」tab,React 化 MCP 连接管理(Profile 通用配置 + 连接列表/卡片/搜索/过滤 + 建/改弹窗),复用现成 `/mcp_connections` REST,补 Profile 前端 API。

**Architecture:** 后端零改动。`endpoints.ts` 补 `mcp.profile.*`。`features/admin/mcp/` 组件(McpPage/ProfilePanel/ConnectionList/Card/EditDialog + 共享 KvEditor),react-query 取数。stdio 不门控(后端 spawn),仅加"路径指服务器主机"提示。

**Tech Stack:** React19/TS/@tanstack/react-query/@chayuan/ui。

**环境**:仓库 root 所有→写文件/git 用 sudo,只 stage 改的;前端 typecheck `cd chayuan-client && node_modules/.bin/tsc -p packages/<api|app>/tsconfig.json --noEmit`;不 push/不 bump(最后统一)。

---

## 文件结构
- **Modify** `packages/api/src/endpoints.ts` — `mcp.profile.*` + `McpProfile` 类型。
- **Create** `packages/app/src/features/admin/mcp/KvEditor.tsx` — 共享 KV 编辑器。
- **Create** `.../mcp/McpEditDialog.tsx` — 建/改表单。
- **Create** `.../mcp/McpConnectionCard.tsx` — 单连接卡片。
- **Create** `.../mcp/McpConnectionList.tsx` — 列表+搜索+过滤+统计+新建。
- **Create** `.../mcp/McpProfilePanel.tsx` — 通用配置。
- **Create** `.../mcp/McpPage.tsx` — 编排。
- **Modify** `packages/app/src/features/admin/AdminPage.tsx` — MCP tab。

---

## Task 1: endpoints.ts 补 Profile API

**Files:** Modify `packages/api/src/endpoints.ts`

- [ ] **Step 1: 加 McpProfile 类型 + mcp.profile**

在 `McpConnectionInput` 接口后加：
```typescript
export interface McpProfile {
  timeout: number;
  working_dir: string;
  env_vars: Record<string, string>;
  update_time?: string | null;
}
export interface McpProfileInput {
  timeout: number;
  working_dir: string;
  env_vars: Record<string, string>;
}
```
在 `mcp` 对象内(`disable` 方法后、`};` 前)加：
```typescript
  profile: {
    async get(): Promise<McpProfile> {
      const r = await request<McpProfile>('/api/v1/mcp_connections/profile', { raw: true });
      return r.data;
    },
    async save(body: McpProfileInput): Promise<McpProfile> {
      const r = await request<McpProfile>('/api/v1/mcp_connections/profile', { method: 'POST', body, raw: true });
      return r.data;
    },
    async reset(): Promise<void> {
      await request('/api/v1/mcp_connections/profile/reset', { method: 'POST', raw: true });
    },
  },
```

- [ ] **Step 2: typecheck api**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 3: 提交** `feat(api): mcp.profile 客户端(get/save/reset)`

---

## Task 2: KvEditor 共享组件

**Files:** Create `packages/app/src/features/admin/mcp/KvEditor.tsx`

- [ ] **Step 1: 写组件**
```tsx
import * as React from 'react';
import { Button } from '@chayuan/ui';

/** key-value 编辑器(env_vars / headers 共用)。受控:value 为对象,onChange 回传新对象。 */
export const KvEditor: React.FC<{ value: Record<string, string>; onChange(v: Record<string, string>): void }> = ({ value, onChange }) => {
  const rows = Object.entries(value);
  const setRow = (i: number, k: string, v: string) => {
    const next: Record<string, string> = {};
    rows.forEach(([ok, ov], idx) => { if (idx === i) { if (k) next[k] = v; } else next[ok] = ov; });
    onChange(next);
  };
  const add = () => onChange({ ...value, '': '' });
  const del = (k: string) => { const next = { ...value }; delete next[k]; onChange(next); };
  return (
    <div className="space-y-1">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input className="w-1/3 rounded border p-1 text-xs" placeholder="KEY" value={k} onChange={(e) => setRow(i, e.target.value, v)} />
          <input className="flex-1 rounded border p-1 text-xs" placeholder="VALUE" value={v} onChange={(e) => setRow(i, k, e.target.value)} />
          <Button variant="ghost" onClick={() => del(k)}>×</Button>
        </div>
      ))}
      <Button variant="ghost" onClick={add}>+ 新增</Button>
    </div>
  );
};
```
- [ ] **Step 2: typecheck app** (exit 0)
- [ ] **Step 3: 提交** `feat(admin/mcp): KvEditor 共享 KV 编辑器`

---

## Task 3: McpEditDialog 建/改表单

**Files:** Create `.../mcp/McpEditDialog.tsx`

- [ ] **Step 1: 写组件**(字段:server_name 建可编辑/改只读、transport、timeout、enabled、description、stdio: command/args/cwd/env、sse: url/headers、高级 config JSON。stdio 加"路径指服务器主机"提示。保存 mcp.create/update)。完整代码见执行(用 McpConnection/McpConnectionInput + KvEditor;command/url 存进 config)。
- [ ] **Step 2: typecheck app** (exit 0)
- [ ] **Step 3: 提交** `feat(admin/mcp): McpEditDialog 建改表单`

---

## Task 4: McpConnectionCard + List

**Files:** Create `.../mcp/McpConnectionCard.tsx`、`.../mcp/McpConnectionList.tsx`

- [ ] **Step 1: Card**(transport/enabled chip、描述、command/url 预览、元信息、启停/编辑/删除)。
- [ ] **Step 2: List**(react-query `mcp.list()`、搜索框、filter 全部/启用/禁用、统计行、新建按钮、卡片网格、增删改后 refetch)。
- [ ] **Step 3: typecheck app** (exit 0)
- [ ] **Step 4: 提交** `feat(admin/mcp): 连接卡片+列表(搜索/过滤/统计)`

---

## Task 5: McpProfilePanel + McpPage

**Files:** Create `.../mcp/McpProfilePanel.tsx`、`.../mcp/McpPage.tsx`

- [ ] **Step 1: ProfilePanel**(react-query `mcp.profile.get()`、timeout/working_dir 输入、env_vars KvEditor、保存 `mcp.profile.save`、重置 `mcp.profile.reset` 带 confirm)。
- [ ] **Step 2: McpPage**(`<McpProfilePanel/><McpConnectionList/>`)。
- [ ] **Step 3: typecheck app** (exit 0)
- [ ] **Step 4: 提交** `feat(admin/mcp): Profile 配置面板 + McpPage 编排`

---

## Task 6: AdminPage MCP tab

**Files:** Modify `packages/app/src/features/admin/AdminPage.tsx`

- [ ] **Step 1: 4 处接线**(仿用户 tab):lucide 加 `Plug` 图标、`AdminTab` 加 `'mcp'`、import McpPage、TabButton + 内容 `{tab === 'mcp' && <McpPage />}`。
- [ ] **Step 2: typecheck app + web** (exit 0)
- [ ] **Step 3: 提交** `feat(admin): AdminPage 加 MCP tab`

---

## 自检
1. Spec 覆盖:§4 Profile API→T1;§5 KvEditor→T2、EditDialog→T3、Card/List→T4、ProfilePanel/McpPage→T5、tab→T6;§2 落点→T6。后端零改动(无后端 Task,符合 §3)。
2. 占位符:T3 表单代码"见执行"——执行时写全(用真实 McpConnection/Input + KvEditor)。
3. 类型一致:McpProfile/McpProfileInput/mcp.profile/McpConnection/McpConnectionInput 跨 Task 一致。

## 执行约束
sudo 写/git、只 stage 改的、不 push/不 bump(最后统一);前端 typecheck 必 exit 0;parity 后(用户验证)才删 NiceGUI mcp_manage_page。
