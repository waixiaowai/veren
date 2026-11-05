import { defineConfig } from 'vitest/config'

// *.spec.ts 单元与集成测试；真实数据库用例用 *.e2e.ts，无凭据自跳过。
// *.spec.ts unit/integration tests; live-database cases live in *.e2e.ts and
// skip themselves when no credentials are configured.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
})
