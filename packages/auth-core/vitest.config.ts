import { defineConfig } from 'vitest/config'

// *.spec.ts 单元与集成测试（sqlite 内存库，不花真实凭据）。
// *.spec.ts unit/integration tests (in-memory sqlite; no live credentials).
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
