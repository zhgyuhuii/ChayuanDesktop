# 管理端知识库管理复用知识中心 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽出自包含的 `KbCreateFlow` 创建流程组件,让用户侧知识中心与管理端知识库管理共用同一套创建 UI(3 类),并把管理端 kbmanage/kbacl 两页合并为一个、授权层复用 GrantsDialog。

**Architecture:** 方案 A —— `KbCreateFlow` 内部包装 `CreateKbDialog`(文档/向量)+ `AddStructuredSourceDialog`(结构化),对外只暴露 `{open,onOpenChange,onCreated,initialKind}`,消除两端重复的 onPickStructured 接线。管理端合并页在网格+详情里复用 KbCard / 文件分片 / GrantsDialog,详情头新增可见性/owner 编辑(吸收自 kbacl)。后端零改动。

**Tech Stack:** React + TypeScript, packages/app, lucide-react, @chayuan/ui, @chayuan/api, @tanstack/react-query。

**测试策略(诚实说明):** 本仓 kb/admin 这些 React 组件**无单测框架**(既有 kb 功能零单测,验收闸门是 `tsc --noEmit` + 手动冒烟)。本计划不强加 pytest/vitest 式 TDD,每个任务以 typecheck 通过 + 明确的手动核对项 + commit 收尾,遵循既有代码模式。仓库 root 拥有,所有写/git 用 `sudo`(见各步)。tsc 用 `/work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc`(只读,免 sudo)。

---

## 文件结构

```
新增  packages/app/src/features/kb/create/KbCreateFlow.tsx
新增  packages/app/src/features/admin/kbmanage/GrantsDialog.tsx   (从 KbAclPage 迁出)
改动  packages/app/src/features/kb/KbBoard.tsx
改动  packages/app/src/features/admin/kbmanage/KbManagePage.tsx
改动  packages/app/src/features/admin/AdminPage.tsx
删除  packages/app/src/features/admin/kbacl/KbAclPage.tsx
```

通用命令:
- typecheck: `cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit`
- 写 root 文件: 用 `sudo python3` 脚本做精确字符串替换(Edit 工具会因 root 拥有而 EACCES)。

---

### Task 1: 新增 KbCreateFlow 包装组件

**Files:**
- Create: `packages/app/src/features/kb/create/KbCreateFlow.tsx`

- [ ] **Step 1: 创建文件**(sudo 写入下列完整内容)

