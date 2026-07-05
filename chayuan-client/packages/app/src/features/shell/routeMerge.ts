import type { BrandConfig } from '../../brand/types';
import type { RouteEntry } from './page-registry';

/** 内置路由条目 + brand.routeExtensions（追加，不覆盖内置）。无 brand → 原样返回。 */
export function effectiveRouteEntries(
  base: ReadonlyArray<RouteEntry>,
  brand: BrandConfig | undefined,
): RouteEntry[] {
  const exts = brand?.routeExtensions ?? [];
  return [...base, ...exts];
}
