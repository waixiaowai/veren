/**
 * `@veren/baidu-pan-ui` 的 Node 半边：一个空插件行。
 *
 * 客户端的槽位、语言与样式全部由 `./client` 注册；这里之所以需要一行，
 * 是因为 Web 应用扫描的是**活跃 Loader 条目**的 manifest——一个 Node 半边
 * 导入不了的包永远不会成为活跃条目，它的 `dsh.client` 声明也就不会被看见。
 * 与 `@veren/im-ui` / `@veren/mail-ui` 的形态完全一致。
 *
 * The Node half of `@veren/baidu-pan-ui`: an empty plugin row.
 *
 * The client-side slots, locale, and styles all register from `./client`. This
 * row exists only because the Web application scans the manifests of **active
 * Loader entries** — a package whose Node half cannot be imported never becomes
 * an active entry, so its `dsh.client` declaration would never be seen. The
 * same shape as `@veren/im-ui` and `@veren/mail-ui`.
 *
 * @module @veren/baidu-pan-ui
 */

/** 本包不在 Node 侧注册任何能力。This package registers nothing on the Node side. */
export function apply(): void {}
