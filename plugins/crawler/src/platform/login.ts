/**
 * 平台登录注册表：按平台给出探测与登录器（design/modules/auth.md §3）。
 * The platform login registry: probe and login per platform (auth.md §3).
 *
 * 未接入登录的平台在这里 fail loud（INVALID_PLATFORM），管线不会带着
 * 「假装已登录」的状态进入采集。
 * Platforms without a login implementation fail loud here (INVALID_PLATFORM);
 * the pipeline never enters a crawl on a pretend session.
 *
 * @module @veren/crawler/platform/login
 */
import { invalidPlatform } from '../errors.ts'
import { createWbLogin, probeWbLoggedIn } from './wb/auth.ts'
import { createTiebaLogin, probeTiebaLoggedIn } from './tieba/auth.ts'
import { createBiliLogin, probeBiliLoggedIn } from './bili/auth.ts'
import type { AbstractLogin, LoginProbe } from '../auth/contract.ts'
import type { BrowserSession } from '../browser/contract.ts'
import type { CrawlerRunRequest } from '../control/runner.ts'
import type { Platform } from '../types.ts'

/** 平台登录面：探测 + 登录器 / the platform login face: probe plus login */
export interface PlatformAuth {
  /** 登录探测 / the login probe */
  probe: () => Promise<LoginProbe>
  /** 登录器 / the login implementation */
  login: AbstractLogin
}

/**
 * 造平台登录面：只认已接入登录的平台。
 * Builds the platform login face: only platforms with a login wired in.
 */
export function createPlatformAuth(platform: Platform, session: BrowserSession, request: CrawlerRunRequest): PlatformAuth {
  if (platform === 'wb') {
    return { probe: async () => await probeWbLoggedIn(session), login: createWbLogin(session, request) }
  }
  if (platform === 'tieba') {
    return { probe: async () => await probeTiebaLoggedIn(session), login: createTiebaLogin(session, request) }
  }
  if (platform === 'bili') {
    return { probe: async () => await probeBiliLoggedIn(session), login: createBiliLogin(session, request) }
  }
  throw invalidPlatform(platform)
}
