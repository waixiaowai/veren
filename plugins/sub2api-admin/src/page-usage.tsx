/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 用量分析页（只读）：区间汇总、近 7 日趋势与模型维度统计经 store 首屏同步；
 * 其他口径用 usage 工具查询，成本与毛利在首页。本页不执行任何写操作。
 * The usage analytics page (read-only): the range summary, the 7-day trend,
 * and the per-model statistics sync via the store's first screen; other slices
 * query through the usage tool, cost and gross profit live on the home page.
 * This page performs no writes.
 *
 * @module @veren/sub2api-admin/page-usage
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import { readState, registerTools, rowsOf, URL_PREFIX } from './page-runtime.ts'

export const UsagePage: PageFC = (_props, agent) => {
  registerTools(agent, ['usage'])
  const state = readState()
  const trend = rowsOf(state.usage?.trend ?? [])
  const models = rowsOf(state.usage?.models ?? [])
  return (
    <>
      <h1>{`Sub2API 运营 · 用量分析${state.usage?.updatedAt === undefined ? '' : `（更新于 ${state.usage.updatedAt}）`}`}</h1>
      <p>区间汇总：{String((state.usage?.range as unknown | undefined) ?? '-')}</p>
      {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
      <h2>近 7 日趋势</h2>
      <ul>{trend.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
      <h2>模型维度</h2>
      <ul>{models.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
    </>
  )
}

export const UsageMeta: ComponentPageMeta = {
  name: 'usage',
  url: `${URL_PREFIX}/usage`,
  description: '用量分析页：近 7 日趋势、模型维度统计、区间汇总（成本/毛利口径见指挥台）',
  unattended: {
    serves: '用量/成本分析类投递任务与盘面问询',
    level: 'L0',
    evidence: 'read-only',
    escape: 'none-needed',
  },
  instructions: '区间汇总经 usage.range、近 7 日趋势经 usage.trend、模型维度经 usage.models 同步。'
    + '需要其他口径（自定义区间/按用户/按 Key/用户排行）用 usage 工具查询；'
    + '成本与毛利在首页（today_actual_cost 与支付收入之差）。本页只读，不执行任何写操作。',
  instanceTitle: () => 'Sub2API 运营 · 用量分析',
}
