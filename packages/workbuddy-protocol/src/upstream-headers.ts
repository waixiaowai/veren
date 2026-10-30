/**
 * 上游请求头建造器：common / chat / billing 三族。
 * Upstream header builders: the common / chat / billing families.
 *
 * 账号身份字段缺哪个就发对应的 `X-No-<字段>: 1`——不发空白头（空白头=向上游
 * 登记一个无身份设备，比不发更糟）。X-Agent 族的不对称是承重的：intent/
 * purpose 两区域都发，`type: main` 仅国际版。
 * When an account-identity field is absent its `X-No-<Field>: 1` counterpart is
 * sent instead — never a blank header (blank registers a device with no
 * identity). The X-Agent asymmetry is load-bearing: intent/purpose go out on
 * both regions, `type: main` on the international region only.
 *
 * 证据：docs/workbuddy-protocol.cn.md §3.1/§5；卷宗 upstream.ts:425-507, 692-706。
 * Evidence: docs/workbuddy-protocol.md §3.1/§5; dossier upstream.ts:425-507, 692-706.
 *
 * @module @veren/workbuddy-protocol/upstream-headers
 */

import { deviceHeaders } from './fingerprint.ts'
import type { ChatIdentity } from './identity.ts'
import { regionProfile, type WorkBuddyRegion } from './region.ts'
import type { RefreshableCredential } from './refresh.ts'

/** chat/探测请求要展示的身份（调用方已按区域解析好）。The identity a chat/probe request presents (region-resolved by the caller). */
export interface ChatRequestIdentity {
  readonly identity: ChatIdentity
  readonly userAgent: string
}

/**
 * X-Agent 身份族：intent/purpose/type 三件，**两区域都发**。
 * The X-Agent identity family: intent/purpose/type, sent on **both** regions.
 *
 * 历史与实测（偏离记录在案）：PR #1 时代（2026-09）的观测是 `type: main` 仅
 * 国际版发送、CN 发它会被拒；卷宗据此做了区域不对称。2026-10-30 本机真机实测
 * 推翻：CN chat 端点对只有 intent/purpose 的请求回答 400/11128「请求被拦截，
 * 请重新发送」，补上 `X-Agent-Type: main` 后放行——CN 风控已升级到与國际版同
 * 一族。三件套是当前唯一实测皆过的形态，因此不再区分两个半族。
 * History and measured divergence on record: PR #1 (2026-09) observed
 * `type: main` as international-only, with CN rejecting it; the dossier encoded
 * that asymmetry. A live measurement on 2026-10-30 overturns it: the CN chat
 * endpoint answers 400/11128 「请求被拦截，请重新发送」 to a request carrying
 * only intent/purpose, and passes once `X-Agent-Type: main` is added — CN risk
 * control has converged with the international one. The full trio is the only
 * form measured good everywhere today, so the two half-families are gone.
 *
 * 值是字面常量不是配置：它们命名调用方的种类，调用方自选值等于说谎。
 * The values are literal constants, not configuration: they name the *kind* of
 * client making the call; a caller-chosen value would be a caller lying.
 */
export const AGENT_HEADERS: Readonly<Record<string, string>> = {
  'X-Agent-Intent': 'craft',
  'X-Agent-Purpose': 'conversation',
  'X-Agent-Type': 'main',
}

/** 按 X-Agent 族取用（两区域同形；保留区域参数以稳定调用点签名）。 */
/** The X-Agent family for one region (identical across regions; the region parameter keeps call sites stable). */
export function agentHeadersFor(_region: WorkBuddyRegion): Readonly<Record<string, string>> {
  return AGENT_HEADERS
}

/** 每个上游请求共享的头。Headers every upstream request shares. */
export function commonHeaders(region: WorkBuddyRegion, userAgent: string): Record<string, string> {
  const { origin } = regionProfile(region)
  return {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': origin,
    'Referer': `${origin}/`,
    'User-Agent': userAgent,
  }
}

/** 空值字段的"无"替身头。The "no" stand-in headers for absent identity fields. */
function identityHeaders(uid: string, enterpriseId: string | undefined, domain: string): Record<string, string> {
  return {
    ...(uid === '' ? { 'X-No-User-Id': '1' } : { 'X-User-Id': uid }),
    ...(enterpriseId === undefined || enterpriseId === ''
      ? { 'X-No-Enterprise-Id': '1' } : { 'X-Enterprise-Id': enterpriseId }),
    ...(domain === '' ? { 'X-No-Department-Info': '1' } : { 'X-Domain': domain }),
  }
}

/**
 * chat 请求头：common + 桌面身份族 + 账号身份族（带 X-No-* 替身）+ 设备指纹
 * 族（空 uid 整族不发）+ 授权。X-Agent 族由调用方按区域另行 Object.assign。
 * Chat headers: common + desktop identity + account identity (with X-No-*
 * stand-ins) + device fingerprints (omitted entirely for an empty uid) +
 * authorization. The X-Agent family is assigned by the caller per region.
 */
export function chatHeaders(
  credential: RefreshableCredential,
  requestIdentity: ChatRequestIdentity,
): Record<string, string> {
  return {
    ...commonHeaders(credential.region, requestIdentity.userAgent),
    'Content-Type': 'application/json',
    ...identityHeaders(credential.uid, credential.enterpriseId, credential.domain),
    ...deviceHeaders(credential.uid),
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Version': requestIdentity.identity.clientVersion,
    'X-Product': 'SaaS',
    'Authorization': `Bearer ${credential.accessToken}`,
  }
}

/** 刷新端点头（与 chat 头刻意不同源，两条路径漂不进彼此）。 */
/** Refresh headers (deliberately a separate family from chat so the paths cannot drift into each other). */
export function refreshRequestHeaders(credential: RefreshableCredential): Record<string, string> {
  const profile = regionProfile(credential.region)
  const headers: Record<string, string> = {
    ...commonHeaders(credential.region, 'CLI/2.63.2 CodeBuddy/2.63.2'),
    'X-Refresh-Token': credential.refreshToken,
    'X-Auth-Refresh-Source': profile.refreshSource,
    ...(credential.uid === '' ? {} : { 'X-User-Id': credential.uid }),
  }
  if (credential.enterpriseId !== undefined && credential.enterpriseId !== '') {
    headers['X-Enterprise-Id'] = credential.enterpriseId
  }
  return headers
}

/** 计费端点头：授权 + 账号/租户身份（只在有值时发）。Billing headers: authorization plus account/tenant identity when present. */
export function billingHeaders(credential: RefreshableCredential): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${credential.accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }
  if (credential.uid !== '') headers['X-User-Id'] = credential.uid
  if (credential.enterpriseId !== undefined && credential.enterpriseId !== '') {
    headers['X-Enterprise-Id'] = credential.enterpriseId
    headers['X-Tenant-Id'] = credential.enterpriseId
  }
  if (credential.domain !== '') headers['X-Domain'] = credential.domain
  return headers
}

/** 目录端点头：按客户端身份分流（CN=CLI UA，国际=App 无空格 UA）。 */
/** Catalog headers: split by client identity (CN = CLI UA, international = the no-space App UA). */
export function catalogHeaders(
  credential: RefreshableCredential,
  userAgent: string,
  international: boolean,
): Record<string, string> {
  const { origin } = regionProfile(credential.region)
  return {
    'Authorization': `Bearer ${credential.accessToken}`,
    'Accept': 'application/json',
    'Origin': origin,
    'Referer': `${origin}/`,
    ...(international ? { 'X-Requested-With': 'XMLHttpRequest', 'X-Product': 'SaaS' } : {}),
    'User-Agent': userAgent,
  }
}
