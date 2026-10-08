/**
 * 平台注册表。新增平台 = 实现一个 PlatformAdapter 并加进这个数组，没有动态加载。
 */
import type { PlatformAdapter } from '../core/platform';
import { bilibiliAdapter } from './bilibili';

export const adapters: readonly PlatformAdapter[] = [bilibiliAdapter];
