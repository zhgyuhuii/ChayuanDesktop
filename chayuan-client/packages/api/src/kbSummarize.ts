/**
 * 单文件「全文总结」流式客户端 —— 消费后端
 * ``POST /knowledge_base/kb_summary_api/summarize_file_now``(EventSourceResponse,SSE 帧)。
 *
 * 后端事件(json,带 status):
 *   - { code:100, status:"running", chunk_count }      开始(已取全文,准备归纳)
 *   - { code:200, status:"needs_confirm", chunk_count, est_llm_calls }  超大文件待确认
 *   - { code:200, status:"ok", summary, cached }        完成,summary 是整篇摘要文本
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
      const token = getAccessToken();
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
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw
            .split('\n')
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
