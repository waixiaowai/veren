/**
 * 刷新的**线路层**：请求形状、轮换语义、惰性判定。
 * The refresh **wire layer**: request shape, rotation semantics, laziness test.
 *
 * 单飞与跨进程锁的**编排**住在壳层（凭据记录缝自带跨进程串行化）；本模块只
 * 回答两个纯问题：这个凭据需要刷吗？一次刷新在线路上长什么样？
 * Single-flight and cross-process **orchestration** live in the shell (the
 * credential-record seam is serialized across processes by itself); this module
 * answers two pure questions: does this credential need a refresh, and what
 * does one refresh look like on the wire.
 *
 * 轮换是账号安全性质：响应带新 refresh token、旧令牌即作废。并发刷新的第
 * 二个请求发送的是已被消费的令牌——上游读作被盗令牌重放，正是风控要抓的
 * 形状。因此编排层必须保证"一账号一时刻至多一个刷新在飞"。
 * Rotation is an account-safety property: the response carries a new refresh
 * token and the old one is spent. The second of two concurrent refreshes sends
 * a consumed token — upstream reads it as a stolen-token replay, exactly what
 * risk control hunts. The orchestration layer must therefore keep at most one
 * refresh in flight per account.
 *
 * 证据：docs/workbuddy-protocol.cn.md §2；卷宗 refresh.ts。
 * Evidence: docs/workbuddy-protocol.md §2; dossier refresh.ts.
 *
 * @module @veren/workbuddy-protocol/refresh
 */

import { regionProfile, type WorkBuddyRegion } from './region.ts'

/** 刷新端点。The refresh endpoint. */
export const REFRESH_PATH = '/v2/plugin/auth/token/refresh'

/**
 * 提前刷新边际：5 分钟（对齐参考实现），稳超一个聊天回合——令牌不会在
 * 检查与使用之间过期。
 * Refresh margin: five minutes (matching the reference implementations),
 * comfortably longer than one chat turn.
 */
export const REFRESH_MARGIN_MS = 5 * 60_000

/** 刷新 UA。The refresh UA. */
export const REFRESH_USER_AGENT = 'CLI/2.63.2 CodeBuddy/2.63.2'

/** 线路层的最小凭据视图。The minimal credential view the wire layer needs. */
export interface RefreshableCredential {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAtMs: number
  readonly domain: string
  readonly uid: string
  readonly enterpriseId?: string
  readonly region: WorkBuddyRegion
}

/** 一次线路刷新的产出。The outcome of one wire refresh. */
export interface RefreshTokens {
  readonly accessToken: string
  /** 轮换：上游给了新 refresh token 就用它；没给则旧令牌仍有效。Rotation: use the new token when offered; absence means the old one stays valid. */
  readonly refreshToken?: string
  readonly expiresInSec?: number
  readonly domain?: string
}

/** 刷新端点期望的头（X-Refresh-Token 只出现在这里）。 */
/** Headers the refresh endpoint expects (X-Refresh-Token appears here and nowhere else). */
export function refreshHeaders(credential: RefreshableCredential): Record<string, string> {
  const profile = regionProfile(credential.region)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': REFRESH_USER_AGENT,
    Origin: profile.origin,
    Referer: `${profile.origin}/`,
    'X-Refresh-Token': credential.refreshToken,
    // 上游按此头判别刷新来源；参考实现发 cn=`workbuddy`、global=`plugin`，
    // 发错对它们可见——值从区域表取，不许调用方自定。
    // The upstream discriminates refresh origin on this header; values come
    // from the region table and callers may not invent their own.
    'X-Auth-Refresh-Source': profile.refreshSource,
    'X-User-Id': credential.uid,
    'X-CodeBuddy-Request': '1',
    'Accept-Language': profile.acceptLanguage,
  }
  if (credential.domain !== '') headers['X-Domain'] = credential.domain
  if (credential.enterpriseId !== undefined && credential.enterpriseId !== '') {
    headers['X-Enterprise-Id'] = credential.enterpriseId
  }
  return headers
}

/**
 * 这个凭据需要刷吗（惰性判定：距过期 ≤ 边际）。
 * 无 refresh token 的凭据回答"不需要"——报"需要"会让每次调用都注定失败地
 * 试一轮；正确出路是重新登录。
 * Does this credential need a refresh (lazy: expiry within the margin)? A
 * credential without a refresh token answers "no" — "yes" would make every call
 * attempt a refresh destined to fail; the fix is signing in again.
 */
export function needsRefresh(credential: RefreshableCredential, now: number, marginMs: number = REFRESH_MARGIN_MS): boolean {
  if (credential.refreshToken === '') return false
  return credential.expiresAtMs - marginMs <= now
}

/** 从上游嵌套不稳定的信封里抽出令牌（`{data:{...}}` 与 `{data:{data:{...}}}` 都见过）。 */
/** Pull the tokens out of the unstably nested envelope (both `{data:{...}}` and `{data:{data:{...}}}` seen). */
export function extractRefreshTokens(payload: unknown): RefreshTokens | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const root = payload as Record<string, unknown>
  const first = root['data']
  const inner = typeof first === 'object' && first !== null && 'data' in (first as Record<string, unknown>)
    ? (first as Record<string, unknown>)['data']
    : first
  if (typeof inner !== 'object' || inner === null) return undefined
  const body = inner as Record<string, unknown>
  if (typeof body['accessToken'] !== 'string' || body['accessToken'] === '') return undefined
  return {
    accessToken: body['accessToken'],
    ...(typeof body['refreshToken'] === 'string' && body['refreshToken'] !== ''
      ? { refreshToken: body['refreshToken'] } : {}),
    ...(typeof body['expiresIn'] === 'number' && Number.isFinite(body['expiresIn']) && body['expiresIn'] > 0
      ? { expiresInSec: body['expiresIn'] } : {}),
    ...(typeof body['domain'] === 'string' && body['domain'] !== '' ? { domain: body['domain'] } : {}),
  }
}
