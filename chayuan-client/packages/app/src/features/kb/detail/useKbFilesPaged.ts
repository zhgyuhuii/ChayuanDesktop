import { useInfiniteQuery } from '@tanstack/react-query';
import { kb as kbApi, type PagedFiles, type KbFile } from '@chayuan/api';

const PAGE_SIZE = 20;

/** 纯函数:由上一页响应推下一页 page(无更多则 undefined)。 */
export function nextPageParam(last: PagedFiles): number | undefined {
  return last.has_more ? last.page + 1 : undefined;
}

export interface UseKbFilesPagedResult {
  items: KbFile[];
  total: number;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  refetch: () => void;
}

export function useKbFilesPaged(kbName: string, keyword: string): UseKbFilesPagedResult {
  const q = useInfiniteQuery({
    queryKey: ['kb.files.paged', kbName, keyword],
    enabled: !!kbName,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => kbApi.listFilesPaged(kbName, pageParam as number, PAGE_SIZE, keyword),
    getNextPageParam: nextPageParam,
    staleTime: 30_000,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const total = q.data?.pages?.[0]?.total ?? 0;
  return {
    items,
    total,
    fetchNextPage: () => { void q.fetchNextPage(); },
    hasNextPage: !!q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    isLoading: q.isLoading,
    refetch: () => { void q.refetch(); },
  };
}
