import { defineConfig } from 'vitest/config'

// Bundle spec only: this package is configuration-only, so tests parse the
// patch file and assert the composition invariants.
// 并发安全：不写任何文件。
// 组合包测试：本包零运行时代码，测试解析 patch 文件并断言组合不变量。
// Concurrency safe: no files are written.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
