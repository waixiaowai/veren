/**
 * 凭据记录文档：全部账号状态（凭据/冷却/停用/探测四类）同住一张 grant 载荷，
 * 全部以 uid 为键。
 * The credential-record document: all account state (credential / cooldown /
 * disabled / probe — four classes) shares one grant payload, all keyed by uid.
 *
 * 为什么单文档：宿主凭据缝的 `modifyRecord` 是**跨进程串行的读-改-写**（文档
 * 原文："which is what makes a token refresh safe"）——把四类状态放进同一张
 * 文档，登出的"四类清除"就由构造保证原子完成，冷却持久化与凭据原子写全部
 * 免费获得。取舍：单文档写的竞争面比四文件大（一次失败冷却也改写全档），
 * 对个人装机的频度可忽略。
 * Why one document: the host credential seam's `modifyRecord` is a cross-process
 * serialized read-modify-write ("which is what makes a token refresh safe") —
 * with all four classes in one document, logout's four-class purge is atomic by
 * construction, and cooldown persistence plus atomic writes come free. The
 * trade: one document takes more write contention than four files, negligible
 * at personal-install frequency.
 *
 * @module @veren/workbuddy-protocol/state-doc
 */

import type { WorkBuddyEffort } from './catalog-types.ts'
import { regionOfDomain, type WorkBuddyRegion } from './region.ts'

/** 盘上格式版本；读取端拒绝其它版本而不是猜。On-disk format version; readers reject anything else rather than guess. */
export const STATE_DOCUMENT_VERSION = 1

/** 一个账号的完整凭据条目（时间戳一律 epoch 毫秒；上游 expiresIn 秒在此边界转换）。 */
/** One account's full credential entry (timestamps in epoch ms; the upstream's seconds convert exactly at this boundary). */
export interface WorkbuddyAccountEntry {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAtMs: number
  /** 上游域，区域由它重算（不从盘上信）。The upstream domain; the region recomputes from it. */
  readonly domain: string
  readonly uid: string
  readonly enterpriseId?: string
  readonly nickname?: string
}

/** 一次探测的存档观测。One archived probe observation. */
export interface ProbeObservationDocument {
  readonly validation: 'validating' | 'non-validating' | 'unknown'
  readonly efforts: readonly WorkBuddyEffort[]
  readonly observedAtMs: number
}

/** 一个账号的探测记录（按区域分文档语义，键含区域）。One account's probe records (region-scoped by key). */
export interface ProbeRecordDocument {
  readonly byRegion: Partial<Record<WorkBuddyRegion, { readonly byModel: Record<string, ProbeObservationDocument> }>>
}

/** 凭据记录的 grant 载荷。The grant payload of the credential record. */
export interface WorkbuddyStateDocument {
  readonly version: typeof STATE_DOCUMENT_VERSION
  readonly accounts: readonly WorkbuddyAccountEntry[]
  /** uid → 冷却截止（epoch ms）。uid → cool-until epoch ms. */
  readonly cooldowns: Readonly<Record<string, number>>
  /** 停用账号 uid 集。Disabled account uids. */
  readonly disabled: readonly string[]
  /** uid → 探测记录。uid → probe records. */
  readonly probes: Readonly<Record<string, ProbeRecordDocument>>
}

