#!/usr/bin/env node
/**
 * 页面会话上下文审计 CLI：从落盘会话日志还原「模型实际收到了什么」。
 * Page-session context audit CLI: reconstruct what the model actually received, from the
 * on-disk session logs.
 *
 * 用法 / usage:
 *   node scripts/audit-page-context.mjs [--home <dir>]... [--app <appId>] [--json]
 *
 * 默认扫描 `deepseek/.dsh`（测试环境）与 `~/.dsh`（正式环境，**只读**）。
 * Defaults to the test home `deepseek/.dsh` plus the production home `~/.dsh`
 * (read-only).
 *
 * 为什么不能只 grep 源码里的 `instructions`：模型真正读到的 PAGE 块由
 * `componentPageBlock` 拼装、由工具登记差集生成 tools 行，块里还有关卡与厂商注入的
 * 其它消息（runtime-context / skill-catalog / 工具 schema）。唯一能证实"模型收到了
 * 什么"的证据是会话日志本身。
 * Why source-level `instructions` are not evidence: the PAGE block the model reads is
 * assembled by `componentPageBlock`, its tools line is the registration delta, and the
 * context also carries vendor-injected messages (runtime-context, skill-catalog, tool
 * schemas). The session log is the only proof of what the model received.
 * @module @veren/scripts/audit-page-context
 */
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { observePageSession, summarize } from './audit/observe.mjs'
import { readEvents } from './audit/zstd-frames.mjs'

/** 会话日志文件名 / the session-log file name pattern */
const LOG_FILE = /^session\.v\d+\.jsonl\.zstd$/

/**
 * 递归收集会话日志路径。
 * Collect session-log paths recursively.
 * @param root - 起始目录 / the root directory
 * @param into - 收集结果（可复用）/ the collector
 * @returns 日志路径数组 / the log paths
 */
export function collectLogs(root, into = []) {
  let entries
  try { entries = readdirSync(root) } catch { return into }
  for (const name of entries) {
    const path = join(root, name)
    let info
    try { info = statSync(path) } catch { continue }
    if (info.isDirectory()) collectLogs(path, into)
    else if (LOG_FILE.test(name)) into.push(path)
  }
  return into
}

/**
 * 扫描若干 home，产出观测与报告。
 * Scan the given homes and produce the observations and the report.
 * @param homes - DSH home 目录 / DSH home directories
 * @param appId - 目标应用 id / the app id
 * @returns 日志数、观测与报告 / the log count, the observations and the report
 */
export function audit(homes, appId) {
  const logs = homes.flatMap((home) => collectLogs(join(home, 'sessions')))
  const observations = []
  for (const file of logs) {
    let events
    try { events = readEvents(file) } catch { continue }
    const observed = observePageSession(events, appId)
    if (observed !== undefined) observations.push(observed)
  }
  return { logsScanned: logs.length, observations, report: summarize(observations) }
}

/** 解析命令行 / parse argv */
function parseArgs(argv) {
  const homes = []
  let appId = 'task-workbench'
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--home') { homes.push(argv[index + 1]); index += 1 }
    else if (arg === '--app') { appId = argv[index + 1]; index += 1 }
    else if (arg === '--json') json = true
  }
  if (homes.length === 0) homes.push(join('deepseek', '.dsh'), join(homedir(), '.dsh'))
  return { homes, appId, json }
}

/** 人读输出 / the human-readable rendering */
function print(appId, logsScanned, report) {
  const line = (label, value) => process.stdout.write(`${label.padEnd(46)} ${value}\n`)
  line('logs scanned', logsScanned)
  line(`${appId} page sessions`, report.pageSessions)
  line('PAGE block is the first user message', report.pageBlockFirst)
  line('first turn fired no tool', report.noCallFirstTurn)
  line('first turn fired a tool', report.firedCallFirstTurn)
  line('first turn fired a WRITE tool', report.firedWriteFirstTurn)
  line('sessions repeating the PAGE block', `${report.repeatedBlockSessions} (verbatim ${report.repeatedVerbatimSessions}, max ${report.maxBlockRepeat})`)
  line('block chars', `${report.blockChars.min} / ${report.blockChars.median} / ${report.blockChars.max}`)
  line('skeleton map/tools/app-note/page-note', `${report.skeleton.map}/${report.skeleton.tools}/${report.skeleton.appNote}/${report.skeleton.pageNote}`)
  line('sessions carrying the page identity', report.pageIdentity)
  line('tool schema chars', `${report.toolSchemaChars.min} / ${report.toolSchemaChars.median} / ${report.toolSchemaChars.max}`)
  line('page tool schema chars', `${report.pageToolSchemaChars.min} / ${report.pageToolSchemaChars.median} / ${report.pageToolSchemaChars.max}`)
  process.stdout.write('wording generations (n / fired / wrote):\n')
  for (const row of report.generations) {
    process.stdout.write(`  ${row.generation.padEnd(18)} ${String(row.sessions).padStart(3)} / ${String(row.fired).padStart(3)} / ${String(row.wrote).padStart(3)}\n`)
  }
  process.stdout.write('skeleton presence per page key (map / tools / page note):\n')
  for (const page of report.pages) {
    process.stdout.write(`  ${page.pageKey.padEnd(26)} ${String(page.sessions).padStart(3)} sessions, ${String(page.map).padStart(3)} / ${String(page.tools).padStart(3)} / ${String(page.pageNote).padStart(3)}\n`)
  }
  process.stdout.write('context parts (mean chars per message):\n')
  for (const part of report.contextParts) {
    process.stdout.write(`  ${part.kind.padEnd(22)} ${String(part.meanChars).padStart(6)} x ${part.count}\n`)
  }
}

/** 主流程 / the entry point */
function main() {
  const { homes, appId, json } = parseArgs(process.argv.slice(2))
  const { logsScanned, report } = audit(homes, appId)
  if (json) {
    process.stdout.write(`${JSON.stringify({ appId, logsScanned, ...report }, null, 2)}\n`)
    return
  }
  print(appId, logsScanned, report)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
