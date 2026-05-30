# 桌面授权 — Rust 原生层交接（须在有 Rust 工具链的环境执行）

本文给出 Plan 4 最后两块的**完整可执行代码**：① `apps/desktop/src-tauri` 的两个 Tauri 命令
（`license_fingerprint` / `license_verify_shortcode`），② Rust 就绪后的 TS 接线 diff。
TS 层（`@chayuan/license` 验证核心、`features/license` 编排/store/UI、`platform-tauri` 绑定）已完成并验证。

> ⚠️ 顺序铁律：**Rust 命令 + 真实公钥未就绪前，不要做 §3 接线**。否则 video-generation 会被锁死且无法激活
> （token 验签用占位 key 失败、`verifyShortcode` 调的命令不存在）。两者同批上。

---

## 0. 契约（不可改，否则与服务端 / 黄金向量不兼容）

- 短码 = `header(6B) || HMAC_SHA256(K, header||fp)[..8]` → Crockford Base32(无 I/L/O/U) + 1 位 mod-37 校验符，分组 `5-5-5-5-4`（去横线 24 字符）。
- header 6 字节位布局：`ver(4) app(6) durDays(14) issueDate(14) nonce(8)` + 低 2 位保留。
- `fp` = `hex(sha256(machine_uid))[..16]`（8 字节 → 16 hex）。**不进码**，验签时本机重建。
- `issueDate` = 距 `2026-01-01T00:00:00Z` 天数；`expireAt = issueDate*天 + durDays*天`。
- `LicenseCheck` 序列化字段须与 TS 一致：`{ valid: bool, reason?: string, expireAt?: string(ISO), source?: "shortcode" }`。

黄金向量（来自真实服务端 `server/license`，cargo test 必须通过）：

| 项 | 值 |
|---|---|
| HMAC key (hex, 32B) | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| fp (hex, 8B) | `1122334455667788` |
| serial | `2101W-0JWN1-MN2JP-9V4QW-MSGJ` |
| 期望 | `valid=true, durDays=30, issueDate=151, expireAt=2026-07-01T00:00:00Z` |

---

## 1. `Cargo.toml` 依赖

`apps/desktop/src-tauri/Cargo.toml` 的 `[dependencies]` 增加（`sha2`/`hex`/`machine-uid` 已有）：

```toml
hmac = "0.12"
subtle = "2"          # 常量时间比较
chrono = "0.4"        # expireAt 的 ISO 格式化
```

HMAC 密钥**编进二进制**：用 build 时环境变量注入，避免硬编码进源码仓库。
在 `build.rs` 末尾加（CI/本地构建前 export `LICENSE_HMAC_KEY_V1=<64 hex>`）：

```rust
// build.rs
println!(
    "cargo:rustc-env=LICENSE_HMAC_KEY_V1={}",
    std::env::var("LICENSE_HMAC_KEY_V1").unwrap_or_default()
);
```

源码里用 `env!("LICENSE_HMAC_KEY_V1")` 读取（见下）。生产用混淆/拆分进一步加固（后续）。

---

## 2. `src/license.rs`（新建模块）

