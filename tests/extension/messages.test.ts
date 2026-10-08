import { describe, expect, it } from 'vitest';
import { ANALYZE_REQUEST, isAnalyzeRequestMessage, isCommentId } from '@/extension/messages';

const pageUrl = 'https://www.bilibili.com/video/BV1UbpP6EEGu/';

describe('isAnalyzeRequestMessage', () => {
  it('接受不带评论 id 的评论区请求', () => {
    expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'subject', pageUrl })).toBe(true);
  });

  it('评论树请求必须带纯数字评论 id', () => {
    expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'thread', commentId: '316401376609', pageUrl })).toBe(true);
    for (const commentId of [undefined, '', '316401376609a', ' 316401376609', '31_64', 316401376609]) {
      expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'thread', commentId, pageUrl })).toBe(false);
    }
  });

  it('评论区请求不接受评论 id，thread 之外的 kind 一律拒绝', () => {
    expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'subject', commentId: '1', pageUrl })).toBe(false);
    expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'all', pageUrl })).toBe(false);
    expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'thread', commentId: '1' })).toBe(false);
    expect(isAnalyzeRequestMessage({ type: ANALYZE_REQUEST, kind: 'thread', commentId: '1', pageUrl: '' })).toBe(false);
    expect(isAnalyzeRequestMessage({ type: 'loupe:other', kind: 'subject', pageUrl })).toBe(false);
    expect(isAnalyzeRequestMessage(null)).toBe(false);
  });
});

describe('isCommentId', () => {
  it('只认纯数字字符串', () => {
    expect(isCommentId('316401376609')).toBe(true);
    expect(isCommentId('0')).toBe(true);
    expect(isCommentId(316401376609)).toBe(false);
    expect(isCommentId('')).toBe(false);
    expect(isCommentId('-1')).toBe(false);
    expect(isCommentId('1.5')).toBe(false);
  });
});
