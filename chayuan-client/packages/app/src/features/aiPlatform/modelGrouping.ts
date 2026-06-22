/**
 * 默认模型候选「按厂商 / 平台分组」—— 消费端(系统设置 · RuntimeCenter)与
 * 管理后台(/admin · DefaultModelsPage)的默认模型下拉【共用同一套分组逻辑】。
 *
 * 规则:
 *   - 本地 sidecar(platform_name = local / local-*)归一到「本地模型」,排首位;
 *   - platform_name 缺失 / 异常 → 「其它」,排末位;
 *   - 云厂商用 platform_name 原值作分组名,按名称字母序;
 *   - 组内候选按 id 字母序。
 */

/** 任何带 id + platform_name 的候选都能分组(CapabilityCandidate / DefaultsCandidate 均满足)。 */
export interface PlatformGroupable {
  id: string;
  platform_name?: string | null;
}

/** 平台分组 key + 显示名。 */
export function platformGroupKey(p: string | null | undefined): { key: string; label: string } {
  if (!p) return { key: '__other__', label: '其它' };
  if (p === 'local' || p.startsWith('local-')) return { key: '__local__', label: '本地模型' };
  return { key: p, label: p };
}

/** 按平台把候选分组:本地置顶、其它置底、云厂商字母序;组内按 id 序。 */
export function groupCandidatesByPlatform<T extends PlatformGroupable>(
  candidates: T[],
): Array<{ label: string; items: T[] }> {
  const map = new Map<string, { label: string; items: T[] }>();
  for (const c of candidates) {
    const { key, label } = platformGroupKey(c.platform_name);
    const entry = map.get(key) ?? { label, items: [] };
    entry.items.push(c);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === '__local__') return -1;
      if (b === '__local__') return 1;
      if (a === '__other__') return 1;
      if (b === '__other__') return -1;
      return a.localeCompare(b);
    })
    .map(([, v]) => ({
      label: v.label,
      items: v.items.slice().sort((x, y) => x.id.localeCompare(y.id)),
    }));
}
