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

  it('ok 帧 → 停流 + 100% + ok 态(content 由打字机负责,不在此设)', () => {
    const m = applySummaryFrame({ ...base, content: '部分' }, { status: 'ok', summary: '完整总结' }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.taskProgress?.percent).toBe(100);
    expect(m.metadata?.summary?.state).toBe('ok');
  });

  it('error 帧 → 停流 + error 文案', () => {
    const m = applySummaryFrame(base, { status: 'error', msg: '炸了' }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.error).toBe('炸了');
    expect(m.metadata?.summary).toEqual({ state: 'error', fileName: 'x.docx', msg: '炸了' });
  });
});
