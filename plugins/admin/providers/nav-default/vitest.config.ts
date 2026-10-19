/**
 * Vitest configuration for `@veren/admin-navigation-default`.
 * `@veren/admin-navigation-default` 的 Vitest 配置。
 */

import { defineConfig } from 'vitest/config'
import { adminAliases } from '../../vitest.aliases.ts'

export default defineConfig({
  resolve: { alias: adminAliases },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
