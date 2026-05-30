import type { ActivationRecord, LicenseCheck, LicenseHostApi } from '@chayuan/platform-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ActivationDeps,
  activateBySerial,
  activateByToken,
  activateOnline,
  currentStatus,
} from '../activation';

// 真实服务端 server/license 签发的黄金向量(与 @chayuan/license 互通测试同源)。
const MID = '1122334455667788';
const RAW_PUB_HEX = '3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be';
const TOKEN =
  'eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwibWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0.8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg';
const SERIAL = '2101W-0JWN1-MN2JP-9V4QW-MSGJ';
const EXPIRE_ISO = '2026-07-01T00:00:00.000Z';
const NOW = Date.UTC(2026, 5, 15); // 2026-06-15,早于到期

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// 内存版 PAL LicenseHostApi:fingerprint 可配,verifyShortcode 对黄金短码返回有效。
function makeHost(
  opts: { fp?: string } = {},
): LicenseHostApi & { _store: Map<string, ActivationRecord> } {
  const store = new Map<string, ActivationRecord>();
  return {
    _store: store,
    async fingerprint() {
      return opts.fp ?? MID;
    },
    async verifyShortcode(serial: string): Promise<LicenseCheck> {
      if (serial.replace(/-/g, '').toUpperCase() === SERIAL.replace(/-/g, ''))
        return { valid: true, expireAt: EXPIRE_ISO, source: 'shortcode' };
      return { valid: false, reason: 'signature' };
    },
    async readActivation(app: string) {
      return store.get(app) ?? null;
    },
    async writeActivation(rec: ActivationRecord) {
      store.set(rec.app, rec);
    },
  };
}

function makeDeps(
  host: ReturnType<typeof makeHost>,
  over: Partial<ActivationDeps> = {},
): ActivationDeps {
  return {
    host,
    publicKey: hexToBytes(RAW_PUB_HEX),
    entitlementBaseUrl: 'https://pay.aidooo.com',
    fetchText: async () => JSON.stringify({ token: TOKEN, expireAt: EXPIRE_ISO }),
    now: () => NOW,
    ...over,
  };
}

describe('activateByToken（文件/气隙/中继）', () => {
  let host: ReturnType<typeof makeHost>;
  beforeEach(() => {
    host = makeHost();
  });

  it('正确指纹 + 服务端令牌 → 激活成功并落库', async () => {
    const s = await activateByToken('video', TOKEN, 'file', makeDeps(host));
    expect(s.licensed).toBe(true);
    expect(s.source).toBe('file');
    expect(s.expireAt).toBe(EXPIRE_ISO);
    expect(host._store.get('video')?.mid).toBe(MID);
  });

  it('换一台机器(指纹不符) → mismatch,不落库', async () => {
    const wrong = makeHost({ fp: '8877665544332211' });
    const s = await activateByToken('video', TOKEN, 'file', makeDeps(wrong));
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('mismatch');
    expect(wrong._store.size).toBe(0);
  });

  it('app 不匹配 → mismatch', async () => {
    const s = await activateByToken('other', TOKEN, 'file', makeDeps(host));
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('mismatch');
  });
});

describe('activateOnline（在线自动）', () => {
  it('拉到 entitlement 令牌 → 激活成功,source=online', async () => {
    const host = makeHost();
    const s = await activateOnline('video', makeDeps(host));
    expect(s.licensed).toBe(true);
    expect(s.source).toBe('online');
  });

  it('网络失败 → 不激活', async () => {
    const host = makeHost();
    const s = await activateOnline(
      'video',
      makeDeps(host, {
        fetchText: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect(s.licensed).toBe(false);
  });
});

describe('activateBySerial（手输短码 B1）', () => {
  it('黄金短码 → 激活成功,source=shortcode', async () => {
    const host = makeHost();
    const s = await activateBySerial('video', SERIAL, makeDeps(host));
    expect(s.licensed).toBe(true);
    expect(s.source).toBe('shortcode');
  });

  it('错误短码 → 不激活', async () => {
    const host = makeHost();
    const s = await activateBySerial('video', 'WRONG-CODE-XXXXX-YYYYY-ZZZZ', makeDeps(host));
    expect(s.licensed).toBe(false);
  });
});

describe('currentStatus（防回拨 + 过期 + seenMax 推进）', () => {
  it('激活后正常放行,并把 seenMax 推进到 now', async () => {
    const host = makeHost();
    await activateByToken('video', TOKEN, 'online', makeDeps(host));
    // 人为把 seenMax 调小,验证 currentStatus 会推进
    const rec = host._store.get('video');
    if (rec) host._store.set('video', { ...rec, seenMax: NOW - 1000 });
    const s = await currentStatus('video', makeDeps(host));
    expect(s.licensed).toBe(true);
    expect(host._store.get('video')?.seenMax).toBe(NOW);
  });

  it('时钟回拨(now 远早于 seenMax) → rollback,拒绝放行', async () => {
    const host = makeHost();
    host._store.set('video', {
      mid: MID,
      app: 'video',
      expireAt: EXPIRE_ISO,
      seenMax: Date.UTC(2026, 5, 20), // 见过 6-20
      source: 'online',
      credential: TOKEN,
    });
    const s = await currentStatus('video', makeDeps(host, { now: () => Date.UTC(2026, 0, 1) })); // 时钟回到 1-1
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('rollback');
  });

  it('已过期 → expired', async () => {
    const host = makeHost();
    host._store.set('video', {
      mid: MID,
      app: 'video',
      expireAt: '2026-05-01T00:00:00.000Z',
      seenMax: Date.UTC(2026, 4, 1),
      source: 'shortcode',
      credential: SERIAL,
    });
    const s = await currentStatus('video', makeDeps(host));
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('expired');
  });

  it('无记录 → none', async () => {
    const host = makeHost();
    const s = await currentStatus('video', makeDeps(host));
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('none');
  });
});
