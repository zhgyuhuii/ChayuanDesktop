import * as React from 'react';
import type { DeptNode } from '@chayuan/api';

// 递归部门树:可点选(onSelect)、可显示勾选框(checked/onToggle 用于多选范围)。
// 传入 onMove 时启用拖拽改父级:拖某节点到目标节点上=移动为其子部门。
// 拖拽 id 走 dataTransfer(跨递归实例安全);每层本地 dragOverId 高亮放置目标。
const DRAG_MIME = 'application/x-chayuan-dept-id';
export const DeptTree: React.FC<{
  nodes: DeptNode[];
  selectedId?: number | null;
  onSelect?: (d: DeptNode) => void;
  checkedIds?: Set<number>;
  onToggle?: (id: number) => void;
  onMove?: (dragId: number, newParentId: number | null) => void;
  depth?: number;
}> = ({ nodes, selectedId, onSelect, checkedIds, onToggle, onMove, depth = 0 }) => {
  const [collapsed, setCollapsed] = React.useState<Set<number>>(new Set());
  const [dragOverId, setDragOverId] = React.useState<number | null>(null);
  const dnd = onMove
    ? (n: DeptNode) => ({
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData(DRAG_MIME, String(n.id));
          e.dataTransfer.effectAllowed = 'move';
        },
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverId !== n.id) setDragOverId(n.id);
        },
        onDragLeave: () => setDragOverId((cur) => (cur === n.id ? null : cur)),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOverId(null);
          const raw = e.dataTransfer.getData(DRAG_MIME);
          const dragId = Number(raw);
          if (dragId && dragId !== n.id) onMove(dragId, n.id);
        },
      })
    : () => ({});
  return (
    <ul className="text-sm">
      {nodes.map((n) => {
        const hasChildren = (n.children?.length ?? 0) > 0;
        const isCollapsed = collapsed.has(n.id);
        return (
          <li key={n.id}>
            <div
              {...dnd(n)}
              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                dragOverId === n.id
                  ? 'ring-1 ring-[var(--cy-brand-500)] bg-[var(--cy-brand-500)]/10'
                  : selectedId === n.id ? 'bg-[var(--cy-brand-500)]/10 text-[var(--cy-brand-600)]' : 'hover:bg-[var(--cy-surface-2)]'
              }`}
              style={{ paddingLeft: depth * 14 + 4 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="w-4 text-xs opacity-60"
                  onClick={() =>
                    setCollapsed((s) => {
                      const x = new Set(s);
                      x.has(n.id) ? x.delete(n.id) : x.add(n.id);
                      return x;
                    })
                  }
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="w-4" />
              )}
              {checkedIds && onToggle ? (
                <input type="checkbox" checked={checkedIds.has(n.id)} onChange={() => onToggle(n.id)} />
              ) : null}
              <button type="button" className="flex-1 text-left" onClick={() => onSelect?.(n)}>
                {n.name}
              </button>
            </div>
            {hasChildren && !isCollapsed ? (
              <DeptTree
                nodes={n.children}
                selectedId={selectedId}
                onSelect={onSelect}
                checkedIds={checkedIds}
                onToggle={onToggle}
                onMove={onMove}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

// 扁平化树(取所有节点),给"部门下拉选择器"用。
export function flattenDepts(nodes: DeptNode[], depth = 0): { id: number; name: string; depth: number }[] {
  const out: { id: number; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flattenDepts(n.children, depth + 1));
  }
  return out;
}

// 部门下拉选择器(原生 select,缩进表层级)。orgId 变化时由父组件传入 tree。
export const DeptSelect: React.FC<{
  nodes: DeptNode[];
  value: number | null;
  onChange: (id: number | null) => void;
  allowEmpty?: boolean;
}> = ({ nodes, value, onChange, allowEmpty = true }) => {
  const flat = React.useMemo(() => flattenDepts(nodes), [nodes]);
  return (
    <select
      className="w-full rounded border p-2 text-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      {allowEmpty ? <option value="">（未分配 / 无）</option> : null}
      {flat.map((d) => (
        <option key={d.id} value={d.id}>
          {'  '.repeat(d.depth) + d.name}
        </option>
      ))}
    </select>
  );
};
