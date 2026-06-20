import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { tools, type ToolCard } from '@chayuan/api';
import { ToolCardView } from './ToolCardView';
import { ToolSettingsDialog } from './ToolSettingsDialog';

export const ToolsPage: React.FC = () => {
  const [kw, setKw] = React.useState('');
  const [cat, setCat] = React.useState('');
  const [status, setStatus] = React.useState<'all' | 'on' | 'off'>('all');
  const [settings, setSettings] = React.useState<ToolCard | null>(null);
  const q = useQuery({ queryKey: ['admin', 'tools', 'catalog'], queryFn: () => tools.getCatalog(), staleTime: 30_000 });
  const cards = q.data?.cards ?? [];
  const cats = q.data?.categories ?? {};

  const rows = React.useMemo(() => {
    const k = kw.trim().toLowerCase();
    return cards.filter((c) => {
      if (cat && c.category !== cat) return false;
      if (status === 'on' && !c.enabled) return false;
      if (status === 'off' && c.enabled) return false;
      if (k && !c.title.toLowerCase().includes(k) && !(c.summary ?? '').toLowerCase().includes(k) && !(c.tags ?? []).some((t) => t.toLowerCase().includes(k))) return false;
      return true;
    });
  }, [cards, kw, cat, status]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded border p-2 text-sm" placeholder="搜索 标题/简介/标签" value={kw} onChange={(e) => setKw(e.target.value)} />
        <select className="rounded border p-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">全部分类</option>
          {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="rounded border p-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'on' | 'off')}>
          <option value="all">全部</option><option value="on">已启用</option><option value="off">未启用</option>
        </select>
        <span className="text-xs text-muted-foreground">{rows.length}/{cards.length}</span>
        <Button variant="ghost" className="ml-auto" onClick={() => void q.refetch()}>刷新</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => <ToolCardView key={c.key} card={c} onSettings={() => setSettings(c)} onChanged={() => void q.refetch()} />)}
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {settings ? <ToolSettingsDialog card={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); void q.refetch(); }} /> : null}
    </div>
  );
};
