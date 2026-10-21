import { defineConfig } from 'vitest/config'

// *.spec.ts 单元测试 / unit tests only
// TSX 使用 @veren/prompt-core 的 JSX runtime：显式 esbuild 声明 + react 兼容别名双保护。
// TSX uses @veren/prompt-core's JSX runtime: explicit esbuild config plus react
// aliasing as double protection.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@veren/prompt-core',
  },
  resolve: {
    alias: [
      { find: /^react\/jsx-dev-runtime$/, replacement: '@veren/prompt-core/jsx-dev-runtime' },
      { find: /^react\/jsx-runtime$/, replacement: '@veren/prompt-core/jsx-runtime' },
    ],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