/** 空文档。The empty document. */
export function emptyStateDocument(): WorkbuddyStateDocument {
  return { version: STATE_DOCUMENT_VERSION, accounts: [], cooldowns: {}, disabled: [], probes: {} }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 帐号条目守卫。The account-entry guard. */
function isAccountEntry(value: unknown): value is WorkbuddyAccountEntry {
  if (!isObject(value)) return false
  return typeof value['accessToken'] === 'string' && value['accessToken'] !== ''
    && typeof value['refreshToken'] === 'string'
    && typeof value['uid'] === 'string' && value['uid'] !== ''
    && typeof value['domain'] === 'string'
    && typeof value['expiresAtMs'] === 'number' && Number.isFinite(value['expiresAtMs'])
}

/**
 * 解析一份 grant 载荷；形状不符返回 undefined（调用方以空文档续跑，不猜）。
 * Parse a grant payload; a wrong shape answers undefined (callers continue from
 * an empty document, never guess).
 */
export function parseStateDocument(value: unknown): WorkbuddyStateDocument | undefined {
  if (!isObject(value) || value['version'] !== STATE_DOCUMENT_VERSION) return undefined
  if (!Array.isArray(value['accounts']) || !value['accounts'].every(isAccountEntry)) return undefined
  const cooldowns = value['cooldowns']
  if (!isObject(cooldowns)) return undefined
  const probes = value['probes']
  if (!isObject(probes)) return undefined
  const disabled = value['disabled']
  if (!Array.isArray(disabled) || !disabled.every(uid => typeof uid === 'string')) return undefined
  return {
    version: STATE_DOCUMENT_VERSION,
    accounts: value['accounts'],
    cooldowns: cooldowns as Record<string, number>,
    disabled: disabled as readonly string[],
    probes: probes as Record<string, ProbeRecordDocument>,
  }
}

/** 读文档里一个账号（region 按 domain 重算——盘上不存 region）。 */
/** Read one account (the region recomputes from the domain — never stored). */
export function regionOfEntry(entry: WorkbuddyAccountEntry): WorkBuddyRegion {
  return regionOfDomain(entry.domain)
}

/** 登入/刷新后的整档替换（按 uid upsert，保序）。Replace the document after a sign-in or refresh (upsert by uid, order kept). */
export function withAccountEntry(document: WorkbuddyStateDocument, entry: WorkbuddyAccountEntry): WorkbuddyStateDocument {
  const accounts = document.accounts.filter(account => account.uid !== entry.uid)
  const existing = document.accounts.find(account => account.uid === entry.uid)
  if (existing !== undefined) {
    const index = document.accounts.indexOf(existing)
    accounts.splice(index, 0, entry)
  } else {
    accounts.push(entry)
  }
  return { ...document, accounts }
}

/**
 * 登出：一个账号的四类痕迹一次删净——只删凭据会让 uid 留在其余三类里（隐私
 * 泄漏；同 uid 再登录时旧停用态/旧探测结论悄悄生效）。
 * Logout: one account's four classes erased at once — deleting only the
 * credential leaves the uid in the rest (a privacy leak; a re-sign-in would
 * silently re-apply the old disabled flag or stale probe verdicts).
 */
export function withoutAccount(document: WorkbuddyStateDocument, uid: string): WorkbuddyStateDocument {
  const probes = { ...document.probes }
  delete probes[uid]
  const cooldowns = { ...document.cooldowns }
  delete cooldowns[uid]
  return {
    version: STATE_DOCUMENT_VERSION,
    accounts: document.accounts.filter(account => account.uid !== uid),
    cooldowns,
    disabled: document.disabled.filter(disabled => disabled !== uid),
    probes,
  }
}

/** 记一笔冷却。Note one cooldown. */
export function withCooldown(document: WorkbuddyStateDocument, uid: string, untilMs: number): WorkbuddyStateDocument {
  return { ...document, cooldowns: { ...document.cooldowns, [uid]: untilMs } }
}

/** 启停一个账号（幂等）。Enable or disable one account (idempotent). */
export function withDisabled(document: WorkbuddyStateDocument, uid: string, disabled: boolean): WorkbuddyStateDocument {
  const set = new Set(document.disabled)
  if (disabled) set.add(uid)
  else set.delete(uid)
  return { ...document, disabled: [...set].sort() }
}

/** 存一条探测观测。Archive one probe observation. */
export function withProbeObservation(
  document: WorkbuddyStateDocument,
  uid: string,
  region: WorkBuddyRegion,
  model: string,
  observation: ProbeObservationDocument,
): WorkbuddyStateDocument {
  const current = document.probes[uid] ?? { byRegion: {} }
  const regionRecord = current.byRegion[region] ?? { byModel: {} }
  const merged: ProbeRecordDocument = {
    byRegion: {
      ...current.byRegion,
      [region]: { byModel: { ...regionRecord.byModel, [model]: observation } },
    },
  }
  return { ...document, probes: { ...document.probes, [uid]: merged } }
}
