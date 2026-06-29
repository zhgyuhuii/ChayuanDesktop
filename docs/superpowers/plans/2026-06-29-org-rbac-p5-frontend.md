# 前端：组织机构/用户/角色/授权（P5）实施计划

> 每个 Task 一个 subagent。仓库根 /work/chayuan-desktop，分支 main，直接在 main 上做。前端无浏览器验证 → **验证 = `pnpm typecheck` 通过**（本机环境打不开 URL，运行时走查由用户后续做）。

**Goal:** 把 P1-P4 后端能力接到网络版后台 UI：新增「组织机构」页(组织+部门树+成员+部门角色)、用户多角色+部门、角色数据权限、知识库按 用户/角色/部门 授权。

## 通用约定
- 仓库 root 所有：写文件用 `sudo cp`(scratchpad temp → 目标 + `sudo chown root:root`)；git 用 sudo。只 stage 本 task 文件。不 push、不 bump(留 P6)。
- 文案中文硬编码(项目无 i18n)。UI 组件从 `@chayuan/ui` import；**无 Select**(用原生 `<select>`)、**无 Tree**(自实现递归)。API 从 `@chayuan/api` import。
- commit message 末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 路径：CLIENT=`/work/chayuan-desktop/chayuan-client`，APP=`CLIENT/packages/app/src`，API=`CLIENT/packages/api/src`。

## 验证(typecheck)
```
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/api typecheck   # 改 api 包后
pnpm --filter @chayuan/app typecheck   # 改 app 包后
# 若 pnpm 不可用,回退: cd packages/api && npx tsc -p tsconfig.json --noEmit
```
（首次可能要 `pnpm install`；若 sandbox 无法装依赖,至少跑单包 tsc。如实报告 typecheck 结果。）

## 后端契约(P1-P4 已上线,前端按此对接;http 自动剥 {code,msg,data} 返回 data)
- `GET /api/v1/admin/orgs` → `{orgs:[{id,name,code,order_num,status,remark}]}`
- `POST /api/v1/admin/orgs {name,code,order_num?,remark?}` → org
- `PATCH /api/v1/admin/orgs/{id} {name?,order_num?,remark?,status?}` → org
- `DELETE /api/v1/admin/orgs/{id}` → {deleted}
- `GET /api/v1/admin/depts?org_id=` → `{tree:[DeptNode{...,children:[]}]}`
- `POST /api/v1/admin/depts {org_id,parent_id?,name,order_num?,leader_user_id?}` → dept
- `PATCH /api/v1/admin/depts/{id} {name?,order_num?,leader_user_id?,status?}` → dept
- `POST /api/v1/admin/depts/{id}/move {new_parent_id}` → dept
- `DELETE /api/v1/admin/depts/{id}` → {deleted}
- `GET /api/v1/admin/depts/{id}/roles` → `{roles:[{role_name,include_subtree}]}`
- `PUT /api/v1/admin/depts/{id}/roles {roles:[{role_name,include_subtree}]}` → {roles}
- `GET /api/v1/admin/depts/{id}/members?include_subtree=&keyword=` → `{members:[{id,username,email,dept_id,is_active,roles:[]}]}`
- `POST /auth/users {username,password,role?,roles?,email?,dept_id?}` → UserPublic(含 roles,dept_id)
- `GET /auth/users` → `[UserPublic{...,roles:[],dept_id}]`
- `PUT /auth/users/{id}/roles {roles:[]}` → {roles}
- `PATCH /auth/users/{id}/dept {dept_id}` → ok
- `DELETE /auth/users/{id}` → ok
- `GET /api/v1/admin/roles` → `{roles:[{...,data_scope,scope_dept_ids?}], module_catalog}`（scope_dept_ids 由 P5-T5 后端微调补上）
- `POST /api/v1/admin/roles {...,data_scope,scope_dept_ids?}`；`PATCH /api/v1/admin/roles/{name} {...,data_scope?,scope_dept_ids?}`
- `GET /api/v1/admin/kb-acl/{kbId}/grants` → `{grants:[{subject_type,subject_id,role,include_subtree,user_id?,user?}]}`
- `POST /api/v1/admin/kb-acl/{kbId}/grants {subject_type,subject_id,role,include_subtree?}`（兼容 {user_id,role}）
- `DELETE /api/v1/admin/kb-acl/{kbId}/grants?subject_type=&subject_id=`

