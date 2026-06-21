import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { mcp, type McpConnection } from '@chayuan/api';
import { McpConnectionCard } from './McpConnectionCard';
import { McpEditDialog } from './McpEditDialog';
import { McpProfileDialog } from './McpProfileDialog';

export const McpConnectionList: React.FC = () => {
  const [kw, setKw] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'on' | 'off'>('all');
  const [dialog, setDialog] = React.useState<{ open: boolean; conn: McpConnection | null }>({ open: false, conn: null });
  const [profileOpen, setProfileOpen] = React.useState(false);
  const q = useQuery({ queryKey: ['admin', 'mcp', 'list'], queryFn: () => mcp.list(), staleTime: 30_000 });
  const all = q.data ?? [];

  const rows = React.useMemo(() => {
    const k = kw.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === 'on' && !c.enabled) return false;
      if (filter === 'off' && c.enabled) return false;
      if (k && !c.server_name.toLowerCase().includes(k) && !(c.description ?? '').toLowerCase().includes(k)) return false;
      return true;
    });
  }, [all, kw, filter]);

  const stat = { total: all.length, on: all.filter((c) => c.enabled).length, stdio: all.filter((c) => c.transport === 'stdio').length, sse: all.filter((c) => c.transport === 'sse').length };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded border p-2 text-sm" placeholder="搜索 名称/描述" value={kw} onChange={(e) => setKw(e.target.value)} />
        <select className="rounded border p-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'on' | 'off')}>
          <option value="all">全部</option><option value="on">启用</option><option value="off">禁用</option>
        </select>
        <span className="text-xs text-muted-foreground">共 {stat.total} · 启用 {stat.on} · stdio {stat.stdio} · sse {stat.sse}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" onClick={() => void q.refetch()}>刷新</Button>
          <Button variant="outline" onClick={() => setProfileOpen(true)}>通用配置</Button>
          <Button onClick={() => setDialog({ open: true, conn: null })}>新建连接</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((c) => (
          <McpConnectionCard key={c.id} conn={c} onEdit={() => setDialog({ open: true, conn: c })} onChanged={() => void q.refetch()} />
        ))}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {profileOpen ? <McpProfileDialog onClose={() => setProfileOpen(false)} /> : null}
      {dialog.open ? (
        <McpEditDialog initial={dialog.conn} onClose={() => setDialog({ open: false, conn: null })} onSaved={() => { setDialog({ open: false, conn: null }); void q.refetch(); }} />
      ) : null}
    </div>
  );
};
