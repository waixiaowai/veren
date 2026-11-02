/**
 * 六个模型工具：重采、配凭据、出报告、列内容、看单篇趋势、选题建议。
 *
 * 工具全是**只读或本地写**：它们读知乎、写本地存储、写报告——绝不替你在知乎
 * 上发布、评论或关注。错误走规范值（`kind: 'error'`）而不是异常，模型读得懂
 * 结构化 code 并自行纠偏。
 *
 * 每个工具一个构造器，组装的函数只负责收集——工具矩阵因此按职责分开，改一个
 * 工具不会牵动其余五个。
 *
 * The six model tools: re-pull, set the credential, write a report, list
 * contents, read one content's trend, and ask for topic suggestions.
 *
 * Every tool is **read-only or a local write**: they read Zhihu, write local
 * storage, and write reports — they never publish, comment, or follow on your
 * behalf. Errors travel as canonical values (`kind: 'error'`) rather than
 * exceptions, so the model reads a structured code and self-corrects.
 *
 * @module @veren/zhihu-ops/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { contentPerformance, moversOf } from './collect/metrics.ts'
import { requireRuntime } from './runtime.ts'

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

/** 渲染规范值：文本直出，错误带上 code / renders a canonical value: text plain, errors with their code */
function renderValue(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  const record = value as { kind?: string; text?: string; code?: string; message?: string }
  if (record.kind === 'error') {
    return [{ type: 'text', text: `失败（${record.code ?? 'unknown'}）：${record.message ?? ''}` }]
  }
  return [{ type: 'text', text: record.text ?? '' }]
}

/**
 * 把任意抛出物折成错误规范值。
 * Folds any thrown value into an error canonical value.
 *
 * @param error - the thrown value / 被抛出的值
 * @returns the error value / 错误值
 */
function toErrorValue(error: unknown): { kind: 'error'; code: string; message: string } {
  const code = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'error', code: typeof code === 'string' ? code : 'ZHIHU_OPS_ERROR', message }
}

/** 文本规范值 / a text canonical value */
function textValue(text: string): { kind: 'text'; text: string } {
  return { kind: 'text', text }
}

/**
 * 造六个工具定义。
 * Builds the six tool definitions.
 *
 * @returns the tool definitions / 工具定义
 */
export function createZhihuOpsTools(): ReturnType<typeof defineTool>[] {
  return [refreshNowTool(), setupCredentialsTool(), generateReportTool(), listContentsTool(), contentTrendTool(), suggestTopicsTool()]
}

