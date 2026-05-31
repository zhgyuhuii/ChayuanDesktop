/**
 * 软件授权 API 客户端。对应后端 `chayuan/server/api_server/license_routes.py`，
 * 挂 `/api/v1/license/*`。后端返回裸 JSON（无 {code,msg,data} 壳），`http.get/post`
 * 经 isEnvelope 判定后原样返回。
 *
 * 验证全在 Python 后端（机器指纹绑定 + Ed25519/B1 验签 + 防回拨）；
 * 前端不持任何机密或验签算法。桌面走本地 sidecar，网页走远程同一套 API。
 */

import { http } from './client';

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
}

const BASE = '/api/v1/license';

export function licenseFingerprint(): Promise<{ fingerprint: string }> {
  return http.get<{ fingerprint: string }>(`${BASE}/fingerprint`);
}

export function licenseBuyUrl(app: string): Promise<{ url: string }> {
  return http.get<{ url: string }>(`${BASE}/buy-url`, { query: { app } });
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
