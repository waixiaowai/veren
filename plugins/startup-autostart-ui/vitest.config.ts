/**
 * Vitest configuration for the panel package.
 *
 * The shared environment stays `node`; component specs would opt into the DOM
 * per file with a `// @vitest-environment jsdom` pragma, matching the Client
 * test convention in the checkout. This package currently ships DOM-free specs,
 * so no DOM library is part of its dependency set.
 *
 * 面板包的 Vitest 配置。
 *
 * 共享环境保持 `node`；组件测试按检出仓库的客户端测试约定，在文件首行用
 * `// @vitest-environment jsdom` 单独切换。当前本包只有不依赖 DOM 的 spec，
 * 因此 DOM 相关依赖不进入本包依赖表。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
  },
})
