/**
 * 模态路由(modality.router)前端 SDK。
 *
 * 与后端 `chayuan/server/modality/router/` 对齐:
 *   - `classifyModalityCapability(modelName)`:前端镜像 Python
 *     `classify_capability`,由 ChatComposer 用来切 UI 模式
 *     (badge/placeholder/submitLabel/参数条)
 *   - `streamModality(req, signal)`:打 `/v1/modality/completions`,返回
 *     v5 事件异步流
 *
 * **重要**:本模块仅供"非聊天 capability"使用(t2i/t2v/tts/asr/image_edit)。
 * chat 模型继续走老 transport(chayuan-transport.ts),KB / agent / citation
 * 等所有现有逻辑不变。
 *
 * 为什么放在 transport 而不是 api:
 *   - 依赖 SSE parser(transport 内置)+ fetch 流式
 *   - api 包依赖 transport 反向不成立(避免循环 import)
 *   - capability 分类是纯函数,放这里也方便 chat composer 直接 import
 */

import { parseV5Stream, type V5Event } from './v5-stream';

// ─────────────────────────────────────────────────────────────
// Capability classifier — 与 chayuan-server protocol.py 同一份真源
// ─────────────────────────────────────────────────────────────
//
// 不与 @chayuan/api 的 Capability(`text-embedding` / `text-to-image` 等
// 横杠命名)冲突 —— 这里用 modality.router 的内部短名(`embedding` / `t2i`),
// 命名空间通过 ``Modality`` 前缀显式区分。

export type ModalityCapability =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 't2i'
  | 't2v'
  | 'image_edit'
  | 'tts'
  | 'asr'
  | 'vl'
  | 'ocr';

/** 顺序敏感:更精确的前缀放前面(qwen-image-edit 必须先于 qwen-image)。 */
const PREFIX_TO_CAP: ReadonlyArray<readonly [string, ModalityCapability]> = [
  ['qwen-image-edit',   'image_edit'],
  ['qwen-image',        't2i'],
  ['gpt-image',         't2i'],
  ['dall-e',            't2i'],
  ['wanxiang-t2v',      't2v'],
  ['wanx-t2v',          't2v'],
  ['wanx',              't2i'],
  ['wanxiang',          't2i'],
  ['sora',              't2v'],
  ['stable-video',      't2v'],
  ['svd',               't2v'],
  ['runway',            't2v'],
  ['kling',             't2v'],
  ['wan-2',             't2v'],
  ['qvq-',              'vl'],
  ['qwen-vl',           'vl'],
  ['qwen-omni',         'vl'],
  ['qwen-audio',        'vl'],
  ['paraformer',           'asr'],
  ['whisper',              'asr'],
  ['qwen-asr',             'asr'],
  ['qwen3-asr',            'asr'],
  ['funasr',               'asr'],
  ['gpt-4o-transcribe',    'asr'],
  ['gpt-4o-mini-transcribe', 'asr'],
  ['qwen-tts',          'tts'],
  ['qwen3-tts',         'tts'],
  ['cosyvoice',         'tts'],
  ['sambert',           'tts'],
  ['voxcpm',            'tts'],
  // rerank 必须在 embedding 之前 — bge-reranker 否则会被 bge- 吞
  ['bge-reranker',      'rerank'],
  ['gte-rerank',        'rerank'],
  ['cohere-rerank',     'rerank'],
  ['jina-rerank',       'rerank'],
  ['text-embedding-',   'embedding'],
  ['embedding-',        'embedding'],
  ['text-embedding',    'embedding'],
  ['bge-',              'embedding'],
  ['rapidocr',          'ocr'],
  ['paddleocr',         'ocr'],
  ['pp-ocr',            'ocr'],
];

/**
 * 按模型名前缀推断 capability。命中不到一律 `chat`。
 * 兼容 `platform::model` 和 `provider/model` 两种命名空间写法。
 */
export function classifyModalityCapability(
  modelName: string | null | undefined,
): ModalityCapability {
  if (!modelName) return 'chat';
  let low = modelName.toLowerCase().trim();
  if (low.includes('::')) low = low.split('::', 2)[1] ?? low;
  if (low.includes('/')) low = low.split('/', 2)[1] ?? low;
  for (const [prefix, cap] of PREFIX_TO_CAP) {
    if (low.startsWith(prefix)) return cap;
  }
  return 'chat';
}


// ─────────────────────────────────────────────────────────────
// Vendor classifier — 与后端 protocol.py classify_vendor 同一份真源
// ─────────────────────────────────────────────────────────────
//
// 为什么前端也需要:UI 参数条要按厂商切音色 / 尺寸预设(DashScope TTS 用
// Cherry/Serena…,OpenAI TTS 用 alloy/echo…)。如果只看 platform_type 会错
// (bailian 配 platform_type=openai 用来跑 chat compat-mode,但 qwen-tts-*
// 仍是 DashScope native 协议)。模型名前缀更接近上游协议的真源。

export type ModalityVendor =
  | 'dashscope'
  | 'openai'
  | 'stability'
  | 'runway'
  | 'kling'
  | null;

