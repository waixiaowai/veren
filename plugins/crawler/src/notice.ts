/**
 * 完成通知：一场采集结束后，把回执投进站内通知收件箱（@veren/mail 的
 * `station-notice` 工作流）。
 *
 * 与 mail 的耦合刻意保持为零运行时依赖：类型走 import type，服务在投递
 * 时刻按令牌名解析（cordis `get` 不阻塞）；未安装 mail 时采集照常工作，
 * 只是没有回执。通知失败绝不影响采集状态。
 *
 * The completion notice: after a crawl run ends, its receipt is delivered
 * into the station inbox (the `station-notice` workflow of @veren/mail).
 *
 * The coupling to mail deliberately carries zero runtime dependency: types
 * come via import type, and the service resolves by token name at delivery
 * time (cordis `get` never blocks). Without mail installed, crawls work
 * exactly as before — just without receipts. A notice failure never
 * touches crawl status.
 *
 * @module @veren/crawler/notice
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineToken, get, type Token } from '@veren/core'
import type { MailService } from '@veren/mail'
import type { RuntimeConfig } from './config.ts'
import type { CrawlerRunOutcome } from './control/manager.ts'

/**
 * mail 服务令牌：契约名与 @veren/mail 的 `MailServiceToken`（'mailService'）
 * 一致；此处刻意不运行时导入该包，装与不装 mail 都不影响本插件加载。
 *
 * The mail service token: the contract name equals @veren/mail's
 * `MailServiceToken` ('mailService'). Importing that package at runtime is
 * deliberate avoided, so the plugin loads with or without mail.
 */
const MailNoticeToken: Token<MailService> = defineToken<MailService>('mailService')

/** 收件人：mail 种子的 `host`（站长）/ the recipient: mail's seeded `host` (the station owner) */
const NOTICE_SUBSCRIBER = 'host'

/** 触发标识：mail 种子的 `station-notice` / the trigger: mail's seeded `station-notice` */
const NOTICE_TRIGGER = 'station-notice'

/**
 * 把结局整理成通知的标题与正文。
 * Shapes an outcome into the notice's title and body.
 *
 * @param outcome - the crawl run's outcome / 一场采集的结局
 * @returns the payload fields / 载荷字段
 */
export function noticePayloadOf(outcome: CrawlerRunOutcome): { title: string; body: string } {
  const seconds = Math.max(1, Math.round((Date.parse(outcome.finishedAt) - Date.parse(outcome.startedAt)) / 1000))
  const label = `${outcome.platform} ${outcome.crawlerType}`
  return outcome.ok
    ? { title: `采集完成：${label}`, body: `本次采集正常结束，耗时约 ${seconds} 秒。` }
    : { title: `采集失败：${label}`, body: `采集进程异常退出（退出码 ${outcome.exitCode}），耗时约 ${seconds} 秒；日志见采集面板。` }
}

/**
 * 构造管理器的结局观察者：投一条站内通知回执。
 * Builds the manager's outcome observer: deliver one station notice.
 *
 * @param ctx - the host context / 宿主上下文
 * @param config - the resolved runtime config / 已解析的运行时配置
 * @returns the observer / 观察者
 */
export function crawlFinishedNotifier(
  ctx: Context,
  config: RuntimeConfig,
): (outcome: CrawlerRunOutcome) => Promise<void> {
  return async (outcome) => {
    if (!config.notifyOnFinish) return
    const mail = get(ctx, MailNoticeToken)
    if (mail === undefined) return
    try {
      const { title, body } = noticePayloadOf(outcome)
      await mail.trigger({
        name: NOTICE_TRIGGER,
        payload: { title, body },
        to: [{ kind: 'subscriber', subscriberId: NOTICE_SUBSCRIBER }],
      })
    } catch (error: unknown) {
      // 回执是锦上添花：失败只记日志，采集状态与下一次采集不受影响。
      // The receipt is a bonus: failures log only; crawl status and the next run are untouched.
      ctx.logger.warn('[veren-crawler] completion notice failed: %s', String(error))
    }
  }
}
