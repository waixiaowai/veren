/**
 * 页面会话观测：从会话事件里取出「模型实际收到了什么、而后做了什么」。
 * Page-session observation: what the model actually received, and what it then did.
 *
 * 所有函数都是纯函数（喂事件数组，返回普通对象），CLI 与自证测试共用同一份口径。
 * Every function is pure (events in, plain object out), so the CLI and the red-light
 * self-tests share exactly one definition of each metric.
 * @module @veren/scripts/audit/observe
 */
import { blockLines, locatorOf, noteOf } from './page-block.mjs'

/** 写工具：首回合就产生副作用的那一类 / write tools: the ones that produce effects on turn one */
export const WRITE_TOOL = /(take_task|take_page_task|complete_task|abandon_task|split_task|publish_task)$/

/** 页面身份段的判定词 / the marker of the page-identity block */
const IDENTITY_MARKER = '你当前在应用页面'

/**
 * 一条消息的纯文本。
 * The plain text of one message.
 * @param message - 消息对象 / the message object
 * @returns 拼接后的文本 / the concatenated text
 */
export function textOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** 消息的来源 kind / a message's source kind */
function sourceOf(record) {
  const message = record.data?.message ?? record.data
  return message?.source?.kind ?? 'user'
}

/** 请求头里的工具清单（对象或数组两种记录形态）/ the tool list in a request header (either record form) */
function toolsOf(record) {
  const tools = record.data?.header?.tools
  return Array.isArray(tools) ? tools : Object.values(tools ?? {})
}

/**
 * 一个会话的观测结果；非页面会话返回 undefined。
 * One session's observation; undefined for a non-page session.
 * @param events - 该会话的事件序列 / the session's events
 * @param appId - 目标应用 id / the app id to match
 * @returns 观测结果或 undefined / the observation, or undefined
 */
export function observePageSession(events, appId) {
  const pagePrefix = `PAGE ${appId}/`
  const toolPrefix = `${appId.replace(/-/g, '_')}__`
  const parts = []
  let firstUserSource
  let firstTurnCalls
  let pageBlocks = 0
  let blockText = ''
  let lastBlockText = ''
  let toolSchemaChars = 0
  let pageToolChars = 0
  let toolCount = 0
  let pageIdentity = false
  for (const record of events) {
    if (record.type === 'user/message') {
      const kind = sourceOf(record)
      const text = textOf(record.data?.message ?? record.data)
      if (firstUserSource === undefined) firstUserSource = kind
      if (text.includes(IDENTITY_MARKER)) pageIdentity = true
      if (kind === 'app/page' && text.startsWith(pagePrefix)) {
        pageBlocks += 1
        if (blockText === '') blockText = text
        lastBlockText = text
      }
      parts.push({ kind, chars: text.length })
    }
    if (record.type === 'request/header') {
      const tools = toolsOf(record)
      toolCount = tools.length
      toolSchemaChars = JSON.stringify(tools).length
      pageToolChars = JSON.stringify(tools.filter((tool) => String(tool?.name ?? '').startsWith(toolPrefix))).length
    }
    if (record.type === 'assistant/message' && firstTurnCalls === undefined && pageBlocks > 0) {
      const content = record.data?.message?.content ?? []
      firstTurnCalls = Array.isArray(content)
        ? content.filter((block) => block.type === 'tool-call').map((block) => block.name)
        : []
    }
  }
  if (pageBlocks === 0) return undefined
  const note = noteOf(blockText)
  return {
    firstUserSource,
    pageBlocks,
    firstTurnCalls: firstTurnCalls ?? [],
    parts,
    pageKey: locatorOf(blockText).pageKey,
    blockChars: blockText.length,
    blockLines: blockLines(blockText),
    note,
    /** 同一会话后来重发的块是否与首块逐字相同 / whether a later block repeats the first verbatim */
    blockRepeatedVerbatim: pageBlocks > 1 && lastBlockText === blockText,
    toolCount,
    toolSchemaChars,
    pageToolChars,
    pageIdentity,
  }
}

/**
 * 中位数（取整）。
 * The median, rounded.
 * @param values - 数值序列 / the numbers
 * @returns 中位数 / the median
 */
export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle]
}

/** 一组数值的 min/median/max / min, median and max of a numeric list */
function spread(values) {
  return values.length === 0
    ? { min: 0, median: 0, max: 0 }
    : { min: Math.min(...values), median: median(values), max: Math.max(...values) }
}

