import type { ActivationRecord, LicenseCheck, LicenseHostApi } from '@chayuan/platform-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivationDeps } from '../activation';
import { useLicenseStore } from '../licenseStore';

const MID = '1122334455667788';
const RAW_PUB_HEX = '3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be';
const TOKEN =
  'eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwibWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0.8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg';
const SERIAL = '2101W-0JWN1-MN2JP-9V4QW-MSGJ';
const EXPIRE_ISO = '2026-07-01T00:00:00.000Z';
const NOW = Date.UTC(2026, 5, 15);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function makeHost(fp = MID): LicenseHostApi {
  const store = new Map<string, ActivationRecord>();
  return {
    async fingerprint() {
      return fp;
    },
    async verifyShortcode(serial: string): Promise<LicenseCheck> {
      if (serial.replace(/-/g, '').toUpperCase() === SERIAL.replace(/-/g, ''))
        return { valid: true, expireAt: EXPIRE_ISO, source: 'shortcode' };
      return { valid: false, reason: 'signature' };
    },
    async readActivation(app) {
      return store.get(app) ?? null;
    },
    async writeActivation(rec) {
      store.set(rec.app, rec);
    },
  };
}

function deps(host: LicenseHostApi, over: Partial<ActivationDeps> = {}): ActivationDeps {
  return {
    host,
    publicKey: hexToBytes(RAW_PUB_HEX),
    entitlementBaseUrl: 'https://aidooo.com',
    fetchText: async () => JSON.stringify({ token: TOKEN }),
    now: () => NOW,
    ...over,
  };
}

describe('license store', () => {
  beforeEach(() => {
    useLicenseStore.setState({ enabled: false, deps: null, statusByApp: {} });
  });

  it('未配置(Web)→ 门控放行', () => {
    expect(useLicenseStore.getState().isLicensed('video')).toBe(true);
  });

  it('configure + 手输黄金短码 → licensed', async () => {
    useLicenseStore.getState().configure(deps(makeHost()));
    const s = await useLicenseStore.getState().activateSerial('video', SERIAL);
    expect(s.licensed).toBe(true);
    expect(useLicenseStore.getState().isLicensed('video')).toBe(true);
  });

  it('refresh 无本地记录 → best-effort 在线自动激活成功', async () => {
    useLicenseStore.getState().configure(deps(makeHost()));
    const s = await useLicenseStore.getState().refresh('video');
    expect(s.licensed).toBe(true);
    expect(s.source).toBe('online');
  });

  it('换机(指纹不符)+ 无网 → 未授权', async () => {
    useLicenseStore.getState().configure(
      deps(makeHost('8877665544332211'), {
        fetchText: async () => {
          throw new Error('offline');
        },
      }),
    );
    await useLicenseStore.getState().refresh('video');
    expect(useLicenseStore.getState().isLicensed('video')).toBe(false);
  });

  it('reset 清空激活态', async () => {
    useLicenseStore.getState().configure(deps(makeHost()));
    await useLicenseStore.getState().activateSerial('video', SERIAL);
    useLicenseStore.getState().reset();
    expect(useLicenseStore.getState().isLicensed('video')).toBe(false); // enabled 仍 true,但 status 清空
  });
});
