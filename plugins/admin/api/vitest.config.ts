/**
 * Vitest configuration for `@veren/admin-api-kernel`.
 * `@veren/admin-api-kernel` 的 Vitest 配置。
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
