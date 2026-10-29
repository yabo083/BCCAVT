/**
 * 页面评论的跨世界契约：写意图 / 写结果、作者入口（用户卡片）、定位与待办定位等桥消息的守卫，
 * 以及定位用的视频身份解析。
 */
import { describe, expect, it } from 'vitest';
import {
  READER_BRIDGE_SOURCE,
  READER_COMMENT_MAX_LENGTH,
  READER_LOCATE,
  READER_USER_CARD,
  READER_WRITE_REQUEST,
  READER_WRITE_RESULT,
  USER_CARD_BRIDGE_SOURCE,
  isPendingLocate,
  isReaderLocateMessage,
  isReaderUserCardMessage,
  isReaderWriteRequest,
  isReaderWriteResult,
  isUserCardBridgeMessage,
  videoIdOf,
} from '@/extension/page-comments';

/** 写意图消息的公共前缀：source + type + requestId 都由这里给，各用例只补 op 与载荷。 */
const writeRequestBase = { source: READER_BRIDGE_SOURCE, type: READER_WRITE_REQUEST, requestId: 'req-1' } as const;

describe('写意图桥（READER_WRITE_REQUEST）的守卫', () => {
  it('点赞 / 取消点赞只认 commentId，多余字段一律拒绝', () => {
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like', commentId: '123' })).toBe(true);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'unlike', commentId: '123' })).toBe(true);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like', commentId: 'abc' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like', commentId: 123 })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like', commentId: '123', text: '你好' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like', commentId: '123', rootId: '1' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'like', commentId: '123', parentId: '1' })).toBe(false);
  });

  it('reply：顶层评论只给正文，楼中楼必须成对给出 rootId / parentId', () => {
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: '你好' })).toBe(true);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', rootId: '1', parentId: '2', text: '你好' })).toBe(true);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: '' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: '   ' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: 42 })).toBe(false);
    // 只给一半 = 发送方状态不一致：宁可拒绝也不猜是哪一种回复
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', rootId: '1', text: '你好' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', parentId: '2', text: '你好' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', rootId: '1', parentId: 'x', text: '你好' })).toBe(false);
    // 回复目标走 parentId，不走 commentId
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', commentId: '2', text: '你好' })).toBe(false);
  });

  it('正文按 UTF-16 码元计长：等于上限放行，超一个字符就拒绝', () => {
    const atLimit = 'x'.repeat(READER_COMMENT_MAX_LENGTH);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: atLimit })).toBe(true);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: `${atLimit}x` })).toBe(false);
    // emoji 记 2，与输入框 maxlength 的计数方式一致
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: '😀'.repeat(READER_COMMENT_MAX_LENGTH / 2) })).toBe(true);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'reply', text: '😀'.repeat(READER_COMMENT_MAX_LENGTH / 2 + 1) })).toBe(false);
  });

  it('op 必须是枚举值，requestId 必须是非空且不太长的字符串', () => {
    expect(isReaderWriteRequest({ ...writeRequestBase, op: 'report', commentId: '123' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, op: undefined, commentId: '123' })).toBe(false);
    for (const requestId of ['', 1, null, undefined, 'x'.repeat(65)]) {
      expect(isReaderWriteRequest({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_REQUEST, requestId, op: 'like', commentId: '1' })).toBe(false);
    }
    expect(
      isReaderWriteRequest({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_REQUEST, requestId: 'x'.repeat(64), op: 'reply', text: '你好' }),
    ).toBe(true);
  });

  it('source / type 不符或根本不是对象的一律拒绝', () => {
    expect(isReaderWriteRequest({ ...writeRequestBase, source: 'other', op: 'like', commentId: '1' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, type: READER_WRITE_RESULT, op: 'like', commentId: '1' })).toBe(false);
    expect(isReaderWriteRequest({ ...writeRequestBase, type: 'loupe:reader-ready', op: 'like', commentId: '1' })).toBe(false);
    expect(isReaderWriteRequest(null)).toBe(false);
    expect(isReaderWriteRequest('loupe:reader-write')).toBe(false);
    expect(isReaderWriteRequest([])).toBe(false);
  });
});

describe('写结果桥（READER_WRITE_RESULT）的守卫', () => {
  const resultBase = { source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: 'req-1' } as const;

  it('点赞结果不带评论，回复结果带至少含 id 的评论', () => {
    expect(isReaderWriteResult({ ...resultBase, ok: true })).toBe(true);
    expect(isReaderWriteResult({ ...resultBase, ok: true, comment: { id: '456' } })).toBe(true);
    expect(isReaderWriteResult({ ...resultBase, ok: true, comment: {} })).toBe(false);
    expect(isReaderWriteResult({ ...resultBase, ok: true, comment: null })).toBe(false);
    expect(isReaderWriteResult({ ...resultBase, ok: true, comment: '456' })).toBe(false);
  });

  it('失败必须带一句可展示的原因', () => {
    expect(isReaderWriteResult({ ...resultBase, ok: false, error: '触发 Bilibili 风控，请稍后再试' })).toBe(true);
    expect(isReaderWriteResult({ ...resultBase, ok: false })).toBe(false);
    expect(isReaderWriteResult({ ...resultBase, ok: false, error: '' })).toBe(false);
    expect(isReaderWriteResult({ ...resultBase, ok: false, error: 500 })).toBe(false);
  });

  it('ok 必须是布尔，requestId 与 source / type 照旧校验', () => {
    expect(isReaderWriteResult({ ...resultBase, ok: 'true' })).toBe(false);
    expect(isReaderWriteResult({ ...resultBase, ok: true, requestId: '' })).toBe(false);
    expect(isReaderWriteResult({ source: 'other', type: READER_WRITE_RESULT, requestId: 'r', ok: true })).toBe(false);
    expect(isReaderWriteResult({ ...resultBase, type: READER_WRITE_REQUEST, ok: true })).toBe(false);
    expect(isReaderWriteResult(null)).toBe(false);
  });
});

