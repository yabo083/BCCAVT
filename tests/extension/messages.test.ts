import { describe, expect, it } from 'vitest';
import {
  ANALYZE_REQUEST,
  LOCATE_COMMENT,
  isAnalyzeRequestMessage,
  isCommentId,
  isLocateCommentRequest,
  isLocateCommentResponse,
} from '@/extension/messages';

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

describe('isLocateCommentRequest', () => {
  const request = { type: LOCATE_COMMENT, input: pageUrl, commentId: '316401376609' };

  it('非空地址 + 纯数字评论 id 才算一次定位请求', () => {
    expect(isLocateCommentRequest(request)).toBe(true);
  });

  it('评论 id 非纯数字、地址为空、type 不符或根本不是对象的一律拒绝', () => {
    for (const value of [
      { ...request, commentId: 'abc' },
      { ...request, commentId: 316401376609 },
      { ...request, commentId: undefined },
      { ...request, input: '' },
      { ...request, input: 42 },
      { ...request, type: ANALYZE_REQUEST },
      { input: pageUrl, commentId: '316401376609' },
      null,
      [],
      'loupe:locate-comment',
    ]) {
      expect(isLocateCommentRequest(value)).toBe(false);
    }
  });
});

describe('isLocateCommentResponse', () => {
  it('成功不带载荷', () => {
    expect(isLocateCommentResponse({ ok: true })).toBe(true);
    expect(isLocateCommentResponse({ ok: true, error: '不该有' })).toBe(false);
  });

  it('失败必须带一句可展示的原因', () => {
    expect(isLocateCommentResponse({ ok: false, error: '无法在评论区定位，请刷新那个视频页后重试' })).toBe(true);
    expect(isLocateCommentResponse({ ok: false })).toBe(false);
    expect(isLocateCommentResponse({ ok: false, error: '' })).toBe(false);
    expect(isLocateCommentResponse({ ok: false, error: 500 })).toBe(false);
    expect(isLocateCommentResponse({ ok: 'true' })).toBe(false);
    expect(isLocateCommentResponse(null)).toBe(false);
    expect(isLocateCommentResponse(undefined)).toBe(false);
  });
});
