import * as React from 'react';
import { UsersHero } from './UsersHero';
import { UsersTopGrid } from './UsersTopGrid';
import { UsersInsights } from './UsersInsights';
import { UsersTable } from './UsersTable';
import { Button } from '@chayuan/ui';
import { BarChart3, List } from 'lucide-react';

/**
 * 用户管理域。需求#2「只保留用户列表即可」:默认只显示用户列表;
 * P2 分析图表(Hero/TopGrid/Insights)收进「数据分析」开关,需要时再展开。
 */
export const UsersPage: React.FC = () => {
  const [showAnalytics, setShowAnalytics] = React.useState(false);
  return (
    <div className="space-y-4 p-2">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowAnalytics((v) => !v)}>
          {showAnalytics ? <List className="mr-1.5 h-4 w-4" /> : <BarChart3 className="mr-1.5 h-4 w-4" />}
          {showAnalytics ? '只看列表' : '数据分析'}
        </Button>
      </div>
      {showAnalytics && (
        <div className="space-y-6">
          <UsersHero />
          <UsersTopGrid />
          <UsersInsights />
        </div>
      )}
      <UsersTable />
    </div>
  );
};
