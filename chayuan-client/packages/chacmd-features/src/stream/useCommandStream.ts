import * as React from 'react';
import { type CommandState, applyStreamEvent, initialCommandState } from './streamReducer';

/**
 * 订阅后端 GET /api/v1/stream（EventSource/SSE），把事件累积成指挥态。
 * 纯逻辑在 applyStreamEvent（已单测）；本 hook 只做 EventSource 生命周期 + 解析。
 */
export function useCommandStream(url = '/api/v1/stream'): CommandState {
  const [state, setState] = React.useState<CommandState>(initialCommandState);

  React.useEffect(() => {
    // EventSource 由浏览器/webview 提供；SSR/测试(node)环境下缺省则跳过。
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(url);
    es.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data);
        setState((s) => applyStreamEvent(s, event));
      } catch {
        /* 忽略畸形帧 */
      }
    };
    return () => es.close();
  }, [url]);

  return state;
}
