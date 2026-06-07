/**
 * AI 视频生成客户端模块（文生视频 / 图生视频）。
 *
 * 向模态网关 POST /v1/modality/completions 提交请求，订阅 SSE v5 进度流，
 * 以及列出所有已配置的文生视频模型。
 *
 * SSE 事件格式遵循 sse_v5.py：
 *   type="file"          媒体产物（视频/图片/音频）: { mediaType, url, metadata? }
 *   type="data-task-progress"  进度: { data: { percent, eta_s?, message? } }
 *   type="error"         错误: { errorText, code? }
 *   type="finish"        流结束
 */

import { getPlatform } from '@chayuan/platform-shared';
import { getClientConfig } from './client';
import { getAccessToken } from './auth-store';
import { providers } from './providers';

// ─────────────────────────────────────────────────────────────────────────────
// 参数 / 回调接口
// ─────────────────────────────────────────────────────────────────────────────

export interface AiVideoParams {
  /** 模型 id，如 "wan2.1-t2v-14b" */
  model: string;
  /** 文字提示词 */
  prompt: string;
  /** 图生视频时的参考图 base64 数据（不含 data URI 前缀） */
  imageB64?: string | null;
  /** 参考图 MIME 类型，默认 'image/png' */
  imageMime?: string | null;
  /** 传给后端 modality_params 的额外参数，如 width/height/duration 等 */
  modalityParams?: Record<string, unknown>;
}

export interface AiVideoEventHandlers {
  /** 生成进度 0-100 */
  onProgress?(percent: number): void;
  /** 视频产物 URL（可能是本地 /files/... 或远端 https://...） */
  onVideo(url: string): void;
  /** 发生错误（不一定终止流，由调用方决定是否继续） */
  onError?(e: Error): void;
  /** 流正常结束 */
  onDone?(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE v5 事件结构（对应 sse_v5.py 各工厂函数）
// ─────────────────────────────────────────────────────────────────────────────

interface SseFileEvent {
  type: 'file';
  /** MIME 类型，如 "video/mp4"、"image/png" */
  mediaType: string;
  /** 产物访问 URL */
  url: string;
  metadata?: Record<string, unknown>;
}

interface SseTaskProgressData {
  percent: number;
  eta_s?: number;
  message?: string;
}

interface SseDataTaskProgressEvent {
  type: 'data-task-progress';
  data: SseTaskProgressData;
  id?: string;
}

interface SseErrorEvent {
  type: 'error';
  errorText: string;
  code?: string;
}

interface SseFinishEvent {
  type: 'finish';
}

interface SseOtherEvent {
  type: string;
  [key: string]: unknown;
}

type SseEvent =
  | SseFileEvent
  | SseDataTaskProgressEvent
  | SseErrorEvent
  | SseFinishEvent
  | SseOtherEvent;

// ─────────────────────────────────────────────────────────────────────────────
// 核心函数：提交并订阅 SSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 向 /v1/modality/completions 提交文生/图生视频请求，流式订阅 SSE v5 事件。
 *
 * - 视频产物事件 (type="file", mediaType 以 "video/" 开头) → handlers.onVideo(url)
 * - 进度事件 (type="data-task-progress") → handlers.onProgress(percent)
 * - 错误事件 (type="error") → handlers.onError(new Error(errorText))
 * - 流结束 (type="finish" 或 reader done) → handlers.onDone()
 */
export async function aiVideoGenerate(
  params: AiVideoParams,
  handlers: AiVideoEventHandlers,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const cfg = getClientConfig();
  const baseURL = (cfg.baseURL || '').replace(/\/+$/, '');
  const url = `${baseURL}/v1/modality/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if ((cfg.authMode ?? 'bearer') === 'bearer') {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }

  // 构造请求体
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [{ role: 'user', content: params.prompt }],
    extra_body: {
      modality_params: params.modalityParams ?? {},
      ...(params.imageB64
        ? {
            modality_attachments: [
              {
                mime: params.imageMime ?? 'image/png',
                data_b64: params.imageB64,
              },
            ],
          }
        : {}),
    },
  };

  const res = await getPlatform().net.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
    credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
  } as RequestInit);

  if (!res.ok || !res.body) {
    throw new Error(`aiVideo HTTP ${res.status}`);
  }

  // 手动解析 SSE（与 vgSubscribeTaskEvents 保持一致的分帧逻辑）
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

        const dataLines: string[] = [];
        for (const rawLine of frame.split(/\r?\n/)) {
          if (!rawLine || rawLine.startsWith(':')) continue;
          const colon = rawLine.indexOf(':');
          const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
          let val = colon === -1 ? '' : rawLine.slice(colon + 1);
          if (val.startsWith(' ')) val = val.slice(1);
          // SSE v5 事件：type 放在 JSON data 里，不用 event: 行
          if (field === 'data') dataLines.push(val);
        }

        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');

        // 跳过 OpenAI 兼容终止哨兵
        if (dataStr.trim() === '[DONE]') continue;

        let ev: SseEvent;
        try {
          ev = JSON.parse(dataStr) as SseEvent;
        } catch {
          // 解析失败跳过
          continue;
        }

        if (ev.type === 'file') {
          const fileEv = ev as SseFileEvent;
          if (fileEv.mediaType?.startsWith('video/')) {
            handlers.onVideo(fileEv.url);
          }
        } else if (ev.type === 'data-task-progress') {
          const progEv = ev as SseDataTaskProgressEvent;
          const pct = progEv.data?.percent;
          if (typeof pct === 'number') {
            handlers.onProgress?.(pct);
          }
        } else if (ev.type === 'error') {
          const errEv = ev as SseErrorEvent;
          handlers.onError?.(new Error(errEv.errorText ?? '视频生成失败'));
        } else if (ev.type === 'finish') {
          handlers.onDone?.();
          return;
        }
        // start / text-* / source-* / finish-step / ping 等其他事件忽略
      }
    }
    handlers.onDone?.();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 列出已配置的文生视频模型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 列出所有已配置（enabled）的厂商中可用的 text2video 模型。
 *
 * 返回 { platform: pid 或 platform_name, model } 列表，供 UI 展示下拉选项。
 */
export async function aiVideoListModels(): Promise<Array<{ platform: string; model: string }>> {
  const entries = await providers.list();
  const result: Array<{ platform: string; model: string }> = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const models = entry.text2video_models;
    if (!Array.isArray(models)) continue;
    const platform = entry.pid;
    for (const model of models) {
      const isDisabled = Array.isArray(entry.disabled_models) && entry.disabled_models.includes(model);
      if (!isDisabled) {
        result.push({ platform, model });
      }
    }
  }
  return result;
}
