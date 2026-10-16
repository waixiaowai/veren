// 单测配置：只跑包级 tests/ 下的 *.spec.ts（与本地 @veren 插件一致）。
// Unit-test config: run only package-level tests/**/*.spec.ts, matching the
// local @veren plugins.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
