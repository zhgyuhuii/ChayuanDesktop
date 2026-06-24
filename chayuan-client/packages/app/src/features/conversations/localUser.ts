/** 本地历史隔离键:真实登录用户 → 其 id 字符串;单机/未登录/guest → "guest"。
 *  与服务端 auth.deps.owner_id_of(guest→共享)语义对齐。 */
import { useAuthStore } from '../../store/auth';

export function localUserIdOf(user: { id?: number } | null | undefined): string {
  return user && typeof user.id === 'number' && user.id > 0 ? String(user.id) : 'guest';
}

export function useLocalUserId(): string {
  return useAuthStore((s) => localUserIdOf(s.user));
}
