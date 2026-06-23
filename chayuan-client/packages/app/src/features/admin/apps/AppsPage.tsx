import * as React from 'react';
import { confirmDialog } from '../../../store/confirmDialog';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { apps, type AppSpec } from '@chayuan/api';

const EVENTS = ['chat.completed', 'kb.doc.updated'];

const EditDialog: React.FC<{ initial: AppSpec | null; onClose(): void; onSaved(secret?: AppSpec): void }> = ({ initial, onClose, onSaved }) => {
  const editing = !!initial;
  const [name, setName] = React.useState(initial?.name ?? '');
  const [cb, setCb] = React.useState(initial?.callback_url ?? '');
  const [events, setEvents] = React.useState<string[]>(initial?.callback_events ?? []);
  const [enabled, setEnabled] = React.useState(initial?.enabled ?? true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const toggleEvent = (e: string) => setEvents((s) => s.includes(e) ? s.filter((x) => x !== e) : [...s, e]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (!name.trim()) throw new Error('名称必填');
      if (editing && initial) { await apps.update(initial.app_id, { name, callback_url: cb, callback_events: events, enabled }); onSaved(); }
      else { const created = await apps.create({ name, callback_url: cb, callback_events: events }); onSaved(created); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const inp = 'mt-1 w-full rounded border p-2 text-sm';
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-[var(--cy-surface-base,#fff)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">{editing ? '编辑应用' : '新建应用'}</h2>
        <div className="space-y-2 text-sm">
          <label className="block">名称*<input className={inp} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block">回调 URL<input className={inp} value={cb} placeholder="https://..." onChange={(e) => setCb(e.target.value)} /></label>
          <div><div className="text-sm">订阅事件</div>{EVENTS.map((e) => <label key={e} className="mr-3 text-xs"><input type="checkbox" checked={events.includes(e)} onChange={() => toggleEvent(e)} /> {e}</label>)}</div>
          {editing ? <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用</label> : null}
          {err ? <p className="text-destructive">{err}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</Button></div>
      </div>
    </div>
  );
};

const SecretDialog: React.FC<{ app: AppSpec; onClose(): void }> = ({ app, onClose }) => (
  <div className="fixed inset-0 z-[510] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-2xl bg-[var(--cy-surface-base,#fff)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <h2 className="mb-2 text-lg font-semibold">应用密钥（仅显示一次）</h2>
      <p className="text-sm text-amber-600">请立即复制保存，关闭后无法再次查看明文。</p>
      <div className="mt-2 space-y-1 text-sm">
        <div>app_id: <code className="break-all">{app.app_id}</code></div>
        <div>app_secret: <code className="break-all font-mono">{app.app_secret}</code></div>
      </div>
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>我已保存</Button></div>
    </div>
  </div>
);

export const AppsPage: React.FC = () => {
  const [dialog, setDialog] = React.useState<{ open: boolean; item: AppSpec | null }>({ open: false, item: null });
  const [secret, setSecret] = React.useState<AppSpec | null>(null);
  const q = useQuery({ queryKey: ['admin', 'apps'], queryFn: () => apps.list(), staleTime: 30_000 });
  const rows = q.data ?? [];
  const del = async (a: AppSpec) => { if (await confirmDialog(`删除应用 ${a.name}?`, { title: '删除应用?', danger: true })) { await apps.remove(a.app_id); void q.refetch(); } };
  const rotate = async (a: AppSpec) => { if (await confirmDialog(`轮换 ${a.name} 的密钥?旧密钥立即失效。`, { title: '轮换密钥?', danger: true })) { setSecret(await apps.rotate(a.app_id)); void q.refetch(); } };
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">共 {rows.length} 个应用</span>
        <Button onClick={() => setDialog({ open: true, item: null })}>新建应用</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((a) => (
          <div key={a.app_id} className="rounded-xl border p-3 space-y-1">
            <div className="flex items-center justify-between"><span className="font-medium">{a.name}</span><span className={`rounded px-1.5 py-0.5 text-xs ${a.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'}`}>{a.enabled ? '启用' : '禁用'}</span></div>
            <div className="font-mono text-xs text-muted-foreground">app_id: {a.app_id}</div>
            <div className="font-mono text-xs text-muted-foreground">secret: {a.app_secret}</div>
            {a.callback_url ? <div className="truncate text-xs text-muted-foreground">cb: {a.callback_url}</div> : null}
            <div className="flex justify-end gap-1">
              <Button variant="ghost" onClick={() => void rotate(a)}>轮换密钥</Button>
              <Button variant="ghost" onClick={() => setDialog({ open: true, item: a })}>编辑</Button>
              <Button variant="ghost" onClick={() => void del(a)}>删除</Button>
            </div>
          </div>
        ))}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {dialog.open ? <EditDialog initial={dialog.item} onClose={() => setDialog({ open: false, item: null })} onSaved={(created) => { setDialog({ open: false, item: null }); if (created) setSecret(created); void q.refetch(); }} /> : null}
      {secret ? <SecretDialog app={secret} onClose={() => setSecret(null)} /> : null}
    </div>
  );
};
