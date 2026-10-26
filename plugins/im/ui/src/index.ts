/**
 * Node half of the im page.
 *
 * The page is browser-only: it reads and writes the `im` Remote namespace
 * that the separately installed `@veren/im` Host service exposes, so this
 * half registers nothing. It exists because a Client plugin still needs a Loader
 * row whose package declares `dsh.client` — the Web application discovers the
 * browser half by scanning the active Loader entries' manifests, and a row whose
 * node half cannot be imported never becomes an active entry.
 *
 * 记事本页面的 Node 半边。
 *
 * 页面只存在于浏览器：它读写由单独安装的 `@veren/im` 宿主服务暴露的 `im` 远端
 * 命名空间，因此这半边不注册任何东西。它存在的理由是：客户端插件仍然需要一个 Loader 行，
 * 而该行的包要声明 `dsh.client`——Web 应用通过扫描活跃 Loader 行的清单来发现浏览器半边，
 * Node 半边无法导入的行永远不会成为活跃条目。
 *
 * @module @veren/im-ui
 */

/**
 * Contribute nothing on the Node side.
 *
 * The browser half is the whole plugin; keeping this empty is what lets the page
 * be installed, disabled, or removed independently of the Host service.
 */
export function apply(): void {}
