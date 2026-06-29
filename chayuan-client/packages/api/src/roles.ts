// packages/api/src/roles.ts —— 角色管理 + 当前用户模块(RBAC 按模块授权 #2)。
import { http } from './client';

export interface Role {
  id: number;
  name: string;
  description: string;
  is_system: boolean;
  modules: string[];
  /** 数据权限范围:1全部/2自定义/3本部门/4本部门及以下/5仅本人(org-RBAC P5) */
  data_scope: number;
  /** data_scope==2(自定义)时的部门 id 列表;后端 P5-T5 微调返回 */
  scope_dept_ids?: number[];
}
export interface ModuleCatalogItem {
  group: string;
  key: string;
  label: string;
}
export interface RolesPayload {
  roles: Role[];
  module_catalog: ModuleCatalogItem[];
}
export interface MyModules {
  role: string;
  is_admin: boolean;
  /** 网络游客(未登录但放行):按 user 角色 app.* 授权管控 */
  is_guest?: boolean;
  /** 单机部署(桌面版 AUTH_REQUIRED=false):前端不做任何功能限制 */
  single_machine?: boolean;
  modules: string[];
  /** 当前用户的全部角色(org-RBAC P5,后端已返回) */
  roles?: string[];
}

export const roles = {
  list: () => http.get<RolesPayload>('/api/v1/admin/roles'),
  create: (body: { name: string; description?: string; modules: string[]; data_scope?: number; scope_dept_ids?: number[] }) =>
    http.post<Role>('/api/v1/admin/roles', body),
  update: (name: string, body: { description?: string; modules?: string[]; data_scope?: number; scope_dept_ids?: number[] }) =>
    http.patch<Role>(`/api/v1/admin/roles/${encodeURIComponent(name)}`, body),
  remove: (name: string) =>
    http.del<{ deleted: string }>(`/api/v1/admin/roles/${encodeURIComponent(name)}`),
  myModules: () => http.get<MyModules>('/auth/me/modules'),
};
