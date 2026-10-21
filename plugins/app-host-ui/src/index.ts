/**
 * Node half of the application toolbar plugin.
 *
 * The toolbar is browser-only: it reads the `appHost` Remote namespace that the
 * separately loaded `@veren/app-host` assembly exposes, so this half registers
 * nothing. It exists because a Client plugin still needs a Loader row whose
 * package declares `dsh.client` - the Web application discovers the browser
 * half by scanning the active Loader entries' manifests, and a row whose node
 * half cannot be imported never becomes an active entry.
 *
 * 应用工具栏插件的 Node 半边。工具栏只存在于浏览器：它读写由**单独加载**的
 * `@veren/app-host` 装配暴露的 `appHost` 远程命名空间，因此这半边不注册任何东西。
 * 它存在的理由是：客户端插件仍然需要一个 Loader 行，而该行的包要声明 `dsh.client`——
 * Web 应用通过扫描活跃 Loader 行的清单来发现浏览器半边，Node 半边无法导入的行
 * 永远不会成为活跃条目。
 * @module @veren/app-host-ui
 */

/**
 * Contribute nothing on the Node side.
 *
 * The browser half is the whole plugin; keeping this empty is what lets the
 * toolbar be installed, disabled, or removed independently of the host
 * assembly.
 */
export function apply(): void {}
