import * as React from 'react';
import { Button } from '@chayuan/ui';
import { tools, type ToolCard } from '@chayuan/api';

export const ToolCardView: React.FC<{ card: ToolCard; onSettings(): void; onChanged(): void }> = ({ card, onSettings, onChanged }) => {
  const toggle = async () => { await tools.updateConfig(card.key, { enabled: !card.enabled }); onChanged(); };
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{card.title}</span>
        <input type="checkbox" checked={card.enabled} onChange={() => void toggle()} title="启用/禁用" />
      </div>
      <div className="text-xs text-muted-foreground">{card.category}</div>
      <p className="line-clamp-3 text-xs text-muted-foreground">{card.description_override || card.description || card.summary}</p>
      <div className="flex flex-wrap gap-1">
        {(card.tags ?? []).slice(0, 4).map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{t}</span>)}
      </div>
      <div className="mt-auto flex items-center justify-between">
        {card.docs_url ? <a className="text-xs text-sky-600" href={card.docs_url} target="_blank" rel="noreferrer">官网</a> : <span />}
        <Button variant="ghost" onClick={onSettings}>设置</Button>
      </div>
    </div>
  );
};
