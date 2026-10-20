import { defineConfig } from 'vitest/config'

// *.e2e.ts 真实 API 测试（花 token，无凭据自跳过，retry: 2）
// TSX 使用 @veren/prompt-core 的 JSX runtime（与 vitest.config.ts 同款映射）
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
    include: ['tests/**/*.e2e.ts'],
    testTimeout: 120_000,
    retry: 2,
    hookTimeout: 30_000,
  },
})
