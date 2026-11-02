/**
 * Forensic event extractor for the notebook audit (docs/notebook-audit-forensic.cn.md).
 *
 * Walks one DSH sessions directory, decompresses every session.v4.jsonl.zstd
 * (multi-frame, via the zstd CLI), and emits a deterministic event table of
 * notebook tool activity: session headers, first user intent, tool calls and
 * their results joined by callId. No statistics live here — extraction only.
 *
 * notebook 审计的取证事件提取器（docs/notebook-audit-forensic.cn.md）。
 *
 * 遍历一个 DSH sessions 目录，逐个解压 session.v4.jsonl.zstd（多帧，走 zstd CLI），
 * 产出确定性的 notebook 工具活动事件表：会话头、首条用户意图、工具调用与按 callId
 * 对接的结果。这里不做任何统计——只提取。
 *
 * Usage: node audit-extract.mjs <sessionsDir> <outJson>
 *
 * @module scripts/audit-extract
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The tool-name prefix every notebook tool carries. 每个 notebook 工具名的前缀。 */
const TOOL_PREFIX = 'notebook__'
/** Cap per captured result text, keeps the table bounded. 每条结果文本截取上限，保持表有界。 */
const RESULT_TEXT_CAP = 400
/** Cap per captured user-intent text. 每条用户意图文本截取上限。 */
const INTENT_TEXT_CAP = 120

/**
 * Find every session log under the sessions root, any depth.
 * @param {string} root - the DSH sessions directory.
 * @returns {string[]} absolute paths of session.v4.jsonl.zstd files.
 */
function findSessionLogs(root) {
  return readdirSync(root, { recursive: true })
    .filter(name => name.endsWith('session.v4.jsonl.zstd'))
    .map(name => join(root, name))
}

/**
 * Decompress one log fully and split into JSONL lines (multi-frame safe: the
 * CLI concatenates frames).
 * @param {string} file - the .zstd log path.
 * @returns {object[]} parsed event objects; malformed lines are skipped.
 */
function readEvents(file) {
  const run = spawnSync('zstd', ['-dc', file], { maxBuffer: 1 << 28 })
  if (run.status !== 0) return []
  const lines = run.stdout.toString('utf8').split('\n')
  const events = []
  for (const line of lines) {
    if (!line.startsWith('{')) continue
    try { events.push(JSON.parse(line)) } catch { /* torn tail line is skippable */ }
  }
  return events
}

/**
 * Flatten one message's text content into a single string.
 * @param {object} message - a log message with a content array.
 * @returns {string} concatenated text parts.
 */
function textOf(message) {
  return (message?.content ?? [])
    .filter(part => part.type === 'text')
    .map(part => String(part.text ?? ''))
    .join('\n')
}

/**
 * Reduce one session's event stream to notebook-relevant rows.
 * @param {object[]} events - parsed JSONL events of one session.
 * @returns {object} one row per session (header, intent, calls, results).
 */
function reduceSession(events) {
  const row = { session: null, intent: '', calls: [], results: [] }
  for (const event of events) {
    const { type, data, time } = event
    if (data === undefined) continue
    if (type === 'session') row.session = { id: data.id, createdAt: data.createdAt, preset: data.agentPreset }
    if (type === 'user/message' && row.intent === '') row.intent = textOf(data).slice(0, INTENT_TEXT_CAP)
    if (type === 'tool/call' && String(data.name).startsWith(TOOL_PREFIX)) {
      row.calls.push({ callId: data.callId, tool: data.name, time, turn: data.turn, args: data.arguments })
    }
    if (type === 'tool/result') {
      const message = data.message ?? {}
      row.results.push({ callId: message.toolCallId, isError: message.isError === true, text: textOf(message).slice(0, RESULT_TEXT_CAP) })
    }
  }
  return row
}

/**
 * Extract the event table from every session log and write it out.
 * @param {string} sessionsDir - the DSH sessions directory.
 * @returns {object[]} one reduced row per session that saw notebook tools.
 */
function extract(sessionsDir) {
  const rows = []
  for (const file of findSessionLogs(sessionsDir).sort()) {
    const row = reduceSession(readEvents(file))
    if (row.calls.length > 0) rows.push({ ...row, file })
  }
  return rows
}

const [, , sessionsDir, outJson] = process.argv
if (!sessionsDir || !outJson) {
  console.error('usage: node audit-extract.mjs <sessionsDir> <outJson>')
  process.exit(2)
}
const rows = extract(sessionsDir)
const calls = rows.reduce((sum, row) => sum + row.calls.length, 0)
writeFileSync(outJson, JSON.stringify({ extractedAt: 'deterministic', sessions: rows.length, calls, rows }, null, 2))
console.log(`sessions with notebook calls: ${rows.length}, calls: ${calls} -> ${outJson}`)
