/**
 * `@veren/admin-shell-default` — the default shell pack (Host half).
 *
 * The Host half only publishes the pack directory to the UI kernel, so the
 * browser can import `client.js` from the same origin.
 *
 * 默认外壳包（宿主半边）。宿主半边只把包目录发布给 UI 内核，浏览器因此能同源导入
 * `client.js`。
 *
 * @module @veren/admin-shell-default
 */

// 只有这一个 Node 内置导入：需要把 `import.meta.url` 变成真实目录路径。
// The single Node built-in import: `import.meta.url` must become a real path.
import { fileURLToPath } from 'node:url'

/** Plugin display name. 插件显示名。 */
export const name = 'admin-shell-default'

/** The pack needs the UI kernel registry to publish itself. 包需要 UI 内核注册表才能发布自身。 */
export const inject = ['adminUi']

/** What the UI kernel publishes for this pack. UI 内核为本包发布的清单。 */
const MANIFEST = {
  id: 'shell-default',
  version: '0.1.0',
  uiContract: '^1.0',
  kind: 'shell',
  entry: '/admin/ui-plugins/shell-default/client.js',
  label: { en: 'Default shell', zh: '默认壳' },
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
  ctx.effect(() => ctx.adminUi.register({ manifest: MANIFEST, root }), 'admin-shell-default')
}
