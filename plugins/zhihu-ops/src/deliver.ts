/**
 * 报告投递：把写好的报告送进任务中心，让运营者在自己的收件箱里看到它。
 *
 * 投递走任务中心的正门（`taskCenter.send`），因此收件箱、通知与完成状态
 * 都是宿主的那一套，本插件不另造一套。幂等键按报告日定，因此同一天重复
 * 生成报告不会堆出多条任务。
 *
 * Report delivery: hands the finished report to the task center so the
 * operator sees it in their own inbox.
 *
 * Delivery goes through the task center's front door (`taskCenter.send`), so
 * the inbox, the notification, and the completion state are the host's own —
 * this plugin does not build a second one. The idempotency key is the report
 * day, so re-generating a report on the same day does not pile up tasks.
 *
 * @module @veren/zhihu-ops/deliver
 */
import type { TaskCenterContract, TaskDraft } from '@veren/task-center'
import type { PageInstanceKey } from '@veren/prompt-page'
import { APP_ID } from './app.ts'
import type { ReportRow } from './store/store.ts'

/** 报告页的 URL / the reports page url */
export const REPORTS_PAGE_URL = '/apps/zhihu-ops/reports'

/** 报告页的页面键 / the reports page key */
export const REPORTS_PAGE_KEY = 'reports'

/**
 * 组装一份报告的任务草稿。
 * Assembles the task draft of one report.
 *
 * @param report - the report / 报告
 * @returns the task draft / 任务草稿
 */
export function reportDraft(report: ReportRow): TaskDraft {
  return {
    kind: 'zhihu-ops/report' as TaskDraft['kind'],
    title: report.title,
    body: report.body.slice(0, 4000),
    target: {
      url: REPORTS_PAGE_URL as PageInstanceKey,
      appId: APP_ID,
      page: REPORTS_PAGE_KEY,
      params: {},
    },
    idempotencyKey: `zhihu-ops/report-${report.day}`,
  }
}

/**
 * 把报告投进任务中心。
 * Delivers the report to the task center.
 *
 * @param taskCenter - the task-center contract / 任务中心契约
 * @param report - the report / 报告
 * @returns the task record / 任务记录
 */
export async function deliverReport(taskCenter: TaskCenterContract, report: ReportRow) {
  return await taskCenter.send(reportDraft(report))
}