const PREFIX_TO_VENDOR: ReadonlyArray<readonly [string, ModalityVendor]> = [
  // DashScope 系
  ['qwen-image-edit',  'dashscope'],
  ['qwen-image',       'dashscope'],
  ['qwen-tts',         'dashscope'],
  ['qwen3-tts',        'dashscope'],
  ['qwen-asr',         'dashscope'],
  ['qwen3-asr',        'dashscope'],
  ['qwen-vl',          'dashscope'],
  ['qwen-omni',        'dashscope'],
  ['qwen-audio',       'dashscope'],
  ['qvq-',             'dashscope'],
  ['wanxiang-t2v',     'dashscope'],
  ['wanx-t2v',         'dashscope'],
  ['wanx',             'dashscope'],
  ['wanxiang',         'dashscope'],
  ['wan-2',            'dashscope'],
  ['paraformer',       'dashscope'],
  ['cosyvoice',        'dashscope'],
  ['sambert',          'dashscope'],
  // OpenAI 系
  ['dall-e',           'openai'],
  ['gpt-image',        'openai'],
  ['gpt-4o-mini-tts',  'openai'],
  ['tts-1',            'openai'],
  ['whisper',          'openai'],
  ['gpt-4o-transcribe', 'openai'],
  ['gpt-4o-mini-transcribe', 'openai'],
  ['sora',             'openai'],
  ['stable-video',     'stability'],
  ['svd',              'stability'],
  ['runway',           'runway'],
  ['kling',            'kling'],
];

export function classifyModalityVendor(modelName: string | null | undefined): ModalityVendor {
  if (!modelName) return null;
  let low = modelName.toLowerCase().trim();
  if (low.includes('::')) low = low.split('::', 2)[1] ?? low;
  if (low.includes('/')) low = low.split('/', 2)[1] ?? low;
  for (const [prefix, vendor] of PREFIX_TO_VENDOR) {
    if (low.startsWith(prefix)) return vendor;
  }
  return null;
}


// ─────────────────────────────────────────────────────────────
// streamModality — 打后端 /v1/modality/completions
// ─────────────────────────────────────────────────────────────

/**
 * 模态附件 — 给 image_edit / vl / asr 等需要"用户输入图/音/视"的能力用。
 *
 * 二选一形态:
 *   - ``dataB64``:base64 编码字节(任意本地文件 / blob)
 *   - ``url``:已上传到后端 artifacts 的 ``/v1/artifacts/<sha>.<ext>`` URL
 *
 * 后端解码 + 落 artifacts + 注入到 GenerateReq.attachments。
 */
export interface ModalityAttachment {
  mime: string;
  /** base64 字节(不含 ``data:...;base64,`` 前缀) */
  dataB64?: string;
  /** 已存在的 artifact URL,与 dataB64 二选一 */
  url?: string;
  name?: string;
}

export interface ModalityStreamReq {
  model: string;
  prompt: string;
  /** image_edit / asr 等场景的输入附件(参考图、音频文件等) */
  attachments?: ModalityAttachment[];
  params?: Record<string, unknown>;
  authHeader?: string;
  /** API base — 由调用方注入(浏览器走 vite proxy,Tauri 走 127.0.0.1:62581) */
  baseUrl: string;
}

/**
 * SSE 流,逐条 yield v5 事件。典型用法:
 * ```ts
 *   for await (const ev of streamModality({...}, ctrl.signal)) {
 *     switch (ev.type) {
 *       case 'text-delta': appendText(ev.delta); break;
 *       case 'file': addImagePart(ev.url, ev.mediaType, ev.metadata); break;
 *       case 'data-task-progress': updateProgress(ev.data); break;
 *       case 'error': showError(ev.errorText); break;
 *     }
 *   }
 * ```
 */
export async function* streamModality(
  req: ModalityStreamReq,
  signal?: AbortSignal,
): AsyncGenerator<V5Event> {
  const url = req.baseUrl.replace(/\/+$/, '') + '/v1/modality/completions';
  // 附件以 ``{mime, data_b64, name}`` / ``{mime, url, name}`` 形态塞进 extra_body
  // 后端解码 base64 → artifacts 落盘 → 注入 GenerateReq.attachments。
  const modalityAttachments = (req.attachments ?? []).map((a) => ({
    mime: a.mime,
    data_b64: a.dataB64,
    url: a.url,
    name: a.name,
  }));
  const body = JSON.stringify({
    model: req.model,
    messages: [{ role: 'user', content: req.prompt }],
    stream: true,
    extra_body: {
      modality_params: req.params ?? {},
      modality_attachments: modalityAttachments,
    },
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (req.authHeader) headers.Authorization = req.authHeader;
  const resp = await fetch(url, { method: 'POST', headers, body, signal });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    yield {
      type: 'error',
      errorText:
        resp.status === 503
          ? `模态路由未启用(503):${text || '后端需 CHAYUAN_MODALITY_NEW_PATH=1'}`
          : `HTTP ${resp.status}: ${text}`,
      code: `http_${resp.status}`,
    };
    return;
  }
  if (!resp.body) {
    yield { type: 'error', errorText: '响应没有 body,无法解析 SSE 流' };
    return;
  }
  for await (const ev of parseV5Stream(resp.body, signal)) {
    yield ev;
  }
}
