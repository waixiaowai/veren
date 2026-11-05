/**
 * Vitest configuration for the mail core.
 *
 * The specs run against the domain's own logic with an in-memory store, so
 * they need no medium, no network, and no host: everything they exercise is
 * a pure function of its inputs.
 *
 * 邮件核心的 Vitest 配置。
 *
 * 这些 spec 针对域自身的逻辑运行，使用内存存储，因此既不需要介质、也不需要网络或宿主：
 * 它们所验证的一切都是其输入的纯函数。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
