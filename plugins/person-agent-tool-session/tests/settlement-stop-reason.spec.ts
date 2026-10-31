// 结束原因与失败取代：六种可命名原因的措辞、无法命名原因按失败汇报、
// agent/error 与后续轮次的取代规则，以及收尾复查（flush 期间又落事件就重判）。
// Stop reasons and failure supersession: the wording of the six nameable
// reasons, unnameable ones reported as failures, the agent/error vs later-turn
// supersession rules, and the pre-finalization re-check (an event landing during
// the flush forces a re-decision).
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './harness-env.js'
import type { FakeAgent } from './harness-fake-agent.js'
import type { Env } from './harness-env.js'
import { dispatchTo, noticeText } from './settlement-helpers.js'

describe('结束原因与失败取代 / stop reasons and failure supersession', () => {
  /** 派发一次，让目标以给定原因结束一个轮次，返回通知正文。 */
  /** Dispatch once, end one turn with the given reason, and return the notice body. */
  async function noticeFor(reasonKind: string): Promise<string> {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')
    target.turnEnd(reasonKind)
    target.finish()
    await settleAsync()
    return noticeText(caller)
  }

  it('completed：干净结束且没有未跑输入', async () => {
    expect(await noticeFor('completed')).toContain('finished and will do no further work')
  })

  it('aborted：被停止', async () => {
    expect(await noticeFor('aborted')).toContain('was stopped before it finished')
  })

  it('interrupted 也归入 aborted', async () => {
    expect(await noticeFor('interrupted')).toContain('was stopped before it finished')
  })

  it('max-tokens：空间不够', async () => {
    expect(await noticeFor('max-tokens')).toContain('ran out of room before it finished')
  })

  it('blocked：pre-step 拒绝，是"拒绝"而不是"做完"', async () => {
    expect(await noticeFor('blocked')).toContain('declined the task')
  })

  it('error：失败', async () => {
    expect(await noticeFor('error')).toContain('failed before it finished')
  })

  it('无法命名的结束原因按失败汇报，绝不报成功', async () => {
    expect(await noticeFor('something-new')).toContain('failed before it finished')
  })

  it('agent/error 单独发生时按失败汇报', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')
    target.fail()
    target.finish()
    await settleAsync()
    expect(noticeText(caller)).toContain('failed before it finished')
  })

  it('后续已提交轮次取代先前的失败', async () => {
    // A later committed turn supersedes the failure, so the notice reports success.
    const env = await install()
    const caller: FakeAgent = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.fail()
    target.turnEnd('completed')
    target.finish()
    await settleAsync()

    expect(noticeText(caller)).toContain('finished and will do no further work')
  })

  it('通知前会 best-effort 刷目标会话（官方 flushFinalState 同序）', async () => {
    const env: Env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.turnEnd('completed')
    target.finish()
    await settleAsync()

    expect(env.flushes).toEqual(['target', 'caller'])
  })

  it('收尾复查：flush 期间目标又落了事件就重判，不拿旧结论报告', async () => {    // The pre-finalization re-check: an event landing while the flush is in
    // flight moves the session seq, so the observer decides again instead of
    // reporting the conclusion reached before the flush.
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.turnEnd('completed')
    let injected = false
    env.flushHooks.push((sessionId) => {
      if (sessionId !== 'target' || injected) return
      injected = true
      // 只落事件、不唤醒：故意绕开 poke 令牌，单独验证 seq 这道闸。
      // Records an event without waking, so this isolates the seq guard from the
      // poke token.
      target.say('ARRIVED-DURING-FLUSH')
    })
    target.finish()
    await settleAsync()

    expect(injected).toBe(true)
    // 目标被刷了两次（复查前后各一次），说明确实回到了循环重判。
    // The target was flushed twice (before and after the re-decision), proving the
    // observer went back around.
    expect(env.flushes).toEqual(['target', 'target', 'caller'])
    expect(caller.received).toHaveLength(1)
    expect(noticeText(caller)).toContain('ARRIVED-DURING-FLUSH')
  })
})
