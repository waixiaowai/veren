/**
 * Vitest configuration for the admin bundle composition test.
 * 后台组合包组合测试的 Vitest 配置。
 */

import { defineConfig } from 'vitest/config'
import { adminAliases } from '../vitest.aliases.ts'

export default defineConfig({
  resolve: { alias: adminAliases },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
