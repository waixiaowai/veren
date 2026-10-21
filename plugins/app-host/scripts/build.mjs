/**
 * Build step: transpile `src/*.ts` into `dist/*.js`.
 *
 * The forum house style, chosen here for a hard constraint: app-host's
 * dependencies `@veren/page-registry` and `@veren/task-center` still resolve to
 * TypeScript sources, and emitting with `tsc` would pull those sources into
 * this program and break on `rootDir`. Type checking stays with plain
 * `tsc --noEmit`; this script only emits JavaScript with the Harness checkout's
 * own TypeScript, and `rewriteRelativeImportExtensions` turns the house-style
 * `.ts` import specifiers into the `.js` specifiers Node loads.
 *
 * 构建步骤：把 `src/*.ts` 转译成 `dist/*.js`。
 *
 * 这里选 forum 家法是出于一个硬约束：本包依赖的 `@veren/page-registry` 与
 * `@veren/task-center` 目前仍解析到 TypeScript 源码，用 `tsc` 发射会把那些源码
 * 拖进本程序并在 `rootDir` 上炸掉。类型检查仍由 `tsc --noEmit` 承担；本脚本只用
 * Harness 检出自带的 TypeScript 产出 JavaScript，`rewriteRelativeImportExtensions`
 * 把家法风格的 `.ts` 导入后缀改写成 Node 实际加载的 `.js`。
 *
 * @module @veren/app-host/build
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
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      // Remote methods use standard decorators, which transpile lowers the
      // same way the shipped Harness packages do.
      // Remote 方法用标准装饰器，此转译按随包 Harness 包相同的方式降级。
      experimentalDecorators: false,
    },
    fileName: join(SRC, entry),
  })
  writeFileSync(join(OUT, entry.replace(/\.tsx?$/, '.js')), emitted.outputText)
  process.stdout.write(`emitted dist/${entry.replace(/\.tsx?$/, '.js')}\n`)
}
