// Crockford Base32 解码 + mod-37 校验符 —— 必须与服务端 server/license/base32.js 字节兼容。
// 数字保留,去掉易混字母 I L O U;解码时 I/L->1 O->0,大小写不敏感。

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 符号
const CHECK = `${ENC}*~$=U`; // 37 符号(校验位用)

const DEC: Record<string, number> = {};
[...ENC].forEach((c, i) => {
  DEC[c] = i;
});
DEC.O = 0;
DEC.I = 1;
DEC.L = 1; // 输入容错别名

export function decode(str: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const raw of str.toUpperCase()) {
    if (raw === '-') continue;
    const v = DEC[raw];
    if (v === undefined) throw new Error(`invalid base32 symbol: ${raw}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

// 校验符 = 全部数据字节当大整数取模 37。
export function checkChar(buf: Uint8Array): string {
  let n = 0n;
  for (const b of buf) n = (n * 256n + BigInt(b)) % 37n;
  return CHECK[Number(n)] as string;
}
