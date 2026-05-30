/**
 * 授权激活编排（五档）+ 防时钟回拨 + 过期判定。
 *
 * 架构（ARCHITECTURE.md §1 / CONTRIBUTING §包边界）：
 * - 纯验签算法来自 `@chayuan/license`（Ed25519 令牌，无机密）。
 * - 平台能力（指纹 / B1 短码验签 / 防回拨记录读写）经 PAL `LicenseHostApi`（桌面 = platform-tauri/Rust）。
 * - 在线 entitlement 拉取走注入的 `fetchText`（运行时 = PAL.net.fetch 到 aidooo.com / 内网中继）。
 *
 * 全部依赖注入，便于 vitest 在无 Tauri 运行时下测。本模块**无 React、无 server data 进 store**。
 */

import { verifyToken } from '@chayuan/license';
import type { ActivationRecord, LicenseHostApi } from '@chayuan/platform-shared';

const ROLLBACK_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 容许 1 天时钟偏差

export type ActivationSource = ActivationRecord['source'];
export type ActivationReason = 'none' | 'expired' | 'rollback' | 'mismatch';

export interface ActivationStatus {
  licensed: boolean;
  app: string;
  expireAt?: string;
  source?: ActivationSource;
  reason?: ActivationReason;
}

export interface ActivationDeps {
  /** PAL 平台能力（桌面 = platform-tauri/Rust）。 */
  host: LicenseHostApi;
  /** 内嵌 Ed25519 公钥（验令牌；无机密）。 */
  publicKey: Uint8Array;
  /** entitlement 基址：默认 aidooo.com；内网部署改中继地址。 */
  entitlementBaseUrl: string;
  /** 拉取文本（运行时 = PAL.net.fetch 包一层，返回响应体字符串）。 */
  fetchText(url: string): Promise<string>;
  /** 可注入时钟，便于测试。 */
  now?(): number;
}

const clock = (d: ActivationDeps): number => (d.now ? d.now() : Date.now());
const sameMid = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** 读取并校验本地激活态（防回拨 + 过期），正常时单调推进 seenMax。 */
export async function currentStatus(app: string, d: ActivationDeps): Promise<ActivationStatus> {
  const rec = await d.host.readActivation(app);
  if (!rec) return { licensed: false, app, reason: 'none' };
  const t = clock(d);
  // 防时钟回拨：系统时间被调到远早于"见过的最大时间" → 视为作弊，拒绝离线放行。
  if (t < rec.seenMax - ROLLBACK_TOLERANCE_MS) {
    return { licensed: false, app, reason: 'rollback', expireAt: rec.expireAt, source: rec.source };
  }
  if (t > new Date(rec.expireAt).getTime()) {
    return { licensed: false, app, reason: 'expired', expireAt: rec.expireAt, source: rec.source };
  }
  if (t > rec.seenMax) await d.host.writeActivation({ ...rec, seenMax: t });
  return { licensed: true, app, expireAt: rec.expireAt, source: rec.source };
}

/** Ed25519 令牌激活（在线/中继/文件/气隙四档共用）。验签 + 校验 mid/app/exp 后落库。 */
export async function activateByToken(
  app: string,
  token: string,
  source: ActivationSource,
  d: ActivationDeps,
): Promise<ActivationStatus> {
  const mid = await d.host.fingerprint();
  const r = verifyToken(token, d.publicKey);
  if (!r.valid || !r.payload) return { licensed: false, app, reason: 'none' };
  if (r.payload.app !== app) return { licensed: false, app, reason: 'mismatch' };
  if (!sameMid(r.payload.mid, mid)) return { licensed: false, app, reason: 'mismatch' }; // 换机失败
  const t = clock(d);
  if (r.payload.exp * 1000 <= t) return { licensed: false, app, reason: 'expired' };
  const rec: ActivationRecord = {
    mid,
    app,
    expireAt: new Date(r.payload.exp * 1000).toISOString(),
    seenMax: t,
    source,
    credential: token,
  };
  await d.host.writeActivation(rec);
  return { licensed: true, app, expireAt: rec.expireAt, source };
}

/** 在线自动激活：指纹 → 拉 entitlement → 验令牌 → 落库。 */
export async function activateOnline(app: string, d: ActivationDeps): Promise<ActivationStatus> {
  const mid = await d.host.fingerprint();
  const url = `${d.entitlementBaseUrl}/api/license/entitlement?mid=${mid}&app=${app}`;
  let token: string | undefined;
  try {
    token = JSON.parse(await d.fetchText(url)).token;
  } catch {
    return { licensed: false, app, reason: 'none' };
  }
  if (!token) return { licensed: false, app, reason: 'none' };
  return activateByToken(app, token, 'online', d);
}

/** 手输短码激活（B1；HMAC 密钥在原生层，验签经 PAL.verifyShortcode）。 */
export async function activateBySerial(
  app: string,
  serial: string,
  d: ActivationDeps,
): Promise<ActivationStatus> {
  const check = await d.host.verifyShortcode(serial);
  if (!check.valid || !check.expireAt) return { licensed: false, app, reason: 'none' };
  const t = clock(d);
  if (new Date(check.expireAt).getTime() <= t) return { licensed: false, app, reason: 'expired' };
  const mid = await d.host.fingerprint();
  const rec: ActivationRecord = {
    mid,
    app,
    expireAt: check.expireAt,
    seenMax: t,
    source: 'shortcode',
    credential: serial,
  };
  await d.host.writeActivation(rec);
  return { licensed: true, app, expireAt: check.expireAt, source: 'shortcode' };
}
