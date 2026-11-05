/**
 * The Node half of the mail UI package.
 *
 * It registers nothing. The browser half is what the Web application
 * discovers, and it reads the `mail` Remote namespace the core plugin
 * mounts. This half exists because a Client plugin still needs a Loader row
 * whose package declares `dsh.client` — the Web application scans the active
 * Loader entries' manifests, and a row whose node half cannot be imported
 * never becomes an active entry.
 *
 * 邮件 UI 包的 Node 半边。
 *
 * 它不注册任何东西。浏览器半边才是 Web 应用发现的东西，它读取核心插件挂载的 `mail` 远端
 * 命名空间。此半边之所以存在，是因为 Client 插件仍需要一行声明了 `dsh.client` 的 Loader 行
 * ——Web 应用会扫描活跃 Loader 条目的清单，而 Node 半边无法导入的行永远不会成为活跃条目。
 *
 * @module @veren/mail-ui
 */

/**
 * Apply the Node half: nothing to register.
 *
 * 应用 Node 半边：无需注册任何东西。
 */
export function apply(): void {}
