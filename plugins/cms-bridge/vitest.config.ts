/**
 * Vitest configuration for the cms-bridge package.
 *
 * The Host-side suites run without a DOM; the browser-half spec stubs `fetch`
 * and `EventSource` in the node environment. A future component spec would opt
 * into jsdom per file with `// @vitest-environment jsdom`.
 *
 * cms-bridge 包的 Vitest 配置。
 *
 * 宿主侧测试不需要 DOM；浏览器半边的测试在 node 环境里替换 `fetch` 与 `EventSource`。
 * 将来的组件测试会在文件首行用 `// @vitest-environment jsdom` 单独切换。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
