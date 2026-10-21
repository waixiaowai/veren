/**
 * appHost 网关服务：GUI 伴生插件（@veren/app-host-ui）经 Typert Remote 直调的
 * 唯一宿主入口。只做两件事——读应用目录（含入口页 URL）、打开某应用的入口页；
 * 两者都是 `ctx.apps` / `ctx.pageRegistry` 已声明服务面的纯转发，不新增状态。
 * 失败直接抛带稳定 code 的结构化错误，由 Remote 信封翻成 {ok:false,error}——
 * 不做第二层 ok/error 联合（forum 的同一纪律）：GUI 拿到稳定 code 才能显示
 * 「目录读不到 / 入口页打不开」的明确状态，而不是静默空白。
 * The appHost gateway service: the single host entry the GUI companion plugin
 * (@veren/app-host-ui) calls through Typert Remote. It does exactly two things —
 * read the app catalog (with entry-page urls) and open an app's entry page —
 * both pure forwards over the declared `ctx.apps` / `ctx.pageRegistry` faces,
 * adding no state of its own. Failures throw structured errors carrying stable
 * codes; the Remote envelope turns them into {ok:false,error} — no second
 * ok/error layer (the forum discipline): the GUI needs stable codes to show
 * explicit "catalog unavailable / entry failed" states instead of silent
 * blanks.
 * @module @veren/app-host/gateway
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'

/** 服务名（ctx.appHost；wire namespace 同名）/ service key; wire namespace matches */
export const APP_HOST_GATEWAY_NAME = 'appHost'

/** 目录里的一条应用（GUI 下拉行）/ one catalog entry (one dropdown row) */
export interface AppGatewayApp {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly state: 'active' | 'disabled' | 'broken'
  /** 入口页 URL；入口页未注册时缺席（GUI 显示「入口缺失」）/ entry url; absent when unregistered (GUI shows the entry-missing state) */
  readonly entryUrl?: string
}

/** 网关抛出的结构化错误 / the structured gateway error */
export interface GatewayError extends Error {
  readonly code: string
}

/** 构造带稳定 code 的网关错误 / one gateway error with a stable code */
function gatewayError(code: string, message: string): GatewayError {
  return Object.assign(new Error(message), { code }) as GatewayError
}

/** 打开入口页的成功载荷 / the successful open-entry payload */
export interface AppGatewayOpened {
  readonly sessionId: string
  readonly url: string
  readonly title: string
}

/** 目录服务的静态依赖；经 Typert Remote 基类的属主面访问（ctx.apps / ctx.pageRegistry） */
export class AppHostGatewayService extends TypertRemoteService {
  static inject = ['apps', 'pageRegistry']

  constructor(ctx: Context) {
    super(ctx, APP_HOST_GATEWAY_NAME, { namespace: APP_HOST_GATEWAY_NAME })
  }

  /** 应用目录：每条应用带上入口页 URL / the app catalog with entry urls */
  @Remote('catalog')
  catalog(): readonly AppGatewayApp[] {
    return this.ctx.apps.catalog().map((record) => {
      const entry = this.ctx.apps.listPages(record.definition.id)
        .find((page) => page.name === record.definition.entry)
      return {
        id: record.definition.id,
        name: record.definition.name,
        description: record.definition.description,
        state: record.state,
        ...(entry === undefined ? {} : { entryUrl: entry.url }),
      }
    })
  }

  /**
   * 打开某应用的入口页（一律新建会话，同 URL 旧会话废弃——§9.1 反转）。
   * `url` 可选：显式给定时必须是该应用 `/apps/<appId>/…` 下的页面 URL
   * （如详情页/发布页），仍是"一律新建会话"的同一运行时路径。
   * Open one app's entry page (always a fresh session; the previous one on the
   * same url is deprecated — the §9.1 inversion). `url` is optional: when
   * given it must be a page url under this app's /apps/<appId>/ (detail,
   * publish, …) and takes the same always-fresh-session runtime path.
   */
  @Remote('open')
  async open(appId: string, url?: string): Promise<AppGatewayOpened> {
    const app = this.catalog().find((record) => record.id === appId)
    if (app === undefined) {
      throw gatewayError('app/not-found', `app "${appId}" is not registered`)
    }
    const entryUrl = app.entryUrl
    if (entryUrl === undefined) {
      throw gatewayError('app/entry-missing', `app "${appId}" has no registered entry page`)
    }
    const target = url === undefined ? entryUrl : url
    if (!target.startsWith(`/apps/${appId}/`)) {
      throw gatewayError('page/url-invalid', `url "${target}" is not a page of app "${appId}"`)
    }
    const opened = await this.ctx.pageRegistry.openUrl(target)
    return { sessionId: opened.sessionId, url: opened.url, title: opened.title }
  }
}
