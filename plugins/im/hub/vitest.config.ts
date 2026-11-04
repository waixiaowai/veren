import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 别名把 @veren/im 指到核心源码：核心的 dist 是构建产物（不入库、可能过期），
// 测试必须永远对着源码契约跑。
// The alias points @veren/im at the core source: core's dist is a build
// artifact (not committed, possibly stale) and tests must always run against
// the source contract.
const core = resolve(fileURLToPath(new URL('.', import.meta.url)), '../core/src/index.ts')

export default defineConfig({
  resolve: {
    alias: { '@veren/im': core },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
