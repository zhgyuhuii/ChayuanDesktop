import { getAccessToken, getClientConfig } from '@chayuan/api';
import { downloadUrlAsFile } from '../../lib/downloadMedia';

/** 任意文件来源的统一描述。后端 /v1/files?kind=... 对应。DH/VG 阶段3 再加。 */
export type FileRef =
  | { kind: 'kb-doc'; kb: string; file: string }
  | { kind: 'image'; sourceId: string | number; imageId: string }
  | { kind: 'artifact'; name: string };

function refParams(ref: FileRef): Record<string, string> {
  switch (ref.kind) {
    case 'kb-doc':
      return { kind: 'kb-doc', kb: ref.kb, file: ref.file };
    case 'image':
      return { kind: 'image', source_id: String(ref.sourceId), image_id: ref.imageId };
    case 'artifact':
      return { kind: 'artifact', name: ref.name };
  }
}

/** 解析为同源 /api/v1/files URL(带 token);download=true 加 download=1(attachment)。
 *  注:用 /api/v1/files 而非 /v1/files(后者被 OpenAI 兼容 list_files 占用 → 422)。 */
export async function resolveFileUrl(ref: FileRef, opts?: { download?: boolean }): Promise<string> {
  const base = (getClientConfig().baseURL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams(refParams(ref));
  if (opts?.download) qs.set('download', '1');
  const tok = await getAccessToken();
  if (tok) qs.set('token', tok);
  return `${base}/api/v1/files?${qs.toString()}`;
}

/** 统一下载:fetch blob → 平台保存(不用 window.open,不被 nginx 整页导航 SPA fallback 吞)。 */
export async function downloadFile(ref: FileRef, filename: string): Promise<void> {
  const url = await resolveFileUrl(ref, { download: true });
  await downloadUrlAsFile(filename, url);
}
