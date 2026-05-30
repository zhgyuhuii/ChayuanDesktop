/**
 * 任务/视频显示名 —— 与后端 runner._persist_vg_videos 的 title 推导一致:
 * 优先 video_subject;空则取脚本首句(到首个句末/分隔标点)截 ~14 字;再空兜底。
 *
 * 为什么需要:时间轴编辑器手动改脚本时会清掉 video_subject(script_source=manual),
 * 任务面板只看 video_subject 就显示"(未命名)"。脚本明明有内容,应据此概括出名字。
 */
interface VgTaskParamsLike {
  video_subject?: string | null;
  video_script?: string | null;
}

export function vgTaskName(
  params: VgTaskParamsLike | undefined | null,
  fallback = '(未命名)',
): string {
  const subject = (params?.video_subject || '').trim();
  if (subject) return subject;
  const script = String(params?.video_script || '');
  const firstLine = script.split('\n').map((s) => s.trim()).find((s) => s.length > 0) || '';
  if (!firstLine) return fallback;
  // 取首个句末/分隔标点前的概括,截 14 字
  const head = firstLine.split(/[。!?！？,，、;；:.]/)[0]?.trim() || firstLine;
  return (head || firstLine).slice(0, 14);
}
