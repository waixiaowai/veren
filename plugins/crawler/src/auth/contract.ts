/**
 * 登录与凭证契约：三种登录方式、探测结果与持久化状态（design/modules/auth.md）。
 * Auth contracts: the three login methods, the probe result and the
 * persisted login state (design/modules/auth.md).
 *
 * 凭证档案按平台隔离；Cookie 凭证不落任何数据介质，只在浏览器档案与
 * 本机内存中存在。
 * Credential profiles are platform-isolated; cookie credentials never
 * reach any data medium — browser profile and local memory only.
 *
 * @module @veren/crawler/auth/contract
 */
import type { LoginSessionState, LoginType, Platform } from '../types.ts'

/** 域与键值对 / one domain-keyed cookie pair */
export interface CookiePair {
  domain: string
  name: string
  value: string
}

/** 登录探测结果 / the login probe result */
export interface LoginProbe {
  /** 当前上下文是否已有有效登录态 / whether the context holds a valid session */
  loggedIn: boolean
  /** 各平台探测手段不同 / the probe method varies per platform */
  probeMethod: 'api' | 'page' | 'cookie'
}

/** 持久化登录状态（浏览器档案层，非数据介质）/ persisted login state (browser profile layer, not a data medium) */
export interface LoginState {
  platform: Platform
  cookieSnapshot: CookiePair[]
  /** 按平台隔离的用户数据目录 / the platform-isolated user data directory */
  persistedDir: string
}

/**
 * 统一登录契约：七平台各自实现，按 loginType 分发。
 * The unified login contract: implemented per platform, dispatched by
 * login type.
 */
export interface AbstractLogin {
  /** 本登录器服务的平台 / the platform this login serves */
  readonly platform: Platform
  /** 按 LOGIN_TYPE 分发到三种方式 / dispatch to the three methods by login type */
  begin(): Promise<void>
  /** 呈现二维码并轮询，成功返回 true / show the QR code and poll; true on success */
  loginByQrcode(): Promise<boolean>
  /** 手机号+验证码，成功返回 true / phone + code flow; true on success */
  loginByMobile(): Promise<boolean>
  /** 注入使用者提供的 Cookie 串 / inject the user-provided cookie string */
  loginByCookies(): Promise<void>
}

/** 登录探测实现 / the login probe implementation */
export type LoginProbeFn = () => Promise<LoginProbe>

/** 登录态持久化实现（覆盖式写入）/ the persistence implementation (overwriting write) */
export type PersistLoginFn = (state: LoginState) => Promise<void>

/** 登录方式运行时输入 / the runtime inputs of a login attempt */
export interface LoginFlowDeps {
  /** 当前登录方式 / the login method */
  loginType: LoginType
  /** cookie 方式的凭证串 / the cookie string for cookie login */
  cookies: string | null
  /** 平台登录器 / the platform login implementation */
  login: AbstractLogin
  /** 登录探测 / the login probe */
  probe: LoginProbeFn
  /** 登录态持久化 / login-state persistence */
  persist: PersistLoginFn
  /** 浏览器档案根目录（缺省 ./browser-data）/ the profile root directory (defaults to ./browser-data) */
  profileRoot?: string
}

/** 登录流程对外可观测的状态源 / the observable login-state source of the flow */
export interface LoginFlowResult {
  /** 终态 / the final state */
  state: LoginSessionState
  /** 命中缓存的探测结果（未登录时为 null）/ the cache-hit probe (null when a login ran) */
  probeHit: LoginProbe | null
}
