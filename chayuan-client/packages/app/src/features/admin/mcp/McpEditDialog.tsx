import * as React from 'react';
import { Button } from '@chayuan/ui';
import { mcp, type McpConnection, type McpConnectionInput } from '@chayuan/api';
import { KvEditor } from './KvEditor';

export const McpEditDialog: React.FC<{ initial: McpConnection | null; onClose(): void; onSaved(): void }> = ({ initial, onClose, onSaved }) => {
  const editing = !!initial;
  const cfg = (initial?.config ?? {}) as Record<string, unknown>;
  const [name, setName] = React.useState(initial?.server_name ?? '');
  const [transport, setTransport] = React.useState<'stdio' | 'sse'>((initial?.transport as 'stdio' | 'sse') ?? 'stdio');
  const [timeout, setTimeout_] = React.useState(initial?.timeout ?? 30);
  const [enabled, setEnabled] = React.useState(initial?.enabled ?? true);
  const [description, setDesc] = React.useState(initial?.description ?? '');
  const [command, setCommand] = React.useState(String(cfg.command ?? ''));
  const [argsText, setArgsText] = React.useState((initial?.args ?? []).join('\n'));
  const [cwd, setCwd] = React.useState(initial?.cwd ?? '');
  const [env, setEnv] = React.useState<Record<string, string>>(initial?.env ?? {});
  const [url, setUrl] = React.useState(String(cfg.url ?? ''));
  const [headers, setHeaders] = React.useState<Record<string, string>>((cfg.headers as Record<string, string>) ?? {});
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (!name.trim()) throw new Error('服务器名称必填');
      if (transport === 'stdio' && !command.trim()) throw new Error('stdio 需填 command');
      if (transport === 'sse' && !url.trim()) throw new Error('sse 需填 url');
      const config: Record<string, unknown> = transport === 'stdio' ? { command: command.trim() } : { url: url.trim(), headers };
      const body: McpConnectionInput = {
        server_name: name.trim(), transport, timeout, enabled, description: description || undefined,
        args: transport === 'stdio' ? argsText.split('\n').map((a) => a.trim()).filter(Boolean) : [],
        env: transport === 'stdio' ? env : {},
        cwd: transport === 'stdio' ? (cwd || undefined) : undefined,
        config,
      };
      if (editing && initial) await mcp.update(initial.id, body);
      else await mcp.create(body);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-[var(--cy-surface-base,#fff)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">{editing ? '编辑连接' : '新建 MCP 连接'}</h2>
        <div className="space-y-2 text-sm">
          <label className="block">服务器名称{editing ? '（不可改）' : ''}
            <input className="mt-1 w-full rounded border p-2" value={name} disabled={editing} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <label className="flex-1">传输
              <select className="mt-1 w-full rounded border p-2" value={transport} onChange={(e) => setTransport(e.target.value as 'stdio' | 'sse')}>
                <option value="stdio">stdio(本地进程)</option>
                <option value="sse">sse(远程网址)</option>
              </select>
            </label>
            <label className="w-28">超时(s)
              <input type="number" className="mt-1 w-full rounded border p-2" value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} />
            </label>
            <label className="w-28">状态
              <select className="mt-1 w-full rounded border p-2" value={enabled ? '1' : '0'} onChange={(e) => setEnabled(e.target.value === '1')}>
                <option value="1">启用</option><option value="0">禁用</option>
              </select>
            </label>
          </div>
          <label className="block">描述
            <textarea className="mt-1 w-full rounded border p-2" rows={2} value={description} onChange={(e) => setDesc(e.target.value)} />
          </label>
          {transport === 'stdio' ? (
            <div className="space-y-2 rounded-lg border p-2">
              <p className="text-xs text-amber-600">提示：command / cwd / env 指**运行后端的主机**文件系统（网络版=服务器）。</p>
              <label className="block">command*<input className="mt-1 w-full rounded border p-2" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx / uvx / python" /></label>
              <label className="block">args(每行一个)<textarea className="mt-1 w-full rounded border p-2 font-mono text-xs" rows={3} value={argsText} onChange={(e) => setArgsText(e.target.value)} /></label>
              <label className="block">cwd(可选)<input className="mt-1 w-full rounded border p-2" value={cwd ?? ''} onChange={(e) => setCwd(e.target.value)} /></label>
              <div>env<KvEditor value={env} onChange={setEnv} /></div>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border p-2">
              <label className="block">url*<input className="mt-1 w-full rounded border p-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://host:port/sse" /></label>
              <div>headers<KvEditor value={headers} onChange={setHeaders} /></div>
            </div>
          )}
          {err ? <p className="text-destructive">{err}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '保存'}</Button>
        </div>
      </div>
    </div>
  );
};
