/**
 * useFeatureAccess —— 角色「前端功能权限」门控(RBAC #2 消费端)。
 *
 * 数据源:GET /auth/me/modules(rolesApi.myModules)。后端目录里以 `app.` 前缀
 * 的键即「前端功能」模块(见 server/admin/role_modules.py 的「前端功能」分组)。
 *
 * 放行语义(向后兼容优先,绝不误锁老角色 / 单机机主):
 *   - 未加载 / 接口出错                            → 不限制,全部放行(不闪烁、不误锁)
 *   - single_machine(桌面单机版,机主自用)        → 不限制
 *   - is_admin                                    → 不限制
 *   - 角色未勾选任何 app.* 功能模块               → 不限制(老角色 / 默认游客全功能)
 *   - 勾选了部分 app.*                            → 只放行勾选的功能,其余隐藏
 *     (网络游客=未登录但放行,按其默认角色 user 的 app.* 授权;admin 配 user 角色即可限制游客)
 *
 * 用法:`const { canUse } = useFeatureAccess(); canUse('app.kb')`。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { roles as rolesApi } from '@chayuan/api';

export function useFeatureAccess(): {
  canUse: (featureKey: string) => boolean;
  restricted: boolean;
  loading: boolean;
} {
  const q = useQuery({
    queryKey: ['auth', 'feature-modules'],
    queryFn: () => rolesApi.myModules(),
    staleTime: 60_000,
    retry: 0,
  });

  const allowed = React.useMemo<Set<string> | null>(() => {
    const data = q.data;
    if (!data || data.single_machine || data.is_admin !== false) return null; // 未知 / 单机 / admin → 不限制
    const appKeys = (data.modules ?? []).filter((k) => k.startsWith('app.'));
    if (appKeys.length === 0) return null; // 角色没配任何前端功能 → 向后兼容,全放行
    return new Set(appKeys);
  }, [q.data]);

  const canUse = React.useCallback(
    (featureKey: string) => allowed === null || allowed.has(featureKey),
    [allowed],
  );

  return { canUse, restricted: allowed !== null, loading: q.isLoading };
}
