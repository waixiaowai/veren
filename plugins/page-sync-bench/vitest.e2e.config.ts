import { defineConfig } from 'vitest/config'

// *.e2e.ts 真实 API 测试（花 token，无凭据自跳过，retry: 2）
export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.ts'],
    testTimeout: 120_000,
    retry: 2,
    hookTimeout: 30_000,
  },
})
