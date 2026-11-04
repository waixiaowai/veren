/**
 * 模型工具面：启停采集、查状态、看日志、列数据（意见 4：dsh tools 注册）。
 * The model tool face: start/stop crawls, read status, tail logs, and list
 * data (directive 4: dsh tools registration).
 *
 * 工具全是**只读或本地写**：启停本机采集进程、读写本机存储域——绝不代替
 * 使用者在目标平台发布或互动。错误走规范值（`kind: 'error'`）而不是异常，
 * 模型读得懂结构化 code 并自行纠偏。
 * Every tool is read-only or a local write: it starts/stops the local crawl
 * and reads local storage — it never posts or interacts on any platform.
 * Errors travel as canonical values (`kind: 'error'`) so the model reads a
 * structured code and self-corrects.
 *
 * @module @veren/crawler/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertCrawlerType, assertLoginType, assertPlatform } from './errors.ts'
import { wordFrequencies } from './wordcloud.ts'
import type { CrawlerManager } from './control/manager.ts'
import type { CrawlerRunRequest } from './control/runner.ts'
import type { CrawlerStore } from './store/domain.ts'
import type { LoginType } from './types.ts'

/** 工具端口：工具取数的唯一正道 / the tool port: the only straight path for tool data */
export interface CrawlerToolPort {
  /** 任务管理器 / the task manager */
  manager: CrawlerManager
  /** 已打开存储域（未开时 undefined）/ the opened domain (undefined until open) */
  domain: () => CrawlerStore | undefined
}

/** 错误规范值的 schema 面 / the error value's schema face */
const ERROR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'error' },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

/** 文本规范值的 schema 面 / the text value's schema face */
const TEXT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'text' },
    text: { type: 'string', required: true },
  },
} as const

/** 输出 = oneOf[text, error] / the output = oneOf[text, error] */
const OUTPUT_SCHEMA = { oneOf: [TEXT_SCHEMA, ERROR_SCHEMA] } as const

/** 渲染规范值：文本直出，错误带 code / renders a canonical value: text plain, errors with their code */
function renderValue(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  const record = value as { kind?: string; text?: string; code?: string; message?: string }
  if (record.kind === 'error') {
    return [{ type: 'text', text: `失败（${record.code ?? 'unknown'}）：${record.message ?? ''}` }]
  }
  return [{ type: 'text', text: record.text ?? '' }
  ]
}

/** 把任意抛出值折成错误规范值 / folds any thrown value into an error canonical value */
function toErrorValue(error: unknown): { kind: 'error'; code: string; message: string } {
  const code = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'error', code: typeof code === 'string' ? code : 'CRAWLER_ERROR', message }
}

/** 文本规范值 / a text canonical value */
function textValue(text: string): { kind: 'text'; text: string } {
  return { kind: 'text', text }
}

/**
 * 造五个工具定义（本地名；装配处以 `crawler__<本地名>` 全名注册）。
 * Builds the five tool definitions (local names; the assembler registers
 * them under `crawler__<localName>`).
 */
export function createCrawlerTools(): ReturnType<typeof defineTool>[] {
  return [startTool(), stopTool(), statusTool(), logsTool(), dataTool(), wordcloudTool()]
}

/** 启动参数（工具面形状）/ the start arguments (the tool-face shape) */
interface StartToolInput {
  platform: string
  crawlerType: string
  keywords?: string[]
  specifiedIds?: string[]
  creatorIds?: string[]
  loginType?: string
  cookies?: string
  headless?: boolean
  maxNotesCount?: number
  enableComments?: boolean
}

