import * as React from 'react';
import { confirmDialog } from '../../../store/confirmDialog';
import { Button } from '@chayuan/ui';
import { mcp, type McpConnection } from '@chayuan/api';

export const McpConnectionCard: React.FC<{ conn: McpConnection; onEdit(): void; onChanged(): void }> = ({ conn, onEdit, onChanged }) => {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const preview = conn.transport === 'stdio'
    ? [String(cfg.command ?? ''), ...(conn.args ?? [])].join(' ')
    : String(cfg.url ?? '');
  const toggle = async () => { conn.enabled ? await mcp.disable(conn.id) : await mcp.enable(conn.id); onChanged(); };
  const del = async () => { if (await confirmDialog(`删除连接 ${conn.server_name}?`, { title: '删除连接?', danger: true })) { await mcp.delete(conn.id); onChanged(); } };
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{conn.server_name}</span>
        <div className="flex shrink-0 gap-1 text-xs">
          <span className="rounded bg-slate-100 px-1.5 py-0.5">{conn.transport}</span>
          <span className={`rounded px-1.5 py-0.5 ${conn.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{conn.enabled ? '启用' : '禁用'}</span>
        </div>
      </div>
      {conn.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{conn.description}</p> : null}
      <div className="truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">{preview}</div>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span>超时 {conn.timeout}s</span>
        <span>env {Object.keys(conn.env ?? {}).length}</span>
        <span>{conn.update_time?.slice(0, 16) ?? ''}</span>
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={() => void toggle()}>{conn.enabled ? '禁用' : '启用'}</Button>
        <Button variant="ghost" onClick={onEdit}>编辑</Button>
        <Button variant="ghost" onClick={() => void del()}>删除</Button>
      </div>
    </div>
  );
};
