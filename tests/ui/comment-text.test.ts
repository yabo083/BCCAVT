import { describe, expect, it } from 'vitest';
import { tokenizeComment, splitMention } from '@/ui/comment-text';
import type { Emote } from '@/core/model';

const EMOTES: Record<string, Emote> = {
  '[支持]': { url: 'https://i0.hdslb.com/a.png' },
  '[支]': { url: 'https://i0.hdslb.com/c.png' },
  '[doge]': { url: 'https://i0.hdslb.com/b.png', width: 20, height: 20 },
};

describe('tokenizeComment', () => {
  it('没有表情时整段是文本，空输入产出空列表', () => {
    expect(tokenizeComment('普通文本', {})).toEqual([{ kind: 'text', text: '普通文本' }]);
    expect(tokenizeComment('普通文本')).toEqual([{ kind: 'text', text: '普通文本' }]);
    expect(tokenizeComment('')).toEqual([]);
  });

  it('命中表情 token，未命中的括号原样保留', () => {
    expect(tokenizeComment('支持[支持]你', EMOTES)).toEqual([
      { kind: 'text', text: '支持' },
      { kind: 'emote', token: '[支持]', url: 'https://i0.hdslb.com/a.png' },
      { kind: 'text', text: '你' },
    ]);
    expect(tokenizeComment('[未知]', EMOTES)).toEqual([{ kind: 'text', text: '[未知]' }]);
  });

  it('最长字面量优先：[支持] 不会被更短的 [支] 抢先切走', () => {
    expect(tokenizeComment('[支持]', EMOTES)).toEqual([
      { kind: 'emote', token: '[支持]', url: 'https://i0.hdslb.com/a.png' },
    ]);
    expect(tokenizeComment('[支]', EMOTES)).toEqual([{ kind: 'emote', token: '[支]', url: 'https://i0.hdslb.com/c.png' }]);
  });

  it('相邻与重复的 token 各自成段，宽高随段带出', () => {
    expect(tokenizeComment('[支持][支持][doge]', EMOTES)).toEqual([
      { kind: 'emote', token: '[支持]', url: 'https://i0.hdslb.com/a.png' },
      { kind: 'emote', token: '[支持]', url: 'https://i0.hdslb.com/a.png' },
      { kind: 'emote', token: '[doge]', url: 'https://i0.hdslb.com/b.png', width: 20, height: 20 },
    ]);
  });

  it('缺省尺寸的 token 不带 width/height 字段', () => {
    const [segment] = tokenizeComment('[支持]', EMOTES);
    expect(segment).toEqual({ kind: 'emote', token: '[支持]', url: 'https://i0.hdslb.com/a.png' });
    expect(segment && 'width' in segment).toBe(false);
  });

  it('token 里的正则元字符只按字面比较', () => {
    const literal = { 'a.c': { url: 'https://i0.hdslb.com/d.png' } };
    expect(tokenizeComment('axc a.c', literal)).toEqual([
      { kind: 'text', text: 'axc ' },
      { kind: 'emote', token: 'a.c', url: 'https://i0.hdslb.com/d.png' },
    ]);
  });

  it('Unicode emoji（ZWJ / VS16 / 代理对 / 区域指示符）原样保留并可无损重拼', () => {
    const leading = '👨👩👧👦❤️🏳️🌈🇨🇳';
    const text = `${leading}[支持]👍`;
    const segments = tokenizeComment(text, EMOTES);
    expect(segments[0]).toEqual({ kind: 'text', text: leading });
    expect(segments.filter((segment) => segment.kind === 'emote')).toHaveLength(1);
    expect(segments.map((segment) => (segment.kind === 'text' ? segment.text : segment.token)).join('')).toBe(text);
  });

  it('HTML 只作为文本，不产生任何结构', () => {
    expect(tokenizeComment('<b>[[c:1]]</b>', EMOTES)).toEqual([{ kind: 'text', text: '<b>[[c:1]]</b>' }]);
  });
});

describe('splitMention', () => {
  it('全角冒号：拆出提及名，正文去掉前缀', () => {
    expect(splitMention('回复 @阿蓝：同意你的看法')).toEqual({ mention: '阿蓝', body: '同意你的看法' });
  });

  it('半角冒号与「回复」后的空白变体都认', () => {
    expect(splitMention('回复@阿蓝:同意')).toEqual({ mention: '阿蓝', body: '同意' });
    expect(splitMention('回复   @阿蓝   :   同意')).toEqual({ mention: '阿蓝', body: '同意' });
  });

  it('缺冒号 / 不以「回复 @」开头：原样返回，mention 为 null', () => {
    expect(splitMention('回复 @阿蓝 同意')).toEqual({ mention: null, body: '回复 @阿蓝 同意' });
    expect(splitMention('@阿蓝 你这条说得对')).toEqual({ mention: null, body: '@阿蓝 你这条说得对' });
    expect(splitMention('普通评论')).toEqual({ mention: null, body: '普通评论' });
  });

  it('正文为空也命中：只留下提及名', () => {
    expect(splitMention('回复 @阿蓝：')).toEqual({ mention: '阿蓝', body: '' });
    expect(splitMention('回复 @阿蓝:   ')).toEqual({ mention: '阿蓝', body: '' });
  });

  it('多行正文完整保留（换行不被 \\. 截断）', () => {
    expect(splitMention('回复 @阿蓝：第一行\n第二行')).toEqual({ mention: '阿蓝', body: '第一行\n第二行' });
  });

  it('去前缀后的正文照旧交给 tokenizeComment：表情令牌仍成段，不被破坏', () => {
    const { mention, body } = splitMention('回复 @阿蓝：[支持]谢谢');
    expect(mention).toBe('阿蓝');
    expect(body).toBe('[支持]谢谢');
    expect(tokenizeComment(body, EMOTES)).toEqual([
      { kind: 'emote', token: '[支持]', url: 'https://i0.hdslb.com/a.png' },
      { kind: 'text', text: '谢谢' },
    ]);
  });

  it('无前缀时 body 与输入逐字相同（含表情令牌与 HTML）', () => {
    const raw = '<b>[支持]</b> 原样';
    const { mention, body } = splitMention(raw);
    expect(mention).toBeNull();
    expect(body).toBe(raw);
  });
});
