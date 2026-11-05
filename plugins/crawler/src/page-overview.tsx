/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 总览页（入口）：任务状态、最近日志与存储数据汇总。
 * The overview page (the entry): the task status, the recent logs, and the
 * storage data summary.
 *
 * 正文直读当前状态（同步投影面），不替宿主取数；需要启停时由页面会话
 * 挂载的 crawler__ 工具完成。数据域未开就明说，不假装有数据。
 * The body reads the current state directly (a synchronous projection) and
 * never fetches on the host's behalf; starts and stops go through the
 * crawler__ tools mounted into the page session. With no domain open it
 * says so plainly instead of pretending.
 *
 * @module @veren/crawler/page-overview
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { externalName, followupText, URL_PREFIX } from './pages.ts'
import type { CrawlerManager } from './control/manager.ts'
import type { CrawlerStore } from './store/domain.ts'

/** 页面挂载的工具：启停与查读六件套（与指引文案一一对应，挂载面可静态核验）。
 * / The tools this page mounts: the six start/stop/read tools, mirroring the
 * instructions so the mount face stays statically verifiable. */
function registerOverviewTools(agent: Agent): void {
  for (const localName of ['start', 'stop', 'status', 'logs', 'data', 'wordcloud']) {
    agent.ctx.tools.register(toolOf(externalName(localName)))
  }
}

/** 工具存根由装配面注入（这里只登记全名）；`toolOf` 与页面挂载核验约定的包装名一致。
 * / The tool stubs arrive from the assembly (only full names registered here);
 * `toolOf` matches the wrapper name the page-mount audit resolves. */
const toolStubs = new Map<string, ToolDefinition>()

/** 按全名取已备好的工具定义 / look up one prepared tool definition by full name */
function toolOf(fullName: string): ToolDefinition {
  return toolStubs.get(fullName) as ToolDefinition
}

/** 装配面把工具定义放进存根表 / the assembly fills the stub table */
export function provideToolStubs(tools: ToolDefinition[]): void {
  toolStubs.clear()
  for (const tool of tools) {
    toolStubs.set(tool.name, tool)
  }
}

/** 运行时面：页面取数的唯一正道 / the runtime faces: the only straight path for page data */
export interface OverviewRuntime {
  manager: CrawlerManager
  domain: () => CrawlerStore | undefined
}

let overviewRuntime: OverviewRuntime | undefined

/** 绑定总览页运行时 / binds the overview runtime */
export function bindOverviewRuntime(runtime: OverviewRuntime): void {
  overviewRuntime = runtime
}

/** 首屏：状态与数据量作为消息推进会话 / the first screen: status and data volume ride in as a message */
async function overviewFirstScreen(agent: Agent): Promise<() => Promise<void>> {
  const runtime = overviewRuntime
  try {
    if (runtime === undefined) throw new Error('runtime not bound')
    const status = runtime.manager.status()
    const domain = runtime.domain()
    const counts = domain === undefined ? '存储域未打开' : `contents ${[...domain.table('contents').entries()].length} · comments ${[...domain.table('comments').entries()].length}`
    followupText(agent, [`[crawler] 任务状态：${status.status}${status.errorMessage === null ? '' : `（${status.errorMessage}）`}`, `[crawler] 已采数据：${counts}`].join('\n'))
  } catch (error: unknown) {
    followupText(agent, '[crawler] 状态读取失败：' + (error instanceof Error ? error.message : String(error)))
  }
  return async () => undefined
}

/**
 * 总览页组件体（一次性渲染）。
 * The overview page's body (the one-shot render).
 */
export const OverviewPage: PageFC = (_props, agent) => {
  const runtime = overviewRuntime
  if (runtime === undefined) {
    return (
      <>
        <h1>多平台内容采集</h1>
        <p>运行时未绑定（装配异常），请检查插件日志。</p>
      </>
    )
  }
  registerOverviewTools(agent)
  agent.ctx.effect(() => overviewFirstScreen(agent), 'crawler:overview-first-screen')
  return <OverviewBody runtime={runtime} />
}

/** 快照数据：状态、日志与按平台计数。 / The snapshot data: status, logs and the per-platform counts. */
interface OverviewSnapshot {
  status: ReturnType<CrawlerManager['status']>
  recentLogs: ReturnType<CrawlerManager['logs']['recent']>
  contents: number
  comments: number
  byPlatform: Array<[string, number]>
}

/** 取一次性快照：正文是打开时刻的读数，不替宿主取数。 / Take the one-shot snapshot: the body reads at open time, it never fetches. */
function snapshotOf(runtime: OverviewRuntime): OverviewSnapshot {
  const domain = runtime.domain()
  const contents = domain === undefined ? [] : [...domain.table('contents').entries()]
  const comments = domain === undefined ? [] : [...domain.table('comments').entries()]
  const byPlatform = new Map<string, number>()
  for (const [key] of contents) {
    const platform = key.split('::')[0] ?? '?'
    byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + 1)
  }
  return {
    status: runtime.manager.status(),
    recentLogs: runtime.manager.logs.recent(10),
    contents: contents.length,
    comments: comments.length,
    byPlatform: [...byPlatform.entries()],
  }
}

/** 总览正文：状态、日志与数据量三段。 / The overview body: status, logs and the data volume. */
function OverviewBody({ runtime }: { runtime: OverviewRuntime }): JSX.Element {
  const { status, recentLogs, contents, comments, byPlatform } = snapshotOf(runtime)
  return (
    <>
      <h1>多平台内容采集</h1>
      <h2>任务状态</h2>
      <p>
        {status.status} · 平台 {status.platform ?? '—'} · 模式 {status.crawlerType ?? '—'} · 起始 {status.startedAt ?? '—'}
        {status.errorMessage === null ? '' : ` · 错误：${status.errorMessage}`}
      </p>
      <h2>最近日志（10 条）</h2>
      <ul>
        {recentLogs.map((entry) => (
          <li key={entry.id}>{entry.level} · {entry.message}</li>
        ))}
        {recentLogs.length === 0 ? <li>暂无日志。</li> : null}
      </ul>
      <h2>已采数据（宿主存储域）</h2>
      <ul>
        <li>内容 {contents} 条</li>
        <li>评论 {comments} 条</li>
        {byPlatform.map(([platform, count]) => (
          <li key={platform}>{platform}: {count} 条内容</li>
        ))}
      </ul>
      <p>正文是打开时刻的快照；启停采集用页面挂载的 crawler__ 工具，返回值与后续消息为准。</p>
    </>
  )
}

/**
 * 页面元数据。
 * The page meta.
 */
export const OverviewMeta: ComponentPageMeta = {
  name: 'overview',
  url: `${URL_PREFIX}/overview`,
  description: '采集控制台总览：任务状态、已采数据量与失败原因',
  writes: true,
  unattended: {
    serves: '查看采集任务状态与已采数据量，判断是否需要启停采集',
    level: 'L1',
    evidence: '任务状态与数据量来自进程内管理器与宿主存储域，记录可机查',
    escape: '采集失败如实记录失败原因与状态，不重试消耗额度',
  },
  instructions: [
    '这是多平台内容采集的控制台首页。正文给出任务状态机快照与存储域数据量。',
    '要启停采集：调 crawler__start / crawler__stop；要看进度或失败原因：crawler__logs；要数据量：crawler__data；要评论词频表：crawler__wordcloud。',
    '单任务互斥：running/starting 时再 start 会被拒绝，先 stop 或等完成。本应用对目标平台严格只读。',
  ].join(''),
}
