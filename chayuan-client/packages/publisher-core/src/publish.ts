// packages/publisher-core/src/publish.ts
import { planUpload, type PlatformKey, type Tier } from '@chayuan/installer-core';
import { TIER_VARIANT } from './parse';
import type { DetectItem } from './detect';

export interface FinalizeResult { url: string; sha256: string; sizeBytes: number; }

export interface PublishIO {
  initUpload(meta: { product: string; version: string; platform: string; filename: string; size: number; sha256?: string }):
    Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
  getReceived(uploadId: string): Promise<number[]>;
  /** 读盘第 index 块并 PATCH 上传;isLast 标记末块。 */
  putChunk(uploadId: string, index: number, isLast: boolean): Promise<void>;
  finalize(uploadId: string, body: { variant: string; primary: boolean; notes?: string }): Promise<FinalizeResult>;
  publish(product: string, version: string, platform: string, variant: string): Promise<void>;
  setPrimary(product: string, version: string, platform: string, variant: string): Promise<void>;
  onProgress?(ev: { filename: string; received: number; total: number }): void;
}

export interface PublishedAsset {
  platform: PlatformKey; tier: Tier; url: string; sha256: string; sizeBytes: number; unpack: string;
}
export interface PublishResult {
  published: PublishedAsset[];
  failed: { filename: string; error: string }[];
}

/** 逐项 init→(续传跳块)→putChunk→finalize→publish→(可选 setPrimary)。单项失败隔离进 failed。 */
export async function runPublish(
  items: DetectItem[], io: PublishIO,
  opts: { product: string; version: string; notes?: string; primaryKeys?: string[] },
): Promise<PublishResult> {
  const published: PublishedAsset[] = [];
  const failed: { filename: string; error: string }[] = [];
  const primaryKeys = new Set(opts.primaryKeys ?? []);

  for (const it of items) {
    if (!it.selected || it.parsed !== 'ok' || !it.platform || !it.tier) continue;
    const variant = TIER_VARIANT[it.tier];
    const key = `${it.platform}/${it.tier}`;
    const primary = primaryKeys.has(key);
    try {
      const { uploadId, chunkSize, totalChunks } = await io.initUpload({
        product: opts.product, version: opts.version, platform: it.platform, filename: it.filename, size: it.sizeBytes,
      });
      const plan = planUpload(it.sizeBytes, chunkSize);
      const received = new Set(await io.getReceived(uploadId));
      let done = received.size;
      for (const c of plan.chunks) {
        if (received.has(c.index)) continue;
        // isLast 用本地 plan.totalChunks(与 plan.chunks 同源),不依赖服务端 totalChunks,避免两套切块公式不一致时末块标记错位。
        await io.putChunk(uploadId, c.index, c.index === plan.totalChunks - 1);
        done++;
        io.onProgress?.({ filename: it.filename, received: done, total: plan.totalChunks });
      }
      void totalChunks; // 服务端回报的块数仅作参考,实际切块以本地 planUpload 为准
      const fin = await io.finalize(uploadId, { variant, primary, notes: opts.notes });
      await io.publish(opts.product, opts.version, it.platform, variant);
      if (primary) await io.setPrimary(opts.product, opts.version, it.platform, variant);
      // unpack 占位 'none':调用方(apps/publisher)在合成清单前用 unpackForExt(文件名扩展) 补正确值。
      published.push({ platform: it.platform, tier: it.tier, url: fin.url, sha256: fin.sha256, sizeBytes: fin.sizeBytes, unpack: 'none' });
    } catch (e) {
      failed.push({ filename: it.filename, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { published, failed };
}
