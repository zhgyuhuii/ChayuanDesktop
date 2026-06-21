// packages/api/src/infraConfig.ts —— 基础设施配置 admin REST(Redis / 数据库 / 数据目录)。
// 存储(MinIO)走既有 storage.ts;此处汇总 P3/P5/P7 后端新端点。
import { http } from './client';

// ── Redis(P3)──────────────────────────────────────────────
export interface RedisForm {
  scheme: string;
  host: string;
  port: string;
  db: string;
  username: string;
  password: string;
}
export interface RedisStatus {
  configured: boolean;
  form: RedisForm;
  masked: string;
  probe: { ok: boolean; reason: string };
}
export interface ConnResult { ok: boolean; message: string; detail: string; db_missing?: boolean }

export const redisConfig = {
  status: () => http.get<RedisStatus>('/api/v1/admin/redis/status'),
  test: (body: Partial<RedisForm> & { url?: string }) =>
    http.post<ConnResult>('/api/v1/admin/redis/test', body),
  save: (body: Partial<RedisForm> & { url?: string }) =>
    http.post<{ masked: string; restart_required: boolean }>('/api/v1/admin/redis/save', body),
  clear: () => http.post<{ restart_required: boolean }>('/api/v1/admin/redis/clear'),
};
