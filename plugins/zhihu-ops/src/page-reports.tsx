/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 报告页：分析报告列表与最新一份的正文。
 *
 * 报告是模型写的叙事，数字的权威在采集账与页面数据——本页因此同时列出报告
 * 与它覆盖的窗口天数，让读者知道这份结论站在多少天的数据上。
 *
 * The reports page: the analysis reports and the newest one's body.
 *
 * A report is the model's narrative; the authority on the numbers is the pull
 * ledger and the page data — so this page also lists the window each report
 * covers, letting the reader see how many days the conclusion stands on.
 *
 * @module @veren/zhihu-ops/page-reports
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { toolOf } from './runtime.ts'
import { requireRuntime } from './runtime.ts'
import { STRINGS, URL_PREFIX } from './pages.tsx'

/**
 * 本页挂载的工具：出报告。
 * The tools this page mounts: write a report.
 *
 * @param agent - the page session's agent / 页面会话的 agent
 */
function registerReportTools(agent: Agent): void {
  agent.ctx.tools.register(toolOf('generate_report'))
}

/** 报告页组件体（一次性渲染）/ the reports page's body (the one-shot render) */
export const ReportsPage: PageFC = (_props, agent) => {
  registerReportTools(agent)
  const runtime = requireRuntime()
  const reports = runtime.storage.reports()
  const latest = reports[0]
  return (
    <>
      <h1>分析报告</h1>
      <ul>
        {reports.map((report) => (
          <li key={report.report_id}>{report.day} · {report.title}（覆盖 {report.window_days} 天）</li>
        ))}
        {reports.length === 0 ? <li>还没有报告，调 generate_report 生成一份。</li> : null}
      </ul>
      {latest === undefined ? null : (
        <>
          <h2>{latest.title}</h2>
          <blockquote>{latest.body}</blockquote>
        </>
      )}
      <blockquote>{STRINGS.snapshot.zh}</blockquote>
    </>
  )
}

export const ReportsMeta: ComponentPageMeta = {
  name: 'reports',
  url: `${URL_PREFIX}/reports`,
  description: '运营分析报告列表与最新一份正文',
  writes: true,
  unattended: {
    serves: '产出并查看运营分析报告，报告随任务投递进收件箱',
    level: 'L1',
    evidence: '报告落本地存储（reports 表）+ 任务中心记录终态可机查',
    escape: '写不出报告时如实说明缺哪个数据（多为缺采集），不重试消耗额度',
  },
  instructions: [
    '这是分析报告页。正文列出历史报告并展开最新一份的全文。',
    '要新报告：调 generate_report——它基于存储里的窗口快照写成，并投进收件箱。',
    '报告里的数字来自采集快照；若快照是空的，报告会说数据未覆盖，不要替它补数字。',
  ].join(''),
}
