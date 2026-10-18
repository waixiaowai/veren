/**
 * Vitest configuration for the canvas panel.
 *
 * The plugin lives outside the DSH workspace, so aliases resolve every
 * `@deepseek-ai/*` package to the checkout's **sources** (the same graph the
 * checkout tests use) and React/jsdom helpers to the checkout's installed
 * packages. Nothing here is a second implementation: the tests mount the real
 * slot registry, renderer, and client test runtime.
 *
 * 画布面板的 Vitest 配置。插件在 DSH 工作区之外，因此别名把每个 `@deepseek-ai/*` 包解析到
 * 检出仓库的**源码**（与仓库测试同一依赖图），React/jsdom 辅助库解析到检出仓库已安装的包。
 * 这里不是第二套实现：测试挂载真实槽位注册表、渲染器与 client-test-runtime。
 */

import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const checkout = resolve(root, '../../../deepseek/deepseek-harness')
const repository = resolve(root, '../../..')

const require = createRequire(join(checkout, 'package.json'))
const clientRequire = createRequire(join(checkout, 'packages/test-support/client-runtime/package.json'))
const protocolRequire = createRequire(join(checkout, 'packages/typert/protocol/package.json'))
const ts = require('typescript')
const read = ts.readConfigFile(join(checkout, 'tsconfig.base.json'), ts.sys.readFile)
if (read.error !== undefined) {
    throw new Error(`cannot read the checkout tsconfig: ${ts.flattenDiagnosticMessageText(read.error.message, ' ')}`)
}

const aliases = []
const add = (find, replacement) => aliases.push({ find, replacement })
for (const [alias, targets] of Object.entries(read.config.compilerOptions.paths ?? {})) {
    const target = targets[0]
    if (target === undefined) continue
    const stars = (alias.match(/\*/g) ?? []).length
    if (stars > 1) continue
    if (stars === 1) {
        add(alias.replace('*', ''), resolve(checkout, target.replace('*', '')))
    } else {
        const absolute = resolve(checkout, target)
        add(alias, absolute)
        // The checkout's client-runtime imports package sources through the
        // package's `./src/*` export, so mirror that prefix explicitly.
        const sourceMarker = `${sep}src${sep}`
        const sourceIndex = absolute.lastIndexOf(sourceMarker)
        if (sourceIndex >= 0) add(`${alias}/src`, absolute.slice(0, sourceIndex + `${sep}src`.length))
        else if (absolute.endsWith(`${sep}src`)) add(`${alias}/src`, absolute)
        // Directory aliases also serve deep relative imports such as
        // `/src/client/bind.ts` used by the test runtime.
        if (!absolute.endsWith('.ts') && !absolute.endsWith('.tsx')) add(`${alias}/*`, `${absolute}/*`)
    }
}

// Graph packages live in this repository, not in the DSH checkout.
add('@deepseek-ai/dsh-graph-core', resolve(repository, 'packages/graph/graph-core/src/index.ts'))
add('@deepseek-ai/dsh-graph-flow-api', resolve(repository, 'packages/graph/flow-api/src/index.ts'))
add('@deepseek-ai/dsh-graph-flow-engine', resolve(repository, 'packages/graph/flow-engine/src/index.ts'))
add('@deepseek-ai/dsh-graph-flow-canvas/types', resolve(repository, 'packages/graph/flow-canvas/src/types.ts'))
add('@deepseek-ai/dsh-graph-flow-canvas', resolve(repository, 'packages/graph/flow-canvas/src/index.ts'))
add('@veren/core', resolve(repository, 'packages/core/src/index.ts'))

// React and the DOM test helpers come from the checkout's install.
add('react/jsx-dev-runtime', clientRequire.resolve('react/jsx-dev-runtime'))
add('react/jsx-runtime', clientRequire.resolve('react/jsx-runtime'))
add('react-dom/client', clientRequire.resolve('react-dom/client'))
add('react-dom', clientRequire.resolve('react-dom'))
add('react', clientRequire.resolve('react'))
add('zod', protocolRequire.resolve('zod'))
add('@testing-library/react', clientRequire.resolve('@testing-library/react'))
add('@testing-library/dom', clientRequire.resolve('@testing-library/dom'))

// Longest prefix first so `@pkg/client` wins over `@pkg`.
aliases.sort((left, right) => right.find.length - left.find.length)

export default {
    resolve: { alias: aliases },
    test: {
        include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
        environment: 'node',
        testTimeout: 15_000,
        server: {
            deps: {
                // The checkout's sources live outside this package; transform
                // them through Vite so aliases and JSX apply.
                inline: [/deepseek[\\/]deepseek-harness[\\/](packages|vendor)[\\/]/],
            },
        },
    },
}
