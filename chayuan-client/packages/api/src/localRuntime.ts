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
  /** 当前 installer 是否轻量版(没嵌 chat);后端 2026-05-16 起返回此字段。
   *  老服务端没返时前端取 undefined → 视为 false(向后兼容 full 行为)。 */
  is_lite_build?: boolean;
  /** 随包真实嵌入的 capability 短名列表(chat / embedding / rerank / asr / ocr / image) */
  bundled_caps?: string[];
  /** FULL_CAPS - bundled_caps,前端可在 footer / 设置页提示"需先下载"。 */
  missing_caps?: string[];
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

// ─── auto-start 开关 ───
// 5 个 capability + rapidocr 各自的"是否在 chayuan-server 启动时自动拉起"开关。
// 切换 UI 不影响当前进程,只决定下次 server 启动行为(用户仍可手动启停)。
// 持久化到 <CHAYUAN_ROOT>/data/sidecar_settings.json。

export type AutoStartKey =
  | LocalRuntimeCapability
  | 'rapidocr';

export type AutoStartDict = Partial<Record<AutoStartKey, boolean>>;

async function listAutoStart(): Promise<AutoStartDict> {
  return (await request<AutoStartDict>('/runtime/llama/auto-start')).data;
}

async function setAutoStart(capability: AutoStartKey, enabled: boolean): Promise<AutoStartDict> {
  return (
    await request<AutoStartDict>('/runtime/llama/auto-start', {
      method: 'POST',
      body: { capability, enabled },
    })
  ).data;
}

// ─── PyTorch 检测 + 安装 ───
// transformers image 链的硬依赖,wheel 体积巨大不打包进 installer,装机时按需下载。
// 走「设置 → 本地模型服务 → PyTorch」一键检测 + 安装,跟 OCR 体验一致。

export type PytorchVariant = 'cpu' | 'cu118' | 'cu121' | 'cu124' | 'cu126' | 'auto';

export interface PytorchStatus {
  torch_version: string | null;
  torch_cuda_build: string | null;        // "cu124" / "cpu" / null
  torchvision_version: string | null;
  /** 整个 import 链是否健康(transformers image 路径能否走通)*/
  import_ok: boolean;
  import_error: string | null;
  has_nvidia_gpu: boolean;
  nvidia_driver: string | null;
  /** 一键自动安装时该用哪个 variant(CPU 或 cuXXX)*/
  suggested_variant: PytorchVariant;
  can_install: boolean;
  /** 内置 wheel 是否可用 — true 时即使无网也能装上(走 vendor/torch_wheels) */
  offline_wheels_available: boolean;
  offline_wheels_dir: string | null;
  /** 给前端的额外提示(驱动太老 / 版本不配等)*/
  notes: string[];
}

/** install_task_manager.InstallTask 子集(只暴露 UI 用得到的字段)*/
export interface PytorchInstallTask {
  task_id: string;
  framework: string;
  recipe_label: string;
  state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  log: string[];
  return_code: number | null;
  error: string;
  started_at: number;
  finished_at: number | null;
}

async function pytorchStatus(): Promise<PytorchStatus> {
  return (await request<PytorchStatus>('/runtime/pytorch/status')).data;
}

async function pytorchInstall(
  variant: PytorchVariant = 'auto',
  opts: { preferOffline?: boolean } = {},
): Promise<PytorchInstallTask> {
  return (
    await request<PytorchInstallTask>('/runtime/pytorch/install', {
      method: 'POST',
      body: { variant, prefer_offline: opts.preferOffline ?? true },
      timeoutMs: 30_000,  // start 本身只是入队,几百 ms;真实安装异步跑
    })
  ).data;
}

async function pytorchInstallTask(taskId: string): Promise<PytorchInstallTask> {
  return (
    await request<PytorchInstallTask>(
      `/runtime/pytorch/install/${encodeURIComponent(taskId)}`,
    )
  ).data;
}

// ─── OCR (RapidOCR 进程内 onnxruntime,没有独立 sidecar) ───

export interface RuntimeOcrHealth {
  /** 'ready' = 模型齐全可加载;'failed' = python 包或 ONNX 模型缺失 */
  state: 'ready' | 'failed';
  /** state=failed 时给出原因(用户友好,可直接展示在 footer hover title) */
  reason?: string | null;
  /** 内部诊断字段:rapidocr_pkg / models / models_dir 等 */
  detail?: Record<string, unknown>;
}

async function getOcrHealth(): Promise<RuntimeOcrHealth> {
  return (await request<RuntimeOcrHealth>('/runtime/ocr/health')).data;
}

export const runtimeOcr = {
  health: getOcrHealth,
};

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
  // auto-start 开关(5 cap + rapidocr 共用一份字典)
  listAutoStart,
  setAutoStart,
  // PyTorch 检测 + 安装(transformers image 链硬依赖)
  pytorchStatus,
  pytorchInstall,
  pytorchInstallTask,
};
