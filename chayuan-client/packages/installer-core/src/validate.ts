import type { PlatformKey, Tier } from './types';

const PLATFORM_KEYS: PlatformKey[] = [
  'linux-x86_64', 'linux-arm64', 'mac-x86_64', 'mac-arm64', 'win-x86_64', 'win-arm64',
];
const TIERS: Tier[] = ['lite', 'standard', 'pro'];

/** 运行时校验外部清单(皮从 website 拉的 JSON 用前必须校验,防坏清单崩溃)。
 *  返回 {ok, errors};ok=false 时 errors 列出所有问题。 */
export function validateManifest(obj: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, errors: ['manifest 不是对象'] };
  }
  const m = obj as Record<string, unknown>;
  if (typeof m.version !== 'string') errors.push('version 必须是字符串');
  if (!Array.isArray(m.components)) {
    errors.push('components 必须是数组');
    return { ok: false, errors };
  }
  (m.components as unknown[]).forEach((c, i) => {
    if (typeof c !== 'object' || c === null) {
      errors.push(`components[${i}] 不是对象`);
      return;
    }
    const comp = c as Record<string, unknown>;
    if (typeof comp.name !== 'string') errors.push(`components[${i}].name 必须是字符串`);
    if (typeof comp.dest !== 'string') errors.push(`components[${i}].dest 必须是字符串`);
    if (!Array.isArray(comp.tiers) || !(comp.tiers as unknown[]).every((t) => TIERS.includes(t as Tier))) {
      errors.push(`components[${i}].tiers 必须是 lite/standard/pro 的数组`);
    }
    if (typeof comp.platforms !== 'object' || comp.platforms === null) {
      errors.push(`components[${i}].platforms 必须是对象`);
    } else {
      for (const [k, asset] of Object.entries(comp.platforms as Record<string, unknown>)) {
        if (!PLATFORM_KEYS.includes(k as PlatformKey)) {
          errors.push(`components[${i}].platforms 含非法平台键 ${k}`);
        }
        const a = asset as Record<string, unknown> | null;
        if (typeof a !== 'object' || a === null || typeof a.url !== 'string' || typeof a.unpack !== 'string') {
          errors.push(`components[${i}].platforms.${k} 需含 url+unpack 字符串`);
        }
      }
    }
  });
  return { ok: errors.length === 0, errors };
}
