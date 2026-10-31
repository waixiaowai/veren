// 结算时序测试（回报内容）：纯派发不回报、空收尾文本、字符截断、不捡投递前的
// 历史，以及通知构造本身的纯函数契约。
// Settlement-timing tests (report content): fire-and-forget never reports, the
// empty closing text, the character truncation, no pre-dispatch history, and the
// notice construction's own pure-function contract.
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './harness-env.js'
import { dispatchTo, noticeText } from './settlement-helpers.js'
import { createSettlementNotice } from '../src/notice.js'
import { SessionId } from '@deepseek-ai/dsh-session'

describe('session_dispatch 结算 / settlement：回报内容 / report content', () => {
  it('report=false 时纯派发、永不回报', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const receipt = await env.run(
      'session_dispatch', { sessionId: 'target', prompt: 'just do it', report: false }, { agent: caller },
    )
    expect(receipt).toMatchObject({ reporting: false, watchId: null })

    target.say('SILENT-DONE')
    target.finish()
    await settleAsync()
    expect(caller.received).toHaveLength(0)
  })

  it('目标没有收尾文本时报告 "It left no closing message."', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.finish()
    await settleAsync()
    expect(noticeText(caller)).toContain('It left no closing message.')
  })

  it('收尾文本按 maxReportChars 截断', async () => {
    const env = await install({ maxReportChars: 24 })
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say(`LONG-${'x'.repeat(400)}`)
    target.finish()
    await settleAsync()

    expect(noticeText(caller)).toContain('LONG-')
    expect(noticeText(caller)).toContain('…')
    expect(noticeText(caller)).not.toContain('x'.repeat(40))
  })

  it('回报只看投递之后的新输出，不捡投递前的历史', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    target.say('STALE-HISTORY')
    await dispatchTo(env, caller, 'target')

    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(noticeText(caller)).not.toContain('STALE-HISTORY')
    expect(noticeText(caller)).toContain('It left no closing message.')
  })

  it('通知构造是纯函数：空收尾文本与超限文本都有确定结果', () => {
    // 归属信息现在是必填参数：每条通知都必须写明它答复的是哪一次派发。
    // Attribution is now a required argument: every notice must state which
    // dispatch it answers.
    const first = createSettlementNotice(SessionId('s-1'), 'completed', [], 4000, {
      watchId: 'sd-1', messageId: 'm-1', prompt: 'do the work',
    })
    expect(first.content).toEqual([
      { type: 'text', text: 'Background session s-1 finished and will do no further work unless you send it more.' },
      { type: 'text', text: 'That report answers dispatch sd-1 (message m-1): "do the work".' },
      { type: 'text', text: 'It left no closing message.' },
    ])
    expect(first.source).toMatchObject({ watchId: 'sd-1', messageId: 'm-1' })
    const bounded = createSettlementNotice(
      SessionId('s-2'), 'completed', [{ type: 'text', text: 'y'.repeat(50) }], 10, {
        watchId: 'sd-2', messageId: 'm-2', prompt: 'p',
      },
    )
    expect((bounded.content[3] as { text: string }).text).toHaveLength(10)
    expect((bounded.content[3] as { text: string }).text.endsWith('…')).toBe(true)
  })
})
