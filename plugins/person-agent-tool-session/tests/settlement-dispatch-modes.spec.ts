// 结算时序测试（派发变体与容量）：新建会话路径、看守容量上限、投递失败撤看守、
// 卸载（HMR）取消挂起的看守。
// Settlement-timing tests (dispatch variants and capacity): the new-session
// path, the watch capacity cap, the guard retracted on a failed delivery, and
// unload (HMR) cancelling pending watches.
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './harness-env.js'
import { dispatchTo } from './settlement-helpers.js'

describe('session_dispatch 结算 / settlement：派发变体与容量 / dispatch variants and capacity', () => {
  it('新建会话后派发', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    env.addAgent('created-1')

    const receipt = await env.run(
      'session_dispatch',
      { newSession: { workspaceId: 'ws-1', agentPreset: 'person-agent' }, prompt: 'start fresh' },
      { agent: caller },
    )
    expect(receipt).toMatchObject({ sessionId: 'created-1', reporting: true })
    expect(env.created).toEqual([{ workspaceId: 'ws-1', agentPreset: 'person-agent' }])
  })

  it('看守容量上限被拒绝', async () => {
    const env = await install({ maxConcurrentWatches: 1 })
    const caller = env.addAgent('caller')
    env.addAgent('target')

    await env.run('session_dispatch', { sessionId: 'target', prompt: 'first' }, { agent: caller })
    await expect(env.run('session_dispatch', { sessionId: 'target', prompt: 'second' }, { agent: caller }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_CAPACITY_REACHED' })
  })

  it('投递失败时撤掉看守，不留下幽灵通知', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    target.followup = () => { throw new Error('inbox is closed') }

    await expect(env.run('session_dispatch', { sessionId: 'target', prompt: 'boom' }, { agent: caller }))
      .rejects.toThrow('inbox is closed')
    target.settle()
    await settleAsync()
    expect(caller.received).toHaveLength(0)
  })

  it('卸载取消挂起的看守：不再回报（HMR 安全）', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    await env.unload()
    target.say('TOO-LATE')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(0)
    expect(env.warnings).toEqual([])
  })
})
