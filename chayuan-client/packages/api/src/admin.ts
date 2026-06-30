// packages/api/src/admin.ts —— 后台 REST 客户端。
import { http } from './client';

export interface NameCount { name: string; count: number }
export interface RecentQuery { time: string; chat_type: string; query: string; model: string }

export interface AdminUserRow {
  id: number;
  username: string;
  role: string;
  email: string | null;
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
  msg_count: number;
  est_tokens: number;
  last_active: string | null;
  // —— org-RBAC P5:部门 + 多角色 ——
  dept_id?: number | null;
  dept_name?: string | null;
  roles?: string[];
  // —— P2/P3 富字段 ——
  total_chars?: number;
  avg_feedback?: number | null;
  feedback_count?: number;
  first_active?: string | null;
  model_usage?: Record<string, number>;
  chat_type_usage?: Record<string, number>;
  tool_usage?: Record<string, number>;
  kb_usage?: Record<string, number>;
  heatmap?: number[][];
  recent_queries?: RecentQuery[];
}

export interface UsersSnapshot {
  users: AdminUserRow[];
  total_users: number;
  active_7d: number;
  total_messages: number;
  total_tokens: number;
  total_feedback: number;
  avg_feedback: number;
  daily_msg: Array<{ date: string; count: number }>;
  daily_active: Array<{ date: string; active_users: number }>;
  top_model: NameCount[];
  top_tool: NameCount[];
  top_kb: NameCount[];
  top_chat_type: NameCount[];
  user_model_matrix: Array<{ user: string; model: string; count: number }>;
  global_heatmap: number[][];
  global_heatmap_max: number;
  feedback_hist: number[];
  generated_at: number;
}

export function adminUsersSnapshot(): Promise<UsersSnapshot> {
  return http.get<UsersSnapshot>('/api/v1/admin/users/snapshot');
}

/** 后台创建用户（复用 /auth/users，require admin）。 */
export interface AdminUserPublic {
  id: number;
  username: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
  /** 多角色(org-RBAC P5,后端已返回) */
  roles?: string[];
  /** 所属部门 id(org-RBAC P5) */
  dept_id?: number | null;
}

export function adminCreateUser(body: {
  username: string;
  password: string;
  role?: string;
  roles?: string[];
  email?: string;
  dept_id?: number | null;
}): Promise<AdminUserPublic> {
  return http.post<AdminUserPublic>('/auth/users', body);
}

export function adminSetUserActive(userId: number, isActive: boolean): Promise<{ code: number }> {
  return http.patch<{ code: number }>(`/auth/users/${userId}/active`, undefined, {
    query: { is_active: isActive },
  });
}

export function adminSetUserPassword(userId: number, newPassword: string): Promise<{ code: number }> {
  return http.patch<{ code: number }>(`/auth/users/${userId}/password`, { new_password: newPassword });
}

/** 设置用户的多角色(org-RBAC P5)。 */
export function adminSetUserRoles(userId: number, roles: string[]): Promise<{ roles: string[] }> {
  return http.put<{ roles: string[] }>(`/auth/users/${userId}/roles`, { roles });
}

/** 设置用户所属部门(org-RBAC P5)。 */
export function adminSetUserDept(userId: number, deptId: number | null): Promise<{ code: number }> {
  return http.patch<{ code: number }>(`/auth/users/${userId}/dept`, { dept_id: deptId });
}

/** 删除用户(org-RBAC P5)。 */
export function adminDeleteUser(userId: number): Promise<{ code: number }> {
  return http.del<{ code: number }>(`/auth/users/${userId}`);
}

/** 列出全部用户(含 roles/dept_id)(org-RBAC P5)。 */
export function adminListUsers(): Promise<AdminUserPublic[]> {
  return http.get<AdminUserPublic[]>('/auth/users');
}


/** 用户画像 AI 分析结果。 */
export interface PersonaResult {
  model: string;
  analysis: string;
  generated_at: number;
}

export function adminUserPersona(userId: number): Promise<PersonaResult> {
  return http.post<PersonaResult>(`/api/v1/admin/users/${userId}/persona-analysis`);
}


// ── 默认模型(9 类 capability)—— /admin/capability_defaults ──────────────
export interface CapabilityCandidate {
  id: string;
  runtime: string | null;
  platform_name: string | null;
  format: string | null;
  size_bytes: number;
  is_default: boolean;
}
export interface CapabilityDefaults {
  capabilities: string[];
  defaults: Record<string, string | null>;
  candidates: Record<string, CapabilityCandidate[]>;
  auto_assigned: string[];
}

/** 读 9 类默认模型 + 候选(按 platform_name 分云/本地)。GET 公开,后端已自动补默认。 */
export function adminCapabilityDefaults(): Promise<CapabilityDefaults> {
  return http.get<CapabilityDefaults>('/admin/capability_defaults');
}

/** 批量设置默认模型(admin)。payload = {cap: model_id, ...}。 */
export function adminSetCapabilityDefaults(
  payload: Record<string, string>,
): Promise<{ results?: Record<string, { ok: boolean; model?: string; error?: string }> }> {
  return http.post('/admin/capability_defaults', payload);
}
