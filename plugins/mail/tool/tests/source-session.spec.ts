/**
 * The send tool's source-session capture: an agent-bound call names its
 * session automatically; a bare SDK call leaves it absent.
 *
 * 发送工具的来源会话捕获：绑定 agent 的调用自动署名其会话；裸 SDK 调用保持缺席。
 */

import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MailService, TriggerRequest } from '@veren/mail'
import { sendTool } from '../src/delivery-tools.ts'

/** A mail service that only records trigger requests. / 一个只记录触发请求的邮件服务。 */
function fakeMail(): { readonly mail: MailService; readonly requests: TriggerRequest[] } {
  const requests: TriggerRequest[] = []
  const mail = {
    trigger: vi.fn(async (request: TriggerRequest) => {
      requests.push(request)
      return { transactionId: 'tx-1', acceptance: 'PROCESSED', recipientCount: 1 }
    }),
  } as unknown as MailService
  return { mail, requests }
}

/** The args mail_send minimally needs. / mail_send 最少需要的参数。 */
const ARGS = {
  workflow: 'station-notice',
  payload: { title: '标题', body: '正文' },
  to: [{ subscriberId: 'host' }],
}

describe('mail_send source session', () => {
  it('署名调用方 agent 的会话 / names the calling agent\'s session automatically', async () => {
    const { mail, requests } = fakeMail()
    const tool = sendTool(mail)
    const exec = { agent: { id: 'sess-1' } } as unknown as ToolRunContext
    await tool.execute?.(ARGS, exec)
    expect(requests[0]?.sourceSessionId).toBe('sess-1')
  })

  it('裸 SDK 调用（无 agent）保持缺席 / a bare SDK call without an agent stays absent', async () => {
    const { mail, requests } = fakeMail()
    const tool = sendTool(mail)
    await tool.execute?.(ARGS, {} as unknown as ToolRunContext)
    expect(requests[0]?.sourceSessionId).toBeUndefined()
  })
})
