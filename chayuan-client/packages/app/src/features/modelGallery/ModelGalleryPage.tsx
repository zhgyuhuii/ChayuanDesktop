/**
 * 模型广场(Model Gallery)。
 *
 * 在线浏览 ModelScope / HuggingFace 上的可下载模型 + 本机「已安装」模型清单。
 *
 * 顶部过滤(GalleryFilters)→ 列表区(ModelHubRow)→ 底部分页(GalleryPagination,
 * 已安装 tab 不分页)。
 *
 * 过滤为 AND 联合:source / query(300ms 防抖)/ capability / runnableOnly 任一变化
 * 都把 page 复位到 1。远程检索走 ``modelHub.search``;已安装走 ``runtimeModels.list``。
 *
 * 安装/卸载等操作按钮在本页只占位(ModelHubRow 内),P5 再接 useInstallJob。
 */

import {
  type HubModelCard,
  type LocalModelEntry,
  modelHub,
  runtimeModels,
} from '@chayuan/api';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, PackageOpen } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from '../../i18n';
import { GalleryFilters } from './GalleryFilters';
import { GalleryPagination } from './GalleryPagination';
import { ModelHubRow } from './ModelHubRow';

export type GallerySource = 'modelscope' | 'huggingface' | 'installed';
export type HfRoute = 'mirror' | 'official';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

/** 后端线路值:hf-mirror 国内 / 官方。modelHub.search 的 route 参数透传。 */
function routeParam(source: GallerySource, hfRoute: HfRoute): string | undefined {
  if (source !== 'huggingface') return undefined;
  return hfRoute === 'mirror' ? 'hf-mirror' : 'official';
}

/** 已安装本地模型 → ModelHubRow 可消费的 HubModelCard 形状。 */
function localToCard(e: LocalModelEntry): HubModelCard {
  const name = e.relpath?.split('/').filter(Boolean).pop() ?? e.model_id;
  return {
    source: e.source_tag || 'local',
    model_id: e.model_id,
    display_name: name,
    owner: '',
    capability: e.capability,
    param_size: null,
    file_size_bytes: e.size_bytes ?? null,
    format: e.format || null,
    runnable: true,
    serveable: true,
    downloads: null,
    likes: null,
    updated_at: null,
    tags: [],
    installed: true,
    // 内置模型不可卸载 —— 后端 local_index 用 source_tag='bundled' 标注。
    bundled: e.source_tag === 'bundled',
  };
}

/** HF token 本地存储 key(私有仓 / 限流时附带)。 */
const HF_TOKEN_KEY = 'chayuan.hf_token';

