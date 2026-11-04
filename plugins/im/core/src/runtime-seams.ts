/**
 * Runtime seams shared across the IM core: logging, credential removal, and
 * the one shared log-line helper.
 *
 * Tests substitute deterministic fakes for every seam here; production wires
 * them in `index.ts`. The session hand-off seam lives in @veren/im-turn since
 * the 3.0 redesign — the turn executor owns session provisioning.
 *
 * IM 核心共享的运行时接缝：日志、凭据删除，以及共用的一行日志助手。
 *
 * 测试为这里的每个接缝提供确定性假实现；生产接线在 `index.ts`。自 3.0 重设计起，会话交接
 * 接缝移居 @veren/im-turn——回合执行器拥有会话筹备。
 *
 * @module @veren/im/runtime-seams
 */

import { defineToken } from '@veren/core'

/** Logging surface shared by bindings, intake, and the people directory. */
/** 绑定、采集与人员目录共用的日志面。 */
export interface ImLogger {
  info?(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** The logger seam's service token; the plugin provides the host projection. */
/** 日志接缝的服务令牌；插件提供宿主投影。 */
export const ImLoggerToken = defineToken<ImLogger>('imLogger')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The projected host logger. */
    /** 投影后的宿主日志器。 */
    imLogger: ImLogger
  }
}

/** Credential removal seam; the DSH implementation deletes the account grant. */
/** 凭据删除接缝；DSH 实现删除账号授权记录。 */
export interface ImCredentialStore {
  remove(accountId: string): Promise<void>
}

/** The credential seam's service token; the plugin provides the DSH-backed one. */
/** 凭据接缝的服务令牌；插件提供基于 DSH 的实现。 */
export const ImCredentialToken = defineToken<ImCredentialStore>('imCredentials')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The DSH-backed credential removal seam. */
    /** 基于 DSH 的凭据删除接缝。 */
    imCredentials: ImCredentialStore
  }
}

/**
 * Turn an unknown value into one log line. Shared by intake, accounts, and
 * bindings — one helper instead of three copies.
 * 把未知值压成一行日志。采集、账号与绑定共用这一份，不再各抄一份。
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
