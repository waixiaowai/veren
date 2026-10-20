import { defineConfig } from 'vitest/config'

// *.spec.ts 单元测试 / unit tests only
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
