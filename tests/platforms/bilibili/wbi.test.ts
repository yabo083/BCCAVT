import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keyFromWbiUrl, mixinKey, signQuery, type WbiKeys } from '@/platforms/bilibili/wbi';

/** 公开文档里的示例密钥对。 */
const KEYS: WbiKeys = { imgKey: '7cd084941338484aae1ad9425b84077c', subKey: '4932caff0ff746eab6f01bf08b70ac45' };

const MAIN_PARAMS = {
  oid: '80433022',
  type: 1,
  mode: 2,
  pagination_str: '{"offset":""}',
  plat: 1,
  web_location: 1315875,
};

describe('mixinKey', () => {
  it('按官方打乱表重排并取前 32 位', () => {
    expect(mixinKey(KEYS)).toBe('ea1db124af3c7062474693fa704f4ff8');
  });

  it('密钥短于打乱表时截断而不越界', () => {
    expect(mixinKey({ imgKey: '', subKey: '' })).toBe('');
  });
});

describe('keyFromWbiUrl', () => {
  it('取文件名（去扩展名）', () => {
    expect(keyFromWbiUrl('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png')).toBe(
      '7cd084941338484aae1ad9425b84077c',
    );
  });
});

describe('signQuery', () => {
  it('给定 wts 与密钥时签名确定', () => {
    expect(signQuery(MAIN_PARAMS, KEYS, 1700000000)).toBe(
      'mode=2&oid=80433022&pagination_str=%7B%22offset%22%3A%22%22%7D&plat=1&type=1&web_location=1315875' +
        '&wts=1700000000&w_rid=9dc30f9a57972f8eead6bc14924cc6cf',
    );
  });

  it('w_rid = md5(按键排序的查询串 + mixinKey)，用 node:crypto 独立校验', () => {
    const query = signQuery({ ...MAIN_PARAMS, pagination_str: '{"offset":"CAEaADICCB4="}' }, KEYS, 1700000001);
    const [base, rid] = query.split('&w_rid=');
    expect(rid).toBe(createHash('md5').update(`${base}${mixinKey(KEYS)}`, 'utf8').digest('hex'));
    expect(base).toContain('pagination_str=%7B%22offset%22%3A%22CAEaADICCB4%3D%22%7D');
    expect(base).toContain('wts=1700000001');
  });

  it('值里去掉 !\'()* 再编码', () => {
    expect(signQuery({ keyword: "a!b'c(d)e*f" }, KEYS, 1700000000)).toContain('keyword=abcdef');
  });

  it('调用方传入的 wts 被参数里的 wts 覆盖', () => {
    expect(signQuery({ ...MAIN_PARAMS, wts: 1 }, KEYS, 1700000000)).toContain('&wts=1700000000&');
  });

  it('参数按 key 排序', () => {
    const query = signQuery({ b: '2', a: '1' }, KEYS, 1700000000);
    expect(query.startsWith('a=1&b=2&wts=1700000000&w_rid=')).toBe(true);
  });
});
