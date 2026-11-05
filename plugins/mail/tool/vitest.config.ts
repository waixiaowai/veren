/**
 * Vitest configuration for the mail tool package.
 *
 * The specs cover the tool face's pure behavior: the failure projection, the
 * JSON normalization, and the output declaration. They need no host, no
 * tools registry, and no network.
 *
 * 邮件工具包的 Vitest 配置。
 *
 * 这些 spec 覆盖工具面的纯行为：失败投影、JSON 归一化与输出声明。它们既不需要宿主、
 * 也不需要工具注册表或网络。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
