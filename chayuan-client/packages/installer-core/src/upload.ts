export interface UploadChunk { index: number; start: number; end: number; }
export interface UploadPlan { totalChunks: number; chunks: UploadChunk[]; }

/** 按 chunkSize 把 size 切成块(最后一块取余)。 */
export function planUpload(size: number, chunkSize: number): UploadPlan {
  const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
  const chunks: UploadChunk[] = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push({ index: i, start: i * chunkSize, end: Math.min((i + 1) * chunkSize, size) });
  }
  return { totalChunks, chunks };
}

export interface UploadMeta {
  product: string; version: string; platform: string;
  filename: string; size: number; variant: string; primary?: boolean;
}
export interface UploadIO {
  init(meta: UploadMeta): Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
  sendChunk(uploadId: string, index: number, chunk: UploadChunk): Promise<void>;
  finalize(uploadId: string, meta: UploadMeta): Promise<{ ok: boolean; error?: string }>;
}

/** 编排 init→各 chunk→finalize。任一步抛错→返回 {ok:false},不进 finalize。 */
export async function runChunkedUpload(meta: UploadMeta, io: UploadIO): Promise<{ ok: boolean; error?: string }> {
  try {
    const { uploadId, chunkSize } = await io.init(meta);
    const plan = planUpload(meta.size, chunkSize);
    for (const c of plan.chunks) {
      await io.sendChunk(uploadId, c.index, c);
    }
    return await io.finalize(uploadId, meta);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
