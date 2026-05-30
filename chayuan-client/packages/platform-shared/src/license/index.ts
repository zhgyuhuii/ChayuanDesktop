// 桌面端授权验证核心(离线可用)。与服务端 server/license/ 字节兼容。
// 桌面只做"验证 + 算到期",签发在服务端。

export { decode, checkChar } from './base32';
export { unpack, issueToDate, EPOCH_MS, type LicenseFields } from './codec';
export { verifyShortcode, type ShortcodeResult } from './shortcode';
export { verifyToken, type TokenPayload, type TokenResult } from './token';
