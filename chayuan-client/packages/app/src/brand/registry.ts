import type { BrandConfig } from './types';

// 模块级"当前 SKU 品牌"，Shell 启动时 set 一次（仿 registerToolCard 模式）。
let _activeBrand: BrandConfig | undefined;

export function setActiveBrand(brand: BrandConfig | undefined): void {
  _activeBrand = brand;
}

export function getActiveBrand(): BrandConfig | undefined {
  return _activeBrand;
}

export function resolveLandingPath(brand: BrandConfig | undefined): string {
  return brand?.landingPath ?? '/home';
}
