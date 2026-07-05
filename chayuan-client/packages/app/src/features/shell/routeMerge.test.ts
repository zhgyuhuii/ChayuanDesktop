import { describe, expect, it } from 'vitest';
import type { RouteEntry } from './page-registry';
import { effectiveRouteEntries } from './routeMerge';

const base: RouteEntry[] = [
  { pattern: /^\/home$/, render: () => null, defaultTitle: 'nav.home' },
];
const ext: RouteEntry = { pattern: /^\/command$/, render: () => null, defaultTitle: 'ChaCMD' };

describe('effectiveRouteEntries', () => {
  it('无 brand → 原样返回内置条目', () => {
    expect(effectiveRouteEntries(base, undefined)).toEqual(base);
  });

  it('有 routeExtensions → 追加到末尾', () => {
    const merged = effectiveRouteEntries(base, { appName: 'x', routeExtensions: [ext] });
    expect(merged).toHaveLength(2);
    expect(merged[1].pattern.source).toBe(/^\/command$/.source);
  });

  it('brand 无 routeExtensions → 等同内置', () => {
    expect(effectiveRouteEntries(base, { appName: 'x' })).toEqual(base);
  });

  it('内置条目不被 extension 覆盖(extension 只追加)', () => {
    const merged = effectiveRouteEntries(base, { appName: 'x', routeExtensions: [ext] });
    expect(merged[0]).toBe(base[0]);
  });
});
