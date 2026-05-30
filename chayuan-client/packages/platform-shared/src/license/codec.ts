// 6 字节头部解包 + issueDate 换算 —— 必须与服务端 server/license/codec.js 一致。
// 位布局:ver(4) app(6) durDays(14) issueDate(14) nonce(8) + 2 保留位。

export const EPOCH_MS = Date.UTC(2026, 0, 1); // 2026-01-01 UTC
const DAY_MS = 86400000;

const WIDTHS = { ver: 4, app: 6, durDays: 14, issueDate: 14, nonce: 8 } as const;
const ORDER = ['ver', 'app', 'durDays', 'issueDate', 'nonce'] as const;

export interface LicenseFields {
  ver: number;
  app: number;
  durDays: number;
  issueDate: number;
  nonce: number;
}

export function unpack(buf: Uint8Array): LicenseFields {
  let v = 0n;
  for (const b of buf) v = (v << 8n) | BigInt(b);
  v >>= 2n; // 丢保留位
  const out = {} as LicenseFields;
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const k = ORDER[i] as (typeof ORDER)[number];
    const w = BigInt(WIDTHS[k]);
    out[k] = Number(v & ((1n << w) - 1n));
    v >>= w;
  }
  return out;
}

export function issueToDate(n: number): Date {
  return new Date(EPOCH_MS + n * DAY_MS);
}
