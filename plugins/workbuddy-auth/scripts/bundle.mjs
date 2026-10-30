/**
 * 产出插件的两半：`dist/index.js`（Node 行）与 `lib/client.js`（浏览器模块）。
 * Produces both halves of the plugin: `dist/index.js` (the Node row) and
 * `lib/client.js` (the browser module).
 *
 * 浏览器产物必须符合外壳模块加载器的约定：模块 id 取包名，所有平台模块保持
 * external 并从外壳冻结的模块表解析，`@deepseek-ai/dsh-typert-protocol/
 * remote-info` 按生成的 Remote 工件的同样方式内联。
 * The browser artifact must match the shell module loader's convention: the
 * module id is the package name, every platform module stays external and
 * resolves through the shell's frozen module table, and
 * `@deepseek-ai/dsh-typert-protocol/remote-info` is inlined exactly as the
 * generated Remote artifacts inline it.
 *
 * 结构照搬 @veren/opencode-go 的 scripts/bundle.mjs（house 模式）。
 * Structure copied from @veren/opencode-go's scripts/bundle.mjs (house mode).
 *
 * @module @veren/workbuddy-auth/bundle
 */

import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORM_MODULES } from '@veren/platform-modules'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

/** 本包构建所对的 Harness 检出目录；可用 DSH_CHECKOUT 覆盖。 */
/** Harness checkout this package builds against; override with DSH_CHECKOUT. */
const CHECKOUT = process.env.DSH_CHECKOUT ?? resolve(root, '../../deepseek/deepseek-harness')

/** 缩进一级，信封保持可读。Indent the bundled body one level so the envelope stays readable. */
const indent = text => text.split('\n').map(line => line === '' ? line : `    ${line}`).join('\n')

/** 发射 Node 半：协议纯库随之打进包内（@veren/* 非 external）。 */
/** Emit the Node half: the protocol library bundles in (@veren/* is not external). */
async function emitNodeHalf() {
  const result = await build({
    entryPoints: [join(root, 'src/index.ts')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    logLevel: 'warning',
    external: ['@deepseek-ai/*'],
  })
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist/index.js'), result.outputFiles[0].text)
}

/** 发射浏览器半（包进模块加载器信封）。Emit the browser half inside the module-loader envelope. */
async function emitClientHalf() {
  const cardCss = readFileSync(join(root, 'src/client/card.css'), 'utf8')
  const result = await build({
    entryPoints: [join(root, 'src/client/index.tsx')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    logLevel: 'warning',
    external: PLATFORM_MODULES,
    alias: {
      '@deepseek-ai/dsh-typert-protocol/remote-info': join(CHECKOUT, 'packages/typert/protocol/src/remote-info.ts'),
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __WB_CSS__: JSON.stringify(cardCss),
    },
  })
  const envelope = [
    '/* Built by scripts/bundle.mjs - the browser half of the WorkBuddy card. */',
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(packageName)},`,
    '  factory: (require) => {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    indent(result.outputFiles[0].text),
    '    return module.exports;',
    '  },',
    '});',
    '',
  ].join('\n')
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib/client.js'), envelope)
  return envelope.length
}

await emitNodeHalf()
const clientBytes = await emitClientHalf()
console.log(`emitted dist/index.js and lib/client.js (${String(clientBytes)} bytes) for ${packageName}`)
