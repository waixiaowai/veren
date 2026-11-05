import { defineConfig } from 'vitest/config'

// 真实数据库 e2e：无凭据时用例自行跳过，与单测分开跑。
// Live-database e2e: cases skip themselves without credentials; run separately from unit tests.
export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.ts'],
    retry: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
