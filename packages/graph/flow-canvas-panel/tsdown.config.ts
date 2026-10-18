/**
 * Bundle both halves with the DSH checkout's shared client preset. The preset
 * emits the Node Loader entry (`lib/index.js`) and the
 * `window.__ModuleLoader__.load` browser artifact (`lib/client.js`). The alias
 * map inlines the wire-only Typert protocol into both faces, so the plugin
 * needs only Cordis from the profile and the compatibility check has one peer
 * edge to verify.
 *
 * 用 DSH 检出仓库的共享客户端预设打包两半：Node Loader 入口 `lib/index.js` 与
 * `window.__ModuleLoader__.load` 浏览器工件 `lib/client.js`。别名映射把仅线缆用途的
 * Typert protocol 内联进两半，因此插件只需 profile 提供 Cordis，兼容检查也只有一条
 * peer 边要核对。
 */

import { resolve } from 'node:path'
import { clientBundle } from '../../../deepseek/deepseek-harness/packages/client/tsdown.client.ts'

const checkout = resolve(import.meta.dirname, '../../../deepseek/deepseek-harness')

/** Wire-only packages inlined into both the Node and browser artifacts. */
const inlined = {
    '@deepseek-ai/dsh-typert-protocol/remote-info': resolve(checkout, 'packages/typert/protocol/src/remote-info.ts'),
    '@deepseek-ai/dsh-typert-protocol': resolve(checkout, 'packages/typert/protocol/src/index.ts'),
}

const preset = clientBundle(import.meta.dirname, ['lib/types/index.js'])

/** Add the inline aliases to every emitted face. */
export default (inlineConfig) => preset(inlineConfig).map(config => ({
    ...config,
    tsconfig: './tsconfig.build.json',
    alias: { ...config.alias, ...inlined },
}))
