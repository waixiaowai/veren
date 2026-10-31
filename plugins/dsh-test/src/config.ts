/**
 * dsh-test configuration: Standard Schema validation, defaults, and the
 * DSH_SRC location default.
 *
 * 校验走 Standard Schema，因此 bundle 不携带任何运行时 schema 依赖；部署相关的
 * 选择都是 cordis.yml 里可改的配置字段。
 * Validation runs as a Standard Schema so the bundle carries no runtime schema
 * dependency; deployment-varying choices are config fields changeable from
 * cordis.yml.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DshTestConfig, StandardValidation } from './types.js'

/** Workspace root containing this plugin (`plugins/<name>` -> workspace root). */
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Validation issues accumulated by one `validate` run. 单次 validate 累积的校验问题。 */
type ValidationIssues = Array<{ message: string }>

/**
 * Default DSH_SRC: the first deepseek-harness checkout found beside this
 * plugin's directory, falling back to the workspace root.
 */
export function defaultSrcDir(): string {
  const candidates = [
    join(WORKSPACE_ROOT, 'deepseek', 'deepseek-harness'),
    join(WORKSPACE_ROOT, 'deepseek-harness'),
    join(dirname(WORKSPACE_ROOT), 'deepseek-harness'),
  ]
  return candidates.find(candidate => existsSync(join(candidate, 'package.json'))) ?? WORKSPACE_ROOT
}

const CONFIG_DEFAULTS: DshTestConfig = {
  /** Executable that launches the dsh CLI, for example `pnpm` or an absolute `dsh` path. */
  command: 'pnpm',
  /** Arguments after the executable; the default runs the CLI's web runner from source. */
  args: ['dsh', 'web', '--no-open'],
  /** Budget for the subprocess to print its ready URL before the startup fails. */
  startupTimeoutMs: 180_000,
}

/** Whether one config value is a usable non-empty string. 配置值是否为可用的非空字符串。 */
function isNonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0
}

/** Read the `command` field. 读取 `command` 字段。 */
function readCommand(source: Record<string, unknown>, value: DshTestConfig, issues: ValidationIssues): void {
  if (source.command === undefined) return
  if (!isNonEmptyString(source.command)) issues.push({ message: 'command must be a non-empty string' })
  else value.command = source.command
}

/** Read the `args` field. 读取 `args` 字段。 */
function readArgs(source: Record<string, unknown>, value: DshTestConfig, issues: ValidationIssues): void {
  if (source.args === undefined) return
  if (!Array.isArray(source.args) || !source.args.every(isNonEmptyString)) {
    issues.push({ message: 'args must be an array of non-empty strings' })
  } else {
    value.args = [...source.args]
  }
}

/** Read the `cwd` / `srcDir` / `dshHome` fields. 读取 `cwd` / `srcDir` / `dshHome` 字段。 */
function readPaths(source: Record<string, unknown>, value: DshTestConfig, issues: ValidationIssues): void {
  for (const field of ['cwd', 'srcDir', 'dshHome'] as const) {
    if (source[field] === undefined) continue
    if (!isNonEmptyString(source[field])) issues.push({ message: `${field} must be a non-empty string` })
    else value[field] = source[field]
  }
}

/** Read the `port` field. 读取 `port` 字段。 */
function readPort(source: Record<string, unknown>, value: DshTestConfig, issues: ValidationIssues): void {
  if (source.port === undefined) return
  const port = source.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({ message: 'port must be an integer between 1 and 65535' })
  } else {
    value.port = port
  }
}

/** Read the `startupTimeoutMs` field. 读取 `startupTimeoutMs` 字段。 */
function readStartupTimeout(source: Record<string, unknown>, value: DshTestConfig, issues: ValidationIssues): void {
  if (source.startupTimeoutMs === undefined) return
  const timeoutMs = source.startupTimeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    issues.push({ message: 'startupTimeoutMs must be a positive finite number' })
  } else {
    value.startupTimeoutMs = timeoutMs
  }
}

/**
 * Configuration for the managed web instance, validated as a Standard Schema.
 * Field order in `validate` decides issue order; keep it stable.
 *
 * 托管 web 实例的配置，以 Standard Schema 校验。`validate` 内的字段顺序决定问题
 * 顺序；保持稳定。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-test',
    validate(config: unknown): StandardValidation {
      const issues: ValidationIssues = []
      const value: DshTestConfig = { ...CONFIG_DEFAULTS }
      const given = typeof config === 'object' && config !== null ? config as Record<string, unknown> : {}
      readCommand(given, value, issues)
      readArgs(given, value, issues)
      readPaths(given, value, issues)
      readPort(given, value, issues)
      readStartupTimeout(given, value, issues)
      return issues.length > 0 ? { issues } : { value }
    },
  },
} as const
