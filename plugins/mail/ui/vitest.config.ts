/**
 * Vitest configuration for the im Web package.
 *
 * The unit tests cover the two dictionaries against the typed key union and
 * the intake tab's pure derivations; the browser half itself is exercised in
 * the live Web GUI.
 *
 * IM Web 包的 Vitest 配置。单元测试覆盖两份词典与类型化键联合的一致性，以及采集页签的
 * 纯派生逻辑；浏览器半边本身在真实 Web GUI 中验证。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
