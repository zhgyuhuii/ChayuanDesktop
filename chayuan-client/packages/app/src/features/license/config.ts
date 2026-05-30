// 桌面授权配置（由网站后台「支付配置 → 一键生成授权密钥」生成）。
//
// 怎么填：
//   1) 进网站后台 /update → 支付配置 → 点「一键生成授权密钥」。
//   2) 把回显的「桌面内嵌公钥」hex 填到 LICENSE_PUBLIC_KEY_HEX；
//      或直接点后台的「复制 config.ts」，整段覆盖本文件。
//   3) 同时把回显的 HMAC 密钥配到桌面构建环境变量 LICENSE_HMAC_KEY_V1
//      （编进 Rust 二进制，见 docs/license-rust-handoff.md）。
//
// ENTITLEMENT_BASE_URL / BUY_BASE_URL：收款+授权后端地址（默认 aidooo.com；
// 内网部署改成内网中继地址）。

/** 服务端 Ed25519 公钥（64 hex）。占位值需替换成后台生成的真实公钥后才能在线/文件激活。 */
export const LICENSE_PUBLIC_KEY_HEX = '__INJECT_REAL_ED25519_PUBKEY_HEX__';

/** 在线授权拉取 / 购买页基址。内网部署改中继地址。 */
export const ENTITLEMENT_BASE_URL = 'https://aidooo.com';
export const BUY_BASE_URL = 'https://aidooo.com';

/** 是否已填入真实公钥（占位时为 false，业务可据此提示"未配置授权公钥"）。 */
export const LICENSE_CONFIGURED = !LICENSE_PUBLIC_KEY_HEX.startsWith('__');

/** 把内嵌公钥 hex 转成字节数组，供 verifyToken 使用。 */
export function publicKeyBytes(): Uint8Array {
  const h = LICENSE_PUBLIC_KEY_HEX;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