export const ModelGalleryPage: React.FC = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [hfToken, setHfToken] = React.useState<string>(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem(HF_TOKEN_KEY) || '' : ''),
  );
  const onHfTokenChange = React.useCallback((v: string) => {
    setHfToken(v);
    if (typeof localStorage !== 'undefined') {
      if (v) localStorage.setItem(HF_TOKEN_KEY, v);
      else localStorage.removeItem(HF_TOKEN_KEY);
    }
  }, []);

  const [source, setSource] = React.useState<GallerySource>('modelscope');
  const [hfRoute, setHfRoute] = React.useState<HfRoute>('mirror');
  const [queryInput, setQueryInput] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [capability, setCapability] = React.useState<string | null>(null);
  const [runnableOnly, setRunnableOnly] = React.useState(true);
  const [page, setPage] = React.useState(1);

  // 搜索框 300ms 防抖 → query。
  React.useEffect(() => {
    const id = setTimeout(() => setQuery(queryInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [queryInput]);

  // 任一过滤变化(source / 防抖后的 query / capability / runnableOnly)→ page 复位 1。
  React.useEffect(() => {
    setPage(1);
  }, [source, query, capability, runnableOnly]);

  const isInstalled = source === 'installed';
  const route = routeParam(source, hfRoute);
  // token 仅对 HuggingFace 源生效(ModelScope 首期走公开仓)。
  const token = source === 'huggingface' ? hfToken || undefined : undefined;

  // 装 / 卸成功后:刷新对话下拉(['v1.models'])、已安装清单(['runtime.models'])、
  // 本页搜索结果的 installed 标记(['model-hub.search'])。
  const onMutated = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['v1.models'] });
    void qc.invalidateQueries({ queryKey: ['runtime.models'] });
    void qc.invalidateQueries({ queryKey: ['model-hub.search'] });
  }, [qc]);

  // 远程检索。
  const searchQuery = useQuery({
    queryKey: [
      'model-hub.search',
      { source, hfRoute, query, capability, runnableOnly, page, hasToken: !!token },
    ],
    queryFn: () =>
      modelHub.search({
        source,
        route,
        query: query || undefined,
        capability: capability ?? undefined,
        runnableOnly,
        page,
        pageSize: PAGE_SIZE,
        token,
      }),
    enabled: !isInstalled,
    placeholderData: keepPreviousData,
  });

  // 已安装本地模型。
  const installedQuery = useQuery({
    queryKey: ['runtime.models', capability],
    queryFn: () => runtimeModels.list(capability ? { capability } : {}),
    enabled: isInstalled,
  });

  // 已安装 tab:本地无后端分页 / 搜索 → 前端按 query 过滤。
  const installedRows = React.useMemo<HubModelCard[]>(() => {
    if (!isInstalled) return [];
    const items = installedQuery.data?.items ?? [];
    const q = query.toLowerCase();
    return items
      .map(localToCard)
      .filter((c) => !q || c.model_id.toLowerCase().includes(q) || c.display_name.toLowerCase().includes(q));
  }, [isInstalled, installedQuery.data, query]);

  const remoteItems = searchQuery.data?.items ?? [];
  const isFetching = isInstalled ? installedQuery.isFetching : searchQuery.isFetching;
  const error = isInstalled ? installedQuery.error : searchQuery.error;
  const rows = isInstalled ? installedRows : remoteItems;
  const isEmpty = !isFetching && !error && rows.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-5">
      <h1 className="mb-3 shrink-0 text-lg font-semibold text-[var(--cy-text-primary)]">
        {t('nav.modelGallery')}
      </h1>

      <div className="shrink-0">
        <GalleryFilters
          source={source}
          onSourceChange={setSource}
          hfRoute={hfRoute}
          onHfRouteChange={setHfRoute}
          queryInput={queryInput}
          onQueryInputChange={setQueryInput}
          capability={capability}
          onCapabilityChange={setCapability}
          runnableOnly={runnableOnly}
          onRunnableOnlyChange={setRunnableOnly}
          hfToken={hfToken}
          onHfTokenChange={onHfTokenChange}
        />
      </div>

      {/* 列表区 */}
      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="h-8 w-8 text-amber-500" />
            <p className="text-sm text-[var(--cy-text-secondary)]">
              {error instanceof Error ? error.message : '数据源暂时不可达'}
            </p>
            <button
              type="button"
              onClick={() => (isInstalled ? installedQuery.refetch() : searchQuery.refetch())}
              className="rounded-full border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-4 py-1.5 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
            >
              重试
            </button>
          </div>
        ) : isFetching && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--cy-text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <PackageOpen className="h-8 w-8 text-[var(--cy-text-tertiary)]" />
            <p className="text-sm text-[var(--cy-text-tertiary)]">
              {isInstalled ? '本机暂无已安装模型' : '没有匹配的模型'}
            </p>
          </div>
        ) : (
          <div className="relative flex flex-col gap-2">
            {/* 翻页 / 切换时的轻量加载遮罩(keepPreviousData 下保留旧列表) */}
            {isFetching && (
              <div className="pointer-events-none absolute right-0 top-0 inline-flex items-center gap-1 text-[11px] text-[var(--cy-text-tertiary)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                加载中
              </div>
            )}
            {rows.map((card) => (
              <ModelHubRow
                key={`${card.source}::${card.model_id}`}
                card={card}
                route={route}
                token={token}
                onMutated={onMutated}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部分页:已安装 tab 不分页 */}
      {!isInstalled && !error && (
        <div className="shrink-0">
          <GalleryPagination
            page={page}
            hasMore={searchQuery.data?.has_more ?? false}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            onJump={(n) => setPage(n)}
          />
        </div>
      )}
    </div>
  );
};
