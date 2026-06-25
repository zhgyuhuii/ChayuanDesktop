import type { SummaryMessageMeta } from '@chayuan/transport';
import type { ChatMessage } from '../../chat/useChayuanChat';
import type { FileSummaryFrame } from '@chayuan/api';

/**
 * 纯函数:把一帧 FileSummaryFrame 应用到当前 assistant 消息,得到下一态。
 * 流式:`delta` 逐 token 追加到 content(实时显示);`ok` 用 summary 作为权威全文落定
 * (覆盖增量拼接,保证与服务端一致;缓存命中无 delta 时也一次性落全文,无需打字机)。
 */
export function applySummaryFrame(
  msg: ChatMessage,
  frame: FileSummaryFrame,
  fileName: string,
): ChatMessage {
  const withSummary = (s: Omit<SummaryMessageMeta, 'fileName'>): ChatMessage['metadata'] =>
    ({ ...(msg.metadata ?? {}), summary: { ...s, fileName } });

  switch (frame.status) {
    case 'running':
      return {
        ...msg, streaming: true, error: undefined,
        taskProgress: { percent: frame.total ? 1 : 0, message: '正在通览整篇并归纳…' },
        metadata: withSummary({ state: 'running' }),
      };
    case 'progress': {
      const percent = frame.total ? Math.min(99, Math.round((frame.done / frame.total) * 100)) : 0;
      return {
        ...msg, streaming: true,
        taskProgress: { percent, message: '正在归纳…' },
        metadata: withSummary({ state: 'running' }),
      };
    }
    case 'delta':
      // 单次整篇流式:逐 token 追加;首个 delta 起就显示正文,撤掉进度条
      return {
        ...msg, streaming: true, error: undefined,
        content: (msg.content ?? '') + frame.text,
        taskProgress: undefined,
        metadata: withSummary({ state: 'running' }),
      };
    case 'needs_confirm':
      return {
        ...msg, streaming: false, taskProgress: undefined,
        metadata: withSummary({ state: 'needs_confirm', chunkCount: frame.chunk_count, estCalls: frame.est_llm_calls }),
      };
    case 'ok':
      // 权威全文落定:覆盖增量拼接(与服务端一致);缓存命中无 delta 时这里一次性显示全文
      return {
        ...msg, streaming: false, error: undefined,
        content: frame.summary,
        taskProgress: undefined,
        metadata: withSummary({ state: 'ok' }),
      };
    case 'error':
      return {
        ...msg, streaming: false, taskProgress: undefined, error: frame.msg,
        metadata: withSummary({ state: 'error', msg: frame.msg }),
      };
    default:
      return msg;
  }
}
