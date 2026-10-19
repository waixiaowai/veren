/**
 * `@veren/admin-locale-zh-en` — the bilingual default locale pack (Host half).
 *
 * The Host half only publishes the pack directory to the UI kernel, so the
 * browser can import `client.js` from the same origin. The dictionaries live in
 * `client.js`.
 *
 * 默认中英双语语言包（宿主半边）。宿主半边只把包目录发布给 UI 内核，浏览器因此能同源
 * 导入 `client.js`。词典放在 `client.js`。
 *
 * @module @veren/admin-locale-zh-en
 */

// 只有这一个 Node 内置导入：需要把 `import.meta.url` 变成真实目录路径。
// The single Node built-in import: `import.meta.url` must become a real path.
import { fileURLToPath } from 'node:url'

/** Plugin display name. 插件显示名。 */
export const name = 'admin-locale-zh-en'

/** The pack needs the UI kernel registry to publish itself. 包需要 UI 内核注册表才能发布自身。 */
export const inject = ['adminUi']

/** What the UI kernel publishes for this pack. UI 内核为本包发布的清单。 */
const MANIFEST = {
  id: 'locale-zh-en',
  version: '0.1.0',
  uiContract: '^1.0',
  kind: 'locale',
  entry: '/admin/ui-plugins/locale-zh-en/client.js',
  label: { en: 'Chinese and English', zh: '中英双语' },
  order: 0,
}

/**
 * Plugin entry: register the pack directory and dispose it on unload.
 * 插件入口：注册包目录，卸载时释放。
 *
 * @param ctx - plugin context 插件上下文
 */
export function apply(ctx) {
  const root = fileURLToPath(new URL('.', import.meta.url))
  ctx.effect(() => ctx.adminUi.register({ manifest: MANIFEST, root }), 'admin-locale-zh-en')
}
