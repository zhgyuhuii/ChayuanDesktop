// chayuan-client/packages/installer-core/src/__tests__/upload.test.ts
import { describe, it, expect } from 'vitest';
import { planUpload, runChunkedUpload } from '../upload';

describe('planUpload', () => {
  it('按 chunkSize 切块,最后一块取余', () => {
    const p = planUpload(10, 4);
    expect(p.totalChunks).toBe(3);
    expect(p.chunks).toEqual([
      { index: 0, start: 0, end: 4 },
      { index: 1, start: 4, end: 8 },
      { index: 2, start: 8, end: 10 },
    ]);
  });
  it('整除时不多一块', () => {
    expect(planUpload(8, 4).totalChunks).toBe(2);
  });
});

describe('runChunkedUpload', () => {
  it('init→各 chunk→finalize,按序调用注入的 io', async () => {
    const calls: string[] = [];
    const io = {
      init: async () => { calls.push('init'); return { uploadId: 'u1', chunkSize: 4, totalChunks: 3 }; },
      sendChunk: async (id: string, idx: number) => { calls.push(`chunk:${idx}`); return; },
      finalize: async () => { calls.push('finalize'); return { ok: true }; },
    };
    const res = await runChunkedUpload(
      { product: 'desktop', version: '3.0.0', platform: 'linux-x86_64', filename: 'x.run', size: 10, variant: '集成版' },
      io,
    );
    expect(res.ok).toBe(true);
    expect(calls).toEqual(['init', 'chunk:0', 'chunk:1', 'chunk:2', 'finalize']);
  });
  it('某 chunk 抛错 → 返回失败,不调 finalize', async () => {
    const io = {
      init: async () => ({ uploadId: 'u1', chunkSize: 4, totalChunks: 3 }),
      sendChunk: async (_id: string, idx: number) => { if (idx === 1) throw new Error('net'); },
      finalize: async () => ({ ok: true }),
    };
    const res = await runChunkedUpload(
      { product: 'desktop', version: '3.0.0', platform: 'linux-x86_64', filename: 'x.run', size: 10, variant: '集成版' },
      io,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('net');
  });
});
