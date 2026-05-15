/**
 * 本地 LLM runtime 控制面 API 客户端。
 *
 * 对齐 chayuan-server `/runtime/llama/*`:
 *   GET  /runtime/llama/status        → 状态机 + endpoint + pid
 *   POST /runtime/llama/start         → 拉起 llama-server.exe
 *   POST /runtime/llama/stop          → 关停
 *   POST /runtime/llama/restart       → stop + start
 *   GET  /runtime/llama/config        → LocalRuntimeSettings
 *   POST /runtime/llama/config        → 部分更新 + 持久化 yaml
 *   GET  /runtime/llama/install-info  → 装机路径 + 二进制版本
 *
 * 设计:仅在桌面端有意义 (集成版 .msi 装机后 vendor llama-server 才在),
 * Web 端调用会返回 404 — 调用方需自己用 platform.kind 守卫。
 */

import { request } from './client';

// ─── types ───────────────────────────────────────────────────────────

export type LocalRuntimeState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'restarting';

export interface LocalRuntimeStatus {
  state: LocalRuntimeState;
  endpoint?: string | null;
  pid?: number | null;
  model_id?: string | null;
  model_path?: string | null;
  started_at?: string | null;
  last_health_at?: string | null;
  last_error?: string | null;
}

export interface LocalRuntimeSettings {
  preload_on_startup: boolean;
  host: string;
  port: number;
  api_key: string;
  expose_lan: boolean;
  default_chat_model: string;
}

export type LocalRuntimeSettingsPatch = Partial<LocalRuntimeSettings>;

export interface LocalRuntimeInstallInfo {
  chayuan_root: string;
  models_root: string;
  bundled_models_root: string;
  llama_server_exe: string | null;
  build_version: string | null;
}

// 注:`request<T>(path)` 内部已经自动拆 `{code, msg, data}` 信封 (见 client.ts:198-211),
// `r.data` 就是已解包的内层 payload。我们这里只声明内层 T 类型即可。

// ─── client ──────────────────────────────────────────────────────────

async function getStatus(): Promise<LocalRuntimeStatus> {
  return (await request<LocalRuntimeStatus>('/runtime/llama/status')).data;
}

async function start(opts?: { model_id?: string }): Promise<LocalRuntimeStatus> {
  return (
    await request<LocalRuntimeStatus>('/runtime/llama/start', {
      method: 'POST',
      body: opts ?? {},
      timeoutMs: 90_000, // 启动 + 60s health probe 留余量
    })
  ).data;
}

async function stop(): Promise<LocalRuntimeStatus> {
  return (
    await request<LocalRuntimeStatus>('/runtime/llama/stop', {
      method: 'POST',
      timeoutMs: 20_000,
    })
  ).data;
}

async function restart(opts?: { model_id?: string }): Promise<LocalRuntimeStatus> {
  return (
    await request<LocalRuntimeStatus>('/runtime/llama/restart', {
      method: 'POST',
      body: opts ?? {},
      timeoutMs: 90_000,
    })
  ).data;
}

async function getConfig(): Promise<LocalRuntimeSettings> {
  return (await request<LocalRuntimeSettings>('/runtime/llama/config')).data;
}

async function setConfig(patch: LocalRuntimeSettingsPatch): Promise<LocalRuntimeSettings> {
  return (
    await request<LocalRuntimeSettings>('/runtime/llama/config', {
      method: 'POST',
      body: patch,
    })
  ).data;
}

async function getInstallInfo(): Promise<LocalRuntimeInstallInfo> {
  return (await request<LocalRuntimeInstallInfo>('/runtime/llama/install-info')).data;
}

// ─── Plan 3B 多 capability ───

export type LocalRuntimeCapability = 'chat' | 'embedding' | 'rerank' | 'asr' | 'image-embedding';

async function getStatusFor(cap: LocalRuntimeCapability): Promise<LocalRuntimeStatus> {
  return (await request<LocalRuntimeStatus>(`/runtime/llama/${cap}/status`)).data;
}

async function startFor(
  cap: LocalRuntimeCapability,
  opts?: { model_id?: string },
): Promise<LocalRuntimeStatus> {
  return (
    await request<LocalRuntimeStatus>(`/runtime/llama/${cap}/start`, {
      method: 'POST',
      body: opts ?? {},
      timeoutMs: 90_000,
    })
  ).data;
}

async function stopFor(cap: LocalRuntimeCapability): Promise<LocalRuntimeStatus> {
  return (
    await request<LocalRuntimeStatus>(`/runtime/llama/${cap}/stop`, {
      method: 'POST',
      timeoutMs: 20_000,
    })
  ).data;
}

async function restartFor(
  cap: LocalRuntimeCapability,
  opts?: { model_id?: string },
): Promise<LocalRuntimeStatus> {
  return (
    await request<LocalRuntimeStatus>(`/runtime/llama/${cap}/restart`, {
      method: 'POST',
      body: opts ?? {},
      timeoutMs: 90_000,
    })
  ).data;
}

async function getRegistry(): Promise<Record<LocalRuntimeCapability, LocalRuntimeStatus>> {
  return (await request<Record<LocalRuntimeCapability, LocalRuntimeStatus>>('/runtime/llama/registry'))
    .data;
}

export const localRuntime = {
  // 旧:chat 别名(Plan 1+2 已用,不动)
  getStatus,
  start,
  stop,
  restart,
  getConfig,
  setConfig,
  getInstallInfo,
  // Plan 3B 多 capability
  getStatusFor,
  startFor,
  stopFor,
  restartFor,
  getRegistry,
};
