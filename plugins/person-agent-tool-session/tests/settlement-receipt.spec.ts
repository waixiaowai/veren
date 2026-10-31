// 结算时序测试（收据与通知投递）：派发立即返回、目标静止后恰好一条通知、
// 空闲 queue / 忙碌 steer 两条投递路径。
// Settlement-timing tests (receipt and notice delivery): the dispatch returns at
// once, exactly one notice after the target settles, and both delivery paths -
// queue when idle, steer when busy.
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './harness-env.js'
import { dispatchTo, noticeText } from './settlement-helpers.js'

describe('session_dispatch 结算 / settlement：收据与通知投递 / receipt and notice delivery', () => {
  it('派发立即返回，调用方在目标静止前就拿到收据', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const receipt = await dispatchTo(env, caller, 'target')

    expect(receipt).toMatchObject({ sessionId: 'target', reporting: true })
    expect(typeof receipt['messageId']).toBe('string')
    expect(typeof receipt['watchId']).toBe('string')
    expect(target.status).toBe('running')
    expect(caller.received).toHaveLength(0)
    expect(target.received[0]?.content[0]).toEqual({ type: 'text', text: 'do the work' })
    // 派发提示带自己的来源 kind，不会被误读成人类用户消息。
    // The dispatch prompt carries its own source kind, so it is not mistaken for
    // a human user message.
    expect(target.received[0]?.source).toMatchObject({ kind: 'session-dispatch', form: 'relay' })
  })

  it('目标静止后投递一条结算通知', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say('SUMMARY: three packages changed')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    const notice = caller.received[0]
    expect(notice?.role).toBe('user')
    // 通知的来源 kind 与提示不同：这是 runtime 对下场的陈述。
    // The notice's source kind differs from the prompt's: this is the runtime
    // stating what became of the target.
    expect(notice?.source).toMatchObject({ kind: 'session-dispatch-notice', form: 'notice' })
    expect(String((notice?.source as { summary?: string }).summary)).toContain('finished')
    expect(noticeText(caller)).toContain('Background session target finished')
    expect(noticeText(caller)).toContain('Its closing message:')
    expect(noticeText(caller)).toContain('SUMMARY: three packages changed')
    // 通知前会先 best-effort 刷一次目标会话，再刷调用方（与官方 flushFinalState 同序）。
    // The notice best-effort flushes the target before the caller, the official
    // flushFinalState order.
    expect(env.flushes).toEqual(['target', 'caller'])
  })

  it('空闲调用方用 queue（自成一轮）', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(caller.steered).toHaveLength(0)
  })

  it('忙碌调用方用 steer（并入当前轮的下一个 step，不另起一轮）', async () => {
    // A busy caller is steered at its nearest step boundary instead of being
    // forced into an extra turn.
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    caller.wake()
    target.finish()
    await settleAsync()

    expect(caller.steered).toHaveLength(1)
    expect(caller.received).toHaveLength(0)
  })
})