describe('作者入口（用户卡片）的桥守卫', () => {
  const rect = { left: 1, top: 2, width: 3, height: 4 };

  it('嵌入页 → 内容脚本：显示要求 mid + rect，收起要求 mid（迟到的收起不能关掉别人）', () => {
    expect(isReaderUserCardMessage({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect })).toBe(true);
    expect(isReaderUserCardMessage({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: null })).toBe(true);

    // mid 必须是纯数字（bilibili 的 mid），且**收起时也不能省**——省了就会被守卫整条丢掉
    expect(isReaderUserCardMessage({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, rect: null })).toBe(false);
    expect(isReaderUserCardMessage({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: 'abc', rect })).toBe(false);
    expect(isReaderUserCardMessage({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042' })).toBe(false);
    expect(isReaderUserCardMessage({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: { left: 1, top: 2 } })).toBe(false);
    expect(isReaderUserCardMessage({ source: 'loupe-other', type: READER_USER_CARD, mid: '703148042', rect })).toBe(false);
  });

  it('隔离世界 → 主世界：show 必带 mid + rect，hide 可带可不带 mid', () => {
    expect(isUserCardBridgeMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: '703148042', rect })).toBe(true);
    expect(isUserCardBridgeMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: '703148042' })).toBe(false);
    expect(isUserCardBridgeMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: 'abc', rect })).toBe(false);

    // 带 mid = 只收起这一位；不带 = 全局收起（槽位被拆 / 宿主滚动）
    expect(isUserCardBridgeMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide', mid: '703148042' })).toBe(true);
    expect(isUserCardBridgeMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide' })).toBe(true);
    expect(isUserCardBridgeMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide', mid: 'abc' })).toBe(false);
    expect(isUserCardBridgeMessage({ source: 'loupe-other', type: 'hide' })).toBe(false);
  });
});

describe('定位桥（READER_LOCATE）的守卫', () => {
  it('只认本 source 的定位消息，且评论 id 必须是纯数字', () => {
    expect(isReaderLocateMessage({ source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId: '316401376609' })).toBe(true);
    // 评论 id 在边界一律要求纯数字：非数字、缺字段、类型不符都当伪造
    expect(isReaderLocateMessage({ source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId: 316401376609 })).toBe(false);
    expect(isReaderLocateMessage({ source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId: '' })).toBe(false);
    expect(isReaderLocateMessage({ source: READER_BRIDGE_SOURCE, type: READER_LOCATE })).toBe(false);
    expect(isReaderLocateMessage({ source: 'loupe-other', type: READER_LOCATE, commentId: '1' })).toBe(false);
    expect(isReaderLocateMessage({ source: READER_BRIDGE_SOURCE, type: 'loupe:reader-navigation', commentId: '1' })).toBe(false);
    expect(isReaderLocateMessage(null)).toBe(false);
    expect(isReaderLocateMessage('loupe:reader-locate')).toBe(false);
  });
});

describe('待办定位（LOCATE_PENDING_KEY）的守卫', () => {
  const pending = { input: 'https://www.bilibili.com/video/BV1UbpP6EEGu/', commentId: '316401376609', nonce: 'n-1' };

  it('地址、评论 id、nonce 三者齐全才算一条待办', () => {
    expect(isPendingLocate(pending)).toBe(true);
  });

  it('缺一项或类型不符一律拒绝（半个待办宁可丢掉，也不能猜）', () => {
    for (const value of [
      { ...pending, input: '' },
      { ...pending, input: 42 },
      { ...pending, commentId: 'abc' },
      { ...pending, commentId: 316401376609 },
      { ...pending, nonce: '' },
      { ...pending, nonce: 1 },
      { input: pending.input, commentId: pending.commentId },
      { input: pending.input, nonce: pending.nonce },
      { commentId: pending.commentId, nonce: pending.nonce },
      null,
      'loupe.locatePending',
      [],
    ]) {
      expect(isPendingLocate(value)).toBe(false);
    }
  });
});

describe('videoIdOf：定位用的视频身份', () => {
  it('取 BV 号；分集参数、跟踪参数与评论锚点都不影响身份', () => {
    expect(videoIdOf('https://www.bilibili.com/video/BV1UbpP6EEGu/')).toBe('BV1UbpP6EEGu');
    expect(videoIdOf('https://www.bilibili.com/video/BV1UbpP6EEGu/?p=2&spm_id_from=333.999')).toBe('BV1UbpP6EEGu');
    expect(videoIdOf('https://www.bilibili.com/video/BV1UbpP6EEGu?comment_root_id=316401376609#reply316401376609')).toBe(
      'BV1UbpP6EEGu',
    );
    // 前缀统一成大写，与适配器的 BV 号规则一致
    expect(videoIdOf('https://www.bilibili.com/video/bv1UbpP6EEGu/')).toBe('BV1UbpP6EEGu');
  });

  it('不是 www.bilibili.com 的视频页、或路径段不是合法 BV 号时返回 null', () => {
    for (const value of [
      'https://www.bilibili.com/bangumi/play/ep1',
      'https://m.bilibili.com/video/BV1UbpP6EEGu',
      'https://www.bilibili.com/video/av123456',
      'https://www.bilibili.com/video/BV1UbpP6EEG',
      'https://evil.example/video/BV1UbpP6EEGu',
      'not a url',
      '',
    ]) {
      expect(videoIdOf(value)).toBeNull();
    }
  });
});
