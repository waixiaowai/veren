/**
 * 出站客户端身份：请求以什么 User-Agent 与 `X-IDE-Version` 自报家门。
 * Outbound client identity: the User-Agent and `X-IDE-Version` a request
 * presents as.
 *
 * 身份是**配置值 + 编译内置默认**，不读已安装的桌面 App——读桌面正是本插件
 * 要删掉的依赖。形状与上游一直收下的形态一致（两条实测红线）：
 * - chat UA：`WorkBuddy/<ver> WorkBuddy[ AI]/<ver>[ CLI/<ver>]`
 * - catalog UA（国际版）：`WorkBuddyAI/<ver>` **无空格**——带空格被拒 400/12403
 * 版本进 HTTP 头前先校验：值会被内插进头，空白/CR/LF 一律不放过（头注入向
 * 量）；配置了非法版本的 appVersion **报错而不是悄悄换默认**——替用户改值
 * 会把他的笔误藏在一个看似正常的请求后面。
 * The identity is a **configuration value with a compiled-in default**, never
 * resolved from an installed desktop app — reading the desktop is the
 * dependency this plugin exists to remove. Two measured red lines: the catalog
 * UA spells `WorkBuddyAI/<ver>` with **no space** (spaced is rejected with
 * 400/12403). Versions are validated before reaching a header (whitespace/CR/LF
 * never pass — header-injection vector); an invalid configured appVersion
 * **throws** rather than silently swapping the default — a coerced value hides
 * the user's typo behind a request that appears to work.
 *
 * 证据：docs/workbuddy-protocol.cn.md §0/§3.1；卷宗 identity.ts。
 * Evidence: docs/workbuddy-protocol.md §0/§3.1; dossier identity.ts.
 *
 * @module @veren/workbuddy-protocol/identity
 */

import { regionProfile, type WorkBuddyRegion } from './region.ts'

/** 国内版默认声称的桌面版本（声称值，非测量值：上游只在"App 形 vs CLI 形"上分叉）。 */
/** Default claimed desktop version for CN (a claim, not a measurement: the upstream branches on app-shaped vs CLI-shaped). */
export const DEFAULT_CN_APP_VERSION = '5.5.6'

/** 国际版默认桌面版本。Default claimed desktop version for the international region. */
export const DEFAULT_GLOBAL_APP_VERSION = '5.5.2'

/**
 * 能进头的版本：容忍预发布后缀；含空白/CR/LF 一律不通过（值会被内插进
 * HTTP 头，换行是头注入向量）。
 * A version that may reach a header: prerelease suffixes tolerated; whitespace,
 * CR or LF never pass (the value is interpolated into an HTTP header).
 */
export function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,6}(?:\.\d{1,6}){1,3}(?:-[0-9A-Za-z.]+)?$/u.test(value)
}

/** chat 请求的身份。The identity a chat request presents as. */
export interface ChatIdentity {
  readonly clientVersion: string
  /** 有才发 `CLI/…` 段。Present adds the `CLI/…` token; absent drops it. */
  readonly cliVersion?: string
}

/** 身份配置（全可选）。Identity configuration (all optional). */
export interface IdentityConfig {
  readonly appVersion?: string
  readonly cliVersion?: string
}

/**
 * 一个区域要声称的版本：配置优先、非法配置**拒绝而非纠正**。
 * The version to claim for one region: configuration wins; an invalid value is
 * **rejected, not coerced**.
 */
export function resolveAppVersion(region: WorkBuddyRegion, config: IdentityConfig = {}): string {
  const configured = config.appVersion
  if (configured !== undefined && configured !== '') {
    if (!validVersion(configured)) {
      throw new Error(`配置的 appVersion 无法用作请求头：${JSON.stringify(configured)}（需形如 5.5.6）`)
    }
    return configured
  }
  return region === 'global' ? DEFAULT_GLOBAL_APP_VERSION : DEFAULT_CN_APP_VERSION
}

/**
 * 组装完整 chat 身份。CLI 版本坏值**丢弃而非失败**——`CLI/…` 段对上游可选，
 * 而一条失败的消息不可恢复。
 * Resolve the full chat identity. A bad CLI version is **dropped, not fatal** —
 * the `CLI/…` token is optional upstream, a failed message is not recoverable.
 */
export function resolveChatIdentity(region: WorkBuddyRegion, config: IdentityConfig = {}): ChatIdentity {
  const clientVersion = resolveAppVersion(region, config)
  const cliVersion = config.cliVersion
  if (cliVersion !== undefined && cliVersion !== '' && validVersion(cliVersion)) {
    return { clientVersion, cliVersion }
  }
  return { clientVersion }
}

/** 所有失败路径收敛到的身份：宁可 App 形也不落 CLI 形（不同 UA 领到不同花名册）。 */
/** The identity every failure path converges on: app-shaped, never CLI-shaped (different UAs draw different rosters). */
export function fallbackChatIdentity(region: WorkBuddyRegion): ChatIdentity {
  return { clientVersion: region === 'global' ? DEFAULT_GLOBAL_APP_VERSION : DEFAULT_CN_APP_VERSION }
}

/** 组装 chat User-Agent。Build the chat User-Agent for one region. */
export function chatUserAgent(identity: ChatIdentity, region: WorkBuddyRegion): string {
  if (!validVersion(identity.clientVersion)) {
    throw new Error(`chat User-Agent 的版本不可用：${JSON.stringify(identity.clientVersion)}`)
  }
  if (identity.cliVersion !== undefined && !validVersion(identity.cliVersion)) {
    throw new Error(`chat User-Agent 的 CLI 版本不可用：${JSON.stringify(identity.cliVersion)}`)
  }
  const product = regionProfile(region).chatProduct
  const parts = [`WorkBuddy/${identity.clientVersion}`, `${product}/${identity.clientVersion}`]
  if (identity.cliVersion !== undefined) parts.push(`CLI/${identity.cliVersion}`)
  return parts.join(' ')
}

/**
 * catalog 的 App 形 User-Agent：产品段**无空格**、不重复——实测能领到 App
 * 花名册的形态；带空格的形态被 400/12403 拒。
 * The App-shaped catalog UA: product token with **no space** — the form
 * measured to draw the App roster; the spaced form is rejected with 400/12403.
 */
export function appUserAgent(version: string): string {
  if (!validVersion(version)) {
    throw new Error(`catalog User-Agent 的版本不可用：${JSON.stringify(version)}`)
  }
  return `WorkBuddyAI/${version}`
}
