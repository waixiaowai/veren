// 结算时序测试（静止判定）：提前复活、maintenance 坑、inbox 停放、作用域隔离与
// target-gone——目标必须**真正**静止，看守才收尾。
// Settlement-timing tests (the quiescence verdict): early revival, the
// maintenance pitfall, a parked inbox, scope isolation, and target-gone - the
// watch finalizes only when the target is genuinely quiescent.
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './harness-env.js'
import { dispatchTo, noticeText } from './settlement-helpers.js'

describe('session_dispatch 结算 / settlement：静止判定 / quiescence verdict', () => {
  it('先 idle 又复活时不得提前宣布完成', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say('PASS-ONE')
    target.finish()
    // 在判定落地之前复活：inbox 是空的，只有 status 变了。
    // Revive before the decision lands: the inbox is empty, only status moved.
    target.wake()
    await settleAsync()

    expect(target.status).toBe('running')
    expect(target.inbox.nextTurn).toHaveLength(0)
    expect(caller.received).toHaveLength(0)

    target.say('PASS-TWO')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(noticeText(caller)).toContain('PASS-TWO')
    expect(noticeText(caller)).not.toContain('PASS-ONE')
  })

  it('status 已是 idle 但 whenIdle() 未 resolve 时不得回报（maintenance 的坑）', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say('MAINT-DONE')
    target.finishWithMaintenance()
    await settleAsync(8)

    // 公开状态已是 idle——只看 agent/status 就会在这里错报完成。
    // The public status is already idle - watching agent/status alone would
    // announce completion right here, wrongly.
    expect(target.status).toBe('idle')
    expect(caller.received).toHaveLength(0)

    target.settle()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(noticeText(caller)).toContain('MAINT-DONE')
  })

  it('inbox 还留着没人认领的输入时进入 wait 分支，不空转也不收尾', async () => {
    // With input parked in the inbox the observer takes its `wait` branch: it
    // parks on the next wake instead of spinning or finalizing.
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.park()
    await settleAsync(8)
    expect(target.status).toBe('idle')
    expect(target.inbox.nextTurn).toHaveLength(1)
    expect(caller.received).toHaveLength(0)

    target.say('CLAIMED-DONE')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(noticeText(caller)).toContain('CLAIMED-DONE')
  })

  it('看守挂在目标 Agent 自己的作用域上：别的 Agent 不会触发它', async () => {
    // The guard lives on the target Agent's own scope, so another Agent's events
    // never reach it - the property that makes a sessionId comparison unnecessary.
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    const other = env.addAgent('other')
    await dispatchTo(env, caller, 'target')

    other.wake()
    other.finish()
    await settleAsync()
    expect(caller.received).toHaveLength(0)

    target.say('ONLY-TARGET')
    target.finish()
    await settleAsync()
    expect(caller.received).toHaveLength(1)
    // 根上下文上的探针收到了所有 Agent 的事件；看守只收到目标那一个。
    // The root probe saw every Agent's events; the guard saw only the target's.
    expect(env.rootStatusEvents).toContain('other')
    expect(env.rootStatusEvents).toContain('target')
  })

  it('目标 Agent 消失时以 target-gone 收尾', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    env.agents.delete('target')
    target.settle()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(noticeText(caller)).toContain('left the runtime before it was observed settling')
  })
})
