import { describe, expect, it } from 'vitest';
import { verifyShortcode } from '../license/shortcode';
import { verifyToken } from '../license/token';

// 黄金向量:由真实服务端 server/license/ 签发(node 生成),用于证明桌面 TS 验签
// 与服务端字节兼容。任何一端改了 wire 格式,这些断言就会红。
const GOLDEN = {
  hmacKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  fpHex: '1122334455667788',
  serial: '2101W-0JWN1-MN2JP-9V4QW-MSGJ',
  rawPubHex: '3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be',
  token:
    'eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwibWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0.8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg',
  expectExpireISO: '2026-07-01T00:00:00.000Z',
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const FP = hexToBytes(GOLDEN.fpHex);
const KEYS = { 1: hexToBytes(GOLDEN.hmacKeyHex) };
const PUB = hexToBytes(GOLDEN.rawPubHex);

describe('短码验证与服务端互通', () => {
  it('正确指纹+密钥验证服务端签发的短码,字段与到期正确', () => {
    const r = verifyShortcode(GOLDEN.serial, FP, KEYS);
    expect(r.valid).toBe(true);
    expect(r.fields?.durDays).toBe(30);
    expect(r.fields?.app).toBe(1);
    expect(r.expireAt?.toISOString()).toBe(GOLDEN.expectExpireISO);
  });

  it('换一台机器(指纹不同)验证失败', () => {
    const r = verifyShortcode(GOLDEN.serial, hexToBytes('8877665544332211'), KEYS);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('signature');
  });

  it('改一个字符 -> 校验位先报错', () => {
    const noDash = GOLDEN.serial.replace(/-/g, '');
    const flipped = (noDash[0] === 'A' ? 'B' : 'A') + noDash.slice(1);
    const r = verifyShortcode(flipped, FP, KEYS);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('checksum');
  });

  it('未知密钥版本 -> unknown-key', () => {
    const r = verifyShortcode(GOLDEN.serial, FP, {});
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown-key');
  });

  it('接受小写与缺横线输入', () => {
    const r = verifyShortcode(GOLDEN.serial.replace(/-/g, '').toLowerCase(), FP, KEYS);
    expect(r.valid).toBe(true);
  });
});

describe('Ed25519 令牌验证与服务端互通', () => {
  it('正确公钥验证服务端签发的令牌,payload 还原', () => {
    const r = verifyToken(GOLDEN.token, PUB);
    expect(r.valid).toBe(true);
    expect(r.payload?.mid).toBe(GOLDEN.fpHex);
    expect(r.payload?.app).toBe('video');
    expect(r.payload?.durDays).toBe(30);
    // 桌面侧二次校验:mid 必须等于本机指纹
    expect(r.payload?.mid).toBe(GOLDEN.fpHex);
  });

  it('错误公钥 -> 验签失败', () => {
    const wrong = new Uint8Array(32).fill(7);
    expect(verifyToken(GOLDEN.token, wrong).valid).toBe(false);
  });

  it('篡改 payload -> 验签失败', () => {
    const [, s] = GOLDEN.token.split('.');
    const tampered = `${btoa('{"mid":"deadbeefdeadbeef","exp":9999999999}')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')}.${s}`;
    expect(verifyToken(tampered, PUB).valid).toBe(false);
  });

  it('畸形 token -> invalid,不抛错', () => {
    expect(verifyToken('garbage', PUB).valid).toBe(false);
    expect(verifyToken('', PUB).valid).toBe(false);
  });
});
