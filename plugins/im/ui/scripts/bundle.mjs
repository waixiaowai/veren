/**
 * Produce both halves of the forum page: `dist/index.js` (the Node row) and
 * `lib/client.js` (the browser module).
 *
 * The browser artifact must match what the shell's module loader expects:
 *
 *     load({ id: <package name>, factory: (require) => module.exports })
 *
 * so the module id is the package name, every platform module stays external and
 * resolves through the shell's frozen module table, and
 * `@deepseek-ai/dsh-typert-protocol/remote-info` is inlined exactly as the
 * generated Remote artifacts inline it.
 *
 * 产出论坛页面的两半：`dist/index.js`（Node 行）与 `lib/client.js`（浏览器模块）。
 *
 * 浏览器产物必须符合外壳模块加载器的约定：模块 id 取包名，所有平台模块保持 external 并从
 * 外壳冻结的模块表解析，`@deepseek-ai/dsh-typert-protocol/remote-info` 按生成的 Remote 工件
 * 的同样方式内联。
 *
 * @module @veren/forum-ui/bundle
 */

import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORM_MODULES } from '@veren/platform-modules'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

/** Harness checkout this package builds against; override with DSH_CHECKOUT.
 *  本包构建所对的 Harness 检出目录；可用 DSH_CHECKOUT 覆盖。 */
const CHECKOUT = process.env.DSH_CHECKOUT ?? resolve(root, '../../../deepseek/deepseek-harness')

/** Indent the bundled body one level so the envelope stays readable. */
const indent = text => text.split('\n').map(line => line === '' ? line : `    ${line}`).join('\n')

/** Emit the Node half: the empty Loader row the Web application scans. */
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

/** Emit the browser half inside the module-loader envelope. */
async function emitClientHalf() {
  // The page stylesheet: the shared dialect plus the intake tab's additions.
  // 页面样式表：共享方言 + 采集页签增量。
  const panelCss = [
    readFileSync(join(root, 'src/client/panel.css'), 'utf8'),
    readFileSync(join(root, 'src/client/intake.css'), 'utf8'),
  ].join('\n')
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
      __IM_CSS__: JSON.stringify(panelCss),
    },
  })
  const envelope = [
    '/* Built by scripts/bundle.mjs - the browser half of the im page. */',
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
