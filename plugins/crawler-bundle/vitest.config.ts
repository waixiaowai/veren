import { defineConfig } from 'vitest/config'

// 组合包不变量测试：*.spec.ts 单元测试 / bundle invariant tests: unit tests only
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
