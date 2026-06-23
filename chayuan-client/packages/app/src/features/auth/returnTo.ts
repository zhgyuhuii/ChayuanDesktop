/**
 * 登录后回跳目标(returnTo)的安全校验 —— 防 open-redirect。
 * 仅允许【站内绝对路径】:以单个 `/` 开头,排除 `//`、`/\`、协议、以及 `/login` 自身(防回环)。
 * 守卫拦截未登录访问时把当前路径塞进 `/login?returnTo=...`,登录成功后回跳到这里。
 */
export function safeReturnTo(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  if (v[0] !== '/' || v[1] === '/' || v[1] === '\\') return undefined; // 排除协议相对 // 和 /\
  if (v === '/login' || v.startsWith('/login?') || v.startsWith('/login/')) return undefined;
  return v;
}
