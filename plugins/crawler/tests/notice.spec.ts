/**
 * 完成通知单元验收：结局→文案、投递路径的开关与容错。
 * Completion-notice unit acceptance: outcome→copy, and the delivery
 * path's switch and fault tolerance.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { MailService } from '@veren/mail'
import { crawlFinishedNotifier, noticePayloadOf } from '../src/notice.ts'
import type { CrawlerRunOutcome } from '../src/control/manager.ts'
import type { TriggerResult } from '@veren/mail'

/** 一场正常的采集结局 / a successful crawl outcome */
const okOutcome: CrawlerRunOutcome = {
  platform: 'xhs',
  crawlerType: 'search',
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  finishedAt: new Date().toISOString(),
  exitCode: 0,
  ok: true,
}

/** 一场异常退出的采集结局 / a failed crawl outcome */
const failOutcome: CrawlerRunOutcome = { ...okOutcome, exitCode: 1, ok: false }

/** 假 mail 服务：只记录 trigger 调用 / a fake mail service: records trigger calls only */
function fakeMail(result: TriggerResult = { transactionId: 'tx-1', acceptance: 'PROCESSED', recipientCount: 1 }): MailService {
  return {
    trigger: vi.fn(async () => result),
  } as unknown as MailService
}

/** 假宿主上下文：get 按需返回服务 / a fake host context: get returns the service on demand */
function fakeCtx(mail: MailService | undefined): Context {
  return {
    get: () => mail,
    logger: { warn: vi.fn() },
  } as unknown as Context
}

describe('noticePayloadOf', () => {
  it('成功结局写「采集完成」与耗时 / a success names completion and the duration', () => {
    const payload = noticePayloadOf(okOutcome)
    expect(payload.title).toBe('采集完成：xhs search')
    expect(payload.body).toContain('65')
    expect(payload.body).toContain('正常结束')
  })

  it('失败结局写「采集失败」与退出码 / a failure names the exit code', () => {
    const payload = noticePayloadOf(failOutcome)
    expect(payload.title).toBe('采集失败：xhs search')
    expect(payload.body).toContain('退出码 1')
  })
})

describe('crawlFinishedNotifier', () => {
  it('mail 在位时投递 station-notice 给 host / delivers station-notice to host when mail is present', async () => {
    const mail = fakeMail()
    const notify = crawlFinishedNotifier(fakeCtx(mail), { notifyOnFinish: true } as never)
    await notify(okOutcome)
    expect(mail.trigger).toHaveBeenCalledWith(expect.objectContaining({
      name: 'station-notice',
      payload: { title: '采集完成：xhs search', body: expect.any(String) },
      to: [{ kind: 'subscriber', subscriberId: 'host' }],
    }))
  })

  it('mail 缺席时静默跳过 / skips quietly when mail is absent', async () => {
    const ctx = fakeCtx(undefined)
    const notify = crawlFinishedNotifier(ctx, { notifyOnFinish: true } as never)
    await expect(notify(okOutcome)).resolves.toBeUndefined()
  })

  it('开关关闭时不投递 / does not deliver when the switch is off', async () => {
    const mail = fakeMail()
    const notify = crawlFinishedNotifier(fakeCtx(mail), { notifyOnFinish: false } as never)
    await notify(okOutcome)
    expect(mail.trigger).not.toHaveBeenCalled()
  })

  it('投递失败只记日志不外抛 / a delivery failure logs instead of throwing', async () => {
    const mail = fakeMail()
    ;(mail.trigger as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))
    const ctx = fakeCtx(mail)
    const notify = crawlFinishedNotifier(ctx, { notifyOnFinish: true } as never)
    await expect(notify(okOutcome)).resolves.toBeUndefined()
    expect(ctx.logger.warn).toHaveBeenCalled()
  })
})
