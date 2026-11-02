/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 总览页（入口）：粉丝趋势、最近一次采集状态、凭据健康度。
 *
 * 正文直读当前存储状态（同步投影面），不替宿主取数；需要更新时用
 * refresh_now 重采。凭据没配就明说，不假装有数据。
 *
 * The overview page (the entry): the follower trend, the last pull's state, and
 * the credential health.
 *
 * The body reads the current storage state directly (a synchronous projection)
 * and never fetches on the host's behalf; use refresh_now to pull fresh data.
 * With no credential stored it says so plainly instead of pretending.
 *
 * @module @veren/zhihu-ops/page-overview
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { accountTrend } from './collect/metrics.ts'
import { toolOf } from './runtime.ts'
import { requireRuntime } from './runtime.ts'
import { followupText, STRINGS, URL_PREFIX } from './pages.tsx'

/**
 * 本页挂载的工具：重采、配凭据、出报告。
 * The tools this page mounts: re-pull, set the credential, write a report.
 *
 * @param agent - the page session's agent / 页面会话的 agent
 */
function registerOverviewTools(agent: Agent): void {
  for (const localName of ['refresh_now', 'setup_credentials', 'generate_report']) {
    agent.ctx.tools.register(toolOf(localName))
  }
}

/** 首屏读：把凭据与采集状态作为消息送到会话 / the first screen: the credential and pull state ride in as a message */
async function overviewFirstScreen(agent: Agent): Promise<() => Promise<void>> {
  const runtime = requireRuntime()
  try {
    const state = await runtime.secretState()
    const last = runtime.storage.pullRuns().sort((a, b) => b.day.localeCompare(a.day))[0]
    followupText(agent, [
      '[zhihu-ops] 凭据：' + (state === 'configured' ? '已配置' : '未配置（采集会失败，请先走 setup_credentials）'),
      '[zhihu-ops] 最近一次采集：' + (last === undefined ? '无' : `${last.day} · ${last.state} · 请求 ${last.request_count ?? 0} 次`),
    ].join('\n'))
  } catch (error: unknown) {
    followupText(agent, '[zhihu-ops] 状态读取失败：' + (error instanceof Error ? error.message : String(error)))
  }
  return async () => undefined
}

/** 总览页组件体（一次性渲染）/ the overview page's body (the one-shot render) */
export const OverviewPage: PageFC = (_props, agent) => {
  registerOverviewTools(agent)
  const runtime = requireRuntime()
  agent.ctx.effect(() => overviewFirstScreen(agent), 'zhihu-ops:overview-first-screen')
  const trend = accountTrend(runtime.storage.accountStats())
  const runs = runtime.storage.pullRuns().sort((a, b) => b.day.localeCompare(a.day))
  return (
    <>
      <h1>知乎运营分析</h1>
      <h2>账号趋势</h2>
      <p>
        粉丝 {trend.followerCount}（日增 {trend.followerDelta >= 0 ? '+' : ''}{trend.followerDelta}）
        {' · '}区间 {trend.windowDays} 天净增 {trend.windowGrowth}（日均 {trend.dailyAverage}）
      </p>
      <h2>采集账</h2>
      <ul>
        {runs.slice(0, 7).map((run) => (
          <li key={run.day}>{run.day} · {run.state} · 请求 {run.request_count ?? 0} 次{run.reason === undefined ? '' : ` · ${run.reason}`}</li>
        ))}
        {runs.length === 0 ? <li>还没有采集记录。</li> : null}
      </ul>
      <h2>页面</h2>
      <ul>
        <li>{URL_PREFIX}/contents —— 内容表现</li>
        <li>{URL_PREFIX}/reports —— 分析报告</li>
      </ul>
      <blockquote>{STRINGS.snapshot.zh}</blockquote>
    </>
  )
}

export const OverviewMeta: ComponentPageMeta = {
  name: 'overview',
  url: `${URL_PREFIX}/overview`,
  description: '知乎账号运营总览：粉丝趋势、采集账与凭据状态',
  writes: true,
  unattended: {
    serves: '查看账号趋势与采集健康度，判断今天的数据是否新鲜；按需重采或出报告',
    level: 'L1',
    evidence: '采集账与报告落本地存储（pull_runs / reports 表），记录可机查',
    escape: '采集失败如实记录失败原因与状态，不重试消耗额度',
  },
  instructions: [
    '这是知乎运营分析的首页。正文给出粉丝趋势与最近的采集账——采集按天幂等，同一天重采是覆盖。',
    '要最新数据：调 refresh_now 立刻重采一次。要一份分析：调 generate_report，它会把报告投进收件箱。',
    '凭据没配时采集必然失败：先让用户去知乎开发者中心创建 Access Secret，再用 setup_credentials 粘进来。',
    '本应用只读知乎：不发布、不评论、不关注。',
  ].join(''),
}
