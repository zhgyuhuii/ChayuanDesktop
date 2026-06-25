import { describe, it, expect } from 'vitest';
import { applySummaryFrame } from './fileSummaryReducer';
import type { ChatMessage } from '../../chat/useChayuanChat';

const base: ChatMessage = { id: 'a1', role: 'assistant', content: '', createdAt: 0 };

describe('applySummaryFrame', () => {
  it('progress 帧 → 进度百分比 + running 态', () => {
    const m = applySummaryFrame(base, { status: 'progress', done: 3, total: 6 }, 'x.docx');
    expect(m.taskProgress?.percent).toBe(50);
    expect(m.streaming).toBe(true);
    expect(m.metadata?.summary).toEqual({ state: 'running', fileName: 'x.docx' });
  });

  it('needs_confirm 帧 → 停流 + 带 chunkCount/estCalls', () => {
    const m = applySummaryFrame(base, { status: 'needs_confirm', chunk_count: 80, est_llm_calls: 17 }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.metadata?.summary).toEqual({ state: 'needs_confirm', fileName: 'x.docx', chunkCount: 80, estCalls: 17 });
  });

  it('delta 帧 → 逐 token 追加 content + 撤进度条 + running', () => {
    const m1 = applySummaryFrame(base, { status: 'delta', text: '本案' }, 'x.docx');
    expect(m1.content).toBe('本案');
    expect(m1.streaming).toBe(true);
    expect(m1.taskProgress).toBeUndefined();
    const m2 = applySummaryFrame(m1, { status: 'delta', text: '事实' }, 'x.docx');
    expect(m2.content).toBe('本案事实');
  });

  it('ok 帧 → 停流 + 用 summary 落定全文(覆盖增量)+ ok 态', () => {
    const m = applySummaryFrame({ ...base, content: '本案事实' }, { status: 'ok', summary: '完整总结' }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.content).toBe('完整总结');
    expect(m.taskProgress).toBeUndefined();
    expect(m.metadata?.summary?.state).toBe('ok');
  });

  it('error 帧 → 停流 + error 文案', () => {
    const m = applySummaryFrame(base, { status: 'error', msg: '炸了' }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.error).toBe('炸了');
    expect(m.metadata?.summary).toEqual({ state: 'error', fileName: 'x.docx', msg: '炸了' });
  });
});
