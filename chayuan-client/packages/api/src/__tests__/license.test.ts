import { setPlatform } from '@chayuan/platform-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureClient } from '../client';
import {
  licenseActivate,
  licenseActivateToken,
  licenseBuyUrl,
  licenseFingerprint,
  licenseStatus,
} from '../license';

// 注入完整 PAL stub（非仅 net）：client.ts 每次请求都经 buildHeaders → getAccessToken
// → getPlatform().secure.get(...)，只给 net.fetch 会在取 token 时抛 undefined。
// 与 diagnose.test.ts 同套路。每个 test 用 mockNet 覆盖本次的 fetch 响应。
function mockNet(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  setPlatform({
    kind: 'web',
    runtime: {
      appName: 't',
      appVersion: '0',
      release: 't@0',
      defaultApiBase: 'http://127.0.0.1:62581',
    },
    secure: { get: async () => null, set: async () => undefined, del: async () => undefined },
    db: { exec: async () => undefined, query: async () => [] },
    fs: { pickFiles: async () => [], saveText: async () => undefined, readDropped: async () => [] },
    net: { fetch: fetchMock, sse: fetchMock },
  } as never);
  configureClient({ baseURL: 'http://127.0.0.1:62581' });
  return fetchMock;
}

// 默认每个 test 前重置 baseURL，避免跨 test 状态泄漏（fetch 仍由各 test 的 mockNet 覆盖）。
beforeEach(() => configureClient({ baseURL: 'http://127.0.0.1:62581' }));
afterEach(() => vi.restoreAllMocks());

describe('license api client', () => {
  it('GET /fingerprint 返回指纹', async () => {
    const f = mockNet(() => ({ fingerprint: '1122334455667788' }));
    expect(await licenseFingerprint()).toEqual({ fingerprint: '1122334455667788' });
    expect(String(f.mock.calls[0]![0])).toContain('/api/v1/license/fingerprint');
  });

  it('GET /buy-url 带 app query', async () => {
    const f = mockNet(() => ({ url: 'https://aidooo.com/buy?app=video&mid=ab' }));
    const r = await licenseBuyUrl('video');
    expect(r.url).toContain('/buy?app=video');
    expect(String(f.mock.calls[0]![0])).toContain('/api/v1/license/buy-url?app=video');
  });

  it('GET /status 原样返回裸 JSON（无壳剥离）', async () => {
    const f = mockNet(() => ({
      licensed: true,
      app: 'video',
      expireAt: '2026-07-01T00:00:00.000Z',
      source: 'shortcode',
    }));
    const s = await licenseStatus('video');
    expect(s.licensed).toBe(true);
    expect(s.expireAt).toBe('2026-07-01T00:00:00.000Z');
    expect(String(f.mock.calls[0]![0])).toContain('/api/v1/license/status?app=video');
  });

  it('POST /activate 发送 {app,serial}', async () => {
    const f = mockNet(() => ({
      licensed: true,
      app: 'video',
      expireAt: '2026-07-01T00:00:00.000Z',
    }));
    const s = await licenseActivate('video', '2101W-0JWN1-MN2JP-9V4QW-MSGJ');
    expect(s.licensed).toBe(true);
    const sentBody = JSON.parse(String(f.mock.calls[0]![1]?.body));
    expect(sentBody).toEqual({ app: 'video', serial: '2101W-0JWN1-MN2JP-9V4QW-MSGJ' });
  });

  it('POST /activate-token 发送 {app,token}', async () => {
    const f = mockNet(() => ({ licensed: false, app: 'video', reason: 'mismatch' }));
    const s = await licenseActivateToken('video', 'tok');
    expect(s.reason).toBe('mismatch');
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual({ app: 'video', token: 'tok' });
  });
});
