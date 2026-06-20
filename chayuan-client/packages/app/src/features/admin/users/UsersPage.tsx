import * as React from 'react';
import { UsersHero } from './UsersHero';
import { UsersTopGrid } from './UsersTopGrid';
import { UsersInsights } from './UsersInsights';
import { UsersTable } from './UsersTable';

/** 用户管理域(P1 管理核心 + P2 分析图表)。P3 加画像弹窗。 */
export const UsersPage: React.FC = () => (
  <div className="space-y-6 p-2">
    <UsersHero />
    <UsersTopGrid />
    <UsersInsights />
    <UsersTable />
  </div>
);
