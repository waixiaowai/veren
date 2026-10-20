/**
 * Windows logon autostart through the per-user Startup folder.
 *
 * Chosen over the `Run` registry key and over scheduled tasks because the
 * Startup folder needs no administrator rights, is one plain file the user can
 * read and delete by hand, and verifies by mere existence. The entry is never
 * written at boot or on install: `enable` is an explicit action, `disable` is
 * the one-call undo, and `status` is the read-only check.
 *
 * 通过「每用户启动文件夹」实现 Windows 登录自启动。不选 Run 注册表键、不选计划
 * 任务的理由：启动文件夹不需要管理员权限，只是一个用户自己就能查看和删除的普通
 * 文件，且"文件存在即生效"最易验证。启动或安装时绝不写入：`enable` 是显式动作，
 * `disable` 是一键撤销，`status` 是只读检查。
 * @module @veren/startup-autostart-recovery/os-autostart
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AutostartStatus } from './types.ts'

/** File name of the autostart entry inside the Startup folder. */
export const ENTRY_NAME = 'DeepSeek Harness (startup-autostart-recovery).cmd'

/** Structured rejection for the two ways enabling can be refused. */
export class AutostartConfigError extends Error {
  /**
   * @param code - stable machine-readable code.
   * @param message - actionable English text.
   */
  constructor(readonly code: 'platform_unsupported' | 'autostart_command_missing', message: string) {
    super(message)
    this.name = 'AutostartConfigError'
  }
}

/**
 * The per-user Startup folder. Kept next to the writer because the two are one
 * fact: the default place the entry lands.
 * @returns the folder path under the user's roaming profile.
 */
export function defaultStartupFolder(): string {
  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

/** Full path of the entry file inside `folder`. */
export function entryPath(folder: string): string {
  return join(folder, ENTRY_NAME)
}

/** Read-only check: is the entry there, and where would it be? */
export function autostartStatus(folder: string): AutostartStatus {
  const path = entryPath(folder)
  return {
    platformSupported: process.platform === 'win32',
    enabled: existsSync(path),
    entryPath: path,
  }
}

/**
 * Write the entry. Fails loud when the platform has no implementation or the
 * caller gave no command: a silent no-op would claim an autostart that will
 * never happen.
 * @param folder - the Startup folder to write into.
 * @param command - the command line that starts DeepSeek Harness.
 * @returns the status after the write.
 * @throws AutostartConfigError on a non-Windows platform or a blank command.
 */
export function enableAutostart(folder: string, command: string): AutostartStatus {
  if (process.platform !== 'win32') {
    throw new AutostartConfigError('platform_unsupported', 'logon autostart is only implemented for Windows.')
  }
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    throw new AutostartConfigError(
      'autostart_command_missing',
      'config.autostartCommand must name the command line that starts DeepSeek Harness.',
    )
  }
  mkdirSync(folder, { recursive: true })
  // `start ""` detaches: the shortcut window closes immediately after launch.
  // `start ""` 让进程脱离：启动后命令行窗口立即关闭。
  writeFileSync(entryPath(folder), `@echo off\r\nstart "" ${trimmed}\r\n`)
  return autostartStatus(folder)
}

/** The one-call undo: remove the entry, whether or not it exists. */
export function disableAutostart(folder: string): AutostartStatus {
  rmSync(entryPath(folder), { force: true })
  return autostartStatus(folder)
}
