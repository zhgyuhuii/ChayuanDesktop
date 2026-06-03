/**
 * 数字人模块 API 客户端。
 *
 * 对应后端 `chayuan/server/api_server/digital_human_routes.py`,
 * 挂在 `/api/v1/digital-human/*`。
 */

import { request, getClientConfig } from './client';
import type { VgMaterial, VgTimeline } from './videoGeneration';

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
  name?: string;
  persona?: string;       // 该角色人设/语气(多角色生成时注入 prompt)
  voice_rate?: number;
  voice_volume?: number;
  language?: string;
  x?: number;
  y?: number;
  scale?: number;
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
  video_width?: number;
  video_height?: number;
  /** 商品图/视频归一位置+大小(画布拖拽);空=用 template 摆位。 */
  product_x?: number;
  product_y?: number;
  product_scale?: number;
  /** 商品图/视频 ref(persist 进 preset 后工作台画布可预览+拖拽);空=无商品图。 */
  product_ref?: string;
  product_kind?: 'image' | 'video';
  /** 绑定默认对话模型(provider::model);空=用全局默认 chat 模型。 */
  model?: string;
  /** 绑定知识源(doc:* / src:* / office:*);空=不挂知识库。 */
  ku_ids?: string[];
  /** 允许对话时临时切换模型(false=锁定为预设 model)。 */
  allow_model_override?: boolean;
  /** 允许对话时临时改知识源(false=锁定为预设 ku_ids)。 */
  allow_kb_override?: boolean;
  subtitle_enabled?: boolean;
  subtitle_position?: 'top' | 'bottom' | 'center' | 'custom';
  font_name?: string;
  font_size?: number;
  text_fore_color?: string;
  text_background_color?: boolean | string;
  stroke_color?: string;
  stroke_width?: number;
  /** 仅用于 create/update 请求体:嵌套字幕样式 dict(后端白名单解包到上面各字段)。 */
  subtitle?: {
    subtitle_enabled?: boolean;
    subtitle_position?: 'top' | 'bottom' | 'center' | 'custom';
    font_name?: string;
    font_size?: number;
    text_fore_color?: string;
    text_background_color?: boolean | string;
    stroke_color?: string;
    stroke_width?: number;
  };
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
  script?: string;
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

export async function dhTaskToTimeline(
  taskId: string,
): Promise<{ materials: VgMaterial[]; timeline: VgTimeline }> {
  return rd(`/api/v1/digital-human/tasks/${encodeURIComponent(taskId)}/to-timeline`, { method: 'POST' });
}

export async function dhDeleteTask(
  taskId: string,
  opts: { drop_file?: boolean } = {},
): Promise<{ ok: boolean }> {
  const q = opts.drop_file === false ? '?drop_file=false' : '';
  return rd<{ ok: boolean }>(
    `/api/v1/digital-human/tasks/${encodeURIComponent(taskId)}${q}`,
    { method: 'DELETE' },
  );
}

/** 文案生成的「依据来源」——后端命中知识库时透传(kb_used + sources)。 */
export interface DhScriptSource {
  file_name: string;
  snippet: string;
  kb_name?: string;
  kind?: string;
}

export async function dhGenerateScript(
  subject: string,
  opts?: { language?: string; paragraphs?: number; model?: string; productRef?: string; kuIds?: string[] },
): Promise<{ script: string; kb_used?: boolean; sources?: DhScriptSource[] }> {
  return rd('/api/v1/digital-human/script/generate', {
    method: 'POST',
    body: {
      subject,
      language: opts?.language,
      paragraphs: opts?.paragraphs,
      model: opts?.model,
      product_ref: opts?.productRef,
      ku_ids: opts?.kuIds,
    },
  });
}

/** 内置脚本结构模板(自由 / 带货四段 / 问题方案);多角色生成时选其一推进结构。 */
export interface DhScriptTemplate {
  id: string;
  name: string;
  sections: string[];
}

export async function listScriptTemplates(): Promise<{ templates: DhScriptTemplate[] }> {
  return rd<{ templates: DhScriptTemplate[] }>('/api/v1/digital-human/script/templates');
}

/**
 * 多角色文案生成 — 后端按各角色 persona + 专属/预设知识库逐角色检索,
 * 产出交错的 role_segments(role_index 标定说话角色,顺序即对话顺序)。
 */
export async function generateMultiRoleScript(args: {
  preset_id: string;
  subject: string;
  template_id?: string;
  productRef?: string;
  /** 用户临时选的文案模型(provider::model);空=用预设绑定模型/默认。 */
  model?: string;
}): Promise<{
  role_segments: Array<{ role_index: number; text: string }>;
  kb_used?: boolean;
  sources?: DhScriptSource[];
}> {
  return rd('/api/v1/digital-human/script/generate-multi', {
    method: 'POST',
    body: {
      preset_id: args.preset_id,
      subject: args.subject,
      template_id: args.template_id,
      product_ref: args.productRef,
      model: args.model,
    },
  });
}

export async function dhScriptFromVideo(
  file: File,
  opts?: { model?: string; kuIds?: string[] },
): Promise<{ script: string; transcript: string; kb_used?: boolean; sources?: DhScriptSource[] }> {
  const fd = new FormData();
  fd.append('file', file);
  if (opts?.model) fd.append('model', opts.model);
  (opts?.kuIds ?? []).forEach((id) => fd.append('ku_ids', id));
  return rd('/api/v1/digital-human/script/from-video', { method: 'POST', body: fd });
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

export async function dhUploadProduct(
  file: File,
): Promise<{ ref: string; name: string; kind: DhAvatarKind }> {
  const fd = new FormData();
  fd.append('file', file);
  return rd<{ ref: string; name: string; kind: DhAvatarKind }>('/api/v1/digital-human/products', {
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
    script?: string;
    role_scripts?: string[];
    role_segments?: Array<{ role_index: number; text: string }>;
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
      script: opts?.script,
      role_scripts: opts?.role_scripts,
      role_segments: opts?.role_segments,
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

export function dhProductFileUrl(ref: string): string {
  const cfg = getClientConfig();
  return `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/digital-human/products/file?ref=${encodeURIComponent(ref)}`;
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
  generateScript: dhGenerateScript,
  scriptFromVideo: dhScriptFromVideo,
  listScriptTemplates,
  generateMultiRoleScript,
  deleteAvatar: dhDeleteAvatar,
  uploadProduct: dhUploadProduct,
  listEngines: dhListEngines,
  generate: dhGenerate,
  taskStatus: dhTaskStatus,
  listTasks: dhListTasks,
  deleteTask: dhDeleteTask,
  taskFileUrl: dhTaskFileUrl,
  avatarFileUrl: dhAvatarFileUrl,
  productFileUrl: dhProductFileUrl,
  liveAvailable: dhLiveAvailable,
  liveOffer: dhLiveOffer,
};