```tsx
/**
 * KbCreateFlow —— 自包含的「创建知识库」流程包装。
 *
 * 把 CreateKbDialog(文档 / 向量,内部表单)与 AddStructuredSourceDialog(结构化,独立对话框)
 * 的接线收进一个组件,对外只暴露 {open, onOpenChange, onCreated, initialKind}。
 * 用户侧 KbBoard 与 管理端 KbManagePage 共用此组件,不再各自重复 onPickStructured 接线。
 *
 * 用法:
 *   <KbCreateFlow open={open} onOpenChange={setOpen} onCreated={(kuId, kind) => refetch()} />
 *   <KbCreateFlow open initialKind="structured" .../>  // 直接进结构化,跳过类型选择屏
 */
import * as React from 'react';
import type { KuKind } from '@chayuan/api';
import { CreateKbDialog } from './CreateKbDialog';
import { AddStructuredSourceDialog } from '../AddStructuredSourceDialog';

export interface KbCreateFlowProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 创建成功;kuId 形如 doc:<name> / src:<id>,kind 为知识源类型。 */
  onCreated?(kuId: string, kind: KuKind): void;
  /** 可选:直接进某类表单,跳过类型选择屏。'structured' 时直开结构化对话框。 */
  initialKind?: KuKind;
}

export const KbCreateFlow: React.FC<KbCreateFlowProps> = ({
  open,
  onOpenChange,
  onCreated,
  initialKind,
}) => {
  // 「选择屏里点结构化」触发的内部开关
  const [pickerStructured, setPickerStructured] = React.useState(false);
  // initialKind === 'structured':绕过 CreateKbDialog(它的 body 不渲染结构化),直接开结构化对话框
  const directStructured = open && initialKind === 'structured';
  const structuredOpen = pickerStructured || directStructured;

  const closeStructured = () => {
    setPickerStructured(false);
    if (directStructured) onOpenChange(false); // 直开模式下关闭即关闭整个流程
  };

  return (
    <>
      <CreateKbDialog
        open={open && initialKind !== 'structured'}
        initialKind={initialKind === 'structured' ? undefined : initialKind}
        onOpenChange={onOpenChange}
        onPickStructured={() => setPickerStructured(true)}
        onCreated={onCreated}
      />
      <AddStructuredSourceDialog
        open={structuredOpen}
        onOpenChange={(o) => { if (!o) closeStructured(); }}
        onCreated={(sourceId) => {
          closeStructured();
          onCreated?.(`src:${sourceId}`, 'structured');
        }}
      />
    </>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: EXIT 0(新文件被纳入但暂无消费方,应无类型错误)。

- [ ] **Step 3: commit**

```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/kb/create/KbCreateFlow.tsx
sudo git commit -m "feat(kb): 新增 KbCreateFlow 自包含创建流程包装(复用骨架)"
```

---

### Task 2: KbBoard 改用 KbCreateFlow(消除重复接线)

**Files:**
- Modify: `packages/app/src/features/kb/KbBoard.tsx`

现状(已核实):
- import:`AddStructuredSourceDialog`(line ~75)、`CreateKbDialog`(line ~80)
- state:`const [addStructuredOpen, setAddStructuredOpen] = React.useState(false);`(line ~167)
- 头部按钮:`onCreateDb={() => setAddStructuredOpen(true)}`(line ~603)
- 渲染块(line ~718-733):`<AddStructuredSourceDialog .../>` + `<CreateKbDialog ... onPickStructured ... onCreated .../>`

- [ ] **Step 1: 替换两处 import 为 KbCreateFlow**

删除:
```tsx
import { AddStructuredSourceDialog } from './AddStructuredSourceDialog';
```
和
```tsx
import { CreateKbDialog } from './create/CreateKbDialog';
```
新增(放在原 CreateKbDialog import 位置):
```tsx
import { KbCreateFlow } from './create/KbCreateFlow';
```

- [ ] **Step 2: 删除 addStructuredOpen state**

删除整行:
```tsx
  const [addStructuredOpen, setAddStructuredOpen] = React.useState(false);
```

- [ ] **Step 3: 头部「建数据库」按钮改走统一入口**

把:
```tsx
              onCreateDb={() => setAddStructuredOpen(true)}
```
改为:
```tsx
              onCreateDb={() => setCreateOpen({ kind: 'structured' })}
```

- [ ] **Step 4: 渲染块两个对话框合并为一个 KbCreateFlow**

把(line ~718-733):
```tsx
      <AddStructuredSourceDialog
        open={addStructuredOpen}
        onOpenChange={setAddStructuredOpen}
      />

      <CreateKbDialog
        open={createOpen != null}
        initialKind={createOpen?.kind}
        onOpenChange={(o) => { if (!o) setCreateOpen(null); }}
        onPickStructured={() => setAddStructuredOpen(true)}
        onCreated={(kuId) => {
          // 刚建好就让用户能看到+操作:在 TabBar 上新开一个详情 Tab
          // refetch 先跑,onOpenKb 才能拿到正确的 display_name
          void list.refetch().finally(() => onOpenKb(kuId));
        }}
      />
```
替换为:
```tsx
      <KbCreateFlow
        open={createOpen != null}
        initialKind={createOpen?.kind}
        onOpenChange={(o) => { if (!o) setCreateOpen(null); }}
        onCreated={(kuId) => {
          // 刚建好就让用户能看到+操作:在 TabBar 上新开一个详情 Tab
          // refetch 先跑,onOpenKb 才能拿到正确的 display_name
          void list.refetch().finally(() => onOpenKb(kuId));
        }}
      />
```

- [ ] **Step 5: typecheck**

Run: 同 Task1 Step2。Expected: EXIT 0,且无「addStructuredOpen / AddStructuredSourceDialog / CreateKbDialog 未使用」类报错(若有则说明漏删/漏改,回查)。

- [ ] **Step 6: 手动核对(记录,不阻塞)**

确认 KbBoard 头部:新建(picker)、建文档、建图像、建向量、建数据库五个入口仍各自正确打开;结构化创建成功后会 `onCreated('src:<id>','structured')` → 刷新+开详情(这是相对现状的小增益,原 onCreateDb 路径创建后不刷新)。

- [ ] **Step 7: commit**

```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/kb/KbBoard.tsx
sudo git commit -m "refactor(kb): KbBoard 改用 KbCreateFlow,去重创建接线"
```

---

### Task 3: 迁出 GrantsDialog 到独立文件

**Files:**
- Create: `packages/app/src/features/admin/kbmanage/GrantsDialog.tsx`
- Modify: `packages/app/src/features/admin/kbmanage/KbManagePage.tsx`(改 import 来源)

- [ ] **Step 1: 新建 GrantsDialog.tsx**(内容逐字搬自 KbAclPage.tsx 的 GrantsDialog,补齐 import)

```tsx
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { kbAcl, type KbAclItem, type KbAclUser, type KbGrant } from '@chayuan/api';
import { reportError } from '../../../store/errorDialog';

