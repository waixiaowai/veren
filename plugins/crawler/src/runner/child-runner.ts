/**
 * 子进程运行器：以 node 子进程拉起采集 CLI 入口（design/modules/api.md §1）。
 * The child-process runner: spawns the crawl CLI entry as a node
 * subprocess (design/modules/api.md §1).
 *
 * 控制层到采集进程是进程级异步：拉起后立即返回，stdout 逐行泵入日志缓冲。
 * Control-to-crawl is process-level async: the spawner returns at once and
 * stdout is pumped line by line into the log buffer.
 *
 * @module @veren/crawler/runner/child-runner
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { CrawlerRunRequest, RunnerHandle, RunnerSpawner } from '../control/runner.ts'
import type { LogBuffer } from '../control/logs.ts'

/** CLI 入口的 dist 路径（本文件在 dist/runner/ 下，CLI 在 dist 根）/ the CLI entry dist path (this file is dist/runner/, the CLI is the dist root) */
function cliEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../cli.js')
}

/**
 * 把启动请求编码为 CLI 参数：单参数 JSON（进程约定，design §1 唯一耦合）。
 * Encodes the start request as CLI argv: one JSON argument (the process
 * contract — the design's only coupling, api.md §1).
 */
export function buildCommandArgs(req: CrawlerRunRequest): string[] {
  return [cliEntryPath(), JSON.stringify(req)]
}

/**
 * node 子进程运行器工厂：净洗环境变量（剥 KEY/PASSWORD/SECRET/TOKEN 与
 * DSH_*，大小写不敏感）后拉起采集进程。
 * The node child-process runner factory: scrubs the environment (strips
 * KEY/PASSWORD/SECRET/TOKEN and DSH_*, case-insensitive) before spawn.
 *
 * entryPath 可注入：测试用脚本替代 dist/cli.js 验证进程管线。
 * entryPath is injectable: tests substitute a script for dist/cli.js to
 * verify the process pipeline.
 */
export const createChildRunner =
  (entryPath: string = cliEntryPath()): RunnerSpawner =>
  (req: CrawlerRunRequest, logs: LogBuffer): RunnerHandle => {
    const child = spawn(process.execPath, [entryPath, JSON.stringify(req)], {
      env: scrubEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pumpOutput(child, logs)
    return handleOf(child)
  }

/** 环境净洗 / environment scrubbing */
export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase()
    if (upper.endsWith('KEY') || upper.endsWith('PASSWORD') || upper.endsWith('SECRET') || upper.endsWith('TOKEN') || upper.startsWith('DSH_')) continue
    scrubbed[key] = value
  }
  return scrubbed
}

/** stdout/stderr 逐行泵入日志缓冲 / pump stdout/stderr line by line into the buffer */
function pumpOutput(child: ChildProcess, logs: LogBuffer): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue
    const lines = createInterface({ input: stream })
    lines.on('line', (line: string) => {
      logs.append(line)
    })
  }
}

/** ChildProcess → RunnerHandle / adapt a ChildProcess into a RunnerHandle */
function handleOf(child: ChildProcess): RunnerHandle {
  const exit = new Promise<number>((resolve) => {
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve(signal !== null ? 130 : (code ?? 0))
    })
    child.once('error', () => resolve(1))
  })
  return {
    exit,
    terminate: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    },
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    },
  }
}
