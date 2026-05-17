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
  /** 兼容字段:
   *  - 无 sessionId 路径 → 整个 chunk 的转写文本
   *  - 有 sessionId 路径 → 本次 LocalAgreement-2 新 commit 的 stable_increment */
  text: string;
  language: string;
  // session 模式下的额外字段(无 session 时 undefined):
  /** 当前 whisper 对累积音频的完整猜测(整段 audio_pcm) */
  hypothesis?: string;
  /** 截至本次的全部 stable 文本(包括本次的 increment) */
  committed_text?: string;
  /** 当前未确认的尾部(LocalAgreement 还在等第二次确认) */
  volatile_suffix?: string;
  /** whisper 改写了之前 commit 的内容(罕见,前端不撤销;仅诊断用) */
  retroactive_change?: boolean;
  /** session 累积音频已达 30s 上限,下一个 chunk 应换 sessionId 重启 */
  is_full?: boolean;
  chunk_count?: number;
  audio_seconds?: number;
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
    opts: {
      language?: string;
      signal?: AbortSignal;
      /** 传 session_id 走流式 LocalAgreement-2 路径,后端会用累积音频跨 chunk 校验,
       *  返 stable_increment(本次新 commit)+ volatile_suffix(未确认尾部) */
      sessionId?: string;
    } = {},
  ): Promise<TranscribeResult> {
    const form = new FormData();
    form.append('file', blob, (blob as File).name || 'audio.webm');
    if (opts.language) form.append('language', opts.language);
    if (opts.sessionId) form.append('session_id', opts.sessionId);
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
