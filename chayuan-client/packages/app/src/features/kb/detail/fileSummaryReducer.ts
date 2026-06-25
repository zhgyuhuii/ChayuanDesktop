import type { SummaryMessageMeta } from '@chayuan/transport';
import type { ChatMessage } from '../../chat/useChayuanChat';
import type { FileSummaryFrame } from '@chayuan/api';

/**
 * 纯函数:把一帧 FileSummaryFrame 应用到当前 assistant 消息,得到下一态。
 * content 不在此设——`ok` 时正文由 useFileSummaryTurn 的打字机逐字写入。
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
    case 'needs_confirm':
      return {
        ...msg, streaming: false, taskProgress: undefined,
        metadata: withSummary({ state: 'needs_confirm', chunkCount: frame.chunk_count, estCalls: frame.est_llm_calls }),
      };
    case 'ok':
      return {
        ...msg, streaming: false, error: undefined,
        taskProgress: { percent: 100 },
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
