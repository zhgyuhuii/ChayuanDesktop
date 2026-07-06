import * as React from 'react';
import ReactFlow, { Background, Controls, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  type TaskEdge,
  type TaskLifecycle,
  type TaskNode,
  toFlowGraph,
} from '../orchestration/flowModel';

/**
 * L1 任务编排视图（§3.2）：以 Supervisor 为中心的扇出树（reactflow），
 * 节点=角色/子任务，状态灯随事件流；handoff 边高亮、loop 边虚线动画。
 */
export const TaskOrchestrationView: React.FC<{
  nodes: TaskNode[];
  edges: TaskEdge[];
  statuses?: Record<string, TaskLifecycle>;
}> = ({ nodes, edges, statuses = {} }) => {
  const g = React.useMemo(() => toFlowGraph(nodes, edges, statuses), [nodes, edges, statuses]);

  const rfNodes: Node[] = g.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { label: n.data.role ? `${n.data.label}\n(${n.data.role})` : n.data.label },
    style: {
      border: `2px solid ${n.data.color}`,
      borderRadius: 10,
      background: 'rgba(15,23,42,0.9)',
      color: '#e5e7eb',
      fontSize: 12,
      padding: 8,
      width: 160,
      whiteSpace: 'pre-line',
    },
  }));

  const rfEdges: Edge[] = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.animated,
    label: e.label,
    style: e.style,
  }));

  return (
    <div data-testid="task-orchestration" style={{ width: '100%', height: '100%', background: '#0b1020' }}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#1e293b" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};