export const GrantsDialog: React.FC<{ kb: KbAclItem; users: KbAclUser[]; onClose(): void }> = ({ kb, users, onClose }) => {
  const q = useQuery({ queryKey: ['admin', 'kb-acl', kb.id, 'grants'], queryFn: () => kbAcl.grants(kb.id) });
  const grants = q.data ?? [];
  const [uid, setUid] = React.useState<number | ''>('');
  const [role, setRole] = React.useState('reader');
  const grantedIds = new Set(grants.map((g) => g.user_id));
  const candidates = users.filter((u) => !grantedIds.has(u.id) && u.id !== kb.owner_id);

  const add = async () => { if (uid === '') return; try { await kbAcl.addGrant(kb.id, Number(uid), role); setUid(''); void q.refetch(); } catch (e) { reportError(e, '授权失败'); } };
  const revoke = async (g: KbGrant) => { try { await kbAcl.revokeGrant(kb.id, g.user_id); void q.refetch(); } catch (e) { reportError(e, '撤销失败'); } };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-semibold">授权 · {kb.kb_name}</h2>
        <div className="flex gap-2">
          <select className="flex-1 rounded border p-2 text-sm" value={uid} onChange={(e) => setUid(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">选择用户…</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
          <select className="rounded border p-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}><option value="reader">reader</option><option value="editor">editor</option></select>
          <Button disabled={uid === ''} onClick={() => void add()}>授权</Button>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="p-1">用户</th><th className="p-1">角色</th><th className="p-1">操作</th></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.user_id} className="border-t"><td className="p-1">{g.user}</td><td className="p-1">{g.role}</td><td className="p-1"><Button variant="ghost" onClick={() => void revoke(g)}>撤销</Button></td></tr>
            ))}
            {!grants.length ? <tr><td colSpan={3} className="p-2 text-muted-foreground">暂无授权</td></tr> : null}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={onClose}>关闭</Button></div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: KbManagePage 改 import 来源**

把:
```tsx
import { GrantsDialog, CreateKbDialog } from '../kbacl/KbAclPage';
```
暂改为(本任务只动 GrantsDialog 来源;CreateKbDialog 在 Task 4 移除):
```tsx
import { CreateKbDialog } from '../kbacl/KbAclPage';
import { GrantsDialog } from './GrantsDialog';
```

- [ ] **Step 3: typecheck**

Run: 同上。Expected: EXIT 0。

- [ ] **Step 4: commit**

```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/admin/kbmanage/GrantsDialog.tsx chayuan-client/packages/app/src/features/admin/kbmanage/KbManagePage.tsx
sudo git commit -m "refactor(admin/kb): 迁出 GrantsDialog 为独立模块"
```

---

### Task 4: 合并页 —— KbManagePage 用 KbCreateFlow + 详情新增 可见性/owner

**Files:**
- Modify: `packages/app/src/features/admin/kbmanage/KbManagePage.tsx`

- [ ] **Step 1: 改 import**

把 Task 3 留下的:
```tsx
import { CreateKbDialog } from '../kbacl/KbAclPage';
import { GrantsDialog } from './GrantsDialog';
```
改为:
```tsx
import { GrantsDialog } from './GrantsDialog';
import { KbCreateFlow } from '../../kb/create/KbCreateFlow';
```

- [ ] **Step 2: 加 setVis / setOwner(详情头编辑用)**

在组件内 `load` 定义之后新增两个回调(逻辑搬自原 KbAclPage):
```tsx
  const setVis = async (id: number, v: string) => {
    try { await kbAcl.setVisibility(id, v); await load(); }
    catch (e) { reportError(e, '修改可见性失败'); }
  };
  const setOwner = async (id: number, ownerId: number | null) => {
    try { await kbAcl.setOwner(id, ownerId); await load(); }
    catch (e) { reportError(e, '修改 owner 失败'); }
  };
```

