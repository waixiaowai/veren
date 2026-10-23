/**
 * appHost 网关服务：GUI 伴生插件（@veren/app-host-ui）经 Typert Remote 直调的
 * 唯一宿主入口。全部方法都是 `ctx.apps` / `ctx.pageRegistry` 已声明服务面的纯
 * 转发，不新增状态。失败直接抛带稳定 code 的结构化错误，由 Remote 信封翻成
 * {ok:false,error}——不做第二层 ok/error 联合（forum 的同一纪律）：GUI 拿到
 * 稳定 code 才能显示「目录读不到 / 入口页打不开」的明确状态，而不是静默空白。
 * **一次性渲染语义**：选择应用 = 立即打开页面会话（页面实例与 agent 共存亡，
 * 渲染发生在 agent/created）——不再有"先暂存、首条消息才提升"的中间态。
 * The appHost gateway service: the single host entry the GUI companion plugin
 * (@veren/app-host-ui) calls through Typert Remote. Every method is a pure
 * forward over the declared `ctx.apps` / `ctx.pageRegistry` faces, adding no
 * state of its own. Failures throw structured errors carrying stable codes;
 * the Remote envelope turns them into {ok:false,error} — no second ok/error
 * layer (the forum discipline): the GUI needs stable codes to show explicit
 * "catalog unavailable / entry failed" states instead of silent blanks.
 * **One-shot render semantics**: picking an app opens the page session right
 * away (a page instance lives and dies with its agent; the render happens at
 * agent/created) — the old "stage first, promote on the first message"
 * intermediate state no longer exists.
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
   * 选择一个应用 = 立即打开它的入口页（一次性渲染语义）：页面实例与 agent
   * 共存亡，渲染发生在 agent/created——返回新页面会话，GUI 切换过去。入口页
   * 缺失/应用停用在这里 fail loud（GUI 立刻看到原因）。`sessionId` 参数保留
   * 以兼容旧 Remote 面，新语义下不再使用（页面会话总是新建）。
   * Picking an app = opening its entry page right away (one-shot render
   * semantics): the page instance lives and dies with its agent, the render
   * happens at agent/created — the fresh page session comes back and the GUI
   * switches to it. A missing entry page or a disabled app fails loud here so
   * the GUI shows the reason immediately. The `sessionId` parameter survives
   * for Remote-surface compatibility; the new semantics never use it (a page
   * session is always created fresh).
   * @param appId - 应用 id / app id
   * @param sessionId - 兼容参数，未使用 / compatibility parameter, unused
   * @returns 新页面会话的定位信息 / the new page session's locator
   */
  @Remote('stage')
  async stage(appId: string, sessionId: string): Promise<AppGatewayOpened> {
    void sessionId
    const opened = await this.open(appId)
    return { sessionId: opened.sessionId, url: opened.url, title: opened.title }
  }

  /**
   * 关闭该会话绑定的页面实例（原"取消暂存"）：退役该会话的 agent——页面登记
   * 的一切随 fiber 逆序拆除，会话日志保留可读；索引行翻废弃，URL 腾出。
   * Close the page instance bound to the session (the former "unstage"): retire
   * the session's agent — everything the page registered unwinds with the fiber
   * while the session log stays readable; the index row flips deprecated and
   * the url frees up.
   * @param sessionId - 会话 id / session id
   */
  @Remote('unstage')
  async unstage(sessionId: string): Promise<void> {
    const record = await this.liveRowOf(sessionId)
    if (record === undefined) return
    // closePage = retire agent（登记随 fiber 拆除）+ 索引行翻废弃——退役归
    // page-registry（端口句柄的持有者），网关不直接碰 agent。
    // closePage = retire the agent (registrations unwind with the fiber) + flip
    // the index row deprecated — retiring belongs to page-registry (the port
    // handle's owner); the gateway never touches the agent directly.
    await this.ctx.pageRegistry.closePage(record.url)
  }

  /**
   * 会话所属应用：页面会话返回它打开的应用（工具栏据此显示"已选应用"并锁定），
   * 普通会话返回 null。事实源是页面实例索引（会话 id 与页面实例一一绑定），
   * 遍历目录里的应用各查一次——应用数量是个位数，UI 每次会话切换调一次。
   * The app owning one session: a page session returns the app it opened (the
   * toolbar shows and locks "selected app"), an ordinary session returns null.
   * The fact source is the page instance index (a session id binds one page
   * instance); it walks the catalog and asks each app — the catalog is a
   * handful of apps and the UI calls this once per session switch.
   * @param sessionId - 当前会话 id / the current session id
   * @returns 该会话所属的应用，或 null / the owning app, or null
   */
  @Remote('sessionApp')
  async sessionApp(sessionId: string): Promise<AppGatewayApp | null> {
    const record = await this.liveRowOf(sessionId)
    if (record === undefined) return null
    return this.catalog().find((entry) => entry.id === record.appId) ?? null
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

  /** 该会话的活页面实例行（无则 undefined）/ the session's live page-instance row (undefined when none) */
  private async liveRowOf(sessionId: string) {
    for (const record of this.ctx.apps.catalog()) {
      const rows = await this.ctx.pageRegistry.instances.listByApp(record.definition.id)
      // 只认活行：废弃行是历史账目，不属于"该会话当前所属应用"（否则一条被重开
      // 取代的旧会话会被当成页面会话，选择面也会因此错误地锁定）。
      // Live rows only: deprecated rows are history and do not mean the session
      // currently owns the app (otherwise a superseded session would look like a
      // page session and the picker would wrongly lock).
      const row = rows.find((candidate) => candidate.sessionId === sessionId && candidate.state === 'live')
      if (row !== undefined) return row
    }
    return undefined
  }
}
