import ForceGraph3D from '3d-force-graph';
import * as React from 'react';
import type { AgentLifecycle, AgentState } from '../stream/streamReducer';

/** 生命周期 → 节点色（与 2D 栅格一致）。 */
const STATUS_COLOR: Record<AgentLifecycle, string> = {
  running: '#3b82f6',
  waiting: '#f59e0b',
  succeeded: '#22c55e',
  failed: '#ef4444',
  interrupted: '#a855f7',
};

interface StarNode {
  id: string;
  name: string;
  color: string;
  emoji?: string;
}

/**
 * ChaCMD 指挥大屏 L0 — 3D 星群皮肤（3d-force-graph/three）。
 * 每个数字员工 = 一颗星，颜色随生命周期；命令式挂载在 useEffect（仅浏览器/webview 运行）。
 * 视觉需 GPU/显示环境验证；node/测试环境本组件只经 React.lazy 延迟，不会被加载。
 */
export const StarfieldL0: React.FC<{ agents: AgentState[]; onSelect?: (id: string) => void }> = ({
  agents,
  onSelect,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const graphRef = React.useRef<InstanceType<typeof ForceGraph3D> | null>(null);
  // 持最新 onSelect，避免因回调变化重挂 WebGL 图。
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const graph = new ForceGraph3D(el)
      .backgroundColor('#0b1020')
      .nodeRelSize(6)
      .nodeLabel((n) => `${(n as StarNode).emoji ?? ''} ${(n as StarNode).name}`)
      .nodeColor((n) => (n as StarNode).color)
      .nodeOpacity(0.9)
      .onNodeClick((n) => onSelectRef.current?.(String((n as StarNode).id)))
      .warmupTicks(20);
    graphRef.current = graph;
    return () => {
      // 3d-force-graph 实例析构器（释放 WebGL 上下文）。
      graph._destructor();
      graphRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const nodes: StarNode[] = agents.map((a) => ({
      id: a.nickname,
      name: a.nickname,
      color: STATUS_COLOR[a.status],
      emoji: a.emoji,
    }));
    graph.graphData({ nodes, links: [] });
  }, [agents]);

  return <div ref={containerRef} data-testid="starfield-l0" style={{ width: '100%', height: '100%' }} />;
};