---

## Task P5-T1: API 客户端（orgs/depts 新增 + 扩 roles/admin/kbAcl + 导出）

**Files:** Create `API/orgs.ts`; Modify `API/roles.ts`、`API/admin.ts`、`API/endpoints.ts`、`API/index.ts`(导出)

- [ ] **Step 1** READ `API/index.ts` 看现有导出风格(roles/admin/kbAcl 怎么 re-export)；READ `API/client.ts` 确认 http.get 的 opts 支持 `{query:{...}}`(admin.ts 已用过)。
- [ ] **Step 2** 新建 `API/orgs.ts`（同时含 depts）:
```typescript
// packages/api/src/orgs.ts —— 组织 + 部门 管理(org-RBAC P5)。
import { http } from './client';

export interface Org { id: number; name: string; code: string; order_num: number; status: string; remark: string; }
export interface DeptNode {
  id: number; org_id: number; parent_id: number | null; ancestors: string;
  name: string; order_num: number; leader_user_id: number | null; status: string;
  children: DeptNode[];
}
export interface DeptRole { role_name: string; include_subtree: boolean; }
export interface DeptMember {
  id: number; username: string; email: string | null;
  dept_id: number | null; is_active: boolean; roles: string[];
}

export const orgs = {
  list: () => http.get<{ orgs: Org[] }>('/api/v1/admin/orgs').then((r) => r.orgs ?? []),
  create: (body: { name: string; code: string; order_num?: number; remark?: string }) =>
    http.post<Org>('/api/v1/admin/orgs', body),
  update: (id: number, body: { name?: string; order_num?: number; remark?: string; status?: string }) =>
    http.patch<Org>(`/api/v1/admin/orgs/${id}`, body),
  remove: (id: number) => http.del<{ deleted: number }>(`/api/v1/admin/orgs/${id}`),
};

export const depts = {
  tree: (orgId: number) =>
    http.get<{ tree: DeptNode[] }>('/api/v1/admin/depts', { query: { org_id: orgId } }).then((r) => r.tree ?? []),
  create: (body: { org_id: number; parent_id?: number | null; name: string; order_num?: number; leader_user_id?: number | null }) =>
    http.post<DeptNode>('/api/v1/admin/depts', body),
  update: (id: number, body: { name?: string; order_num?: number; leader_user_id?: number | null; status?: string }) =>
    http.patch<DeptNode>(`/api/v1/admin/depts/${id}`, body),
  move: (id: number, newParentId: number | null) =>
    http.post<DeptNode>(`/api/v1/admin/depts/${id}/move`, { new_parent_id: newParentId }),
  remove: (id: number) => http.del<{ deleted: number }>(`/api/v1/admin/depts/${id}`),
  roles: (id: number) =>
    http.get<{ roles: DeptRole[] }>(`/api/v1/admin/depts/${id}/roles`).then((r) => r.roles ?? []),
  setRoles: (id: number, roles: DeptRole[]) =>
    http.put<{ roles: DeptRole[] }>(`/api/v1/admin/depts/${id}/roles`, { roles }),
  members: (id: number, includeSubtree = false, keyword = '') =>
    http.get<{ members: DeptMember[] }>(`/api/v1/admin/depts/${id}/members`, { query: { include_subtree: includeSubtree, keyword } }).then((r) => r.members ?? []),
};
```
- [ ] **Step 3** 扩 `API/roles.ts`：`Role` 接口加 `data_scope: number;` 和 `scope_dept_ids?: number[];`；`create` body 加 `data_scope?: number; scope_dept_ids?: number[];`；`update` body 加 `data_scope?: number; scope_dept_ids?: number[];`。`MyModules` 加可选 `roles?: string[];`(后端已返回)。
- [ ] **Step 4** 扩 `API/admin.ts`：`AdminUserPublic` 接口(若有)加 `roles?: string[]; dept_id?: number | null;`；`adminCreateUser` body 加 `roles?: string[]; dept_id?: number | null;`；新增：
```typescript
export function adminSetUserRoles(userId: number, roles: string[]): Promise<{ roles: string[] }> {
  return http.put<{ roles: string[] }>(`/auth/users/${userId}/roles`, { roles });
}
export function adminSetUserDept(userId: number, deptId: number | null): Promise<{ code: number }> {
  return http.patch<{ code: number }>(`/auth/users/${userId}/dept`, { dept_id: deptId });
}
export function adminDeleteUser(userId: number): Promise<{ code: number }> {
  return http.del<{ code: number }>(`/auth/users/${userId}`);
}
export function adminListUsers(): Promise<AdminUserPublic[]> {
  return http.get<AdminUserPublic[]>('/auth/users');
}
```
（若 AdminUserPublic 类型不在 admin.ts，按其实际定义处补字段;adminListUsers 若已存在则只补类型。）
- [ ] **Step 5** 扩 `API/endpoints.ts` 的 kbAcl：`KbGrant` 接口改为支持泛化主体（保留旧字段可选兼容）：
```typescript
export interface KbGrant {
  subject_type: 'user' | 'role' | 'dept';
  subject_id: string;
  role: string;
  include_subtree?: boolean;
  user_id?: number;   // user 主体时后端附带
  user?: string;      // user 主体时后端附带用户名
  granted_by?: number | null;
}
```
并把 kbAcl 的 add/revoke 泛化（保留旧 addGrant(kbId,userId,role) 兼容签名 + 新增主体版）：
```typescript
  addGrant: (kbId: number, userId: number, role: string) =>
    http.post<unknown>(`/api/v1/admin/kb-acl/${kbId}/grants`, { user_id: userId, role }).then(() => undefined),
  addSubjectGrant: (kbId: number, subjectType: 'user'|'role'|'dept', subjectId: string, role: string, includeSubtree = false) =>
    http.post<unknown>(`/api/v1/admin/kb-acl/${kbId}/grants`, { subject_type: subjectType, subject_id: subjectId, role, include_subtree: includeSubtree }).then(() => undefined),
  revokeGrant: (kbId: number, userId: number) =>
    http.del<unknown>(`/api/v1/admin/kb-acl/${kbId}/grants`, { query: { subject_type: 'user', subject_id: String(userId) } }).then(() => undefined),
  revokeSubjectGrant: (kbId: number, subjectType: string, subjectId: string) =>
    http.del<unknown>(`/api/v1/admin/kb-acl/${kbId}/grants`, { query: { subject_type: subjectType, subject_id: subjectId } }).then(() => undefined),
```
（注：del 需支持 query opts;若现有 del 签名是 `del<T>(path, opts?)` 则 `{query:{...}}` 可用——READ client.ts 确认;若 del 不支持 query,改用旧路径 `/grants/{userId}` 删 user、对 role/dept 用 query path 拼接到 url。）
- [ ] **Step 6** 在 `API/index.ts` 导出 `orgs.ts`(orgs/depts + 类型)，照搬现有 re-export 风格。
- [ ] **Step 7** typecheck `@chayuan/api`，PASS。Commit（`feat(org): P5 api client — orgs/depts + roles/admin/kbAcl extensions`）。

