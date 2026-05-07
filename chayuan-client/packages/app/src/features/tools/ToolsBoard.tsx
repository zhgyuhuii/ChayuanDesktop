/**
 * ToolsBoard —— 工具市场(/tools)。
 *
 * - 卡片网格 + 搜索 + 已启用 / 未启用 tab
 * - 点卡片切换"加入 / 移出 Composer 工具集"
 * - 底部 footer 提示已选数 + 一键清空
 *
 * 设计:对齐 KbBoard / McpBoard 视觉,统一卡片高度 / 间距 / 卡片样式。
 * 后端工具 catalog 是 readonly,所以没有"新建"按钮。
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Wrench } from 'lucide-react';
import { Button, Input, cn } from '@chayuan/ui';
import { tools as toolsApi, type ToolInfo } from '@chayuan/api';
import { useComposerStore } from '../../store/composer';
import { ToolCard } from './ToolCard';

const QK_ALL = ['tools', 'all'] as const;
const QK_ENABLED = ['tools', 'enabled'] as const;

type Tab = 'enabled' | 'all';

export const ToolsBoard: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>('enabled');
  const [keyword, setKeyword] = React.useState('');
  const selected = useComposerStore((s) => s.selectedTools);
  const setTools = useComposerStore((s) => s.setTools);

  const enabledQ = useQuery({
    queryKey: QK_ENABLED,
    queryFn: () => toolsApi.listEnabled(),
    staleTime: 60 * 1000,
    retry: 0,
  });
  const allQ = useQuery({
    queryKey: QK_ALL,
    queryFn: () => toolsApi.listAll(),
    staleTime: 60 * 1000,
    retry: 0,
    enabled: tab === 'all',
  });

  const data: ToolInfo[] = (tab === 'enabled' ? enabledQ.data : allQ.data) ?? [];
  const loading = (tab === 'enabled' ? enabledQ.isLoading : allQ.isLoading);
  const error = (tab === 'enabled' ? enabledQ.error : allQ.error) as Error | null;

  const filtered = React.useMemo(() => {
    if (!keyword.trim()) return data;
    const q = keyword.toLowerCase();
    return data.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q),
    );
  }, [data, keyword]);

  const toggle = (name: string) => {
    setTools(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--cy-text-primary)]">
            <Wrench className="h-5 w-5 text-violet-600" /> 工具
          </h1>
          <p className="mt-0.5 text-xs text-[var(--cy-text-tertiary)]">
            内置 + 自定义工具集合;选中后将在下次对话作为可调用工具组出现
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-0.5 text-xs">
            {(['enabled', 'all'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-full px-3 py-1 transition-colors',
                  tab === t
                    ? 'bg-[var(--cy-surface-base)] font-medium text-[var(--cy-text-primary)] shadow-sm'
                    : 'text-[var(--cy-text-secondary)]',
                )}
              >
                {t === 'enabled' ? '已启用' : '全部'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cy-text-tertiary)]" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索工具名 / 描述"
              className="h-8 w-56 rounded-full pl-7 text-xs"
            />
          </div>
        </div>
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-[var(--cy-text-tertiary)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium text-[var(--cy-text-primary)]">加载失败</p>
            <p className="max-w-md break-words text-xs text-[var(--cy-text-secondary)]">
              {error.message}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => (tab === 'enabled' ? enabledQ.refetch() : allQ.refetch())}
            >
              重试
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
              <Wrench className="h-7 w-7" />
            </div>
            <p className="text-sm font-medium text-[var(--cy-text-primary)]">
              {keyword ? '没有匹配工具' : tab === 'enabled' ? '暂无启用的工具' : '暂无可用工具'}
            </p>
            {tab === 'enabled' && (
              <Button size="sm" variant="outline" onClick={() => setTab('all')}>
                查看全部工具
              </Button>
            )}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          >
            {filtered.map((t, i) => (
              <ToolCard
                key={t.name}
                tool={t}
                index={i}
                selected={selected.includes(t.name)}
                onToggle={() => toggle(t.name)}
              />
            ))}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <footer className="flex flex-shrink-0 items-center justify-between border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-4 py-2 text-xs">
          <span className="text-[var(--cy-text-secondary)]">
            已选 <b className="text-[var(--cy-text-primary)]">{selected.length}</b> 个工具,
            将在下次对话生效
          </span>
          <Button size="sm" variant="ghost" onClick={() => setTools([])}>
            清空
          </Button>
        </footer>
      )}
    </div>
  );
};
