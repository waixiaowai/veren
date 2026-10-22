/**
 * The browser-side Remote definition for the `appHost` namespace.
 *
 * The Web client reaches the host assembly through a Remote contribution
 * mounted with `ctx.remote.$mount`. The generated contributions come from the
 * Harness's type-model generator; this package lives outside that pipeline, so
 * it builds the same contribution by hand with `createTypertRemoteInfo`, the
 * constructor the generated artifacts call. Each entry mirrors one
 * `AppHostGatewayService` method, keyed by the Host's parameter name.
 *
 * `appHost` 远程命名空间的浏览器侧定义。Web 客户端通过 `ctx.remote.$mount` 挂载的
 * Remote contribution 访问宿主装配。生成版 contribution 来自 Harness 的类型模型
 * 生成器；本包不在这条流水线里，因此用 `createTypertRemoteInfo`（生成工件调用的
 * 同一个构造函数）手工构造同样的 contribution。每一条都镜像 `AppHostGatewayService`
 * 的一个方法，键名取宿主参数名。
 * @module @veren/app-host-ui/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

/** One application as the gateway reports it and the dropdown renders it. */
export interface AppEntryView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly state: 'active' | 'disabled' | 'broken'
  readonly entryUrl?: string
}

/** The session an entry-page open produced. */
export interface AppOpenView {
  readonly sessionId: string
  readonly url: string
  readonly title: string
}

/** A Remote call result: the committed value, or the Host's structured refusal. */
export type AppHostResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The mounted `ctx.remote.appHost` surface. */
export interface AppHostRemoteApi {
  /** Read the installed-application catalog (one row per app, with its entry url). */
  readonly catalog: () => Promise<AppHostResult<readonly AppEntryView[]>>
  /** Open the app's entry page, or the given page url of the same app; always a fresh session. */
  readonly open: (appId: string, url?: string) => Promise<AppHostResult<AppOpenView>>
  /** The app owning one session (a page session), or null for an ordinary session. */
  readonly sessionApp: (sessionId: string) => Promise<AppHostResult<AppEntryView | null>>
  /** Stage an app on a session: the session's first message promotes into that app's page. */
  readonly stage: (appId: string, sessionId: string) => Promise<AppHostResult<AppEntryView>>
}

/** Result and parameter schemas stay loose on purpose: the Host owns the fields. */
const APP_SCHEMA = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  state: z.union([z.literal('active'), z.literal('disabled'), z.literal('broken')]),
  entryUrl: z.string().optional(),
})

const OPEN_SCHEMA = z.looseObject({ sessionId: z.string(), url: z.string(), title: z.string() })

/** Host service key owning these endpoints; the wire namespace is `appHost`. */
const SERVICE = 'appHost'

/** One strict codec over a Zod factory. */
function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** One required parameter, keyed by its Host parameter name. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

export const appHostRemote = createTypertRemoteInfo({
  package: '@veren/app-host-ui',
  methods: {
    'appHost/catalog': {
      service: SERVICE,
      description: 'Read the installed-application catalog with each app entry-page url.',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec('app-host:catalog:result', () => z.array(APP_SCHEMA)),
    },
    'appHost/open': {
      service: SERVICE,
      description: 'Open one app page (entry by default, or the given url of the same app) into a fresh page session and focus it.',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('appId', 'app-host:open:appId', () => z.string()),
        parameter('url', 'app-host:open:url', () => z.string().optional()),
      ],
      result: codec('app-host:open:result', () => OPEN_SCHEMA),
    },
    'appHost/sessionApp': {
      service: SERVICE,
      description: 'Resolve the app owning one session (a page session); null for an ordinary session.',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('sessionId', 'app-host:session-app:sessionId', () => z.string()),
      ],
      result: codec('app-host:session-app:result', () => z.union([APP_SCHEMA, z.null()])),
    },
    'appHost/stage': {
      service: SERVICE,
      description: 'Stage an app on a session: the session keeps being an ordinary composer until its first message, which promotes it into that app page.',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('appId', 'app-host:stage:appId', () => z.string()),
        parameter('sessionId', 'app-host:stage:sessionId', () => z.string()),
      ],
      result: codec('app-host:stage:result', () => APP_SCHEMA),
    },
  },
}, z)

/**
 * The host's focus notification, available through the Remote `$on` carrier.
 * The host assembly declares the same Cordis event; this browser half
 * redeclares it because the two are typechecked separately.
 *
 * 宿主的 focus 通知，经 Remote `$on` 载体到达。宿主装配声明了同一个 Cordis 事件；
 * 浏览器半边重新声明，因为两侧分别做类型检查。
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Bring one session to the GUI front. @mode emit
     * 把某条会话切到 GUI 前台。
     */
    'app-host/focus': (payload: { readonly sessionId: string }) => void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection {
    /** The toolbar follows the host's focus requests. 工具栏跟随宿主的切换请求。 */
    'app-host/focus': true
  }
}
