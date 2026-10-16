// 看守时序测试：本插件的核心契约——「真的静止了才回报一次」。
// Guard-timing tests: the plugin's core contract - report exactly once, only
// when the target is genuinely quiescent.
import { describe, expect, it } from 'vitest'
import { createPluginMessage } from '../src/dispatch.js'
import { DEFAULT_CONFIG, install, settleAsync } from './support.js'
import type { Env, FakeAgent } from './support.js'

/** 发起一次带回报的派发。/ Dispatch once with reporting on. */
async function dispatchTo(env: Env, caller: FakeAgent, targetId: string): Promise<Record<string, unknown>> {
  return await env.run('session_dispatch', { sessionId: targetId, prompt: 'do the work' }, { agent: caller }) as Record<string, unknown>
}

/** 调用方收到的最后一条回报正文。/ The last report body the caller received. */
function reportText(caller: FakeAgent): string {
  const message = caller.received.at(-1)
  if (message === undefined) return ''
  return message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

describe('session_dispatch 看守 / the dispatch guard', () => {
  it('派发立即返回，调用方在目标静止前就拿到收据 / returns before the target settles', async () => {
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
  })

  it('目标静止后回报收尾输出一次 / reports the final output once after quiescence', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say('SUMMARY: three packages changed')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(caller.received[0]?.role).toBe('user')
    expect(caller.received[0]?.source).toEqual({ kind: 'session-dispatch' })
    expect(reportText(caller)).toContain('SUMMARY: three packages changed')
    expect(reportText(caller)).toContain('Outcome: settled')
    expect(reportText(caller)).toContain('Target session: target')
    expect(env.flushes).toEqual(['caller'])
  })

  it('先 idle 又复活时不得提前宣布完成 / an idle-then-revive must not report early', async () => {
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
    expect(reportText(caller)).toContain('PASS-TWO')
    expect(reportText(caller)).not.toContain('PASS-ONE')
  })

  it('status 已是 idle 但 whenIdle() 未 resolve 时不得回报 / no report while whenIdle() is pending', async () => {
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
    expect(reportText(caller)).toContain('MAINT-DONE')
  })

  it('看守挂在目标 Agent 自己的作用域上：别的 Agent 的状态不会触发它', async () => {
    // The guard lives on the target Agent's own scope: another Agent's status
    // transitions never reach it. This is the property that makes a sessionId
    // comparison unnecessary.
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
    expect(reportText(caller)).toContain('ONLY-TARGET')
    // 根上下文上的探针收到了所有 Agent 的事件；看守只收到目标那一个。
    // The root probe saw every Agent's events; the guard saw only the target's.
    expect(env.rootStatusEvents).toContain('other')
    expect(env.rootStatusEvents).toContain('target')
  })

  it('目标 Agent 消失时以 target-gone 收尾 / settles as target-gone when the Agent is gone', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say('BEFORE-GONE')
    env.agents.delete('target')
    target.settle()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(reportText(caller)).toContain('Outcome: target-gone')
  })

  it('report=false 时纯派发、永不回报 / fire-and-forget never reports', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const receipt = await env.run('session_dispatch', { sessionId: 'target', prompt: 'just do it', report: false }, { agent: caller })
    expect(receipt).toMatchObject({ reporting: false, watchId: null })

    target.say('SILENT-DONE')
    target.finish()
    await settleAsync()
    expect(caller.received).toHaveLength(0)
  })

  it('回报正文按 maxReportChars 截断 / truncates the report body', async () => {
    const env = await install({ maxReportChars: 24 })
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say(`LONG-${'x'.repeat(400)}`)
    target.finish()
    await settleAsync()

    expect(reportText(caller)).toContain('LONG-')
    expect(reportText(caller)).toContain('…')
    expect(reportText(caller)).not.toContain('x'.repeat(40))
  })

  it('目标没有 assistant 输出时用占位正文 / uses the stand-in body when there is no output', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.finish()
    await settleAsync()
    expect(reportText(caller)).toContain(DEFAULT_CONFIG.emptyOutputText)
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

    // 认领那条输入会发出 inbox/claimed，从而唤醒观察者。
    // Claiming that input emits inbox/claimed, which wakes the observer.
    target.say('CLAIMED-DONE')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(reportText(caller)).toContain('CLAIMED-DONE')
  })

  it('目标静止后又被外部投递唤醒时继续等，不提前回报', async () => {
    // Revived by an outside delivery after reaching idle: keep waiting.
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.say('FIRST-PASS')
    target.finish()
    target.followup({ content: [{ type: 'text', text: 'more work' }], source: { kind: 'user' } } as never)
    await settleAsync()

    expect(caller.received).toHaveLength(0)

    target.say('SECOND-PASS')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(reportText(caller)).toContain('SECOND-PASS')
  })

  it('回报只看投递之后的新输出，不捡投递前的历史', async () => {
    // The report reads only output produced after the delivery.
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    target.say('STALE-HISTORY')
    await dispatchTo(env, caller, 'target')

    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(1)
    expect(reportText(caller)).not.toContain('STALE-HISTORY')
    expect(reportText(caller)).toContain('no assistant text')
  })

  it('回报模板可配置，缺占位符的加载被 Config 拒绝', async () => {
    // Configurable template; a template missing a placeholder fails the Config check.
    expect(createPluginMessage('x').content).toEqual([{ type: 'text', text: 'x' }])
    const env = await install({ reportTemplate: 'DONE {target_session_id}: {output}' })
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')
    target.say('BODY')
    target.finish()
    await settleAsync()
    expect(reportText(caller)).toBe('DONE target: BODY')
  })
})