```rust
// apps/desktop/src-tauri/src/license.rs
//! 桌面 B1 短码离线验签 + 机器指纹。必须与 server/license（Node）字节兼容。
//! Ed25519 令牌验签在前端 @chayuan/license（仅公钥），这里只做 HMAC 短码 + 指纹。

use chrono::{Duration, TimeZone, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const ENC: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK: &[u8; 37] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U";

/// 与 TS LicenseCheck 字段一致。
#[derive(Serialize, Default)]
pub struct LicenseCheck {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "expireAt", skip_serializing_if = "Option::is_none")]
    pub expire_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

fn fail(reason: &str) -> LicenseCheck {
    LicenseCheck { valid: false, reason: Some(reason.into()), ..Default::default() }
}

/// Crockford Base32 解码（O→0, I/L→1, 大小写不敏感）。
fn b32_decode(s: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut out = Vec::new();
    for ch in s.chars() {
        if ch == '-' { continue; }
        let c = ch.to_ascii_uppercase();
        let v = match c {
            '0'..='9' => (c as u8 - b'0') as u32,
            'O' => 0,
            'I' | 'L' => 1,
            _ => match ENC.iter().position(|&e| e == c as u8) {
                Some(p) => p as u32,
                None => return None,
            },
        };
        value = (value << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push(((value >> (bits - 8)) & 0xff) as u8);
            bits -= 8;
            value &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// mod-37 校验符（对全部数据字节）。
fn check_char(buf: &[u8]) -> u8 {
    let mut n: u64 = 0;
    for &b in buf { n = (n * 256 + b as u64) % 37; }
    CHECK[n as usize]
}

/// 本机指纹：hex(sha256(machine_uid))[..16]（8 字节 → 16 hex）。
pub fn fingerprint_hex() -> String {
    let id = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
    let digest = Sha256::digest(id.as_bytes());
    hex::encode(&digest[..8])
}

fn hmac_key() -> Vec<u8> {
    // 构建时由 LICENSE_HMAC_KEY_V1（64 hex）注入。
    hex::decode(env!("LICENSE_HMAC_KEY_V1")).unwrap_or_default()
}

/// 验证手输短码（B1）。key 版本须等于 header.ver（本期只有 v1）。
pub fn verify_shortcode_with(serial: &str, fp_hex: &str, key: &[u8]) -> LicenseCheck {
    let norm: String = serial.chars().filter(|&c| c != '-').collect::<String>().to_uppercase();
    if norm.len() != 24 { return fail("length"); }
    let body = match b32_decode(&norm[..23]) { Some(b) if b.len() == 14 => b, _ => return fail("decode") };
    if check_char(&body) != norm.as_bytes()[23] { return fail("checksum"); }

    let header = &body[..6];
    let given_tag = &body[6..14];

    // unpack header（6 字节 big-endian，>>2 去保留位）
    let mut v: u64 = 0;
    for &b in header { v = (v << 8) | b as u64; }
    v >>= 2;
    let nonce = v & 0xff; v >>= 8;
    let issue_date = (v & 0x3fff) as i64; v >>= 14;
    let dur_days = (v & 0x3fff) as i64; v >>= 14;
    let _app = v & 0x3f; v >>= 6;
    let ver = v & 0xf;
    let _ = nonce;
    if ver != 1 { return fail("unknown-key"); }

    // 重建被签消息：header || fp(8B)
    let fp = match hex::decode(fp_hex) { Ok(f) if f.len() == 8 => f, _ => return fail("decode") };
    let mut mac = match HmacSha256::new_from_slice(key) { Ok(m) => m, Err(_) => return fail("unknown-key") };
    mac.update(header);
    mac.update(&fp);
    let full = mac.finalize().into_bytes();
    let want = &full[..8];
    if want.ct_eq(given_tag).unwrap_u8() != 1 { return fail("signature"); }

    // expireAt = 2026-01-01 + (issueDate + durDays) 天
    let epoch = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let expire = epoch + Duration::days(issue_date + dur_days);
    LicenseCheck {
        valid: true,
        reason: None,
        expire_at: Some(expire.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        source: Some("shortcode".into()),
    }
}

// ── Tauri 命令 ───────────────────────────────────────────────
#[tauri::command]
pub fn license_fingerprint() -> String {
    fingerprint_hex()
}

#[tauri::command]
pub fn license_verify_shortcode(serial: String) -> LicenseCheck {
    let fp = fingerprint_hex();
    verify_shortcode_with(&serial, &fp, &hmac_key())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const FP: &str = "1122334455667788";
    const SERIAL: &str = "2101W-0JWN1-MN2JP-9V4QW-MSGJ";

    #[test]
    fn golden_serial_verifies() {
        let key = hex::decode(KEY_HEX).unwrap();
        let r = verify_shortcode_with(SERIAL, FP, &key);
        assert!(r.valid, "reason={:?}", r.reason);
        // 期望到期 2026-07-01（issueDate 151 + durDays 30）
        assert!(r.expire_at.unwrap().starts_with("2026-07-01T00:00:00"));
    }

    #[test]
    fn wrong_machine_fails() {
        let key = hex::decode(KEY_HEX).unwrap();
        let r = verify_shortcode_with(SERIAL, "8877665544332211", &key);
        assert!(!r.valid);
        assert_eq!(r.reason.as_deref(), Some("signature"));
    }

    #[test]
    fn tampered_char_fails_checksum() {
        let key = hex::decode(KEY_HEX).unwrap();
        let no_dash: String = SERIAL.chars().filter(|&c| c != '-').collect();
        let flipped = format!("{}{}", if &no_dash[..1] == "A" { "B" } else { "A" }, &no_dash[1..]);
        let r = verify_shortcode_with(&flipped, FP, &key);
        assert!(!r.valid);
        assert_eq!(r.reason.as_deref(), Some("checksum"));
    }
}
```

