/**
 * 极简 MD5：WebCrypto 不提供 MD5，而 Bilibili 的 WBI 签名（w_rid）要求它。
 * 只用于对参数串求摘要，因此仅实现字符串 / 字节输入与十六进制输出。
 */

/** 每轮的左移位数。 */
const SHIFT = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

/** K[i] = floor(2^32 * |sin(i + 1)|)，标准 MD5 常数表。 */
const K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

function rotl(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function wordHex(word: number): string {
  let hex = '';
  for (let i = 0; i < 4; i += 1) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return hex;
}

/** UTF-8 文本或字节的 MD5，小写十六进制。 */
export function md5Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  // 追加 0x80 与 64 位小端比特长度，补零到 64 字节的整数倍。
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (f + a + K[i]! + view.getUint32(offset + g * 4, true)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(sum, SHIFT[i]!)) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
}
