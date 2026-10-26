/**
 * Vitest configuration for the im bundle package.
 *
 * The bundle carries no runtime code; its specs read the manifest, the patch,
 * and the member manifests, so the environment stays `node` and the include
 * list is the package's own `tests/` directory.
 *
 * IM 组合包测试配置。组合包不含运行时代码；它的测试读取清单、patch 与成员清单，因此环境
 * 保持 `node`，包含范围就是本包自己的 `tests/` 目录。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
