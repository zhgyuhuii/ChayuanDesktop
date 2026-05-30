import * as React from 'react';
import { ChevronLeft, ChevronRight, Library, LayoutGrid, List as ListIcon } from 'lucide-react';
import { MaterialsStep } from '../steps/MaterialsStep';

export const MediaPoolPanel: React.FC<{ width?: number; fill?: boolean }> = ({ width = 288, fill = false }) => {
  const [open, setOpen] = React.useState(true);
  const [view, setView] = React.useState<'card' | 'list'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('cy.vg.pool.view') === 'list') ? 'list' : 'card');
  const setV = (v: 'card' | 'list') => { setView(v); try { localStorage.setItem('cy.vg.pool.view', v); } catch { /* noop */ } };

  return (
    <div className={`flex flex-col border-r border-[var(--cy-border-subtle)] ${fill && open ? 'min-w-0 flex-1' : 'shrink-0'}`}
      style={fill && open ? undefined : { width: open ? width : 36 }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1 border-b border-[var(--cy-border-subtle)] px-2 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
        {open ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Library className="h-3.5 w-3.5" /> {open && <span>素材库</span>}
      </button>
      {open && (
        <>
          <div className="flex items-center gap-1 border-b border-[var(--cy-border-subtle)] px-2 py-1">
            <button type="button" onClick={() => setV('card')} title="卡片视图"
              className={view === 'card' ? 'text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]'}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setV('list')} title="列表视图"
              className={view === 'list' ? 'text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]'}>
              <ListIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-2"><MaterialsStep view={view} /></div>
        </>
      )}
    </div>
  );
};
