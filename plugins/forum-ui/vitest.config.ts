/**
 * Vitest configuration for the forum Web package.
 *
 * The specs cover the browser half's pure behaviors: the catalog read/poll
 * lifecycle, the hand-built Remote contribution, and the dictionaries. They
 * need no DOM, so the shared environment stays `node`; a future component spec
 * opts in per file with `// @vitest-environment jsdom`.
 *
 * 论坛 Web 包的 Vitest 配置。
 *
 * 测试覆盖浏览器半边的纯行为：目录读取/轮询生命周期、手写 Remote contribution 与词典。
 * 它们不需要 DOM，因此共享环境保持 `node`；将来的组件测试在文件首行用
 * `// @vitest-environment jsdom` 单独切换。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
