/**
 * Runtime seams shared across the IM core: logging, credential removal, and
 * the DSH session gateway face, plus the one shared log-line helper.
 *
 * Tests substitute deterministic fakes for every seam here; production wires
 * them in `index.ts`. Split out of `bindings.ts` so the binding table logic
 * stays under the file-size ceiling; the export surface is unchanged —
 * `bindings.ts` re-exports every name declared here.
 *
 * IM 核心共享的运行时接缝：日志、凭据删除与 DSH 会话网关接口，外加共用的一行日志助手。
 *
 * 测试为这里的每个接缝提供确定性假实现；生产接线在 `index.ts`。按职责从 `bindings.ts`
 * 拆出，让绑定表逻辑保持在单文件行数上限内；导出面不变——`bindings.ts` 原样再导出这里
 * 声明的全部名字。
 *
 * @module @veren/im/runtime-seams
 */

import type { ImBindingSettings, ImMessageContent } from './contract.ts'

/** Logging surface shared by the router and bindings. */
export interface ImLogger {
  info?(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Credential removal seam; the DSH implementation deletes the account grant. */
export interface ImCredentialStore {
  remove(accountId: string): Promise<void>
}

/** One inbound prompt's provenance, kept out of the prompt body. */
export interface ImPromptSource {
  providerId: string
  accountId: string
  conversationId: string
  messageId: string
}

/** Session hand-off used by the router; tests provide a deterministic fake. */
export interface ImSessionGateway {
  ensureSession(request: {
    sessionId?: string
    settings: ImBindingSettings
  }): Promise<{ sessionId: string; created: boolean }>
  ask(request: {
    sessionId: string
    prompt: string
    source: ImPromptSource
  }): Promise<string | undefined>
}

/** One router-level send request; exactly one target form is allowed. */
export interface ImRouterSendRequest {
  bindingId?: string
  accountId?: string
  conversationId?: string
  content: ImMessageContent
  replyToMessageId?: string
}

/**
 * Turn an unknown value into one log line. Shared by the router, intake, the
 * gateway, and bindings — one helper instead of four copies.
 * 把未知值压成一行日志。路由、采集、网关与绑定共用这一份，不再各抄一份。
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
