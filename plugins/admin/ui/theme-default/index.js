/**
 * `@veren/admin-theme-default` — the neutral default theme pack (Host half).
 *
 * The Host half only publishes the pack directory to the UI kernel, so the
 * browser can import `client.js` from the same origin. Token values live in
 * `client.js`; nothing here reads them, so changing a colour never touches the
 * Host.
 *
 * 默认中性主题包（宿主半边）。宿主半边只把包目录发布给 UI 内核，浏览器因此能同源导入
 * `client.js`。token 值都在 `client.js`，这里不读取它们，所以改颜色永远不涉及宿主。
 *
 * @module @veren/admin-theme-default
 */

// 只有这一个 Node 内置导入：需要把 `import.meta.url` 变成真实目录路径。
// The single Node built-in import: `import.meta.url` must become a real path.
import { fileURLToPath } from 'node:url'

/** Plugin display name. 插件显示名。 */
export const name = 'admin-theme-default'

/** The pack needs the UI kernel registry to publish itself. 包需要 UI 内核注册表才能发布自身。 */
export const inject = ['adminUi']

/** What the UI kernel publishes for this pack. UI 内核为本包发布的清单。 */
const MANIFEST = {
  id: 'theme-default',
  version: '0.1.0',
  uiContract: '^1.0',
  kind: 'theme',
  entry: '/admin/ui-plugins/theme-default/client.js',
  label: { en: 'Default theme', zh: '默认主题' },
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
  ctx.effect(() => ctx.adminUi.register({ manifest: MANIFEST, root }), 'admin-theme-default')
}
