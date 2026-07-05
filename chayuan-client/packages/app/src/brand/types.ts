import type * as React from 'react';
import type { RouteEntry } from '../features/shell/page-registry';

/** SKU 品牌 + 路由扩展注入契约（§3.7）。无注入时基座行为不变。 */
export interface BrandConfig {
  /** 应用名（顶栏/标题）。"察元 AI" | "ChaCMD 指挥台" */
  appName: string;
  /** 该 SKU 的落地路径（landing）。缺省 /home（察元现状）。 */
  landingPath?: string;
  /** 该 SKU 追加的路由条目（不覆盖基座内置路由）。 */
  routeExtensions?: RouteEntry[];
  /** 首页组件覆盖（可选；缺省用基座 /home 的 HomePage）。 */
  homeComponent?: React.ComponentType;
}
