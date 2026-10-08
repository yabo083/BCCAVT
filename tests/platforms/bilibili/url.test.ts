import { describe, expect, it } from 'vitest';
import { parseTarget } from '@/platforms/bilibili/url';
import type { Target } from '@/core/model';

const VIDEO = { platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' } as const;

const subject = (id: string): Target => ({ kind: 'subject', subject: { platform: 'bilibili', kind: 'video', id } });
const thread = (id: string, commentId: string): Target => ({
  kind: 'thread',
  subject: { platform: 'bilibili', kind: 'video', id },
  commentId,
});

const cases: [string, Target | null][] = [
  ['BV1GJ411x7h7', { kind: 'subject', subject: VIDEO }],
  ['  BV1GJ411x7h7\n', { kind: 'subject', subject: VIDEO }],
  ['bv1GJ411x7h7', { kind: 'subject', subject: VIDEO }],
  ['av170001', subject('av170001')],
  ['AV00170001', subject('av170001')],
  ['https://www.bilibili.com/video/BV1GJ411x7h7', { kind: 'subject', subject: VIDEO }],
  ['https://www.bilibili.com/video/BV1GJ411x7h7/', { kind: 'subject', subject: VIDEO }],
  ['https://www.bilibili.com/video/BV1GJ411x7h7/?p=1&t=12', { kind: 'subject', subject: VIDEO }],
  ['http://m.bilibili.com/video/BV1GJ411x7h7?from=search', { kind: 'subject', subject: VIDEO }],
  ['www.bilibili.com/video/bv1GJ411x7h7', { kind: 'subject', subject: VIDEO }],
  ['bilibili.com/video/av170001', subject('av170001')],
  ['https://www.bilibili.com/video/BV1GJ411x7h7#reply3760801399', thread('BV1GJ411x7h7', '3760801399')],
  ['https://www.bilibili.com/video/BV1GJ411x7h7?comment_root_id=3760801399', thread('BV1GJ411x7h7', '3760801399')],
  [
    'https://www.bilibili.com/video/BV1GJ411x7h7?comment_root_id=3760801399&comment_secondary_id=4065967309',
    thread('BV1GJ411x7h7', '4065967309'),
  ],
  ['https://www.bilibili.com/video/BV1GJ411x7h7?comment_secondary_id=4065967309', thread('BV1GJ411x7h7', '4065967309')],
  ['https://www.bilibili.com/video/av170001#reply12', thread('av170001', '12')],
  ['https://www.bilibili.com/video/BV1GJ411x7h7?comment_root_id=abc#reply12', thread('BV1GJ411x7h7', '12')],
  [
    'https://www.bilibili.com/video/BV1GJ411x7h7?comment_root_id=3760801399#reply12',
    thread('BV1GJ411x7h7', '3760801399'),
  ],
  // 无法离线解析 / 非视频页
  ['https://b23.tv/av12345', null],
  ['b23.tv/BV1GJ411x7h7', null],
  ['https://www.bilibili.com/bangumi/play/ep123456', null],
  ['https://space.bilibili.com/12345', null],
  ['https://www.bilibili.com/video/', null],
  ['https://www.bilibili.com/video/BV1GJ411x7h', null],
  ['https://www.bilibili.com/video/BV1GJ411x7h70', null],
  ['BV1GJ411x7hO', null],
  ['BV1GJ411x7h0', null],
  ['not a url', null],
  ['av', null],
  ['https://evilbilibili.com/video/BV1GJ411x7h7', null],
  ['', null],
  ['   ', null],
];

describe('parseTarget', () => {
  it.each(cases)('%j', (input, expected) => {
    expect(parseTarget(input)).toEqual(expected);
  });
});
