interface Parsed { nums: number[]; pre: string[]; }

function parse(v: string): Parsed {
  const noBuild = v.split('+')[0];
  const [rel, pre] = noBuild.split('-', 2);
  const nums = rel.split('.').map((s) => parseInt(s, 10) || 0);
  return { nums, pre: pre ? pre.split('.') : [] };
}

function cmpNums(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function cmpPre(a: string[], b: string[]): number {
  // 无 prerelease > 有 prerelease(release 大)
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** 版本号比较:a<b→-1, a==b→0, a>b→1。忽略 +build;prerelease < release。 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const c = cmpNums(pa.nums, pb.nums);
  if (c !== 0) return c;
  return cmpPre(pa.pre, pb.pre);
}

/** latest 是否比 current 新。 */
export function isVersionNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
