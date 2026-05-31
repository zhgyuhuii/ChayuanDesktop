/** 镜像重写规则:把 url 中的 match 主机替换成 replace 主机,生成一个候选。 */
export interface MirrorRule {
  match: string;
  replace: string;
}

/** 国内默认镜像规则(实测可达:hf-mirror 替代 huggingface)。 */
export const DEFAULT_MIRROR_RULES: MirrorRule[] = [
  { match: 'huggingface.co', replace: 'hf-mirror.com' },
  { match: 'hf.co', replace: 'hf-mirror.com' },
];

/** 原 URL → 有序候选 URL(原始优先,再按规则顺序追加镜像;去重)。 */
export function mirrorCandidates(url: string, rules: MirrorRule[]): string[] {
  const out: string[] = [url];
  for (const r of rules) {
    if (url.includes(r.match)) {
      const rewritten = url.split(r.match).join(r.replace);
      if (!out.includes(rewritten)) out.push(rewritten);
    }
  }
  return out;
}
