/**
 * Vitest configuration for `@veren/admin-contract`.
 * `@veren/admin-contract` 的 Vitest 配置。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
