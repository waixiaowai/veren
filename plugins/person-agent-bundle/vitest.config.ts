import { defineConfig } from 'vitest/config'

// Bundle spec only: this package is configuration-only, so tests parse the
// patch file and assert the tool-policy invariant. 并发安全：不写任何文件。
// 组合包测试：本包零运行时代码，测试解析 patch 文件并断言工具策略不变量。
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
