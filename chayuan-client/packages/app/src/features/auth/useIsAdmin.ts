/**
 * useIsAdmin —— 当前用户是否管理员。
 *
 * 数据源:GET /auth/me/modules(rolesApi.myModules)的 ``is_admin`` 字段,与
 * useFeatureAccess / AdminPage **同一 query key** 共享缓存,不重复发请求。
 *
 * 语义:未加载 / 接口出错 / 非 admin → ``false``。调用方若要「单机版机主始终放行」,
 * 自行 OR 上 ``isDesktop()`` —— 本 hook 只回答「是不是网络版管理员」这一件事。
 */
import { useQuery } from '@tanstack/react-query';
import { roles as rolesApi } from '@chayuan/api';

export function useIsAdmin(): boolean {
  const q = useQuery({
    queryKey: ['auth', 'feature-modules'],
    queryFn: () => rolesApi.myModules(),
    staleTime: 60_000,
    retry: 0,
  });
  return q.data?.is_admin === true;
}
