/**
 * 单测配置。组件测试要能编译 `.vue`（含 `<style scoped>`）并解析 `~icons/*` 虚拟模块，
 * 因此这里与 vite.config.ts 的 app 趟保持同一套插件——vitest 只读自己这份配置，
 * 不会去合并 vite.config.ts（那边是四趟构建用的）。
 * 环境默认 node（纯逻辑测试够用），DOM 相关的测试文件用 `// @vitest-environment happy-dom` 逐文件覆盖。
 */
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3' })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
