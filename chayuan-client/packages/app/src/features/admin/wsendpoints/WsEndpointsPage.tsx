import * as React from 'react';
import { confirmDialog } from '../../../store/confirmDialog';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { wsEndpoints, type WsEndpoint, type WsParam } from '@chayuan/api';

const blank = (): WsEndpoint => ({
  name: '', title: '', description: '', url: '', auth: { type: 'none', key: '', value: '' },
  on_connect: [], request_template: '', message_format: 'json', response_path: '',
  max_messages: 5, receive_timeout: 10, close_after_first: false, params: [], enabled: false,
});

const Dialog: React.FC<{ initial: WsEndpoint | null; onClose(): void; onSaved(): void }> = ({ initial, onClose, onSaved }) => {
  const editing = !!initial;
  const [d, setD] = React.useState<WsEndpoint>(() => initial ?? blank());
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const set = <K extends keyof WsEndpoint>(k: K, v: WsEndpoint[K]) => setD((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (!d.name.trim()) throw new Error('name 必填');
      if (editing) await wsEndpoints.update(d.name, d); else await wsEndpoints.create(d);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const setParam = (i: number, patch: Partial<WsParam>) => set('params', d.params.map((p, idx) => idx === i ? { ...p, ...patch } : p));

  const inp = 'mt-1 w-full rounded border p-2 text-sm';
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-[var(--cy-surface-base,#fff)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">{editing ? '编辑' : '新建'} WebSocket 端点</h2>
        <div className="space-y-2 text-sm">
          <label className="block">名称*{editing ? '(不可改)' : ''}<input className={inp} value={d.name} disabled={editing} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="block">标题<input className={inp} value={d.title ?? ''} onChange={(e) => set('title', e.target.value)} /></label>
          <label className="block">描述<textarea className={inp} rows={2} value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} /></label>
          <label className="block">URL*<input className={inp} value={d.url} placeholder="ws://host:port/path" onChange={(e) => set('url', e.target.value)} /></label>
          <div className="flex gap-2">
            <label className="flex-1">鉴权<select className={inp} value={d.auth.type} onChange={(e) => set('auth', { ...d.auth, type: e.target.value })}><option value="none">无</option><option value="header">header</option><option value="query">query</option><option value="bearer">bearer</option></select></label>
            {d.auth.type !== 'none' && d.auth.type !== 'bearer' ? <label className="flex-1">key<input className={inp} value={d.auth.key ?? ''} onChange={(e) => set('auth', { ...d.auth, key: e.target.value })} /></label> : null}
            {d.auth.type !== 'none' ? <label className="flex-1">value<input className={inp} value={d.auth.value ?? ''} onChange={(e) => set('auth', { ...d.auth, value: e.target.value })} /></label> : null}
          </div>
          <label className="block">on_connect(每行一帧)<textarea className={`${inp} font-mono text-xs`} rows={2} value={(d.on_connect ?? []).join('\n')} onChange={(e) => set('on_connect', e.target.value.split('\n').filter(Boolean))} /></label>
          <label className="block">请求模板<textarea className={`${inp} font-mono text-xs`} rows={2} value={d.request_template} onChange={(e) => set('request_template', e.target.value)} /></label>
          <div className="flex gap-2">
            <label className="flex-1">消息格式<select className={inp} value={d.message_format} onChange={(e) => set('message_format', e.target.value)}><option value="json">json</option><option value="text">text</option></select></label>
            <label className="flex-1">response_path<input className={inp} value={d.response_path} onChange={(e) => set('response_path', e.target.value)} /></label>
          </div>
          <div className="flex gap-2">
            <label className="w-28">max_messages<input type="number" className={inp} value={d.max_messages} onChange={(e) => set('max_messages', Number(e.target.value))} /></label>
            <label className="w-28">超时(s)<input type="number" className={inp} value={d.receive_timeout} onChange={(e) => set('receive_timeout', Number(e.target.value))} /></label>
            <label className="flex items-center gap-1 pt-5"><input type="checkbox" checked={d.close_after_first} onChange={(e) => set('close_after_first', e.target.checked)} />首条后关</label>
            <label className="flex items-center gap-1 pt-5"><input type="checkbox" checked={d.enabled} onChange={(e) => set('enabled', e.target.checked)} />启用</label>
          </div>
          <div className="rounded border p-2">
            <div className="mb-1 flex items-center justify-between"><span>参数</span><Button variant="ghost" onClick={() => set('params', [...d.params, { name: '', type: 'string', required: false }])}>+ 参数</Button></div>
            {d.params.map((p, i) => (
              <div key={i} className="flex gap-1">
                <input className="w-1/3 rounded border p-1 text-xs" placeholder="name" value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} />
                <select className="rounded border p-1 text-xs" value={p.type} onChange={(e) => setParam(i, { type: e.target.value })}><option>string</option><option>integer</option><option>number</option><option>boolean</option></select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!p.required} onChange={(e) => setParam(i, { required: e.target.checked })} />必填</label>
                <Button variant="ghost" onClick={() => set('params', d.params.filter((_, idx) => idx !== i))}>×</Button>
              </div>
            ))}
          </div>
          {err ? <p className="text-destructive">{err}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</Button></div>
      </div>
    </div>
  );
};

export const WsEndpointsPage: React.FC = () => {
  const [dialog, setDialog] = React.useState<{ open: boolean; item: WsEndpoint | null }>({ open: false, item: null });
  const q = useQuery({ queryKey: ['admin', 'ws-endpoints'], queryFn: () => wsEndpoints.list(), staleTime: 30_000 });
  const rows = q.data ?? [];
  const del = async (e: WsEndpoint) => { if (await confirmDialog(`删除端点 ${e.name}?`, { title: '删除端点?', danger: true })) { await wsEndpoints.remove(e.name); void q.refetch(); } };
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">共 {rows.length} 个 WebSocket 端点</span>
        <Button onClick={() => setDialog({ open: true, item: null })}>新建端点</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((e) => (
          <div key={e.name} className="rounded-xl border p-3 space-y-1">
            <div className="flex items-center justify-between"><span className="font-medium">{e.title || e.name}</span><span className={`rounded px-1.5 py-0.5 text-xs ${e.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'}`}>{e.enabled ? '启用' : '禁用'}</span></div>
            <div className="truncate font-mono text-xs text-muted-foreground">{e.url}</div>
            <div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => setDialog({ open: true, item: e })}>编辑</Button><Button variant="ghost" onClick={() => void del(e)}>删除</Button></div>
          </div>
        ))}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {dialog.open ? <Dialog initial={dialog.item} onClose={() => setDialog({ open: false, item: null })} onSaved={() => { setDialog({ open: false, item: null }); void q.refetch(); }} /> : null}
    </div>
  );
};
