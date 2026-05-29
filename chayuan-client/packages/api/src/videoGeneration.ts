/**
 * 视频生成模块 API 客户端。
 *
 * 对应后端 `chayuan/server/api_server/video_generation_routes.py`,
 * 21 个 endpoint 全部覆盖。挂在 `/api/v1/video-generation/*`。
 *
 * SSE 进度通道走自实现 reader(同 home.introStream 套路),非 EventSource
 * 是因为 Tauri 桌面要走 PAL.net.fetch 统一 fetch 路径(跨 origin)。
 */

import { getPlatform } from '@chayuan/platform-shared';
import { request, getClientConfig } from './client';
import { getAccessToken } from './auth-store';

// ─────────────────────────────────────────────────────────────────────
// 类型 — 跟后端 schemas.py 对齐
// ─────────────────────────────────────────────────────────────────────

export type VgScriptSource = 'ai' | 'manual' | 'srt';
export type VgVideoAspect = '16:9' | '9:16' | '1:1';
export type VgConcatMode = 'random' | 'sequential';
export type VgTransitionMode = '' | 'Shuffle' | 'FadeIn' | 'FadeOut' | 'SlideIn' | 'SlideOut';
export type VgVoiceProvider = 'piper' | 'edge' | 'sherpa';
export type VgVideoSource = 'local' | 'pexels' | 'pixabay';
export type VgBgmType = 'none' | 'random' | 'file';
export type VgSubtitlePosition = 'top' | 'bottom' | 'center' | 'custom';
export type VgTaskState =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'canceled';
export type VgStopAt =
  | 'script'
  | 'terms'
  | 'audio'
  | 'subtitle'
  | 'materials'
  | 'video';

