// 装配与工具契约测试：走真实 cordis Context（真实 inject 解析、真实 effect
// 逆序清理），驱动被注册的工具定义，锁定参数校验、目标解析与卸载行为。
// Assembly and tool-contract tests: a real cordis Context (real inject resolution
// and real reverse-order effect disposal) drives the registered tool definition,
// locking argument validation, target resolution, and unload behavior.
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.js'
import { install, settleAsync } from './support.js'

describe('session_dispatch 装配与契约 / assembly and contracts', () => {
  it('注册恰好一个工具，并在卸载时摘除它 / registers one tool and removes it on unload', async () => {
    const env = await install()
    expect([...env.definitions.keys()]).toEqual(['session_dispatch'])
    await env.unload()
    expect([...env.definitions.keys()]).toEqual([])
  })

  it('卸载取消挂起的看守：不再回报 / unloading cancels pending watches', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await env.run('session_dispatch', { sessionId: 'target', prompt: 'long job' }, { agent: caller })

    await env.unload()
    target.say('TOO-LATE')
    target.finish()
    await settleAsync()

    expect(caller.received).toHaveLength(0)
    expect(env.warnings).toEqual([])
  })

  it('参数非法时抛带稳定 code 的结构化错误 / rejects invalid arguments with stable codes', async () => {
    const env = await install()
    const caller = env.addAgent('caller')

    await expect(env.run('session_dispatch', { sessionId: 'x', prompt: '   ' }, { agent: caller }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_PROMPT_EMPTY' })
    await expect(env.run('session_dispatch', { prompt: 'hi' }, { agent: caller }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_MISSING' })
    await expect(env.run('session_dispatch', { sessionId: 'x', newSession: {}, prompt: 'hi' }, { agent: caller }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_CONFLICT' })
    await expect(env.run('session_dispatch', { sessionId: 'nope', prompt: 'hi' }, { agent: caller }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_UNRESOLVED' })
    await expect(env.run('session_dispatch', { sessionId: 'x', prompt: 'hi' }, {}))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_NO_CALLER' })
  })

  it('新建会话后派发 / creates a session and dispatches into it', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    env.addAgent('created-1')

    const receipt = await env.run(
      'session_dispatch',
      { newSession: { cwd: 'C:/work', agentPreset: 'person-agent' }, prompt: 'start fresh' },
      { agent: caller },
    )
    expect(receipt).toMatchObject({ sessionId: 'created-1', reporting: true })
    expect(env.created).toEqual([{ cwd: 'C:/work', agentPreset: 'person-agent' }])
  })

  it('看守容量上限被拒绝 / rejects once the watch cap is reached', async () => {
    const env = await install({ maxConcurrentWatches: 1 })
    const caller = env.addAgent('caller')
    env.addAgent('target')

    await env.run('session_dispatch', { sessionId: 'target', prompt: 'first' }, { agent: caller })
    await expect(env.run('session_dispatch', { sessionId: 'target', prompt: 'second' }, { agent: caller }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_CAPACITY_REACHED' })
  })

  it('投递失败时撤掉看守，不留下幽灵回报 / a failed delivery disarms the watch', async () => {
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

  it('Config 提供默认值并拒绝坏配置 / Config fills defaults and rejects bad input', () => {
    const defaults = Config['~standard'].validate(undefined)
    expect(defaults).toMatchObject({
      value: { maxReportChars: 4000, maxConcurrentWatches: 64, emptyOutputText: expect.stringContaining('no assistant text') },
    })
    expect(Config['~standard'].validate({ maxReportChars: 0 })).toHaveProperty('issues')
    expect(Config['~standard'].validate({ reportTemplate: 'no placeholders' })).toHaveProperty('issues')
  })
})
