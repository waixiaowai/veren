/**
 * 登录态持久化：把登录元数据写进浏览器档案目录（design/modules/auth.md §5）。
 * Login-state persistence: writes the login metadata into the browser
 * profile directory (auth.md §5).
 *
 * 只写元数据（平台、档案目录、时间、Cookie 名），**绝不写 Cookie 值**——
 * 凭证只活在浏览器档案与本机内存里。
 * Metadata only (platform, profile directory, timestamp, cookie names),
 * **never cookie values** — credentials live solely in the browser profile
 * and local memory.
 *
 * @module @veren/crawler/auth/persist
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoginState } from './contract.ts'

/** 登录态文件名 / the login-state file name */
export const LOGIN_STATE_FILE = 'login-state.json'

/** 落盘的登录态摘要 / the persisted login-state summary */
export interface LoginStateSummary {
  /** 平台标识 / the platform identifier */
  platform: string
  /** 档案目录 / the profile directory */
  persistedDir: string
  /** 登录时刻（ISO）/ the login timestamp (ISO) */
  loggedInAt: string
  /** Cookie 名（不含值）/ cookie names without values */
  cookieNames: string[]
}

/** 摘要化：抹掉一切凭证值 / summarizes: every credential value is dropped */
export function summarizeLoginState(state: LoginState, now = new Date()): LoginStateSummary {
  return {
    platform: state.platform,
    persistedDir: state.persistedDir,
    loggedInAt: now.toISOString(),
    cookieNames: state.cookieSnapshot.map((cookie) => cookie.name),
  }
}

/**
 * 写入登录态摘要（目录不存在则创建）。
 * Writes the login-state summary (creating the directory when absent).
 */
export async function persistLoginState(state: LoginState): Promise<void> {
  await mkdir(state.persistedDir, { recursive: true })
  const body = `${JSON.stringify(summarizeLoginState(state), null, 2)}\n`
  await writeFile(join(state.persistedDir, LOGIN_STATE_FILE), body, 'utf8')
}
