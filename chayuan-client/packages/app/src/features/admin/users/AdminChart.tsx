import * as React from 'react';

// 懒加载 echarts-for-react —— 仅进 admin 分析区时拉,不压主 bundle。
const ReactECharts = React.lazy(() => import('echarts-for-react'));

export const AdminChart: React.FC<{ option: Record<string, unknown>; height?: number }> = ({ option, height = 280 }) => (
  <React.Suspense fallback={<div style={{ height }} className="flex items-center justify-center text-sm text-muted-foreground">图表加载中…</div>}>
    <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
  </React.Suspense>
);
