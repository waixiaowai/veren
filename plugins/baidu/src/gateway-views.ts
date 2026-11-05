/**
 * 网关视图面：远端方法的业务返回形状与折叠助手。领域错误必须折进业务
 * 返回值——载体层 RemoteFailure 只有 gateway/* 码，BDPAN_* 稳定码上不了
 * 线；面板据此渲染 ErrorBlock（设计 §10.10）。
 * The gateway's view face: the business result shapes of the Remote methods
 * and the folding helpers. Domain errors must fold into the business result —
 * the carrier's RemoteFailure only carries gateway/* codes, so BDPAN_* codes
 * cannot ride the wire; the panel renders its ErrorBlock from them (design
 * §10.10).
 *
 * @module @veren/baidu-pan/gateway-views
 */
import { isAbsolute } from 'node:path'
import type { BaiduPanWorld } from './world.js'
import { baiduPanError, toErrorValue, type ToolErrorValue } from './errors.js'
import { isExpiring, readStoredTokens } from './credentials.js'
import type { FileEntry, QuotaSnapshot, AccountProfile } from './types.js'

/** 业务返回信封：ok 载值，否则带稳定码的失败。The business envelope: ok carries the value, otherwise a failure with a stable code. */
export type GatewayOutcome<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean }

/** 登录状态视图（本地读凭据，不出网）。The auth-state view (local credential read, no outbound call). */
export interface AuthStateView {
  readonly authorized: boolean
  readonly expiresAt?: string
  /** 5 分钟提前量内的"快到期"。The 5-minute-skew "expiring soon". */
  readonly expiring: boolean
  readonly root: string
}

/** 登录引导视图：授权页地址与有效期（设计 §11.5 的 notice 态）。The sign-in guide view: the authorize URL and its validity (design §11.5's notice state). */
export interface SignInStartView {
  readonly url: string
  readonly expiresInMinutes: number
}

/** 目录列表视图。The directory listing view. */
export interface ListingView {
  readonly dir: string
  readonly entries: readonly FileEntry[]
}

/** 传输受理视图。The transfer-acceptance view. */
export interface JobStartedView {
  readonly jobId: string
}

/** 注销回执。The sign-out receipt. */
export interface SignOutView {
  readonly signedOut: true
}

/**
 * 通用折叠：业务闭包的抛出折成规范失败值，成功载值——网关方法体只写
 * 业务，不写 try/catch。
 * The universal fold: the business closure's throws fold into the canonical
 * failure, success carries the value — gateway method bodies stay business
 * only, no try/catch.
 */
export async function foldOutcome<Value>(run: () => Promise<Value>): Promise<GatewayOutcome<Value>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const failure: ToolErrorValue = toErrorValue(error)
    return { ok: false, code: failure.code, message: failure.message, retryable: failure.retryable }
  }
}

/** 登录状态视图装配：有无令牌、到期时间、是否将到期、授权根。Assembles the auth-state view: token presence, expiry, expiring-soon, root. */
export async function authStateView(world: BaiduPanWorld): Promise<AuthStateView> {
  const tokens = await readStoredTokens(world.credentials)
  if (tokens === undefined) return { authorized: false, expiring: false, root: world.config.root }
  return {
    authorized: true,
    expiresAt: tokens.expiresAt,
    expiring: isExpiring(tokens),
    root: world.config.root,
  }
}

/** 面板上传/下载只收绝对本地路径（面板是操作员面，无会话工作区可依）。Panel transfers take absolute local paths only (operator-facing; no session workspace to lean on). */
export function requireAbsoluteLocalPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0 || !isAbsolute(trimmed)) {
    throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'the panel needs an absolute local path' })
  }
  return trimmed
}

/** 非空关键字守卫。The non-empty keyword guard. */
export function requireKeyword(input: string | undefined): string {
  const keyword = input?.trim() ?? ''
  if (keyword.length === 0) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'keyword is required' })
  return keyword
}

/** 随机提取码：4 位数字与小写字母（share 工具同规则）。A random share password: 4 digits/lowercase letters (the share tool's rule). */
export function randomPassword(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  let password = ''
  for (let index = 0; index < 4; index += 1) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return password
}

/** 目录/检索/账号视图的按需类型再输出（客户端 import type 单一来源）。Re-exports the view-facing domain types (the client's single import-type source). */
export type { AccountProfile, QuotaSnapshot }