- [ ] **Step 3: 详情头部 把只读的可见性/owner 文本换成可编辑下拉**

把详情态头部这一段:
```tsx
          <span className="text-[11px] opacity-50">{sel.visibility} · owner {sel.owner_id ?? '—'}</span>
          <span className="flex-1" />
          {acl ? (
            <Button size="sm" variant="outline" onClick={() => setGrantsAcl(acl)}><Lock className="mr-1.5 h-4 w-4" /> 授权</Button>
          ) : null}
```
替换为:
```tsx
          <span className="flex-1" />
          {acl ? (
            <>
              <label className="text-[11px] opacity-60">可见性</label>
              <select className="rounded border p-1 text-xs" value={acl.visibility} onChange={(e) => void setVis(acl.id, e.target.value)}>
                <option value="private">private</option>
                <option value="public">public</option>
              </select>
              <label className="text-[11px] opacity-60">owner</label>
              <select className="rounded border p-1 text-xs" value={acl.owner_id ?? 0} onChange={(e) => void setOwner(acl.id, Number(e.target.value) || null)}>
                <option value={0}>（无）</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
              <Button size="sm" variant="outline" onClick={() => setGrantsAcl(acl)}><Lock className="mr-1.5 h-4 w-4" /> 授权</Button>
            </>
          ) : (
            <span className="text-[11px] opacity-50">{sel.visibility} · owner {sel.owner_id ?? '—'}</span>
          )}
```

- [ ] **Step 4: 网格态创建对话框换成 KbCreateFlow**

把网格态底部:
```tsx
      {createOpen ? <CreateKbDialog users={users} onClose={() => setCreateOpen(false)} onCreated={() => void load()} /> : null}
```
替换为:
```tsx
      <KbCreateFlow open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
```
(`createOpen` 仍是 boolean state,`setCreateOpen(true)` 由「添加知识库」按钮触发,无需改。)

- [ ] **Step 5: 头部说明文案更新(合并语义)**

把:
```tsx
          <p className="mt-1 text-sm text-muted-foreground">全系统知识库(管理员视角)。点卡片进入:授权 / 文件 / 分片管理。</p>
```
改为:
```tsx
          <p className="mt-1 text-sm text-muted-foreground">全系统知识库(管理员视角)。可新建文档 / 数据库 / 外部向量库;点卡片进入:可见性 / owner / 授权 / 文件分片管理。</p>
```

- [ ] **Step 6: typecheck**

Run: 同上。Expected: EXIT 0。若报 `CreateKbDialog` 未使用/找不到,说明 Step1/4 漏改;若报 `Lock` 仍需保留(详情授权按钮在用),无需动 import。

- [ ] **Step 7: 手动核对**

`/admin/kbmanage`:① 添加知识库 → 出现 3 类选择屏(文档/数据库/外部向量库);分别能建。② 点文档库卡 → 详情可改 可见性/owner、点授权弹 GrantsDialog、文件/分片可编辑。③ 点非文档卡(向量/结构化)→ 显示「无文件管理」+(若有 acl)可见性/owner/授权。

- [ ] **Step 8: commit**

```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/admin/kbmanage/KbManagePage.tsx
sudo git commit -m "feat(admin/kb): 知识库管理复用 KbCreateFlow(3类)+ 详情内联 可见性/owner"
```

---

### Task 5: 移除 kbacl tab 与 KbAclPage,旧深链重定向

**Files:**
- Modify: `packages/app/src/features/admin/AdminPage.tsx`
- Delete: `packages/app/src/features/admin/kbacl/KbAclPage.tsx`

现状(已核实行号,实施前以实际为准):
- line 17: `import { KbAclPage } from './kbacl/KbAclPage';`
- line 38: `AdminTab` 联合类型含 `| 'kbacl' |`
- line 48: `{ key: 'kbacl', label: 'KB 授权', icon: Lock },`
- line 92: `const normTab = (t?: string): AdminTab => (t && KNOWN_TABS.has(t as AdminTab) ? (t as AdminTab) : 'users');`
- line 321: `{tab === 'kbacl' && <KbAclPage />}`

- [ ] **Step 1: 删 import**

删除整行:
```tsx
import { KbAclPage } from './kbacl/KbAclPage';
```

- [ ] **Step 2: AdminTab 类型去掉 'kbacl'**

