import { defineConfig } from 'vitest/config'

// 单元测试配置：并发安全的 *.spec.ts，存放在包级 tests/ 目录。
// Unit test config: concurrency-safe *.spec.ts under the package-level tests/ dir.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
