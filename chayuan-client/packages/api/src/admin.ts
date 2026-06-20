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
}

export function adminCreateUser(body: {
  username: string;
  password: string;
  role?: string;
  email?: string;
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
