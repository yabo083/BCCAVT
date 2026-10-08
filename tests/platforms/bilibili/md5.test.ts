import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5Hex } from '@/platforms/bilibili/md5';

/** RFC 1321 附录 A.5 的测试向量。 */
const RFC1321: [string, string][] = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
];

describe('md5Hex', () => {
  it.each(RFC1321)('RFC 1321 向量：%j', (input, expected) => {
    expect(md5Hex(input)).toBe(expected);
  });

  it('在 padding 边界与多字节文本上与 node:crypto 一致', () => {
    // 中文每字 3 字节，覆盖 55/56/63/64 等长度边界。
    for (const count of [0, 1, 18, 19, 20, 21, 40, 100]) {
      const text = '中'.repeat(count);
      expect(md5Hex(text)).toBe(createHash('md5').update(text, 'utf8').digest('hex'));
    }
  });

  it('接受字节输入', () => {
    expect(md5Hex(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});
