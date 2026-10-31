// 生命周期事件：派发与结算各广播一次、按 watchId 配对；纯派发只广播 start。
// Lifecycle events: one broadcast each for the dispatch and the settlement,
// paired by watchId; a fire-and-forget dispatch broadcasts only the start.
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './harness-env.js'
import { dispatchTo } from './settlement-helpers.js'

describe('生命周期事件 / lifecycle events', () => {
  it('派发与结算各广播一次，按 watchId 配对', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const receipt = await dispatchTo(env, caller, 'target') as { watchId: string }
    expect(env.runEvents.map(event => event.name)).toEqual(['start'])
    expect(env.runEvents[0]?.payload).toMatchObject({
      watchId: receipt.watchId, targetSessionId: 'target', callerSessionId: 'caller',
    })

    target.say('CLOSING')
    target.turnEnd('completed')
    target.finish()
    await settleAsync()

    expect(env.runEvents.map(event => event.name)).toEqual(['start', 'end'])
    const end = env.runEvents[1]?.payload
    expect(end).toMatchObject({ watchId: receipt.watchId, outcome: 'completed' })
    // 只序列化收尾块：事件载荷里还带着 agent 本身（含 ctx，是环状的）。
    // Serialize the closing blocks only: the payload also carries the agent
    // itself, whose ctx makes it circular.
    const closing = (end as { lastAssistantMessage?: unknown }).lastAssistantMessage
    expect(JSON.stringify(closing)).toContain('CLOSING')
  })

  it('纯派发只广播 start（没有结算可观察）', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    await env.run('session_dispatch', { sessionId: 'target', prompt: 'fire', report: false }, { agent: caller })
    expect(env.runEvents.map(event => event.name)).toEqual(['start'])
    expect(env.runEvents[0]?.payload).toMatchObject({ watchId: null })

    target.say('IGNORED')
    target.finish()
    await settleAsync()
    expect(env.runEvents.map(event => event.name)).toEqual(['start'])
  })
})
