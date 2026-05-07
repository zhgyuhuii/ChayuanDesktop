/**
 * SearchModePill —— 检索模式 chip(精准 / 全面 / 速度)。
 *
 * 选中后由 store 一次性 set 关联参数(rewriteStrategy / topK / scoreThreshold),
 * 不需要用户再点开"高级参数"。tooltip 描述各档差异,用户不用记。
 *
 * 仅当用户选了至少一个 KB(selectedKuIds 非空)时显示;无 KB 时这个 chip 没意义。
 */

import * as React from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  Pill,
} from '@chayuan/ui';
import { Crosshair, Layers, Rabbit } from 'lucide-react';
import { useComposerStore, useComposerS } from '../../store/composer';

const MODES = [
  {
    value: 'precise' as const,
    label: '精准',
    Icon: Crosshair,
    desc: '原 query 不改写,top 3 命中,阈值 0.5,无 hybrid/无 rerank;少而准',
  },
  {
    value: 'balanced' as const,
    label: '全面',
    Icon: Layers,
    desc: 'auto 改写(短/含代词→hyde,复杂→multi-query),top 8,hybrid + rerank',
  },
  {
    value: 'fast' as const,
    label: '速度',
    Icon: Rabbit,
    desc: '不改写、不 rerank,top 5,适合 SQL/结构化或低延迟场景',
  },
] as const;

export const SearchModePill: React.FC<{ forceVisible?: boolean }> = ({ forceVisible = false }) => {
  const mode = useComposerS((s) => s.searchMode);
  const setMode = useComposerS((s) => s.setSearchMode);
  const hasAnyKb = useComposerStore(
    (s) => s.selectedKuIds.length + s.selectedKbs.length,
  );
  if (!forceVisible && !hasAnyKb) return null;

  const cur = MODES.find((m) => m.value === mode) ?? MODES[1];
  const Icon = cur.Icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pill tone="outline" size="sm" aria-label={`检索模式:${cur.label}`} className="shrink-0 whitespace-nowrap">
          <Icon className="h-3 w-3" />
          {cur.label}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {MODES.map((m) => {
          const I = m.Icon;
          const active = m.value === mode;
          return (
            <DropdownMenuItem
              key={m.value}
              onClick={() => setMode(m.value)}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <I className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" />
                {m.label}
                {active && (
                  <span className="ml-1 text-[10px] text-[var(--cy-brand-600)]">· 当前</span>
                )}
              </span>
              <span className="text-[11px] leading-tight text-[var(--cy-text-tertiary)]">
                {m.desc}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