/**
 * 按页面说明的措辞分代（判定顺序由新到旧，先命中先生效）。
 * Split sessions into wording generations, newest marker first so an older, more
 * generic phrase cannot claim a newer generation's sessions.
 * @param note - 页面说明正文 / the page note
 * @returns 代际键 / the generation key
 */
export function generationOf(note) {
  if (note === '') return 'G0-no-note'
  if (note.includes('类请求用 list_tasks 直接回答') || note.includes('查看类请求不接取')) return 'G4-conditional'
  if (note.includes('有人把任务投给本页时') || note.includes('有人把任务交给你')) return 'G3-detail-anyone'
  if (note.includes('SNAPSHOT/PATCH') || note.includes('PAGE-PATCH')) return 'G2-live-sync'
  if (note.includes('接取用 take') || note.includes('用 take_task 接取 open')) return 'G1-imperative'
  return 'G5-other'
}

/**
 * 汇总观测。纯函数，测试可直接喂观测对象。
 * Aggregate observations. Pure, so a test can feed observations directly.
 * @param observations - `observePageSession` 的结果（已过滤） / the filtered observations
 * @returns 报告数据 / the report payload
 */
export function summarize(observations) {
  const instructionFree = observations.filter((row) => row.firstUserSource === 'app/page')
  const fired = instructionFree.filter((row) => row.firstTurnCalls.length > 0)
  const wrote = fired.filter((row) => row.firstTurnCalls.some((name) => WRITE_TOOL.test(name)))
  const kinds = new Map()
  for (const row of observations) {
    for (const part of row.parts) {
      const bucket = kinds.get(part.kind) ?? { count: 0, total: 0 }
      bucket.count += 1
      bucket.total += part.chars
      kinds.set(part.kind, bucket)
    }
  }
  const count = (predicate) => observations.filter(predicate).length
  const generations = new Map()
  const pages = new Map()
  for (const row of instructionFree) {
    const key = generationOf(row.note)
    const bucket = generations.get(key) ?? { sessions: 0, fired: 0, wrote: 0 }
    bucket.sessions += 1
    if (row.firstTurnCalls.length > 0) bucket.fired += 1
    if (row.firstTurnCalls.some((name) => WRITE_TOOL.test(name))) bucket.wrote += 1
    generations.set(key, bucket)
  }
  for (const row of observations) {
    const bucket = pages.get(row.pageKey) ?? { sessions: 0, map: 0, tools: 0, pageNote: 0 }
    bucket.sessions += 1
    if (row.blockLines.map) bucket.map += 1
    if (row.blockLines.tools) bucket.tools += 1
    if (row.blockLines.pageNote) bucket.pageNote += 1
    pages.set(row.pageKey, bucket)
  }
  return {
    pageSessions: observations.length,
    pageBlockFirst: instructionFree.length,
    noCallFirstTurn: instructionFree.length - fired.length,
    firedCallFirstTurn: fired.length,
    firedWriteFirstTurn: wrote.length,
    repeatedBlockSessions: count((row) => row.pageBlocks > 1),
    repeatedVerbatimSessions: count((row) => row.blockRepeatedVerbatim),
    maxBlockRepeat: Math.max(0, ...observations.map((row) => row.pageBlocks)),
    blockChars: spread(observations.map((row) => row.blockChars).filter((chars) => chars > 0)),
    skeleton: {
      map: count((row) => row.blockLines.map),
      tools: count((row) => row.blockLines.tools),
      appNote: count((row) => row.blockLines.appNote),
      pageNote: count((row) => row.blockLines.pageNote),
    },
    pages: [...pages.entries()]
      .map(([pageKey, bucket]) => ({ pageKey, ...bucket }))
      .sort((a, b) => b.sessions - a.sessions),
    pageIdentity: count((row) => row.pageIdentity),
    toolSchemaChars: spread(observations.map((row) => row.toolSchemaChars).filter((value) => value > 0)),
    pageToolSchemaChars: spread(observations.map((row) => row.pageToolChars).filter((value) => value > 0)),
    generations: [...generations.entries()]
      .map(([generation, bucket]) => ({ generation, ...bucket }))
      .sort((a, b) => a.generation.localeCompare(b.generation)),
    contextParts: [...kinds.entries()]
      .map(([kind, bucket]) => ({ kind, count: bucket.count, meanChars: Math.round(bucket.total / bucket.count) }))
      .sort((a, b) => b.meanChars - a.meanChars),
    writeOnFirstTurn: wrote.map((row) => ({
      pageKey: row.pageKey,
      generation: generationOf(row.note),
      calls: row.firstTurnCalls.filter((name) => WRITE_TOOL.test(name)),
    })),
  }
}
