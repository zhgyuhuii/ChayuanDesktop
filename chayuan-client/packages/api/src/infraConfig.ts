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


// ── 对象存储 / MinIO(P4)—— 复用既有 /storage/* ──────────────
export interface StorageInfo {
  backend?: string;
  healthy?: boolean;
  endpoint?: string;
  local_root?: string;
  namespaces?: Record<string, { objects: number; size_mb: number }>;
  [k: string]: unknown;
}
export interface MinioFields {
  endpoint: string;
  access_key: string;
  secret_key: string;
  secure: boolean;
  region: string;
  bucket_prefix: string;
}
export const storageConfig = {
  status: () => http.get<StorageInfo>('/storage/status'),
  testMinio: (m: MinioFields) =>
    http.post<{ ok: boolean; info?: unknown; error?: string }>('/storage/test_connection', m),
  switch: (backend: 'local' | 'minio', minio?: MinioFields) =>
    http.post<{ backend: string; info: StorageInfo }>('/storage/switch_backend', { backend, minio }),
  migrate: (body: {
    namespace: string;
    direction: 'local_to_minio' | 'minio_to_local';
    dry_run?: boolean;
    limit?: number;
  }) => http.post<{ moved?: number; scanned?: number; dry_run?: boolean; [k: string]: unknown }>(
    '/storage/migrate', body,
  ),
};


// ── 数据库(P5)—— /api/v1/admin/db/{status,validate,create,save} ──────────
export interface DbForm {
  db_type: string;
  sqlite_path: string;
  host: string;
  port: string;
  database: string;
  schema: string;
  username: string;
  password: string;
  charset: string;
}
export interface DbType {
  key: string;
  label: string;
  has_host: boolean;
  has_schema: boolean;
  has_charset: boolean;
  default_port: number | null;
  default_db: string;
  default_schema: string | null;
  default_charset: string | null;
  driver_hint: string;
  install_hint: string;
}
export interface DbStatus { configured: boolean; form: DbForm; summary: string; db_types: DbType[] }
export interface DbValidateResult {
  ok: boolean; message: string; detail: string; db_missing?: boolean; uri_masked?: string;
}
export const dbConfig = {
  status: () => http.get<DbStatus>('/api/v1/admin/db/status'),
  validate: (form: DbForm) => http.post<DbValidateResult>('/api/v1/admin/db/validate', form),
  create: (form: DbForm) =>
    http.post<{ ok: boolean; created?: boolean; message: string; detail: string }>(
      '/api/v1/admin/db/create', form,
    ),
  save: (form: DbForm) =>
    http.post<{ restart_required: boolean; masked: string; validated: DbValidateResult }>(
      '/api/v1/admin/db/save', form,
    ),
};


// ── 数据目录(P7)—— /api/v1/admin/datadir/{info,write-rc} ──────────
export interface DataDirInfo {
  current_root: string;
  source: string;
  reason: string;
  env_value: string;
  derived: Record<string, string>;
  user_state: Record<string, unknown>;
  in_container: boolean;
  default_rc: Record<string, string>;
}
export const dataDirConfig = {
  info: () => http.get<DataDirInfo>('/api/v1/admin/datadir/info'),
  writeRc: (body: { new_root: string; shell: string; rc_path?: string }) =>
    http.post<{ changed: boolean; action: string; rc_path: string; note: string }>(
      '/api/v1/admin/datadir/write-rc', body,
    ),
};


// ── 服务状态/框架/外部端点(P6)—— /api/v1/admin/services/* ──────────
export interface ServiceStatusRow {
  service: string; label: string; level: string; ok: boolean;
  configured: boolean; endpoint: string; detail: string; latency_ms: number | null;
}
export interface FrameworkHealth {
  name: string; label: string; state: string; url: string; models_served: number; capabilities: string[];
}
export interface ExternalRuntime { name: string; url: string; health_path: string; enabled: boolean }

export type TopologyStatus = 'ok' | 'down' | 'disabled' | 'unknown';
export interface TopologyNode {
  id: string;
  label: string;
  group: string;        // edge / proxy / app / infra / runtime
  icon: string;
  status: TopologyStatus;
  summary: string;
  detail: string;
  restartable: boolean;
  config_kind: string;  // api/panel/nginx/redis/db/milvus/minio/langfuse/kkfileview/runtime
  x: number;
  y: number;
}
export interface TopologySnapshot {
  nodes: TopologyNode[];
  edges: [string, string][];
  generated_at: number;
}
export const servicesConfig = {
  readiness: () =>
    http.get<{ statuses: ServiceStatusRow[]; system_ready: boolean }>('/api/v1/admin/services/readiness'),
  topology: (probe = true) =>
    http.get<TopologySnapshot>('/api/v1/admin/services/topology', { query: { probe }, timeoutMs: 30_000 }),
  frameworks: () => http.get<{ frameworks: FrameworkHealth[] }>('/api/v1/admin/services/frameworks'),
  externalList: () => http.get<{ runtimes: ExternalRuntime[] }>('/api/v1/admin/services/external'),
  externalSet: (body: { name: string; url: string; health_path?: string; enabled?: boolean }) =>
    http.post<{ ok: boolean; message: string }>('/api/v1/admin/services/external', body),
  externalProbe: (url: string) =>
    http.post<{ ok: boolean; message: string }>('/api/v1/admin/services/external/probe', { url }),
  frameworkStart: (name: string) =>
    http.post<{ ok: boolean; error?: string; hint?: string }>(
      `/api/v1/admin/services/frameworks/${encodeURIComponent(name)}/start`,
    ),
  frameworkStop: (name: string) =>
    http.post<{ ok: boolean; error?: string; hint?: string }>(
      `/api/v1/admin/services/frameworks/${encodeURIComponent(name)}/stop`,
    ),
};
