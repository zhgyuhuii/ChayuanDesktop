// packages/publisher-core/src/__tests__/publish.test.ts
import { describe, it, expect } from 'vitest';
import { runPublish, type PublishIO } from '../publish';
import type { DetectItem } from '../detect';

function item(over: Partial<DetectItem>): DetectItem {
  return { filename: 'f', path: '/p', sizeBytes: 8, platform: 'win-x86_64', tier: 'pro',
    version: '3.1.0', parsed: 'ok', onlineState: 'new', selected: true, ...over };
}

function fakeIO(log: string[], opts: { failFinalizeFor?: string } = {}): PublishIO {
  return {
    async initUpload(meta) { log.push(`init:${meta.filename}`); return { uploadId: 'u-' + meta.filename, chunkSize: 4, totalChunks: 2 }; },
    async getReceived() { return []; },
    async putChunk(uploadId, index, isLast) { log.push(`chunk:${uploadId}:${index}:${isLast}`); },
    async finalize(uploadId, body) {
      if (opts.failFinalizeFor && uploadId.includes(opts.failFinalizeFor)) throw new Error('finalize boom');
      log.push(`finalize:${uploadId}:${body.variant}`);
      return { url: '/d/' + uploadId, sha256: 'sh', sizeBytes: 8 };
    },
    async publish(p, v, plat, variant) { log.push(`publish:${plat}:${variant}`); },
    async setPrimary(p, v, plat, variant) { log.push(`setPrimary:${plat}:${variant}`); },
  };
}

describe('runPublish', () => {
  it('单项: init→chunks→finalize→publish 顺序,返回 published 含 url/sha/size', async () => {
    const log: string[] = [];
    const res = await runPublish([item({ filename: 'a' })], fakeIO(log), { product: 'chayuan', version: '3.1.0' });
    expect(res.published).toHaveLength(1);
    expect(res.published[0]).toMatchObject({ platform: 'win-x86_64', tier: 'pro', url: '/d/u-a', sha256: 'sh', sizeBytes: 8 });
    expect(res.failed).toHaveLength(0);
    expect(log).toEqual(['init:a', 'chunk:u-a:0:false', 'chunk:u-a:1:true', 'finalize:u-a:全量版', 'publish:win-x86_64:全量版']);
  });

  it('variant 用档位中文名', async () => {
    const log: string[] = [];
    await runPublish([item({ filename: 'b', tier: 'lite' })], fakeIO(log), { product: 'chayuan', version: '3.1.0' });
    expect(log).toContain('finalize:u-b:轻量版');
  });

  it('某项 finalize 失败不阻断其它项,进 failed', async () => {
    const log: string[] = [];
    const res = await runPublish(
      [item({ filename: 'a' }), item({ filename: 'bad', platform: 'mac-arm64' })],
      fakeIO(log, { failFinalizeFor: 'bad' }), { product: 'chayuan', version: '3.1.0' });
    expect(res.published.map((x) => x.platform)).toEqual(['win-x86_64']);
    expect(res.failed).toEqual([{ filename: 'bad', error: 'finalize boom' }]);
  });

  it('跳过未勾选与 needsManual 项', async () => {
    const log: string[] = [];
    const res = await runPublish(
      [item({ filename: 'a' }), item({ filename: 'skip', selected: false }), item({ filename: 'm', parsed: 'needsManual' })],
      fakeIO(log), { product: 'chayuan', version: '3.1.0' });
    expect(res.published).toHaveLength(1);
    expect(log.some((l) => l.includes('skip') || l.includes(':m'))).toBe(false);
  });

  it('primary 指定时调 setPrimary', async () => {
    const log: string[] = [];
    await runPublish([item({ filename: 'a' })], fakeIO(log), { product: 'chayuan', version: '3.1.0', primaryKeys: ['win-x86_64/pro'] });
    expect(log).toContain('setPrimary:win-x86_64:全量版');
  });

  it('续传: getReceived 返回已收块则跳过', async () => {
    const log: string[] = [];
    const io = fakeIO(log); io.getReceived = async () => [0];
    await runPublish([item({ filename: 'a' })], io, { product: 'chayuan', version: '3.1.0' });
    expect(log).toContain('chunk:u-a:1:true');
    expect(log).not.toContain('chunk:u-a:0:false');
  });
});
