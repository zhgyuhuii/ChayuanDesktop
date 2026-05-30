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
  expireAt?: string;
  source?: string;
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
