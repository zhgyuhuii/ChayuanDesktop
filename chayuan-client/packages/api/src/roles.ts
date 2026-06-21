// packages/api/src/roles.ts —— 角色管理 + 当前用户模块(RBAC 按模块授权 #2)。
import { http } from './client';

export interface Role {
  id: number;
  name: string;
  description: string;
  is_system: boolean;
  modules: string[];
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
  modules: string[];
}

export const roles = {
  list: () => http.get<RolesPayload>('/api/v1/admin/roles'),
  create: (body: { name: string; description?: string; modules: string[] }) =>
    http.post<Role>('/api/v1/admin/roles', body),
  update: (name: string, body: { description?: string; modules?: string[] }) =>
    http.patch<Role>(`/api/v1/admin/roles/${encodeURIComponent(name)}`, body),
  remove: (name: string) =>
    http.del<{ deleted: string }>(`/api/v1/admin/roles/${encodeURIComponent(name)}`),
  myModules: () => http.get<MyModules>('/auth/me/modules'),
};
