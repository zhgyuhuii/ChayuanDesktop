/** 断点续传:本地已落 localBytes,目标 totalBytes;返回续传 Range 或 null(已完成)。 */
export function resumeRange(localBytes: number, totalBytes: number): { offset: number; header: string } | null {
  if (totalBytes > 0 && localBytes >= totalBytes) return null;
  const offset = Math.max(0, localBytes | 0);
  return { offset, header: `bytes=${offset}-` };
}

/** sha256 校验:期望为空则视为通过(清单未给 sha 的组件);否则大小写不敏感比对。 */
export function verifySha(expected: string | undefined, actual: string): boolean {
  if (!expected) return true;
  return expected.toLowerCase() === actual.toLowerCase();
}

/** 当前候选(attemptedIdx)失败,取下一个候选 URL;无更多返回 null。 */
export function nextMirror(candidates: string[], attemptedIdx: number): string | null {
  const next = attemptedIdx + 1;
  return next < candidates.length ? candidates[next] : null;
}
