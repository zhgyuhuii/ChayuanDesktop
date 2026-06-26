/**
 * 单文件「全文总结」流式客户端 —— 消费后端
 * ``POST /knowledge_base/kb_summary_api/summarize_file_now``(EventSourceResponse,SSE 帧)。
 *
 * 后端事件(json,带 status):
 *   - { code:100, status:"running", chunk_count }      开始(已取全文,准备归纳)
 *   - { code:100, status:"delta", text }                单次整篇流式:逐 token 增量(实时显示)
 *   - { code:200, status:"needs_confirm", chunk_count, est_llm_calls }  超大文件待确认
 *   - { code:200, status:"ok", summary, cached }        完成,summary 是整篇摘要全文(权威值)
 *   - { code:4xx/5xx, status:"error", msg }             失败
 *
 * 用法与 subscribeHybridSearch 一致:返回 unsubscribe()。
 */
import { getAccessToken } from './auth-store';
import { getClientConfig } from './client';

export interface FileSummaryRequest {
  knowledge_base_name: string;
  file_name: string;
  /** 超大文件二次确认后置 true 再发 */
  confirmed?: boolean;
  threshold?: number;
  model_name?: string;
}

export type FileSummaryFrame =
  | { status: 'running'; chunk_count: number; total?: number }
  | { status: 'progress'; done: number; total: number }
  | { status: 'delta'; text: string }
  | { status: 'needs_confirm'; chunk_count: number; est_llm_calls: number }
  | { status: 'ok'; summary: string; cached?: boolean }
  | { status: 'error'; msg: string };

export function subscribeFileSummary(
  body: FileSummaryRequest,
  onFrame: (frame: FileSummaryFrame) => void,
  onError?: (e: unknown) => void,
): () => void {
  const ac = new AbortController();
  void (async () => {
    try {
      const cfg = getClientConfig();
      const token = await getAccessToken();
      const url = `${cfg.baseURL.replace(/\/+$/, '')}/knowledge_base/kb_summary_api/summarize_file_now`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: ac.signal,
        credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
      });
      if (!resp.ok || !resp.body) {
        onError?.(new Error(`summarize_file_now HTTP ${resp.status}`));
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 事件分隔符:sse_starlette 默认 \r\n\r\n,也容忍 \n\n(取最早出现的)。
        // 与 home.ts / aiVideo.ts 等其它 SSE 消费者一致;此前只切 \n\n → 对 \r\n\r\n
        // 永远匹配不到 → 一帧都解析不出 → 总结正文永不显示(网络版 docker 真机 bug)。
        while (true) {
          const a = buffer.indexOf('\n\n');
          const b = buffer.indexOf('\r\n\r\n');
          if (a < 0 && b < 0) break;
          const isCRLF = b >= 0 && (a < 0 || b <= a);
          const sepIdx = isCRLF ? b : a;
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + (isCRLF ? 4 : 2));
          const line = raw
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as { status?: string } & Record<string, unknown>;
            if (obj && typeof obj.status === 'string') {
              onFrame(obj as unknown as FileSummaryFrame);
            }
          } catch (e) {
            onError?.(e);
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') onError?.(e);
    }
  })();
  return () => ac.abort();
}
