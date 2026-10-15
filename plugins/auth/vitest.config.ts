/**
 * Vitest configuration for the @veren/web-login-gate package (unit specs,
 * concurrent and hermetic).
 * @veren/web-login-gate 的 Vitest 配置（单元 spec，并发且密闭）。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
