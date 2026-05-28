/**
 * 后端 chat handler 'video_generation' mode 在 assistant message answer 末尾
 * 附 sentinel:
 *   <脚本正文>
 *
 *   [[VG_META]]{"videoMeta":{"renderState":"idle",...}}[[/VG_META]]
 *
 * 前端 SSE 完成后调本工具:
 *   - 抽出 sentinel JSON → videoMeta
 *   - 把 sentinel 从 content 剥掉 → text
 *
 * 容错:
 *   - 无 sentinel 时返 { text: content } 原样
 *   - JSON 解析失败时返 { text: content } 原样(不丢 sentinel,便于排查)
 */
import type { VgMessageMeta } from '@chayuan/transport';

const VG_META_RE = /\[\[VG_META\]\]([\s\S]*?)\[\[\/VG_META\]\]/;

export function parseAndStripVgMeta(content: string): {
  text: string;
  videoMeta?: VgMessageMeta;
} {
  const m = VG_META_RE.exec(content);
  if (!m) return { text: content };
  let videoMeta: VgMessageMeta | undefined;
  try {
    const obj = JSON.parse(m[1]!) as { videoMeta?: VgMessageMeta };
    videoMeta = obj.videoMeta;
  } catch {
    // 容错:解析失败就不挂 metadata,只把 sentinel 当文本留着
    return { text: content };
  }
  return { text: content.replace(VG_META_RE, '').trim(), videoMeta };
}
