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
import { createAppStaging } from './staging.ts'
import type { AppStaging } from './staging.ts'

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
  // sessions / agents 供暂存面使用：选择应用只登记，首条用户消息的 pre-step 才提升
  // / sessions / agents back the staging face: a pick is only recorded; the
  // first user message's pre-step performs the promotion
  static inject = ['apps', 'pageRegistry', 'sessions', 'agents']

  private readonly staging: AppStaging

  constructor(ctx: Context) {
    super(ctx, APP_HOST_GATEWAY_NAME, { namespace: APP_HOST_GATEWAY_NAME })
    this.staging = createAppStaging(ctx)
    // 暂存面的 pre-step 监听随网关 fiber 卸载（逆序清理）
    // / the staging face's pre-step listeners die with the gateway fiber
    ctx.effect(() => () => this.staging.dispose(), 'appHost: staging')
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
   * 暂存一个应用（选择 ≠ 开会话）：会话首条用户消息的 pre-step 才把它提升为
   * 页面会话。入口页缺失/应用停用在这里就 fail loud（GUI 立刻看到原因）。
   * Stage one app (a pick is not a session start): the session's first user
   * message promotes it in pre-step. A missing entry page or a disabled app
   * fails loud here so the GUI shows the reason immediately.
   * @param appId - 应用 id / app id
   * @param sessionId - 要绑定的会话（当前输入栏所在的会话）/ the session to bind (the composer's session)
   * @returns 暂存的应用 / the staged app
   */
  @Remote('stage')
  stage(appId: string, sessionId: string): AppGatewayApp {
    const app = this.catalog().find((record) => record.id === appId)
    if (app === undefined) {
      throw gatewayError('app/not-found', `app "${appId}" is not registered`)
    }
    if (app.state !== 'active') {
      throw gatewayError('app/disabled', `app "${appId}" is ${app.state}; it cannot open pages`)
    }
    if (app.entryUrl === undefined) {
      throw gatewayError('app/entry-missing', `app "${appId}" has no registered entry page`)
    }
    this.staging.stage(sessionId, { appId: app.id, name: app.name, url: app.entryUrl })
    return app
  }

  /**
   * 取消暂存（用户改主意）：会话不再在首条消息时提升。
   * Unstage: the session no longer promotes on its first message.
   * @param sessionId - 会话 id / session id
   */
  @Remote('unstage')
  unstage(sessionId: string): void {
    this.staging.unstage(sessionId)
  }

  /**
   * 会话所属应用：页面会话返回它打开的应用（工具栏据此显示"已选应用"并锁定），
   * 普通会话返回 null。事实源是页面实例索引（会话 id 与页面实例一一绑定），
   * 遍历目录里的应用各查一次——应用数量是个位数，UI 每次会话切换调一次。
   * 暂存中的应用优先返回：用户已选但还没发送时，工具栏同样显示已选应用。
   * The app owning one session: a page session returns the app it opened (the
   * toolbar shows and locks "selected app"), an ordinary session returns null.
   * The fact source is the page instance index (a session id binds one page
   * instance); it walks the catalog and asks each app — the catalog is a
   * handful of apps and the UI calls this once per session switch. A staged
   * app wins: picked but not yet sent still shows as the selected app.
   * @param sessionId - 当前会话 id / the current session id
   * @returns 该会话所属的应用，或 null / the owning app, or null
   */
  @Remote('sessionApp')
  async sessionApp(sessionId: string): Promise<AppGatewayApp | null> {
    const staged = this.staging.appOf(sessionId)
    if (staged !== undefined) {
      return this.catalog().find((entry) => entry.id === staged.appId) ?? null
    }
    for (const record of this.ctx.apps.catalog()) {
      const rows = await this.ctx.pageRegistry.instances.listByApp(record.definition.id)
      if (!rows.some((row) => row.sessionId === sessionId)) continue
      return this.catalog().find((entry) => entry.id === record.definition.id) ?? null
    }
    return null
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
