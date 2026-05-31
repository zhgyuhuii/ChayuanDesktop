/**
 * 数字人模块 API 客户端。
 *
 * 对应后端 `chayuan/server/api_server/digital_human_routes.py`,
 * 挂在 `/api/v1/digital-human/*`。
 */

import { request, getClientConfig } from './client';

// ─────────────────────────────────────────────────────────────────────
// 类型 — 跟后端 schemas.py 对齐,同步定义在 @chayuan/transport types.ts
// ─────────────────────────────────────────────────────────────────────

export type DhVoiceProvider = 'piper' | 'edge' | 'sherpa' | 'clone';
export type DhAvatarKind = 'image' | 'video';
export type DhAvatarSource = 'bundled' | 'user';
export type DhTaskState = 'pending' | 'running' | 'complete' | 'failed' | 'canceled';
export type DhComposeMode = 'single' | 'coframe' | 'sequential';
export type DhLayout = 'side' | 'pip' | 'main_minor';

export interface AvatarSlot {
  ref: string;
  kind: DhAvatarKind;
  label?: string;
  lines?: string;
  voice_provider?: DhVoiceProvider;  // 空=继承预设级音色
  voice_name?: string;
}

export interface DigitalHumanPreset {
  id: string;
  name: string;
  avatar_ref: string;
  avatar_kind: DhAvatarKind;
  is_greenscreen: boolean;
  voice_provider: DhVoiceProvider;
  voice_name: string;
  created: number;
  avatars?: AvatarSlot[];
  compose_mode?: DhComposeMode;
  layout?: DhLayout;
}

export interface DhAvatar {
  ref: string;
  kind: DhAvatarKind;
  source: DhAvatarSource;
  name: string;
}

export interface DhTaskStatus {
  task_id: string;
  state: DhTaskState;
  progress: number;
  error: string;
  result_path: string;
}

export interface DhEngineInfo {
  id: 'wav2lip' | 'sadtalker' | 'musetalk';
  label: string;
  kind: 'cpu' | 'gpu';
  input: 'image' | 'video' | 'both';
  builtin: boolean;
  installed: boolean;
}

/**
 * 内部 helper:对 `request<T>` 做一次解包,函数体只关心 data。
 * 别在 digitalHuman.ts 外面用 — 其它包统一用 request<T>.data 风格。
 */
