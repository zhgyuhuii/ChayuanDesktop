import { vgIngestMedia, getClientConfig, type VgMaterial } from '@chayuan/api';

/** 把 AI 生成的视频(artifact URL,可能是相对 /v1/artifacts/...)落库成 VG 素材。 */
export async function ingestAiVideo(videoUrl: string): Promise<VgMaterial> {
  let url = videoUrl;
  if (url.startsWith('/')) {
    const base = (getClientConfig().baseURL || '').replace(/\/+$/, '');
    url = base + url;
  }
  return vgIngestMedia({ url, kind: 'video', source: 'ai-video' });
}
