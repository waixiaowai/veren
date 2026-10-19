/**
 * Browser half of the default shell pack.
 *
 * A shell contribution names the chrome the SPA renders; the layout itself
 * lives in the SPA stylesheet, so this pack stays data. Replacing it changes
 * which shell identity is advertised, and a future SPA can branch on that id.
 *
 * 默认外壳包的浏览器半边。外壳贡献只命名 SPA 渲染的外框；布局本身在 SPA 样式表里，因此
 * 本包只是数据。替换它会改变对外声明的壳身份，未来的 SPA 可据此分支。
 *
 * @module @veren/admin-shell-default/client.js
 */

/**
 * Register the shell with the SPA runtime.
 *
 * @param runtime - the admin UI runtime 后台 UI 运行时
 */
export function activate(runtime) {
  runtime.registerShell({ id: 'default', label: { en: 'Default shell', zh: '默认壳' } })
}
