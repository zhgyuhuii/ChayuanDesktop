/**
 * 软件授权 API 客户端。对应后端 `chayuan/server/api_server/license_routes.py`，
 * 挂 `/api/v1/license/*`。后端返回裸 JSON（无 {code,msg,data} 壳），`http.get/post`
 * 经 isEnvelope 判定后原样返回。
 *
 * 验证全在 Python 后端（机器指纹绑定 + Ed25519/B1 验签 + 防回拨）；
 * 前端不持任何机密或验签算法。桌面走本地 sidecar，网页走远程同一套 API。
 */

import { http } from './client';

/** 激活成功时的权益摘要（由 POST /activate 返回；其余接口无此字段）。 */
export interface LicenseGrant {
  /** 解锁的模块名列表，与 products 配置的 key 对齐（如 ["video", "avatar"]）。 */
  modules: string[];
  /** 授权类型：count=次数；time=时长。 */
  kind: 'count' | 'time';
  /** kind=count 时：本次新增次数；kind=time 时：从激活时刻起的续期天数（向上取整）。 */
  value: number;
}

/** 后端授权态（camelCase 与 server/license/service.py 对齐）。 */
export interface LicenseStatus {
  licensed: boolean;
  app?: string;
  /** 到期时间（ISO）。 */
  expireAt?: string;
  /** 通过时的来源通道：online/relay/file/airgap/shortcode。 */
  source?: string;
  /** 未通过原因：none/expired/rollback/mismatch/signature/invalid-app。 */
  reason?: string;
  /** 激活成功时的本次权益摘要（POST /activate 专属；status 等接口无此字段）。 */
  grant?: LicenseGrant;
}

const BASE = '/api/v1/license';

export function licenseFingerprint(): Promise<{ fingerprint: string }> {
  return http.get<{ fingerprint: string }>(`${BASE}/fingerprint`);
}

/** 支持的支付渠道(来自买站后台「支付配置」开关 + 已配置)。 */
export interface PayChannels {
  wechat: boolean;
  alipay: boolean;
}

export function licenseBuyUrl(app: string): Promise<{ url: string; channels?: PayChannels }> {
  return http.get<{ url: string; channels?: PayChannels }>(`${BASE}/buy-url`, { query: { app } });
}

export function licenseStatus(app: string): Promise<LicenseStatus> {
  return http.get<LicenseStatus>(`${BASE}/status`, { query: { app } });
}

export function licenseActivate(app: string, serial: string): Promise<LicenseStatus> {
  return http.post<LicenseStatus>(`${BASE}/activate`, { app, serial });
}

export function licenseActivateToken(app: string, token: string): Promise<LicenseStatus> {
  return http.post<LicenseStatus>(`${BASE}/activate-token`, { app, token });
}

/** 「我的权限」单条记录(一次购买/一项授权)。 */
export interface EntitlementItem {
  app: string;
  /** 产品名(后端按 app 映射;断网回落为 app)。 */
  productName?: string;
  /** 支付金额(分);断网或本地回落时为 null。 */
  amountFen?: number | null;
  /** 购买时间(ISO);断网或本地回落时为 null。 */
  paidAt?: string | null;
  /** 到期时间(ISO)。 */
  expireAt?: string | null;
  /** 序列号。 */
  serial?: string | null;
  /** 当前是否有效(未过期)。 */
  active?: boolean;
  /** 来源通道。 */
  source?: string;
}

export interface EntitlementsResp {
  fingerprint: string;
  /** 本次是否成功联网拉到购买记录(否则为本地回落,无金额/购买时间)。 */
  online: boolean;
  items: EntitlementItem[];
}

/** 「我的权限」:本机购买/授权记录(在线含金额与购买时间,离线回落本地)。 */
export function licenseEntitlements(): Promise<EntitlementsResp> {
  return http.get<EntitlementsResp>(`${BASE}/entitlements`);
}

/**
 * 重置本机激活(删除本地授权记录)。注意:若线上仍有该机器授权且联网,
 * 下次刷新会被在线自动激活"复活";彻底重置需在网站后台按指纹吊销。
 */
export function licenseReset(app: string): Promise<{ ok: boolean; removed: boolean; app: string }> {
  return http.post<{ ok: boolean; removed: boolean; app: string }>(`${BASE}/reset`, { app });
}

// ── 按次门控 ────────────────────────────────────────────────────────────────

/** consume 接口返回值。 */
export interface ConsumeResult {
  /** 是否允许执行(false → 需弹购买对话框)。 */
  allowed: boolean;
  /** 本次消耗来源:'free'|'count'|'time'|'none' */
  source: 'free' | 'count' | 'time' | 'none';
  /** 今日剩余免费次数。 */
  remainingFree: number;
  /** 购买剩余次数。 */
  counts: number;
  /** 购买时间授权到期时间(ISO);无时间授权时为 null。 */
  timeExpireAt: string | null;
  /** 不通过时的原因说明(可选)。 */
  reason?: string;
}

/**
 * 执行前门控:扣减一次使用额度,返回是否允许执行及来源。
 * - allowed=true, source='free' → 用的免费额度,建议弹分享对话框。
 * - allowed=true, source='count'|'time' → 用的购买额度,直接执行无需弹窗。
 * - allowed=false → 额度耗尽,弹购买对话框。
 */
export function licenseConsume(app: string): Promise<ConsumeResult> {
  return http.post<ConsumeResult>(`${BASE}/consume`, { app });
}

// ── 分享素材 ────────────────────────────────────────────────────────────────

/** 分享素材(裂变邀请链接 + QR 码原始 URL + 海报)。 */
export interface ShareMaterial {
  /** 邀请码。 */
  inviteCode: string;
  /** 分享链接(encode 成二维码给好友扫)。 */
  shareUrl: string;
  /** 海报图地址(可选,当前前端自行生成 QR 不强依赖)。 */
  posterUrl: string;
}

/**
 * 获取分享素材。需要本机指纹 mid(通过 licenseFingerprint() 取得)。
 * shareUrl 形如 /buy?app=&ref=<inviteCode>,前端本地生成 QR 码展示。
 */
export function shareMaterial(app: string, mid: string): Promise<ShareMaterial> {
  return http.get<ShareMaterial>('/api/share/material', { query: { app, mid } });
}

/** 本地拼接的分享链接(离线可用),对应 GET /api/v1/license/share-url。 */
export interface ShareUrl {
  url: string;
  fingerprint: string;
}
export function shareUrl(app: string): Promise<ShareUrl> {
  return http.get<ShareUrl>(`${BASE}/share-url`, { query: { app } });
}