async function rd<T>(...args: Parameters<typeof request>): Promise<T> {
  const r = await request<T>(...args);
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────

export async function dhListPresets(): Promise<{ count: number; items: DigitalHumanPreset[] }> {
  return rd<{ count: number; items: DigitalHumanPreset[] }>('/api/v1/digital-human/presets');
}

export async function dhCreatePreset(
  body: Partial<DigitalHumanPreset>,
): Promise<DigitalHumanPreset> {
  return rd<DigitalHumanPreset>('/api/v1/digital-human/presets', {
    method: 'POST',
    body,
  });
}

export async function dhUpdatePreset(
  id: string,
  body: Partial<DigitalHumanPreset>,
): Promise<DigitalHumanPreset> {
  return rd<DigitalHumanPreset>(`/api/v1/digital-human/presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
}

export async function dhDeletePreset(id: string): Promise<{ deleted: boolean }> {
  return rd<{ deleted: boolean }>(`/api/v1/digital-human/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Avatars
// ─────────────────────────────────────────────────────────────────────

export async function dhListAvatars(): Promise<{ count: number; items: DhAvatar[] }> {
  return rd<{ count: number; items: DhAvatar[] }>('/api/v1/digital-human/avatars');
}

export async function dhComposeReference(files: File[]): Promise<DhAvatar> {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  return rd<DhAvatar>('/api/v1/digital-human/avatars/compose', { method: 'POST', body: fd });
}

export async function dhTaskToTimeline(taskId: string): Promise<{ material: { id: string; name: string } }> {
  return rd(`/api/v1/digital-human/tasks/${encodeURIComponent(taskId)}/to-timeline`, { method: 'POST' });
}

export async function dhUploadAvatar(file: File): Promise<DhAvatar> {
  const fd = new FormData();
  fd.append('file', file);
  return rd<DhAvatar>('/api/v1/digital-human/avatars', {
    method: 'POST',
    body: fd,
  });
}

export async function dhDeleteAvatar(name: string): Promise<{ deleted: boolean }> {
  return rd<{ deleted: boolean }>(`/api/v1/digital-human/avatars/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────

export async function dhUploadProduct(file: File): Promise<{ ref: string; name: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return rd<{ ref: string; name: string }>('/api/v1/digital-human/products', {
    method: 'POST',
    body: fd,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Engines
// ─────────────────────────────────────────────────────────────────────

export async function dhListEngines(): Promise<{ count: number; items: DhEngineInfo[] }> {
  return rd<{ count: number; items: DhEngineInfo[] }>('/api/v1/digital-human/engines');
}

// ─────────────────────────────────────────────────────────────────────
// Generate
// ─────────────────────────────────────────────────────────────────────

export async function dhGenerate(
  preset_id: string,
  text: string,
  opts?: {
    product_image?: string;
    template?: 'none' | 'corner' | 'bg' | 'side';
    matte?: boolean;
    engine?: 'wav2lip' | 'sadtalker' | 'musetalk';
    width?: number;
    height?: number;
  },
): Promise<{ task_id: string }> {
  return rd<{ task_id: string }>('/api/v1/digital-human/generate', {
    method: 'POST',
    query: { width: opts?.width ?? 720, height: opts?.height ?? 1280 },
    body: {
      preset_id,
      text,
      product_image: opts?.product_image,
      template: opts?.template ?? 'none',
      matte: opts?.matte ?? false,
      engine: opts?.engine ?? 'wav2lip',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Live (WebRTC bridge)
// ─────────────────────────────────────────────────────────────────────

export async function dhLiveAvailable(): Promise<{ available: boolean }> {
  return rd<{ available: boolean }>('/api/v1/digital-human/live/available');
}

export async function dhLiveOffer(
  sdp: string,
  type: string,
): Promise<{ sdp: string; type: string }> {
  return rd<{ sdp: string; type: string }>('/api/v1/digital-human/live/offer', {
    method: 'POST',
    body: { sdp, type },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────

export async function dhTaskStatus(tid: string): Promise<DhTaskStatus> {
  return rd<DhTaskStatus>(`/api/v1/digital-human/tasks/${encodeURIComponent(tid)}`);
}

/** 列出所有数字人任务 + 进行中(pending/running)计数。内存态,进程重启即清。 */
export async function dhListTasks(): Promise<{ count: number; active: number; items: DhTaskStatus[] }> {
  return rd<{ count: number; active: number; items: DhTaskStatus[] }>('/api/v1/digital-human/tasks');
}

/** 拼接任务产物文件 URL — 直接用于 <video> src 或下载链接。 */
export function dhTaskFileUrl(tid: string): string {
  const cfg = getClientConfig();
  return `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/digital-human/tasks/${encodeURIComponent(tid)}/file`;
}

/** 形象文件 URL(按 avatar_ref)— 预设卡片缩略图用 <img>/<video> 直接引。 */
export function dhAvatarFileUrl(ref: string): string {
  const cfg = getClientConfig();
  return `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/digital-human/avatars/file?ref=${encodeURIComponent(ref)}`;
}

// ─────────────────────────────────────────────────────────────────────
// 命名空间聚合
// ─────────────────────────────────────────────────────────────────────

export const digitalHuman = {
  listPresets: dhListPresets,
  createPreset: dhCreatePreset,
  updatePreset: dhUpdatePreset,
  deletePreset: dhDeletePreset,
  listAvatars: dhListAvatars,
  uploadAvatar: dhUploadAvatar,
  composeReference: dhComposeReference,
  taskToTimeline: dhTaskToTimeline,
  deleteAvatar: dhDeleteAvatar,
  uploadProduct: dhUploadProduct,
  listEngines: dhListEngines,
  generate: dhGenerate,
  taskStatus: dhTaskStatus,
  listTasks: dhListTasks,
  taskFileUrl: dhTaskFileUrl,
  avatarFileUrl: dhAvatarFileUrl,
  liveAvailable: dhLiveAvailable,
  liveOffer: dhLiveOffer,
};
