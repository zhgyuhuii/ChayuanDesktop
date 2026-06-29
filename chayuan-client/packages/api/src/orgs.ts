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
