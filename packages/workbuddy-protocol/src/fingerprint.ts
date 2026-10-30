/**
 * 稳定设备指纹派生。只用于 chat/billing/task 端点；**登录流程零指纹**。
 * Stable device-fingerprint derivation. Chat/billing/task endpoints only; the
 * sign-in flow carries **zero** fingerprints.
 *
 * 为什么存在：上游把请求当作来自物理设备。每个进程发明新机器 id、或干脆不
 * 发，等于每次启动都换新设备——正是风控用来标记多账号关联的形状。全部成熟
 * 项目收敛到同一解法：**从账号 uid 确定性派生**，同账号恒定一台"设备"、跨
 * 账号互相隔离。空 uid 时整头不发（发空白头=登记无身份设备，更糟）。
 * Why this exists: the upstream treats requests as coming from a physical
 * device. A fresh machine id per process, or none, reads as a new device every
 * launch — the pattern risk control flags for multi-account correlation. Every
 * mature project converged on deriving the id deterministically from the uid.
 * With an empty uid the headers are omitted entirely.
 *
 * 派生式（`md5("wb2a:<purpose>:<uid>")` 全 32 hex）沿用上游一直在无障碍服务
 * 的那一支（workbuddy2api 的 `derive_id`），不改命名空间前缀——改了等于全体
 * 账号集体"换设备"。
 * The `md5("wb2a:<purpose>:<uid>")` scheme follows the MD5 line the upstream
 * has been serving without issue; the namespace prefix must never change —
 * changing it reads upstream as every account moving to a new device.
 *
 * 证据：docs/workbuddy-protocol.cn.md §1/§3.1；卷宗 fingerprint.ts。
 * Evidence: docs/workbuddy-protocol.md §1/§3.1; dossier fingerprint.ts.
 *
 * @module @veren/workbuddy-protocol/fingerprint
 */

import { createHash } from 'node:crypto'

/** 派生命名空间前缀，禁止变更。Namespace prefix; changing it changes every id upstream has seen. */
const ID_NAMESPACE = 'wb2a'

/** MD5 全长 32 hex（参考实现的 `[:36]` 在 32 字符串上是空转，全摘要即所服务形态）。 */
/** The full 32-hex MD5 digest (the reference's `[:36]` is a no-op on 32 characters). */
const DERIVED_ID_HEX_LENGTH = 32

/**
 * 为一个账号与用途派生稳定 id。uid 必填：没有它就没有稳定基底，返回常量会
 * 让所有账号共享一台"设备"。空 uid 返回 undefined，调用方跳过该头。
 * Derive a stable id for one account and purpose. The uid is required: without
 * one there is no stable basis. Empty uid yields undefined — callers skip the
 * header entirely.
 */
export function deriveId(purpose: string, uid: string): string | undefined {
  if (uid === '') return undefined
  return createHash('md5').update(`${ID_NAMESPACE}:${purpose}:${uid}`, 'utf8').digest('hex').slice(0, DERIVED_ID_HEX_LENGTH)
}

/** chat 请求的两个设备头。The two device headers a chat request carries. */
export interface DeviceHeaders {
  'X-Machine-ID': string
  'X-Session-ID': string
}

/** 组装一个账号的设备身份头；空 uid 返回空对象（不是空白头）。 */
/** Build one account's device headers; an empty uid yields an empty object, never blank headers. */
export function deviceHeaders(uid: string): DeviceHeaders {
  const machine = deriveId('machine', uid)
  const session = deriveId('session', uid)
  if (machine === undefined || session === undefined) return {} as DeviceHeaders
  return { 'X-Machine-ID': machine, 'X-Session-ID': session }
}

/**
 * 请求 id 的稳定前缀：上游按请求 id 聚合一个回合的账目，每次随机会把一回合
 * 碎片化成多条计费可见行。
 * Stable prefix for request ids: the upstream aggregates a conversation turn by
 * request id; a random id per call fragments one turn into many billing rows.
 */
export function requestIdPrefix(uid: string): string {
  return deriveId('req', uid) ?? 'wb2a-anonymous'
}

/** 稳定前缀 + 唯一后缀的请求 id。A request id with a stable per-account prefix and a unique suffix. */
export function requestId(uid: string, now: number = Date.now()): string {
  const suffix = String(now % 1_000_000).padStart(6, '0')
  return `${requestIdPrefix(uid)}-${suffix}`
}
