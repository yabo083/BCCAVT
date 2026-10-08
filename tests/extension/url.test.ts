import { describe, expect, it } from 'vitest';
import { canonicalVideoUrl, isVideoPageUrl } from '@/extension/url';
import { parseTarget } from '@/platforms/bilibili/url';

const VIDEO = 'https://www.bilibili.com/video/BV1UbpP6EEGu/';

describe('canonicalVideoUrl', () => {
  it('保留分集参数，丢掉 hash 与评论锚点 query', () => {
    const dirty = `${VIDEO}?p=2&comment_root_id=316401376609&comment_secondary_id=1#reply316401376609`;
    expect(canonicalVideoUrl(dirty)).toBe(`${VIDEO}?p=2`);
  });

  it('归一化后仍是「评论区」目标，不会因为锚点误跑评论树', () => {
    const dirty = `${VIDEO}#reply316401376609`;
    expect(parseTarget(dirty)?.kind).toBe('thread');
    const clean = canonicalVideoUrl(dirty);
    expect(clean).not.toBeNull();
    expect(parseTarget(clean ?? '')?.kind).toBe('subject');
  });

  it('非视频页与非法输入返回 null', () => {
    expect(canonicalVideoUrl('https://www.bilibili.com/read/cv1')).toBeNull();
    expect(canonicalVideoUrl('https://evil.example/video/BV1UbpP6EEGu')).toBeNull();
    expect(canonicalVideoUrl('https://www.bilibili.com.evil.example/video/BV1UbpP6EEGu')).toBeNull();
    expect(canonicalVideoUrl('not a url')).toBeNull();
  });
});

describe('isVideoPageUrl', () => {
  it('只认 www.bilibili.com 的视频页', () => {
    expect(isVideoPageUrl(VIDEO)).toBe(true);
    expect(isVideoPageUrl('https://www.bilibili.com/bangumi/play/ep1')).toBe(false);
    expect(isVideoPageUrl('https://space.bilibili.com/1')).toBe(false);
  });
});
