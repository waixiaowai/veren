/**
 * Build step: transpile `src/*.ts(x)` into `dist/*.js`.
 *
 * This is the forum house style: type checking stays with
 * `scripts/typecheck.mjs` (which reads the host package's TypeScript sources
 * through tsconfig paths), while this script only emits JavaScript. Emitting
 * with `tsc` would drag the host package's sources into this program via the
 * tsconfig paths and break on `rootDir`, so the emitter is per-file
 * `transpileModule` using the Harness checkout's own TypeScript; the
 * `rewriteRelativeImportExtensions` option turns the house-style `.ts` import
 * specifiers into the `.js` specifiers Node loads.
 *
 * 构建步骤：把 `src/*.ts(x)` 转译成 `dist/*.js`。
 *
 * 这是 forum 一脉的家法：类型检查交给 `scripts/typecheck.mjs`（它经 tsconfig
 * paths 读取宿主包的 TypeScript 源码），本脚本只产出 JavaScript。若用 `tsc`
 * 发射，tsconfig paths 会把宿主包源码拖进本程序并在 `rootDir` 上炸掉，因此这里
 * 用逐文件的 `transpileModule`，且取 Harness 检出自带的 TypeScript；
 * `rewriteRelativeImportExtensions` 把家法风格的 `.ts` 导入后缀改写成 Node
 * 实际加载的 `.js`。
 *
 * @module @veren/notebook-app/build
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
      // Page trees are TSX with the prompt-core JSX runtime, matching the
      // notebook-app tsconfig; standard decorators lower the same way the
      // shipped Harness packages do.
      // 页面树是带 prompt-core JSX 运行时的 TSX，与 notebook-app tsconfig 一致；
      // 标准装饰器按随包 Harness 包相同的方式降级。
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@veren/prompt-core',
      experimentalDecorators: false,
    },
    fileName: join(SRC, entry),
  })
  writeFileSync(join(OUT, entry.replace(/\.tsx?$/, '.js')), emitted.outputText)
  process.stdout.write(`emitted dist/${entry.replace(/\.tsx?$/, '.js')}\n`)
}