在 line 38 的联合类型里删除 `| 'kbacl'`(把 `... | 'apps' | 'kbacl' | 'perf' ...` 改为 `... | 'apps' | 'perf' ...`)。

- [ ] **Step 3: ADMIN_GROUPS 删 kbacl 项**

删除整行:
```tsx
    { key: 'kbacl', label: 'KB 授权', icon: Lock },
```
(删后检查:若 `Lock` 图标在 AdminPage 其它处不再使用,顺手从 lucide-react import 删 `Lock`;typecheck 报 `Lock` 未使用即据此处理。)

- [ ] **Step 4: 删渲染分支**

删除整行:
```tsx
          {tab === 'kbacl' && <KbAclPage />}
```

- [ ] **Step 5: normTab 旧深链重定向 kbacl → kbmanage**

把:
```tsx
const normTab = (t?: string): AdminTab => (t && KNOWN_TABS.has(t as AdminTab) ? (t as AdminTab) : 'users');
```
改为:
```tsx
const normTab = (t?: string): AdminTab => {
  if (t === 'kbacl') return 'kbmanage'; // 旧「KB 授权」页已并入「知识库管理」
  return t && KNOWN_TABS.has(t as AdminTab) ? (t as AdminTab) : 'users';
};
```

- [ ] **Step 6: 删除 KbAclPage 文件**

```bash
cd /work/chayuan-desktop
sudo git rm chayuan-client/packages/app/src/features/admin/kbacl/KbAclPage.tsx
```
(该文件原导出 GrantsDialog 已迁出[Task3]、CreateKbDialog 已废弃[Task4],无其它引用。)

- [ ] **Step 7: typecheck**

Run: 同上。Expected: EXIT 0,无任何对 `./kbacl/KbAclPage` 的悬空引用。

- [ ] **Step 8: 手动核对**

后台左侧菜单不再有「KB 授权」项;「知识库管理」仍在;手动访问 `/admin/kbacl` → 落到「知识库管理」(kbmanage)。「知识库配置」(kbcfg)不受影响。

- [ ] **Step 9: commit**

```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/admin/AdminPage.tsx
sudo git commit -m "refactor(admin): 合并 kbacl 入知识库管理,删 KbAclPage + 旧深链重定向"
```

---

### Task 6: 整体 typecheck + 版本 bump + 推送

- [ ] **Step 1: 全量 typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: EXIT 0。

- [ ] **Step 2: bump 版本(改了程序代码)**

```bash
cd /work/chayuan-desktop
sudo python3.11 scripts/bump-version.py
```
Expected: 打印 `bump 2.0.X -> 2.0.X+1 tauri=OK pyproject=OK init=OK`。

- [ ] **Step 3: stage bump 文件 + commit + push**

```bash
cd /work/chayuan-desktop
sudo git add -- VERSION chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/chayuan/__init__.py chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json
sudo git commit -m "chore(release): bump 版本(知识库管理复用)"
sudo git push origin main
```

- [ ] **Step 4: 收尾说明**

汇总改动文件、typecheck 结果;提醒:docker 网络版需重建镜像、单机版需重建 desktop + 重启 sidecar 才能看到新界面。授权覆盖面假设(kbAcl.list 是否含非文档源)在手动核对 Task4 Step7 第③项时实证。

---

## Self-Review(写计划后自检)

- **Spec 覆盖**:① KbCreateFlow 抽取=Task1;② 用户侧复用=Task2;③ GrantsDialog 模块化=Task3;④ 合并页+3类+详情授权=Task4;⑤ 删 kbacl/重定向=Task5;⑥ 验证/版本=Task6。spec 各节均有对应任务,无缺口。
- **占位扫描**:无 TBD/TODO;每个代码步给了完整代码或精确 old→new。
- **类型一致**:`KbCreateFlowProps {open,onOpenChange,onCreated,initialKind}` 在 Task1 定义,Task2/Task4 按此调用一致;`onCreated(kuId,kind)` 签名两处一致;`kbAcl.setVisibility/setOwner/grants/addGrant/revokeGrant` 与 KbAclPage 既有用法一致;`KbAclItem {id,kb_name,visibility,owner_id}` 字段在 Task4 详情下拉与 Task3 GrantsDialog 一致。
- **风险**:`AddStructuredSourceDialog` 的 `onCreated(sourceId:number)` 在 KbCreateFlow 里包成 `src:<id>` —— 与 spec 数据流一致。
