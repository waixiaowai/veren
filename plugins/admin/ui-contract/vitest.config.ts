/**
 * Vitest configuration for the UI contract package.
 * UI 契约包的 Vitest 配置。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
