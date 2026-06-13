// apps/publisher/src/api.ts
import { invoke } from '@tauri-apps/api/core';
import type { ScannedFile, AdminRelease, OnlineVersion } from '@chayuan/publisher-core';

export const getCaptcha = () => invoke<{ captchaId: string; svg: string }>('get_captcha');
export const login = (username: string, password: string, captchaId: string, captchaCode: string) =>
  invoke<void>('login', { username, password, captchaId, captchaCode });
export const readGitVersion = (repo: string) => invoke<{ version: string; changelog: string }>('read_git_version', { repo });
export const scanBuildDir = (dir: string) => invoke<ScannedFile[]>('scan_build_dir', { dir });
export const hashFile = (path: string) => invoke<string>('hash_file', { path });

export const httpJson = <T = unknown>(method: string, path: string, body?: unknown) =>
  invoke<T>('http_json', { method, path, body: body ?? null });

export const fetchOnlineVersion = () => httpJson<OnlineVersion>('GET', '/api/version/chayuan');
export const fetchAdminReleases = async (): Promise<AdminRelease[]> => {
  // GET /api/admin/releases 返回 {products:{chayuan:{ver:{plat:[{variant,published}]}}}},摊平成 AdminRelease[]
  const raw = await httpJson<{ products?: Record<string, Record<string, Record<string, { variant: string; published: boolean }[]>>> }>(
    'GET', '/api/admin/releases');
  const out: AdminRelease[] = [];
  const cy = raw.products?.chayuan ?? {};
  for (const version of Object.keys(cy)) {
    for (const platform of Object.keys(cy[version])) {
      for (const e of cy[version][platform]) out.push({ version, platform, variant: e.variant, published: e.published });
    }
  }
  return out;
};
