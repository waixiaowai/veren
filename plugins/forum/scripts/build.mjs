/**
 * Build step: transpile `src/*.ts` into `dist/*.js`.
 *
 * The plugin is an out-of-tree bundle, so it does not participate in the
 * Harness workspace build. Type checking still runs against the real Harness
 * sources (`tsc -p tsconfig.json`); this script only emits JavaScript, using the
 * Harness checkout's own TypeScript so decorator lowering matches the runtime
 * the plugin is loaded into.
 *
 * 构建步骤：把 `src/*.ts` 转译成 `dist/*.js`。
 *
 * 本插件是检出仓库之外的组合包，不参与 Harness 工作区构建。类型检查仍然对着真实
 * Harness 源码跑（`tsc -p tsconfig.json`）；本脚本只产出 JavaScript，使用检出仓库
 * 自带的 TypeScript，使装饰器降级结果与被加载进的运行时一致。
 *
 * @module @veren/forum/build
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const checkout = resolve(root, '../../deepseek/deepseek-harness')

const { default: ts } = await import(
  new URL(`file:///${join(checkout, 'node_modules/typescript/lib/typescript.js').replaceAll('\\', '/')}`).href
)

const OUT = join(root, 'dist')
mkdirSync(OUT, { recursive: true })
const SRC = join(root, 'src')

for (const entry of readdirSync(SRC)) {
  if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
  const source = readFileSync(join(SRC, entry), 'utf8')
  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      sourceMap: false,
      // Sources import each other with explicit `.ts` specifiers so the checker
      // resolves them through the same NodeNext rules the Harness uses; the
      // emitted JavaScript must carry `.js` because that is what Node loads.
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      // Page trees are TSX with the prompt-core JSX runtime, matching the
      // forum tsconfig; Remote methods use standard decorators, which this
      // transpile lowers the same way the shipped Harness packages do.
      // 页面树是带 prompt-core JSX 运行时的 TSX，与论坛 tsconfig 一致；Remote
      // 方法用标准装饰器，此转译按随包 Harness 包相同的方式降级。
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@veren/prompt-core',
      experimentalDecorators: false,
    },
    fileName: join(SRC, entry),
  })
  writeFileSync(join(OUT, entry.replace(/\.tsx?$/, '.js')), emitted.outputText)
  process.stdout.write(`emitted dist/${entry.replace(/\.tsx?$/, '.js')}\n`)
}
