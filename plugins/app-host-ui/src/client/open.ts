/**
 * The `appHost.open` Remote call, arity-exact.
 *
 * The client gateway validates an invocation's argument count against the
 * endpoint's declared parameters and rejects a short call before it reaches
 * the host (`client api: appHost/open expected 2 argument(s), got 1`). The
 * toolbar used to call with one argument, so picking an app did nothing. Every
 * declared parameter must be supplied; the optional `url` is passed as an
 * explicit `undefined`, which the gateway then omits from the wire payload.
 *
 * `appHost.open` 的 Remote 调用，参数个数严格对齐。客户端网关按端点声明的参数
 * 个数校验，短调用在到达宿主前就被拒（`client api: appHost/open expected 2
 * argument(s), got 1`）——工具栏曾经只传一个参数，选中应用因此毫无反应。声明的
 * 每个参数都必须占位；可选的 `url` 显式传 `undefined`，网关会把它从线上载荷里
 * 省略。
 * @module @veren/app-host-ui/client/open
 */

/** The slice of `ctx.remote.appHost` this call needs. */
export interface AppHostOpenFace {
  open(appId: string, url?: string): Promise<unknown>
}

/**
 * Open one app's entry page through the Remote, passing every declared
 * parameter (the optional url as an explicit undefined).
 * 经 Remote 打开某应用的入口页，占满全部声明参数（可选 url 显式 undefined）。
 * @param appHost - the mounted `ctx.remote.appHost` face.
 * @param appId - the application to open.
 * @returns the host's result envelope.
 */
export function openAppPage(appHost: AppHostOpenFace, appId: string): Promise<unknown> {
  return appHost.open(appId, undefined)
}