export interface VgSrtCue {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface VgMaterialInfo {
  provider: string;
  url: string;
  duration: number;
  /** 在线搜索结果的预览缩略图 URL(本地素材为空)。 */
  image?: string;
}

// ─────────────────────────────────────────────────────────────────────
// 时间轴 EDL 类型 — 对应后端 VideoTimeline / TimelineTrack / TimelineClip
// ─────────────────────────────────────────────────────────────────────

export interface VgTimelineClip {
  id: string;
  source: { material_id?: string; path?: string; url?: string };
  track_start_ms: number;
  in_ms?: number;
  out_ms?: number;            // 0 = 到素材末尾
  transition?: 'none' | 'fade' | 'slide';
  volume?: number;
}
export interface VgTimelineTrack {
  id: string;
  kind: 'video' | 'audio' | 'subtitle';
  clips?: VgTimelineClip[];
  cues?: VgSrtCue[];
}
export interface VgTimeline {
  version?: number;
  duration_ms?: number;
  tracks: VgTimelineTrack[];
}

/** 后端 VideoParams 全字段;前端 vgComposer store 字段一一对应 */
export interface VgVideoParams {
  video_subject: string;
  video_language: string;
  script_source: VgScriptSource;
  video_script: string;
  srt_cues?: VgSrtCue[] | null;
  paragraph_number: number;
  video_terms?: string | string[] | null;
  /** 脚本/关键词 LLM 用哪个模型(跟随对话框选的 chat 模型;空走后端默认)。 */
  model?: string | null;
  /** 时间轴 EDL;非空时后端按它精确渲染(P1 后端已支持)。 */
  timeline?: VgTimeline | null;
  video_aspect: VgVideoAspect;
  video_concat_mode: VgConcatMode;
  video_transition_mode: VgTransitionMode;
  video_clip_duration: number;
  video_count: number;
  video_source: VgVideoSource;
  video_materials?: VgMaterialInfo[] | null;
  custom_audio_file?: string | null;
  voice_name: string;
  voice_volume: number;
  voice_rate: number;
  voice_provider: VgVoiceProvider;
  bgm_type: VgBgmType;
  bgm_file: string;
  bgm_volume: number;
  subtitle_enabled: boolean;
  subtitle_position: VgSubtitlePosition;
  custom_position: number;
  font_name: string;
  font_size: number;
  text_fore_color: string;
  text_background_color: boolean | string;
  stroke_color: string;
  stroke_width: number;
  n_threads: number;
}

export interface VgTaskResultPartial {
  script?: string;
  terms?: string[];
  audio_file?: string;
  audio_duration_ms?: number;
  tts_provider?: string;
  subtitle_path?: string;
  materials?: string[];
  final_videos?: string[];
  combined_videos?: string[];
  [k: string]: unknown;
}

export interface VgTask {
  task_id: string;
  owner_id: number | null;
  state: VgTaskState;
  progress: number;
  stop_at: VgStopAt;
  params: VgVideoParams;
  result: VgTaskResultPartial;
  error: string | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface VgListResponse<T> {
  total: number;
  items: T[];
  page: number;
  page_size: number;
}

export interface VgMaterial {
  material_id: string;
  owner_id: number | null;
  source: 'upload' | 'pexels' | 'pixabay' | 'bundled';
  name: string;
  path: string;
  mime: string;
  size: number;
  duration_ms: number;
  width: number;
  height: number;
  thumbnail_path: string | null;
  tags: string[];
  used_count: number;
  created_at: number | null;
}

export interface VgVideo {
  video_id: string;
  task_id: string;
  owner_id: number | null;
  title: string;
  path: string;
  duration_ms: number;
  width: number;
  height: number;
  thumbnail_path: string | null;
  params_snapshot: Partial<VgVideoParams>;
  created_at: number | null;
}

export interface VgBgmItem {
  name: string;
  path: string;
  source: 'bundled' | 'upload';
  size: number;
}

export interface VgFontItem {
  /** bundled/user 为裸文件名;system 为绝对路径(compose 直接用)。 */
  name: string;
  /** 显示名(字体 family 名,读不到回退文件名)。 */
  label?: string;
  /** 字体 family 名(读 sfnt name 表,按系统语言本地化);可空。用于按该字体样式渲染选项。 */
  family?: string | null;
  source: 'bundled' | 'user' | 'system';
}

export interface VgVoiceItem {
  id: string;
  label: string;
  language: string;
  /** piper 专用:该音色是否已下载本地;false 时前端选中触发下载。 */
  downloaded?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// 默认参数 — vgComposer store 初始化用
// ─────────────────────────────────────────────────────────────────────

export const VG_DEFAULT_PARAMS: VgVideoParams = {
  video_subject: '',
  video_language: '',
  script_source: 'ai',
  video_script: '',
  srt_cues: null,
  paragraph_number: 1,
  video_terms: null,
  timeline: null,
  video_aspect: '9:16',
  video_concat_mode: 'random',
  video_transition_mode: '',
  video_clip_duration: 5,
  video_count: 1,
  video_source: 'local',
  video_materials: null,
  custom_audio_file: null,
  voice_name: '',
  voice_volume: 1.0,
  voice_rate: 1.0,
  voice_provider: 'piper',
  bgm_type: 'random',
  bgm_file: '',
  bgm_volume: 0.2,
  subtitle_enabled: true,
  subtitle_position: 'bottom',
  custom_position: 70.0,
  font_name: 'STHeitiMedium.ttc',
  font_size: 60,
  text_fore_color: '#FFFFFF',
  text_background_color: true,
  stroke_color: '#000000',
  stroke_width: 1.5,
  n_threads: 2,
};

/**
 * 内部 helper:对 `request<T>` 做一次解包,函数体只关心 data。
 * 别在 videoGeneration.ts 外面用 — 其它包统一用 request<T>.data 风格。
 */
async function rd<T>(...args: Parameters<typeof request>): Promise<T> {
  const r = await request<T>(...args);
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────
// LLM 辅助
// ─────────────────────────────────────────────────────────────────────

export async function vgGenerateScript(args: {
  video_subject: string;
  video_language?: string;
  paragraph_number?: number;
  model?: string;
}): Promise<{ video_script: string }> {
  const { model, ...body } = args;
  return rd<{ video_script: string }>('/api/v1/video-generation/script', {
    method: 'POST',
    body,
    query: model ? { model } : undefined,
  });
}

export async function vgGenerateTerms(args: {
  video_subject: string;
  video_script: string;
  amount?: number;
  model?: string;
}): Promise<{ video_terms: string[] }> {
  const { model, ...body } = args;
  return rd<{ video_terms: string[] }>('/api/v1/video-generation/terms', {
    method: 'POST',
    body,
    query: model ? { model } : undefined,
  });
}

export async function vgParseSrt(
  srt_text: string,
): Promise<{ count: number; cues: VgSrtCue[] }> {
  return rd<{ count: number; cues: VgSrtCue[] }>('/api/v1/video-generation/subtitle/parse', {
    method: 'POST',
    body: { srt_text },
  });
}

/** URL 抽取 — chat 粘 URL 当主题素材。后端走 HTML/PDF/text 三档解析。 */
export interface VgExtractedUrl {
  text: string;
  content_type: 'html' | 'pdf' | 'text';
  source_url: string;
  truncated: boolean;
  raw_bytes: number;
}

export async function vgExtractUrl(url: string): Promise<VgExtractedUrl> {
  return rd<VgExtractedUrl>('/api/v1/video-generation/extract-url', {
    method: 'POST',
    body: { url },
  });
}

/** 试听 — 返回 audio/wav Blob,前端用 URL.createObjectURL 喂 <audio> */
export async function vgPreviewAudio(args: {
  video_script: string;
  voice_provider?: VgVoiceProvider;
  voice_name?: string;
  voice_rate?: number;
  voice_volume?: number;
}): Promise<{ blob: Blob; durationMs: number; provider: string }> {
  const cfg = getClientConfig();
  const url = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/preview-audio`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if ((cfg.authMode ?? 'bearer') === 'bearer') {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const res = await getPlatform().net.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      video_script: args.video_script,
      voice_provider: args.voice_provider ?? 'piper',
      voice_name: args.voice_name ?? '',
      voice_rate: args.voice_rate ?? 1.0,
      voice_volume: args.voice_volume ?? 1.0,
    }),
    credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`preview-audio HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return {
    blob,
    durationMs: Number(res.headers.get('X-Audio-Duration-Ms') || 0) || 0,
    provider: res.headers.get('X-Tts-Provider') || 'unknown',
  };
}

/** 时间轴代理预览 — 返回 video/mp4 Blob,前端用 URL.createObjectURL 喂 <video> */
export async function vgPreviewEdl(args: {
  timeline: VgTimeline;
  aspect?: VgVideoAspect;
}): Promise<{ blob: Blob }> {
  const cfg = getClientConfig();
  const url = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/preview-edl`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if ((cfg.authMode ?? 'bearer') === 'bearer') {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const res = await getPlatform().net.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      timeline: args.timeline,
      aspect: args.aspect ?? '9:16',
    }),
    credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`preview-edl HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return { blob };
}

/** 下载成品文件为 Blob —— Tauri webview 里 `<a download>` 不触发下载,
 *  必须 fetch 成 blob 后用 createObjectURL + 程序化 anchor 点击。带鉴权头。 */
export async function vgDownloadTaskFile(taskId: string, fileName: string): Promise<{ blob: Blob }> {
  const cfg = getClientConfig();
  const url = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/files/${encodeURIComponent(taskId)}/${encodeURIComponent(fileName)}?download=true`;
  const headers: Record<string, string> = {};
  if ((cfg.authMode ?? 'bearer') === 'bearer') {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const res = await getPlatform().net.fetch(url, {
    method: 'GET',
    headers,
    credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
  } as RequestInit);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  return { blob: await res.blob() };
}

// ─────────────────────────────────────────────────────────────────────
// 任务 CRUD
// ─────────────────────────────────────────────────────────────────────

export async function vgSubmitTask(
  params: VgVideoParams,
  opts: { stop_at?: VgStopAt } = {},
): Promise<VgTask> {
  return rd<VgTask>('/api/v1/video-generation/tasks', {
    method: 'POST',
    body: params,
    query: { stop_at: opts.stop_at ?? 'video' },
  });
}

/** 批量提交:N 个主题共享 shared_params,后端并发跑 — BatchModePage 用。 */
export interface VgBatchSubmitResponse {
  submitted: number;
  skipped: number;
  tasks: VgTask[];
}

export async function vgSubmitBatch(args: {
  subjects: string[];
  shared_params: VgVideoParams;
}): Promise<VgBatchSubmitResponse> {
  return rd<VgBatchSubmitResponse>('/api/v1/video-generation/tasks/batch', {
    method: 'POST',
    body: args,
  });
}

export async function vgListTasks(args: {
  state?: VgTaskState;
  page?: number;
  page_size?: number;
} = {}): Promise<VgListResponse<VgTask>> {
  return rd<VgListResponse<VgTask>>('/api/v1/video-generation/tasks', {
    method: 'GET',
    query: {
      state: args.state,
      page: args.page ?? 1,
      page_size: args.page_size ?? 20,
    },
  });
}

export async function vgGetTask(taskId: string): Promise<VgTask> {
  return rd<VgTask>(`/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}`);
}

export async function vgDeleteTask(taskId: string): Promise<{ deleted: boolean }> {
  return rd<{ deleted: boolean }>(`/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}

export async function vgCancelTask(taskId: string): Promise<{ canceled: boolean }> {
  return rd<{ canceled: boolean }>(
    `/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST' },
  );
}

/** 重试/继续任务(失败/取消/服务重启中断都可)。 */
export async function vgRetryTask(taskId: string): Promise<{ retried: boolean }> {
  return rd<{ retried: boolean }>(
    `/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}/retry`,
    { method: 'POST' },
  );
}

// ─────────────────────────────────────────────────────────────────────
// SSE 进度
// ─────────────────────────────────────────────────────────────────────

export interface VgTaskEventHandlers {
  /** 初始全量快照 / 后续 update 都通过这个回调,前端按需 diff */
  onTask(task: VgTask): void;
  onDone?(): void;
  onError?(err: Error): void;
}

export async function vgSubscribeTaskEvents(
  taskId: string,
  handlers: VgTaskEventHandlers,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const cfg = getClientConfig();
  const url = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}/events`;
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if ((cfg.authMode ?? 'bearer') === 'bearer') {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const res = await getPlatform().net.fetch(url, {
    method: 'GET',
    headers,
    signal: opts.signal,
    credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
  } as RequestInit);
  if (!res.ok || !res.body) {
    throw new Error(`vg.tasks.events HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (opts.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sepIdx: number;
      // eslint-disable-next-line no-cond-assign
      while (
        (sepIdx = (() => {
          const a = buf.indexOf('\n\n');
          const b = buf.indexOf('\r\n\r\n');
          if (a === -1) return b;
          if (b === -1) return a;
          return Math.min(a, b);
        })()) !== -1
      ) {
        const isCRLF = buf.startsWith('\r\n\r\n', sepIdx);
        const frame = buf.slice(0, sepIdx);
        buf = buf.slice(sepIdx + (isCRLF ? 4 : 2));
        let event = 'message';
        const dataLines: string[] = [];
        for (const rawLine of frame.split(/\r?\n/)) {
          if (!rawLine || rawLine.startsWith(':')) continue;
          const colon = rawLine.indexOf(':');
          const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
          let val = colon === -1 ? '' : rawLine.slice(colon + 1);
          if (val.startsWith(' ')) val = val.slice(1);
          if (field === 'event') event = val;
          else if (field === 'data') dataLines.push(val);
        }
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');
        if (event === 'task.snapshot' || event === 'task.update') {
          try {
            handlers.onTask(JSON.parse(dataStr) as VgTask);
          } catch (e) {
            handlers.onError?.(e as Error);
          }
        } else if (event === 'ping') {
          // 心跳,忽略
        }
      }
    }
    handlers.onDone?.();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 素材库
// ─────────────────────────────────────────────────────────────────────

export async function vgListMaterials(args: {
  source?: 'upload' | 'pexels' | 'pixabay' | 'bundled';
  page?: number;
  page_size?: number;
} = {}): Promise<VgListResponse<VgMaterial>> {
  return rd<VgListResponse<VgMaterial>>('/api/v1/video-generation/materials', {
    method: 'GET',
    query: {
      source: args.source,
      page: args.page ?? 1,
      page_size: args.page_size ?? 50,
    },
  });
}

export async function vgUploadMaterial(args: {
  file: File;
  name?: string;
  tags?: string;
}): Promise<VgMaterial> {
  const fd = new FormData();
  fd.append('file', args.file);
  if (args.name) fd.append('name', args.name);
  if (args.tags) fd.append('tags', args.tags);
  return rd<VgMaterial>('/api/v1/video-generation/materials', {
    method: 'POST',
    body: fd,
  });
}

export async function vgDeleteMaterial(
  materialId: string,
  opts: { drop_file?: boolean } = {},
): Promise<{ deleted: boolean }> {
  return rd<{ deleted: boolean }>(
    `/api/v1/video-generation/materials/${encodeURIComponent(materialId)}`,
    { method: 'DELETE', query: { drop_file: opts.drop_file ?? true } },
  );
}

export async function vgSearchMaterials(args: {
  q: string;
  source?: 'pexels' | 'pixabay';
  aspect?: VgVideoAspect;
  minimum_duration?: number;
  auto_translate?: boolean;
}): Promise<{ count: number; items: VgMaterialInfo[]; query?: string; translated_query?: string | null }> {
  return rd<{ count: number; items: VgMaterialInfo[]; query?: string; translated_query?: string | null }>('/api/v1/video-generation/materials/search', {
    method: 'GET',
    query: {
      q: args.q,
      source: args.source ?? 'pexels',
      aspect: args.aspect ?? '9:16',
      minimum_duration: args.minimum_duration ?? 5,
      auto_translate: args.auto_translate ?? true,
    },
  });
}

export interface VgMediaItem {
  url: string;
  kind: 'image' | 'video';
  thumb?: string;
  title?: string;
  via?: string;
}
export interface VgExtractedMedia {
  items: VgMediaItem[];
  source_url: string;
}

export async function vgExtractMedia(url: string): Promise<VgExtractedMedia> {
  return rd<VgExtractedMedia>('/api/v1/video-generation/materials/extract-media', {
    method: 'GET',
    query: { url },
  });
}

/** 下载远程媒体落库,返回新建 VgMaterial。 */
export async function vgIngestMedia(args: {
  url: string;
  kind: 'image' | 'video';
  source?: string;
}): Promise<VgMaterial> {
  return rd<VgMaterial>('/api/v1/video-generation/materials/ingest', {
    method: 'POST',
    body: { url: args.url, kind: args.kind, source: args.source ?? 'online' },
  });
}

/** BGM 试听/下载 URL。 */
export function vgBgmFileUrl(name: string, download = false): string {
  const cfg = getClientConfig();
  const u = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/bgm/${encodeURIComponent(name)}/file`;
  return download ? `${u}?download=true` : u;
}

// ─────────────────────────────────────────────────────────────────────
// BGM / 字体 / 声音
// ─────────────────────────────────────────────────────────────────────

export async function vgListBgm(): Promise<{ count: number; items: VgBgmItem[] }> {
  return rd<{ count: number; items: VgBgmItem[] }>('/api/v1/video-generation/bgm');
}

export async function vgUploadBgm(file: File): Promise<{ name: string; path: string; size: number }> {
  const fd = new FormData();
  fd.append('file', file);
  return rd<{ name: string; path: string; size: number }>('/api/v1/video-generation/bgm', { method: 'POST', body: fd });
}

export async function vgListFonts(): Promise<{ count: number; items: VgFontItem[] }> {
  return rd<{ count: number; items: VgFontItem[] }>('/api/v1/video-generation/fonts');
}

export async function vgListVoices(
  provider: VgVoiceProvider = 'piper',
): Promise<{ provider: VgVoiceProvider; count: number; items: VgVoiceItem[] }> {
  return rd<{ provider: VgVoiceProvider; count: number; items: VgVoiceItem[] }>('/api/v1/video-generation/voices', { query: { provider } });
}

/** 显式下载 piper 音色到本地;成功 {downloaded:true},失败抛(detail 含 hint)。 */
export async function vgDownloadVoice(
  provider: VgVoiceProvider,
  voiceName: string,
): Promise<{ downloaded: boolean; voice_name?: string; cached?: boolean }> {
  return rd<{ downloaded: boolean; voice_name?: string; cached?: boolean }>(
    '/api/v1/video-generation/voices/download',
    {
      method: 'POST',
      body: JSON.stringify({ provider, voice_name: voiceName }),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ─────────────────────────────────────────────────────────────────────
// 在线素材源配置
// ─────────────────────────────────────────────────────────────────────

export interface VgSourceConfig {
  source_name: string;
  enabled: boolean;
  /** masked "已配" 或 "" 或明文(reveal 时) */
  api_key: string;
  has_api_key: boolean;
  config: Record<string, unknown>;
  updated_at: string | null;
}

export async function vgListSourceConfigs(reveal = false): Promise<{ items: VgSourceConfig[] }> {
  return rd<{ items: VgSourceConfig[] }>('/api/v1/video-generation/sources/config', {
    method: 'GET',
    query: { reveal },
  });
}

export async function vgUpsertSourceConfig(args: {
  source_name: string;
  enabled?: boolean;
  api_key?: string;
  config?: Record<string, unknown>;
}): Promise<VgSourceConfig> {
  return rd<VgSourceConfig>('/api/v1/video-generation/sources/config', {
    method: 'POST',
    body: JSON.stringify(args),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 文件下载 + 我的视频
// ─────────────────────────────────────────────────────────────────────

/** 拼接任务产物文件 URL — 浏览器/Video 标签直接用,会带 Authorization
 *  header 是不可能的,所以 path-style 同源场景才安全;Tauri 桌面侧由
 *  cookie/JWT proxy 兼容。 */
export function vgTaskFileUrl(taskId: string, fileName: string, download = false): string {
  const cfg = getClientConfig();
  const u = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/files/${encodeURIComponent(taskId)}/${encodeURIComponent(fileName)}`;
  return download ? `${u}?download=true` : u;
}

/** 素材文件 URL(卡片预览 img/video/audio src)。 */
export function vgMaterialFileUrl(materialId: string, download = false): string {
  const cfg = getClientConfig();
  const u = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/materials/${encodeURIComponent(materialId)}/file`;
  return download ? `${u}?download=true` : u;
}

export async function vgListVideos(args: {
  page?: number;
  page_size?: number;
} = {}): Promise<VgListResponse<VgVideo>> {
  return rd<VgListResponse<VgVideo>>('/api/v1/video-generation/videos', {
    method: 'GET',
    query: { page: args.page ?? 1, page_size: args.page_size ?? 50 },
  });
}

export async function vgDeleteVideo(
  videoId: string,
  opts: { drop_file?: boolean } = {},
): Promise<{ deleted: boolean }> {
  return rd<{ deleted: boolean }>(
    `/api/v1/video-generation/videos/${encodeURIComponent(videoId)}`,
    { method: 'DELETE', query: { drop_file: opts.drop_file ?? true } },
  );
}

// ─────────────────────────────────────────────────────────────────────
// 命名空间聚合
// ─────────────────────────────────────────────────────────────────────

export const videoGeneration = {
  generateScript: vgGenerateScript,
  generateTerms: vgGenerateTerms,
  parseSrt: vgParseSrt,
  extractUrl: vgExtractUrl,
  previewAudio: vgPreviewAudio,
  previewEdl: vgPreviewEdl,
  submitTask: vgSubmitTask,
  submitBatch: vgSubmitBatch,
  listTasks: vgListTasks,
  getTask: vgGetTask,
  deleteTask: vgDeleteTask,
  cancelTask: vgCancelTask,
  retryTask: vgRetryTask,
  subscribeTaskEvents: vgSubscribeTaskEvents,
  listMaterials: vgListMaterials,
  uploadMaterial: vgUploadMaterial,
  deleteMaterial: vgDeleteMaterial,
  searchMaterials: vgSearchMaterials,
  extractMedia: vgExtractMedia,
  ingestMedia: vgIngestMedia,
  bgmFileUrl: vgBgmFileUrl,
  listBgm: vgListBgm,
  uploadBgm: vgUploadBgm,
  listFonts: vgListFonts,
  listVoices: vgListVoices,
  downloadVoice: vgDownloadVoice,
  taskFileUrl: vgTaskFileUrl,
  downloadTaskFile: vgDownloadTaskFile,
  materialFileUrl: vgMaterialFileUrl,
  listVideos: vgListVideos,
  deleteVideo: vgDeleteVideo,
  listSourceConfigs: vgListSourceConfigs,
  upsertSourceConfig: vgUpsertSourceConfig,
};
