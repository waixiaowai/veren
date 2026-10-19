/**
 * Vitest configuration for the person-agent preset package.
 *
 * Unit specs run in the `node` environment and never call a model; the
 * live-host suite has its own `vitest.e2e.config.ts` behind `test:e2e`.
 *
 * person-agent 预设包的 Vitest 配置。
 *
 * 单元测试在 `node` 环境运行且从不调用模型；真实宿主套件由 `test:e2e` 使用独立的
 * `vitest.e2e.config.ts`。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
