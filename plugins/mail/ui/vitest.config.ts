/**
 * Vitest configuration for the mail Web package.
 *
 * The unit tests cover the two dictionaries against the typed key union and
 * the panel's pure derivations; the browser half itself is exercised in the
 * live Web GUI.
 *
 * The primitives package resolves to the Harness checkout's pure
 * `relative-time` module: the published barrel drags React and the whole
 * component tree into a Node-side unit lane for one bucketing helper, while
 * the source file is exactly the shared implementation with none of that.
 *
 * Mail Web 包的 Vitest 配置。单元测试覆盖两份词典与类型化键联合的一致性，以及面板的
 * 纯派生逻辑；浏览器半边本身在真实 Web GUI 中验证。
 *
 * primitives 包解析到 Harness 检出仓库的纯 `relative-time` 模块：发布版的 barrel 会为
 * 一个分桶小工具把 React 和整棵组件树拖进 Node 侧单测通道，而那个源文件正是共享实现本身，
 * 不带任何多余依赖。
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** The Harness checkout this workspace sits next to. / 本工作区旁的 Harness 检出仓库。 */
const harness = resolve(import.meta.dirname, '../../../deepseek/deepseek-harness')

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': resolve(
        harness, 'packages/client/ui-primitives/src/relative-time.ts',
      ),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
