/**
 * Node half of the forum page.
 *
 * The page is browser-only: it reads and writes the `forum` Remote namespace
 * that the separately installed `@veren/forum` Host service exposes, so this
 * half registers nothing. It exists because a Client plugin still needs a
 * Loader row whose package declares `dsh.client` — the Web application
 * discovers the browser half by scanning the active Loader entries' manifests,
 * and a row whose node half cannot be imported never becomes an active entry.
 *
 * 论坛页面的 Node 半边。页面只存在于浏览器：它读写由**单独安装**的 `@veren/forum` 宿主
 * 服务暴露的 `forum` 远端命名空间，因此这半边不注册任何东西。它存在的理由是：客户端插件仍然
 * 需要一个 Loader 行，而该行的包要声明 `dsh.client`——Web 应用通过扫描活跃 Loader 行的清单
 * 来发现浏览器半边，而 Node 半边无法导入的行永远不会成为活跃条目。
 *
 * @module @veren/forum-ui
 */

/**
 * Contribute nothing on the Node side.
 *
 * The browser half is the whole plugin; keeping this empty is what lets the
 * page be installed, disabled, or removed independently of the Host service.
 */
export function apply(): void {}