---

## Task P5-T2: 共享部门树组件 DeptTree + DeptTreePicker

**Files:** Create `APP/features/admin/orgs/DeptTree.tsx`（递归渲染 + 选择）

- [ ] **Step 1** 写 `APP/features/admin/orgs/DeptTree.tsx`（自实现递归树，无第三方）:
```tsx
import * as React from 'react';
import type { DeptNode } from '@chayuan/api';

// 递归部门树:可点选(onSelect)、可显示勾选框(checked/onToggle 用于多选范围)。
export const DeptTree: React.FC<{
  nodes: DeptNode[];
  selectedId?: number | null;
  onSelect?: (d: DeptNode) => void;
  checkedIds?: Set<number>;
  onToggle?: (id: number) => void;
  depth?: number;
}> = ({ nodes, selectedId, onSelect, checkedIds, onToggle, depth = 0 }) => {
  const [collapsed, setCollapsed] = React.useState<Set<number>>(new Set());
  return (
    <ul className="text-sm">
      {nodes.map((n) => {
        const hasChildren = (n.children?.length ?? 0) > 0;
        const isCollapsed = collapsed.has(n.id);
        return (
          <li key={n.id}>
            <div
              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                selectedId === n.id ? 'bg-[var(--cy-brand-500)]/10 text-[var(--cy-brand-600)]' : 'hover:bg-[var(--cy-surface-2)]'
              }`}
              style={{ paddingLeft: depth * 14 + 4 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="w-4 text-xs opacity-60"
                  onClick={() =>
                    setCollapsed((s) => {
                      const x = new Set(s);
                      x.has(n.id) ? x.delete(n.id) : x.add(n.id);
                      return x;
                    })
                  }
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="w-4" />
              )}
              {checkedIds && onToggle ? (
                <input type="checkbox" checked={checkedIds.has(n.id)} onChange={() => onToggle(n.id)} />
              ) : null}
              <button type="button" className="flex-1 text-left" onClick={() => onSelect?.(n)}>
                {n.name}
              </button>
            </div>
            {hasChildren && !isCollapsed ? (
              <DeptTree
                nodes={n.children}
                selectedId={selectedId}
                onSelect={onSelect}
                checkedIds={checkedIds}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

// 扁平化树(取所有节点),给"部门下拉选择器"用。
export function flattenDepts(nodes: DeptNode[], depth = 0): { id: number; name: string; depth: number }[] {
  const out: { id: number; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flattenDepts(n.children, depth + 1));
  }
  return out;
}

// 部门下拉选择器(原生 select,缩进表层级)。orgId 变化时由父组件传入 tree。
export const DeptSelect: React.FC<{
  nodes: DeptNode[];
  value: number | null;
  onChange: (id: number | null) => void;
  allowEmpty?: boolean;
}> = ({ nodes, value, onChange, allowEmpty = true }) => {
  const flat = React.useMemo(() => flattenDepts(nodes), [nodes]);
  return (
    <select
      className="w-full rounded border p-2 text-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      {allowEmpty ? <option value="">（未分配 / 无）</option> : null}
      {flat.map((d) => (
        <option key={d.id} value={d.id}>
          {'  '.repeat(d.depth) + d.name}
        </option>
      ))}
    </select>
  );
};
```
- [ ] **Step 2** typecheck `@chayuan/app`，PASS。Commit（`feat(org): shared DeptTree/DeptSelect components`）。

---

## Task P5-T3: 组织机构页 OrgManagementPage + 注册 tab

**Files:** Create `APP/features/admin/orgs/OrgManagementPage.tsx`; Modify `APP/features/admin/AdminPage.tsx`(注册 'orgs' tab + 渲染)

- [ ] **Step 1** 写 `OrgManagementPage.tsx`（左:组织下拉+部门树+建组织/部门/删；右:选中部门的成员 + 部门继承角色）。用 `useQuery` 拉 orgs/depts.tree/depts.members/depts.roles，`reportError` 处理错误（import from `../../../store/errorDialog`，参照 GrantsDialog），`@chayuan/ui` Button。完整组件：
```tsx
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { orgs as orgsApi, depts as deptsApi, roles as rolesApi, type DeptNode } from '@chayuan/api';
import { reportError, notifySuccess } from '../../../store/errorDialog';
import { DeptTree } from './DeptTree';

export const OrgManagementPage: React.FC = () => {
  const [orgId, setOrgId] = React.useState<number | null>(null);
  const [sel, setSel] = React.useState<DeptNode | null>(null);
  const [includeSub, setIncludeSub] = React.useState(false);

  const orgsQ = useQuery({ queryKey: ['admin', 'orgs'], queryFn: () => orgsApi.list(), staleTime: 60_000 });
  React.useEffect(() => {
    if (orgId === null && orgsQ.data && orgsQ.data.length) setOrgId(orgsQ.data[0].id);
  }, [orgsQ.data, orgId]);

  const treeQ = useQuery({
    queryKey: ['admin', 'depts', orgId],
    queryFn: () => deptsApi.tree(orgId as number),
    enabled: orgId !== null,
  });
  const membersQ = useQuery({
    queryKey: ['admin', 'dept-members', sel?.id, includeSub],
    queryFn: () => deptsApi.members(sel!.id, includeSub),
    enabled: !!sel,
  });
  const deptRolesQ = useQuery({
    queryKey: ['admin', 'dept-roles', sel?.id],
    queryFn: () => deptsApi.roles(sel!.id),
    enabled: !!sel,
  });
  const allRolesQ = useQuery({ queryKey: ['admin', 'roles', 'all'], queryFn: () => rolesApi.list(), staleTime: 60_000 });

  const addOrg = async () => {
    const name = window.prompt ? null : null; // 桌面禁用 window.prompt;此页仅网络版,用浏览器原生 prompt 可接受
    void name;
    const nm = (typeof window !== 'undefined' && window.prompt) ? window.prompt('组织名称') : '';
    if (!nm) return;
    const code = (typeof window !== 'undefined' && window.prompt) ? window.prompt('组织编码(唯一,英文)') : '';
    if (!code) return;
    try { await orgsApi.create({ name: nm, code }); notifySuccess('已创建组织'); void orgsQ.refetch(); }
    catch (e) { reportError(e, '创建组织失败'); }
  };
  const addDept = async (parentId: number | null) => {
    if (orgId === null) return;
    const nm = (typeof window !== 'undefined' && window.prompt) ? window.prompt('部门名称') : '';
    if (!nm) return;
    try { await deptsApi.create({ org_id: orgId, parent_id: parentId, name: nm }); notifySuccess('已创建部门'); void treeQ.refetch(); }
    catch (e) { reportError(e, '创建部门失败'); }
  };
  const delDept = async (d: DeptNode) => {
    try { await deptsApi.remove(d.id); notifySuccess('已删除'); setSel(null); void treeQ.refetch(); }
    catch (e) { reportError(e, '删除部门失败(可能有子部门/成员)'); }
  };
  const toggleDeptRole = async (roleName: string, on: boolean) => {
    if (!sel) return;
    const cur = deptRolesQ.data ?? [];
    const next = on
      ? [...cur, { role_name: roleName, include_subtree: false }]
      : cur.filter((r) => r.role_name !== roleName);
    try { await deptsApi.setRoles(sel.id, next); void deptRolesQ.refetch(); }
    catch (e) { reportError(e, '保存部门角色失败'); }
  };
  const toggleDeptRoleSubtree = async (roleName: string, sub: boolean) => {
    if (!sel) return;
    const next = (deptRolesQ.data ?? []).map((r) => r.role_name === roleName ? { ...r, include_subtree: sub } : r);
    try { await deptsApi.setRoles(sel.id, next); void deptRolesQ.refetch(); }
    catch (e) { reportError(e, '保存失败'); }
  };

  return (
    <div className="flex h-full gap-4 p-4">
      <div className="w-72 shrink-0 rounded-lg border border-[var(--cy-border-subtle)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <select className="flex-1 rounded border p-1.5 text-sm" value={orgId ?? ''} onChange={(e) => { setOrgId(e.target.value === '' ? null : Number(e.target.value)); setSel(null); }}>
            {(orgsQ.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => void addOrg()}>+组织</Button>
        </div>
        <div className="mb-2 flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => void addDept(null)}>+根部门</Button>
          {sel ? <Button variant="ghost" size="sm" onClick={() => void addDept(sel.id)}>+子部门</Button> : null}
          {sel ? <Button variant="ghost" size="sm" onClick={() => void delDept(sel)}>删</Button> : null}
        </div>
        <DeptTree nodes={treeQ.data ?? []} selectedId={sel?.id ?? null} onSelect={setSel} />
      </div>

      <div className="flex-1 rounded-lg border border-[var(--cy-border-subtle)] p-3">
        {!sel ? (
          <div className="text-sm text-muted-foreground">请选择左侧部门</div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-medium">{sel.name} · 成员</div>
              <label className="text-xs"><input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> 含下级</label>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="p-1">用户名</th><th className="p-1">角色</th><th className="p-1">状态</th></tr></thead>
              <tbody>
                {(membersQ.data ?? []).map((m) => (
                  <tr key={m.id} className="border-t"><td className="p-1">{m.username}</td><td className="p-1">{m.roles.join(', ')}</td><td className="p-1">{m.is_active ? '正常' : '停用'}</td></tr>
                ))}
                {!(membersQ.data ?? []).length ? <tr><td colSpan={3} className="p-2 text-muted-foreground">暂无成员</td></tr> : null}
              </tbody>
            </table>

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium opacity-70">部门继承角色（成员自动获得这些角色的功能权）</div>
              <div className="space-y-1">
                {(allRolesQ.data?.roles ?? []).map((r) => {
                  const dr = (deptRolesQ.data ?? []).find((x) => x.role_name === r.name);
                  const on = !!dr;
                  return (
                    <div key={r.name} className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={on} onChange={(e) => void toggleDeptRole(r.name, e.target.checked)} />{r.name}</label>
                      {on ? <label className="flex items-center gap-1 text-xs opacity-70"><input type="checkbox" checked={dr!.include_subtree} onChange={(e) => void toggleDeptRoleSubtree(r.name, e.target.checked)} />传给下级</label> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
```
注：本页仅网络版后台用，浏览器原生 `window.prompt` 可用（桌面禁用 prompt 的规则是针对桌面 webview；网络版后台跑在浏览器）。如项目有统一 `promptDialog` 则优先用它——先 grep `promptDialog`，有就替换 window.prompt。
- [ ] **Step 2** 确认 `notifySuccess`/`reportError` 的真实导出位置（grep `export .*notifySuccess`、`export .*reportError`，多半在 `APP/store/errorDialog`；按实际路径修正 import）。
- [ ] **Step 3** 改 `AdminPage.tsx`：`AdminTab` 联合类型加 `'orgs'`；`ADMIN_GROUPS` 的「用户与权限」分组 items 插入 `{ key: 'orgs', label: '组织机构', icon: Building2 }`（从 lucide-react import 一个图标如 `Building2`，参照文件现有图标 import）；条件渲染处加 `{tab === 'orgs' && <OrgManagementPage />}`（import OrgManagementPage）。
- [ ] **Step 4** typecheck `@chayuan/app` PASS。Commit（`feat(org): 组织机构 admin page + tab`）。

---

## Task P5-T4: 用户页升级（多角色 + 部门）

**Files:** Modify `APP/features/admin/users/CreateUserDialog.tsx`（多角色多选 + 部门选择）

- [ ] **Step 1** READ 现有 CreateUserDialog.tsx（已知结构）。把单 `role` select 改成多角色复选 + 部门选择：
  - 状态：`const [roleSet, setRoleSet] = React.useState<Set<string>>(new Set(['user']));` 和 `const [deptId, setDeptId] = React.useState<number|null>(null);`
  - 拉部门：用 orgs/depts API——为简化，新增一个组织下拉(orgsApi.list) + 部门下拉(deptsApi.tree(orgId) + DeptSelect)。enabled: open。
  - 角色复选：用 rolesQ.data.roles 渲染 checkbox 列表(复用 RoleManagement 的勾选风格,或简单 checkbox)。
  - submit 改为：`await adminCreateUser({ username, password, roles: Array.from(roleSet), email, dept_id: deptId });`
  - import `orgs as orgsApi, depts as deptsApi` + `DeptSelect` from `../orgs/DeptTree`。
- [ ] **Step 2** typecheck PASS。Commit（`feat(org): 新建用户支持多角色 + 部门`）。
（说明：UsersTable 的部门列依赖后端 snapshot 暂未带 dept_id，本期不改表格列；多角色/部门通过新建对话框落地，编辑现有用户的角色/部门可后续接 adminSetUserRoles/adminSetUserDept。）

---

## Task P5-T5: 角色页数据权限 + 后端微调返回 scope_dept_ids

**Files:** Modify `SRV/api_server/roles_routes.py`(GET 每角色补 scope_dept_ids) + `APP/features/admin/roles/RoleManagementPage.tsx`(data_scope 单选 + 自定义部门勾选树)

- [ ] **Step 1（后端微调）** 改 `SRV/api_server/roles_routes.py` 的 `list_roles`：对返回的每个 role dict 补 `scope_dept_ids`（调 `role_repository.get_role_scope(name)` 取 depts）。最小改动：构造返回时 `for r in roles: r["scope_dept_ids"] = repo.get_role_scope(r["name"])[1]`。源码 root 所有,temp+sudo cp。补一条后端测试或手动验证 GET 返回含 scope_dept_ids。
- [ ] **Step 2（前端）** 改 `RoleEditDialog`（RoleManagementPage.tsx）：
  - 加状态 `const [dataScope, setDataScope] = React.useState<number>(role?.data_scope ?? 3);` 和 `const [scopeDepts, setScopeDepts] = React.useState<Set<number>>(new Set(role?.scope_dept_ids ?? []));`
  - 在模块矩阵下方加「数据权限范围」单选(1全部/4本部门及以下/3本部门/5仅本人/2自定义)，原生 radio 或按钮组。
  - data_scope==2 时显示部门勾选树：拉 orgs/depts(orgsApi.list + deptsApi.tree(orgId))，用 `<DeptTree nodes={tree} checkedIds={scopeDepts} onToggle={...} />`。
  - save 改：`rolesApi.create({name,description,modules:[...],data_scope:dataScope,scope_dept_ids:Array.from(scopeDepts)})` 和 update 同理带 data_scope/scope_dept_ids。
  - import `orgs as orgsApi, depts as deptsApi` + `DeptTree` from `../orgs/DeptTree`。
- [ ] **Step 3** typecheck `@chayuan/app`（前端）PASS；后端微调跑现有 roles 测试 `test_role_data_scope.py` 仍绿（用后端测试配方）。Commit（`feat(org): 角色页数据权限范围 + 自定义部门 + roles GET 返回 scope_dept_ids`），stage 后端 roles_routes.py + 前端 RoleManagementPage.tsx（跨包但同一功能,一并提交）。

---

## Task P5-T6: 知识库授权对话框升级（用户/角色/部门 + 子树）

**Files:** Modify `APP/features/admin/kbmanage/GrantsDialog.tsx`

- [ ] **Step 1** READ 现有 GrantsDialog.tsx。升级为主体三选一：
  - 状态：`const [subjectType, setSubjectType] = React.useState<'user'|'role'|'dept'>('user');` `const [subjectId, setSubjectId] = React.useState<string>('');` `const [includeSub, setIncludeSub] = React.useState(false);` `const [role, setRole] = React.useState('reader');`
  - 对象类型原生 select(用户/角色/部门)。
  - 选择器：user → 现有 users 下拉(value=String(u.id))；role → 拉 rolesApi.list() 角色下拉(value=r.name)；dept → 组织下拉+部门下拉(orgsApi.list + deptsApi.tree + DeptSelect,value=String(dept.id)) + 「含下级部门」勾选。
  - add：`await kbAcl.addSubjectGrant(kb.id, subjectType, subjectId, role, includeSub);`
  - 已授权列表：grants 现含 subject_type/subject_id/role/include_subtree；展示「类型·标识 角色 [撤销]」，撤销调 `kbAcl.revokeSubjectGrant(kb.id, g.subject_type, g.subject_id)`。user 主体显示 g.user 名,其它显示 subject_id。
  - import `orgs as orgsApi, depts as deptsApi, roles as rolesApi` + `DeptSelect`。
- [ ] **Step 2** typecheck PASS。Commit（`feat(org): 知识库授权支持 用户/角色/部门(含子树)`）。

---

## Task P5-T7: P5 收尾（controller 跑）
- 全包 typecheck(`pnpm -r typecheck` 或逐包) PASS；后端全量回归仍绿(P5-T5 动了 roles_routes)；bump+push。

## 自查
- Spec 覆盖:api 客户端(T1)、DeptTree 复用(T2)、组织机构页(T3)、用户多角色+部门(T4)、角色数据权限(T5)、KB 授权泛化对话框(T6)、tab 注册(T3)。
- 验证局限:无浏览器,仅 typecheck;运行时走查留用户。
- 复用:DeptTree/DeptSelect 在 T3/T4/T5/T6 四处复用(守"能复用就复用")。
