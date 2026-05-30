// B1 离线短码验证(截断 HMAC)—— 与服务端 server/license/shortcode.js 字节兼容。
// 桌面只验证、不签发。机器指纹不在码里,验证时本机重建被签消息。

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { checkChar, decode } from './base32';
import { type LicenseFields, issueToDate, unpack } from './codec';

const DAY_MS = 86400000;

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export interface ShortcodeResult {
  valid: boolean;
  reason?: string;
  fields?: LicenseFields;
  expireAt?: Date;
}

/**
 * 验证手输短码。
 * @param serial 用户输入的序列号(可含/不含横线,大小写不限)
 * @param machineFp 本机指纹(8 字节)
 * @param hmacKeysById 版本号 -> HMAC 密钥(每个 32 字节)。密钥在打包时注入。
 */
export function verifyShortcode(
  serial: string,
  machineFp: Uint8Array,
  hmacKeysById: Record<number, Uint8Array>,
): ShortcodeResult {
  const norm = serial.replace(/-/g, '').toUpperCase();
  if (norm.length !== 24) return { valid: false, reason: 'length' };

  let body: Uint8Array;
  try {
    body = decode(norm.slice(0, 23));
  } catch {
    return { valid: false, reason: 'decode' };
  }
  if (body.length !== 14) return { valid: false, reason: 'decode' };
  if (checkChar(body) !== norm[23]) return { valid: false, reason: 'checksum' };

  const header = body.slice(0, 6);
  const givenTag = body.slice(6, 14);
  const fields = unpack(header);

  const key = hmacKeysById[fields.ver];
  if (!key) return { valid: false, reason: 'unknown-key' };

  const msg = new Uint8Array(header.length + machineFp.length);
  msg.set(header, 0);
  msg.set(machineFp, header.length);
  const tag = hmac(sha256, key, msg).slice(0, 8);
  if (!constantTimeEqual(tag, givenTag)) return { valid: false, reason: 'signature' };

  const expireAt = new Date(issueToDate(fields.issueDate).getTime() + fields.durDays * DAY_MS);
  return { valid: true, fields, expireAt };
}
