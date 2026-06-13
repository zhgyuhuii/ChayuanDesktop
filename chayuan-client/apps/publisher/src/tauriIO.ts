// apps/publisher/src/tauriIO.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PublishIO } from '@chayuan/publisher-core';

const UPLOAD_PATH = '/api/admin/uploads';

/** filePathByName: filename → 本地绝对路径(检测阶段得到)。onProgress 透传给 UI。 */
export function makePublishIO(
  filePathByName: Record<string, string>,
  onProgress: (ev: { filename: string; received: number; total: number }) => void,
): PublishIO & { _runUpload: (id: string, fn: string, cs: number, tc: number, missing: number[]) => Promise<void> } {
  let currentFilename = '';
  return {
    async initUpload(meta) {
      currentFilename = meta.filename;
      return invoke('http_json', { method: 'POST', path: `${UPLOAD_PATH}/init`, body: {
        product: meta.product, version: meta.version, platform: meta.platform,
        filename: meta.filename, size: meta.size, sha256: meta.sha256 ?? null,
      } });
    },
    async getReceived(uploadId) {
      const v = await invoke<{ received: number[] }>('http_json', { method: 'GET', path: `${UPLOAD_PATH}/${uploadId}`, body: null });
      return v.received ?? [];
    },
    async putChunk() { /* 实际批量上传见下方 runUpload,这里不单块调用 */ },
    async finalize(uploadId, body) {
      const v = await invoke<{ entry?: { path: string; sha256: string; size: number } }>('http_json', {
        method: 'POST', path: `${UPLOAD_PATH}/${uploadId}/finalize`, body });
      const e = v.entry!;
      return { url: '/downloads/' + e.path, sha256: e.sha256, sizeBytes: e.size };
    },
    async publish(product, version, platform, variant) {
      await invoke('http_json', { method: 'POST',
        path: `/api/admin/releases/${product}/${version}/${platform}/${encodeURIComponent(variant)}/publish`, body: null });
    },
    async setPrimary(product, version, platform, variant) {
      await invoke('http_json', { method: 'POST',
        path: `/api/admin/releases/${product}/${version}/${platform}/${encodeURIComponent(variant)}/set-primary`, body: null });
    },
    onProgress,
    // 暴露给 App:真正的分块上传(绕过 putChunk 逐块,用 Rust 批量 upload_chunks)
    _runUpload: async (uploadId: string, filename: string, chunkSize: number, totalChunks: number, missing: number[]) => {
      const filePath = filePathByName[filename];
      void currentFilename; // suppress unused warning
      const un = await listen<{ uploadId: string; received: number; total: number }>('upload-progress', (ev) => {
        if (ev.payload.uploadId === uploadId) onProgress({ filename, received: ev.payload.received, total: ev.payload.total });
      });
      try {
        await invoke('upload_chunks', { uploadId, uploadPath: UPLOAD_PATH, filePath, chunkSize, totalChunks, indices: missing });
      } finally { un(); }
    },
  };
}
