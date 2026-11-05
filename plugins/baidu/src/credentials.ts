/**
 * 凭据面：`baidu-pan/account` 记录是本插件唯一的 OAuth 令牌来源。令牌以
 * grant 记录（owner-defined payload）进凭据库，永不进配置文件、永不进日志；
 * 读取方只回答"有没有/快没到期了吗"，值只在出网请求里瞬时存在。
 * The credential face: the `baidu-pan/account` record is this plugin's only
 * OAuth-token source. Tokens land in the credential store as a grant record
 * (owner-defined payload), never in config files, never in logs; readers
 * answer only "is one stored / is it about to expire", and the values exist
 * transiently inside outbound requests.
 *
 * @module @veren/baidu-pan
 */
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { baiduPanError, parseGrantPayload } from './errors.js'
import type { OAuthTokens } from './types.js'

/** 本插件持有的凭据记录键：scope 是插件名，id 命名它唯一的授权。The credential record this plugin owns: the scope is the plugin name, the id names its single grant. */
export const BAIDU_PAN_RECORD = credentialKey('baidu-pan', 'account')

/** 令牌提交点（授权流与刷新共用；由凭据面注入）。The token commit point (shared by the auth flow and refresh; injected by the credential face). */
export type OAuthCommit = (tokens: OAuthTokens) => Promise<void>

/** 提前量：到期前 5 分钟即视为需要刷新。The skew: within 5 minutes of expiry counts as expiring. */
export const EXPIRY_SKEW_MS = 5 * 60 * 1000

/**
 * 读取已存储的令牌；未授权回答 undefined（调用方决定是报
 * BDPAN_AUTH_REQUIRED 还是引导登录）。形状不符的旧载荷一律视为未授权。
 * Reads the stored tokens; signed out answers undefined (the caller decides
 * between BDPAN_AUTH_REQUIRED and guiding a sign-in). A legacy payload with
 * the wrong shape reads as signed out.
 */
export async function readStoredTokens(credentials: CredentialProvider): Promise<OAuthTokens | undefined> {
  const record: CredentialRecord | undefined = await credentials.readRecord(BAIDU_PAN_RECORD)
  if (record === undefined || record.kind !== 'grant') return undefined
  return parseGrantPayload(record.payload)
}

/**
 * 请求路径的令牌解析：没有就是响亮的 BDPAN_AUTH_REQUIRED，不静默、不回退。
 * Request-path token resolution: absence is a loud BDPAN_AUTH_REQUIRED —
 * no silent fallback, no downgrade.
 */
export async function requireStoredTokens(credentials: CredentialProvider): Promise<OAuthTokens> {
  const tokens = await readStoredTokens(credentials)
  if (tokens === undefined) throw baiduPanError('BDPAN_AUTH_REQUIRED')
  return tokens
}

/** 提交一组新令牌（授权流与刷新的唯一写入点）。Commits a new token set (the only write point for sign-in and refresh). */
export async function commitTokens(credentials: CredentialProvider, tokens: OAuthTokens): Promise<void> {
  await credentials.modifyRecord(BAIDU_PAN_RECORD, async () => ({ kind: 'grant', payload: tokens }))
}

/** 注销：清除凭据记录。Signs out by deleting the credential record. */
export async function signOut(credentials: CredentialProvider): Promise<void> {
  await credentials.deleteRecord(BAIDU_PAN_RECORD)
}

/** 判断令牌是否已到期或临近到期（5 分钟提前量）。Whether the tokens are expired or about to be (5-minute skew). */
export function isExpiring(tokens: OAuthTokens, now: number = Date.now()): boolean {
  return Date.parse(tokens.expiresAt) - EXPIRY_SKEW_MS <= now
}
