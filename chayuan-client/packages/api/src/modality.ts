/**
 * 通用多模态 HTTP 客户端 — OCR / ASR。
 * 后端端点:POST /modality/ocr / /modality/transcribe(modality_routes.py)。
 */
import { request } from './client';

export interface OcrResult {
  text: string;
  lang: string;
  confidence: number;
  box_count: number;
  elapsed_ms: number;
}

export interface TranscribeResult {
  text: string;
  language: string;
}

export interface AsrDiagSidecar {
  state: string;
  endpoint: string;
  reachable: boolean;
  http_status: number;
  last_error: string;
  probe_error: string;
}

export interface AsrDiagBackend {
  installed?: boolean;
  configured?: boolean;
  error: string;
}

export interface AsrDiagResult {
  sidecar: AsrDiagSidecar;
  faster_whisper: AsrDiagBackend;
  openai_whisper: AsrDiagBackend;
  openai_api: AsrDiagBackend;
  default_model: string;
  recommend: string;
}

/** call_log entry — preview/error 都已被后端截到 300 字符。 */
export interface CallLogEntry {
  ts: string;
  success: boolean;
  duration_ms: number;
  bytes_in: number;
  preview: string;
  error: string;
  // extra 透传字段(filename / language / lang / box_count / port / audio_format 等)
  [key: string]: unknown;
}

export interface CallLogResult {
  key: string;
  limit: number;
  entries: CallLogEntry[];
}

export const modality = {
  /**
   * 对一张图做 OCR。
   * blob 应该是 image/* (jpeg/png/webp 等浏览器原生支持的格式)。
   * 失败时 throws (server returns 502/503)。
   */
  async ocr(file: Blob, opts: { signal?: AbortSignal } = {}): Promise<OcrResult> {
    const form = new FormData();
    form.append('file', file, (file as File).name || 'image.bin');
    const r = await request<{ data: OcrResult }>(`/modality/ocr`, {
      method: 'POST',
      body: form,
      signal: opts.signal,
      raw: true,
    });
    return r.data?.data as OcrResult;
  },

  /**
   * 对一段音频做 ASR 转写。
   * blob:audio/webm 或 audio/wav 等。失败永远返回 text=""(不 throw)。
   */
  async transcribe(
    blob: Blob,
    opts: { language?: string; signal?: AbortSignal } = {},
  ): Promise<TranscribeResult> {
    const form = new FormData();
    form.append('file', blob, (blob as File).name || 'audio.webm');
    if (opts.language) form.append('language', opts.language);
    const r = await request<{ data: TranscribeResult }>(`/modality/transcribe`, {
      method: 'POST',
      body: form,
      signal: opts.signal,
      raw: true,
    });
    return r.data?.data ?? { text: '', language: opts.language ?? 'auto' };
  },

  /**
   * 实时探测 4 层 ASR 后端可用性 — sidecar / faster-whisper / openai-whisper / OpenAI API。
   * 用于"录完没文字"时给用户精确诊断,不读 registry 缓存。
   */
  async asrDiag(): Promise<AsrDiagResult> {
    const r = await request<{ data: AsrDiagResult }>(`/modality/asr/diag`, {
      method: 'GET',
      raw: true,
    });
    return r.data?.data as AsrDiagResult;
  },

  /**
   * 读取某 capability 最近的调用日志。
   * 当前后端支持 key: 'asr' / 'ocr'(后续若加 chat/embedding record,key 同名)。
   */
  async callLog(key: string, limit = 200): Promise<CallLogResult> {
    const r = await request<{ data: CallLogResult }>(
      `/modality/call-log/${encodeURIComponent(key)}?limit=${limit}`,
      { method: 'GET', raw: true },
    );
    return r.data?.data ?? { key, limit, entries: [] };
  },
};
