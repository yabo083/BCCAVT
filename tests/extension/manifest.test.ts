/**
 * 清单契约：工具栏左键单击打开紧凑设置面板（action.default_popup），
 * 且彻底移除侧栏——既没有 side_panel，权限里也没有 sidePanel。
 */
import { describe, expect, it } from 'vitest';
import { createManifest } from '@/extension/manifest';

const manifest = createManifest('9.9.9');

describe('清单的工具栏与侧栏', () => {
  it('action 左键打开设置面板 config.html', () => {
    expect(manifest.action?.default_popup).toBe('src/ui/config.html');
  });

  it('不再声明侧栏：没有 side_panel，权限里也没有 sidePanel', () => {
    expect(manifest).not.toHaveProperty('side_panel');
    expect(manifest.permissions ?? []).not.toContain('sidePanel');
    expect(manifest.permissions).toContain('storage');
  });

  it('内容脚本仍是主世界 + 隔离世界两条，注入地址不变', () => {
    expect(manifest.content_scripts).toHaveLength(2);
    expect(manifest.content_scripts?.[0]?.world).toBe('MAIN');
    expect(manifest.content_scripts?.[0]?.js).toEqual(['content/main.js']);
    expect(manifest.content_scripts?.[1]?.js).toEqual(['content/isolated.js']);
  });
});
