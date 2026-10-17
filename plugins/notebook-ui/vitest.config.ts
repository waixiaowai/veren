/**
 * Vitest configuration for the notebook Web package.
 *
 * The only unit test here checks the two dictionaries against the typed key
 * union; the browser half itself is exercised in the live Web GUI.
 *
 * 记事本 Web 包的 Vitest 配置。这里的单元测试只检查两份词典与类型化键联合是否一致；浏览器
 * 半边本身在真实 Web GUI 中验证。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