/** 启动采集工具 / the start tool */
function startTool() {
  return defineTool({
    name: 'start',
    description: 'Start a content-crawl task on this machine (single-task mutex: a running task rejects new starts). Provide the platform (xhs/dy/ks/bili/wb/tieba/zhihu), mode (search/detail/creator), targets, data always lands in the host storage domain (dsh storage). loginType defaults to qrcode: a visible Chrome window opens on the platform login page and the run waits up to 300 seconds for you to scan; cookie login instead takes a cookies string. Read-only against the platforms: it only reads public contents.',
    parameters: {
      platform: { type: 'string', required: true },
      crawlerType: { type: 'string', required: true },
      keywords: { type: 'array', items: { type: 'string' } },
      specifiedIds: { type: 'array', items: { type: 'string' } },
      creatorIds: { type: 'array', items: { type: 'string' } },
      loginType: { type: 'string' },
      cookies: { type: 'string' },
      headless: { type: 'boolean' },
      maxNotesCount: { type: 'number' },
      enableComments: { type: 'boolean' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    timeoutMs: 30_000,
    execute: async (args: unknown) => {
      try {
        return textValue(await startCrawl(args as StartToolInput))
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 扫码/短信登录必须可见窗口；cookie 方式可无头 / qr and sms need a visible window; cookie login may run headless */
function headlessOf(loginType: LoginType, value: boolean | undefined): boolean {
  return value ?? loginType === 'cookie'
}

/** 组装启动请求并调用管理器：枚举在此守卫，非法值折成错误规范值 / assembles the request and calls the manager: enums guarded here, illegal values fold into error values */
async function startCrawl(input: StartToolInput): Promise<string> {
  const loginType = assertLoginType(input.loginType ?? 'qrcode')
  const request: CrawlerRunRequest = {
    platform: assertPlatform(input.platform),
    loginType,
    crawlerType: assertCrawlerType(input.crawlerType),
    keywords: input.keywords ?? [],
    specifiedIds: input.specifiedIds ?? [],
    creatorIds: input.creatorIds ?? [],
    enableComments: input.enableComments ?? false,
    enableSubComments: false,
    enableMedia: false,
    cookies: input.cookies ?? null,
    headless: headlessOf(loginType, input.headless),
    maxNotesCount: input.maxNotesCount ?? 20,
    maxCommentsCount: 10,
    startPage: 1,
  }
  const outcome = await portOf().manager.start(request)
  const hint = loginType === 'qrcode' ? '（扫码请在弹出的浏览器窗口完成，最多等 300 秒）' : ''
  return `${outcome.status}: ${outcome.message}${hint}`
}

/** 停止采集工具 / the stop tool */
function stopTool() {
  return defineTool({
    name: 'stop',
    description: 'Stop the running crawl task. Graceful terminate first, force-kill after the timeout; the status returns to idle either way. Returns not_running when idle.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    timeoutMs: 30_000,
    execute: async () => {
      try {
        const outcome = await portOf().manager.stop()
        return textValue(`${outcome.status}: ${outcome.message}`)
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 状态工具 / the status tool */
function statusTool() {
  return defineTool({
    name: 'status',
    description: 'Read the crawl task status: idle/starting/running/stopping/error plus the platform, mode, start time and error message. Use it before starting (single-task mutex) or after an error.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async () => {
      try {
        const status = portOf().manager.status()
        return textValue(JSON.stringify(status))
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 日志工具 / the logs tool */
function logsTool() {
  return defineTool({
    name: 'logs',
    description: 'Tail the crawl log ring buffer (the last N entries, default 50, cap 500). Use it to see per-page progress or a failure reason after an error status.',
    parameters: {
      limit: { type: 'number' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async (args: unknown) => {
      try {
        const limit = (args as { limit?: number }).limit ?? 50
        const entries = portOf().manager.logs.recent(limit)
        return textValue(entries.map((entry) => `${entry.level} ${entry.message}`).join('\n') || '(empty)')
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 数据工具 / the data tool */
function dataTool() {
  return defineTool({
    name: 'data',
    description: 'List collected data: the count of contents and comments stored in the host storage domain per platform. Read-only.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async () => {
      try {
        return textValue(dataSummary())
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 汇总存储域内数据量 / summarizes the stored data volume */
function dataSummary(): string {
  const domain = portOf().domain()
  if (domain === undefined) return '(storage domain not open)'
  const contents = [...domain.table('contents').entries()]
  const comments = [...domain.table('comments').entries()]
  const byPlatform = new Map<string, number>()
  for (const [key] of contents) {
    const platform = key.split('::')[0] ?? '?'
    byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + 1)
  }
  const parts = [...byPlatform.entries()].map(([platform, count]) => `${platform}: ${count} contents`)
  return `contents ${contents.length}, comments ${comments.length}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`
}

/** 词云工具 / the wordcloud tool */
function wordcloudTool() {
  return defineTool({
    name: 'wordcloud',
    description: 'Compute a word-frequency table from the comments stored in the host storage domain (chinese bigrams + latin tokens, stopwords filtered). Read-only. Use it to summarize what collected comments talk about; the table feeds external wordcloud renderers.',
    parameters: {
      topK: { type: 'number' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async (args: unknown) => {
      try {
        const topK = (args as { topK?: number }).topK ?? 30
        const domain = portOf().domain()
        if (domain === undefined) return textValue('(storage domain not open)')
        const comments = [...domain.table('comments').entries()].map(([, row]) => {
          const record = row as { content?: unknown }
          return typeof record.content === 'string' ? record.content : ''
        })
        const frequencies = wordFrequencies(comments, { topK })
        if (frequencies.length === 0) return textValue('(no comments stored yet)')
        return textValue(frequencies.map((entry) => `${entry.word}: ${entry.count}`).join('\n'))
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 工具端口（装配时绑定，bindRuntime 同款）/ the tool port (bound at assembly, like bindRuntime) */
let port: CrawlerToolPort | undefined

/** 绑定工具端口 / binds the tool port */
export function bindToolPort(bound: CrawlerToolPort): void {
  port = bound
}

/** 取已绑定端口 / reads the bound port */
function portOf(): CrawlerToolPort {
  if (port === undefined) throw new Error('crawler tool port not bound')
  return port
}