跑：`cd apps/desktop/src-tauri && LICENSE_HMAC_KEY_V1=$KEY_HEX cargo test license`（test 用 `verify_shortcode_with` 显式传 key，不依赖 env）。

---

## 3. 注册命令（`src/lib.rs`）

```rust
// 顶部
mod license;

// invoke_handler 的 generate_handler![] 里追加：
license::license_fingerprint,
license::license_verify_shortcode,
```

`capabilities/*.json` 若用白名单，放行这两个 command（参照现有 `chayuan_*` 命令的放行写法）。

---

## 4. TS 接线（**仅在 §2/§3 完成后**）

### 4.1 `packages/app/src/features/license/config.ts`（新建）

```ts
// 内嵌 Ed25519 公钥（验在线/文件令牌；仅公钥，非机密）+ 基址。
// 公钥 hex = 服务端 license_ed25519 公钥的原始 32 字节（与 server 对应）。
export const LICENSE_PUBLIC_KEY_HEX = '__INJECT_REAL_ED25519_PUBKEY_HEX__'; // 32B=64 hex
export const ENTITLEMENT_BASE_URL = 'https://pay.aidooo.com'; // 内网改中继
export const BUY_BASE_URL = 'https://pay.aidooo.com';

export function publicKeyBytes(): Uint8Array {
  const h = LICENSE_PUBLIC_KEY_HEX;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
```

### 4.2 `apps/desktop/src/main.tsx`（在 `setPlatform(platform)` 之后）

```ts
import { useLicenseStore } from '@chayuan/app/features/license'; // 若 app 无此 export，改为相对/桶导出
import { publicKeyBytes, ENTITLEMENT_BASE_URL } from '@chayuan/app/features/license/config';
// ...
if (platform.license) {
  useLicenseStore.getState().configure({
    host: platform.license,
    publicKey: publicKeyBytes(),
    entitlementBaseUrl: ENTITLEMENT_BASE_URL,
    fetchText: async (url) => {
      const res = await platform.net.fetch(url);
      return res.text();
    },
  });
}
```

### 4.3 用 `LicenseGate` 包住 video-generation

在 `packages/app/src/router/Chrome.tsx` 渲染 video-generation 内容处包一层：

```tsx
import { LicenseGate } from '../features/license';
// 渲染 video-generation 页面的分支外层：
<LicenseGate app="video">
  {/* 原 video-generation 内容 */}
</LicenseGate>
```

> `app="video"` 要与服务端 `payment.json` 的 `license.products.video.code` 对应（数字 code 在签发时进 header.app；字符串 'video' 在令牌 payload.app）。

---

## 5. 验收

1. `cargo test license` —— 3 个黄金向量测试过（短码验签字节兼容）。
2. dev 跑桌面：进 video-generation → 弹授权窗 → 扫码买 → 手输序列号 → 解锁；断网仍可用（离线短码）。
3. 改系统时间往回 → 提示"时钟回拨"。
4. 续费叠加：到期前再买，到期顺延。
5. 内网：`ENTITLEMENT_BASE_URL` 指向中继，联网自动激活仍工作。
