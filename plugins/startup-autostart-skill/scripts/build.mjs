/**
 * Build step: transpile `src/*.ts` into `dist/*.js`.
 *
 * The plugin is an out-of-tree bundle, so it does not participate in the
 * Harness workspace build. Type checking still runs against the real Harness
 * sources (`tsc -p tsconfig.json`); this script only emits JavaScript, using the
 * Harness checkout's own TypeScript so decorator lowering matches the runtime
 * the plugin is loaded into. The skill body stays in `assets/`, which the
 * package publishes beside `dist/`; the entry resolves it relative to its own
 * module URL.
 * 技能插件使用宿主仓库的 TypeScript 编译器生成独立 ESM 入口。技能正文留在
 * assets/ 随包发布，入口按自身模块 URL 定位它。
 * @module @veren/startup-autostart-skill/build
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
  if (!entry.endsWith('.ts')) continue
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
    },
    fileName: join(SRC, entry),
  })
  writeFileSync(join(OUT, entry.replace(/\.ts$/, '.js')), emitted.outputText)
  process.stdout.write(`emitted dist/${entry.replace(/\.ts$/, '.js')}\n`)
}
