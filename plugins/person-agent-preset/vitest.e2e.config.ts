/**
 * E2E Vitest configuration: real-environment specs (*.e2e.ts) only, retried
 * twice because a live host boot is timing-sensitive. Unit specs stay on the
 * default config.
 * E2E Vitest 配置：仅真实环境 spec（*.e2e.ts），因真实宿主启动对时机敏感而重试
 * 两次。单元 spec 走默认配置。
 * @module vitest.e2e.config
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.ts'],
    retry: 2,
    testTimeout: 300_000,
    fileParallelism: false,
  },
})
