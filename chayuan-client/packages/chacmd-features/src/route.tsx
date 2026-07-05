import type { BrandConfig, RouteEntry } from '@chayuan/app';
import * as React from 'react';

const CommandDashboard = React.lazy(() =>
  import('./dashboard/CommandDashboard').then((m) => ({ default: m.CommandDashboard })),
);

/** ChaCMD 指挥大屏路由（经 brand.routeExtensions 注入基座；走 /$splat 工作区渲染）。 */
export const commandRoute: RouteEntry = {
  pattern: /^\/command$/,
  render: () => <CommandDashboard />,
  defaultTitle: 'ChaCMD 指挥大屏',
  defaultIcon: 'radar',
};

/** ChaCMD SKU 品牌注入配置（apps/chacmd 的 main.tsx 传给 Shell env.brand）。 */
export const chacmdBrand: BrandConfig = {
  appName: 'ChaCMD 指挥台',
  landingPath: '/command',
  routeExtensions: [commandRoute],
};
