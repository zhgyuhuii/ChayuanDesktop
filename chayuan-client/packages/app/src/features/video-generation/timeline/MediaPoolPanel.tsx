import * as React from 'react';
import { ChevronLeft, ChevronRight, Library } from 'lucide-react';
import { MaterialsStep } from '../steps/MaterialsStep';

export const MediaPoolPanel: React.FC = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div className={`flex shrink-0 flex-col border-r border-[var(--cy-border-subtle)] transition-all ${open ? 'w-72' : 'w-9'}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1 border-b border-[var(--cy-border-subtle)] px-2 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
        {open ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Library className="h-3.5 w-3.5" /> {open && <span>素材库</span>}
      </button>
      {open && <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-2"><MaterialsStep /></div>}
    </div>
  );
};
