// Ed25519 强签名令牌验证(在线/中继/文件/气隙四档)—— 与服务端 server/license/token.js 兼容。
// 桌面只需内嵌 *公钥*,无任何机密。

import { ed25519 } from '@noble/curves/ed25519.js';

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface TokenPayload {
  v: number;
  app: string;
  mid: string;
  durDays?: number;
  iat?: number;
  exp: number;
  oid?: string;
  src?: string;
  nonce?: number;
}

export interface TokenResult {
  valid: boolean;
  payload?: TokenPayload;
}

/**
 * 验证 Ed25519 令牌签名。仅验签名 + 解析 payload;
 * 调用方还须二次校验 payload.mid == 本机指纹、payload.exp > now。
 * @param publicKeyRaw 32 字节原始 Ed25519 公钥(打包时内嵌)
 */
export function verifyToken(token: string, publicKeyRaw: Uint8Array): TokenResult {
  try {
    const [p, s] = token.split('.');
    if (!p || !s) return { valid: false };
    const msg = base64UrlToBytes(p);
    const sig = base64UrlToBytes(s);
    if (!ed25519.verify(sig, msg, publicKeyRaw)) return { valid: false };
    const payload = JSON.parse(new TextDecoder().decode(msg)) as TokenPayload;
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}