/** 重采工具：立刻拉一次数据 / the re-pull tool: pull the data right now */
function refreshNowTool() {
  return defineTool({
    name: 'refresh_now',
    description: 'Pull the Zhihu account data right now (account stats, per-content stats, comments, hot list, answerable questions) and store the daily snapshot. Read-only against Zhihu: it never publishes, comments, or follows. Same-day pulls overwrite rather than accumulate. Use it when the user asks for fresh data or the schedule has not run yet.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    timeoutMs: 120_000,
    execute: async () => {
      try {
        const outcome = await requireRuntime().refresh()
        return textValue(`采集完成：${outcome.day} · ${outcome.state} · 请求 ${outcome.requestCount} 次 · 粉丝 ${outcome.followerCount}${outcome.reason === undefined ? '' : ` · ${outcome.reason}`}`)
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 配凭据工具：写入 Access Secret / the credential tool: store the access secret */
function setupCredentialsTool() {
  return defineTool({
    name: 'setup_credentials',
    description: 'Store the Zhihu open-platform Access Secret for this plugin. The secret is written to the credential store, never to configuration or logs. Use it when a pull reports that no credential is stored. It does not itself pull anything.',
    parameters: {
      secret: { type: 'string', required: true, description: 'The Access Secret created in the Zhihu developer center' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async (args: { secret: string }) => {
      try {
        await requireRuntime().installSecret(args.secret)
        return textValue('Access Secret 已写入凭据存储。下一次采集会用它。')
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 出报告工具：写报告并投进收件箱 / the report tool: write a report and deliver it to the inbox */
function generateReportTool() {
  return defineTool({
    name: 'generate_report',
    description: 'Write an operations-analysis report from the stored Zhihu snapshots and deliver it to the inbox. The report covers the configured window of days and names concrete next actions. Use it when the user asks for a report, a summary, or what to do next. It reads local snapshots and never touches Zhihu.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    timeoutMs: 300_000,
    execute: async () => {
      try {
        const report = await requireRuntime().writeReport()
        return textValue(`报告已生成并投进收件箱：${report.title}\n\n${report.body}`)
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 列内容工具：按增量排的内容指标 / the list-contents tool: the metrics ordered by growth */
function listContentsTool() {
  return defineTool({
    name: 'list_contents',
    description: 'List the account\'s own contents with their latest reading, exposure, upvotes, likes, comments, collects, engagement rate, and the growth over the window, ordered by growth. Use it to answer "which piece is working" or to compare the pieces. It reads local snapshots.',
    parameters: {
      limit: { type: 'number', description: 'How many contents to list; default 10' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async (args: { limit?: number }) => {
      try {
        const runtime = requireRuntime()
        const performances = runtime.storage.contents().map((profile) => contentPerformance(profile, runtime.storage.contentStats()))
        const movers = moversOf(performances, args.limit ?? 10)
        if (movers.length === 0) return textValue('窗口内没有内容数据。')
        return textValue(movers.map((item) => [
          `- ${item.title}（${item.contentType}）`,
          `  阅读 ${item.viewCount}（区间 ${item.viewDelta >= 0 ? '+' : ''}${item.viewDelta}）· 曝光 ${item.exposureCount}`
          + ` · 赞同 ${item.upvoteCount} · 喜欢 ${item.likeCount} · 评论 ${item.commentCount} · 收藏 ${item.collectCount}`,
          `  读完率 ${item.readFinishedRate === undefined ? '未覆盖' : item.readFinishedRate}`
          + ` · 本篇涨粉 ${item.followerGain} · 互动率 ${item.engagementRate}`,
        ].join('\n')).join('\n'))
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 单篇趋势工具：逐日曲线 / the per-content trend tool: the day-by-day curve */
function contentTrendTool() {
  return defineTool({
    name: 'content_trend',
    description: 'Read one content\'s day-by-day trend: views, exposure, upvotes, likes, comments, collects, the read-finished rate, and the daily deltas. Use it when the user asks about a specific piece or wants to know when a piece took off. It reads local snapshots.',
    parameters: {
      contentId: { type: 'string', required: true, description: 'The content id (as listed by list_contents)' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async (args: { contentId: string }) => {
      try {
        const runtime = requireRuntime()
        const profile = runtime.storage.contents().find((row) => row.content_id === args.contentId)
        const rows = runtime.storage.contentStats().filter((row) => row.content_id === args.contentId)
          .sort((a, b) => a.day.localeCompare(b.day))
        if (rows.length === 0) return textValue(`内容 ${args.contentId} 没有统计数据。`)
        const lines = rows.map((row) => `- ${row.day}：阅读 ${row.view_count ?? 0}${row.view_delta === undefined ? '' : `（${row.view_delta >= 0 ? '+' : ''}${row.view_delta}）`} · 曝光 ${row.exposure_count ?? 0} · 赞同 ${row.upvote_count ?? 0} · 喜欢 ${row.like_count ?? 0} · 评论 ${row.comment_count ?? 0} · 收藏 ${row.collect_count ?? 0}${row.read_finished_rate === undefined ? '' : ` · 读完率 ${row.read_finished_rate}`}`)
        return textValue(`${profile?.title ?? args.contentId}\n${lines.join('\n')}`)
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}

/** 选题工具：适合回答的问题与热榜 / the topics tool: the answerable questions and the hot list */
function suggestTopicsTool() {
  return defineTool({
    name: 'suggest_topics',
    description: 'List the answerable questions and the hot-list entries the platform suggests. Use it to pick what to write next, or to answer "what should I write about". It reads the latest local snapshot.',
    parameters: {
      limit: { type: 'number', description: 'How many entries to list; default 8' },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: async (args: { limit?: number }) => {
      try {
        const runtime = requireRuntime()
        const limit = args.limit ?? 8
        const day = runtime.now().toISOString().slice(0, 10)
        const questions = runtime.storage.questionsOf(day).slice(0, limit)
        const hot = runtime.storage.hotItemsOf(day).slice(0, limit)
        if (questions.length === 0 && hot.length === 0) return textValue('窗口内没有选题数据，先跑一次采集。')
        const questionLines = questions.map((row) => `- ${row.title}`)
        const hotLines = hot.map((row) => `- ${row.rank}. ${row.title}`)
        return textValue([...questionLines, ...hotLines].join('\n'))
      } catch (error: unknown) {
        return toErrorValue(error)
      }
    },
  })
}
