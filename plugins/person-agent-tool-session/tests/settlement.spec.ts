// 结算时序测试：本插件的核心契约——目标真正静止才回报，且恰好一次。
// Settlement-timing tests: the plugin's core contract - report exactly once, and
// only when the target is genuinely quiescent.
import { describe, expect, it } from 'vitest'
import { createSettlementNotice } from '../src/notice.js'
import { install, settleAsync } from './settlement-harness.js'
import type { Env, FakeAgent } from './settlement-harness.js'
import { SessionId } from '@deepseek-ai/dsh-session'

/** 发起一次带回报的派发。Dispatch once with reporting on. */
async function dispatchTo(env: Env, caller: FakeAgent, targetId: string): Promise<Record<string, unknown>> {
  return await env.run(
    'session_dispatch',
    { sessionId: targetId, prompt: 'do the work' },
    { agent: caller },
  ) as Record<string, unknown>
}

/** 调用方收到的最后一条通知正文。The last notice body the caller received. */
function noticeText(caller: FakeAgent): string {
  const message = caller.received.at(-1) ?? caller.steered.at(-1)
  if (message === undefined) return ''
  return message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

describe('session_dispatch 结算 / settlement', () => {
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
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')
    await dispatchTo(env, caller, 'target')

    target.fail()
    target.turnEnd('completed')
    target.finish()
    await settleAsync()

    expect(noticeText(caller)).toContain('finished and will do no further work')
  })

  it('通知前会 best-effort 刷目标会话（官方 flushFinalState 同序）', async () => {
    const env = await install()
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

describe('返回指导 / return guidance', () => {
  /** 取目标收到的第一块提示内容。The first prompt block the target received. */
  function promptBlocks(target: FakeAgent) {
    return target.received[0]?.content ?? []
  }

  it('目标确实能回话（有 send_message 且是调用方的子级）时追加指导', async () => {
    const env = await install()
    env.addTool('send_message')
    const caller = env.addAgent('caller')
    const target = env.addAgent('target', 'caller')

    await dispatchTo(env, caller, 'target')

    const blocks = promptBlocks(target)
    expect(blocks).toHaveLength(2)
    const guidance = blocks[1]
    expect(guidance?.type === 'text' ? guidance.text : '').toContain('send_message({ agent_id: "caller"')
  })

  it('目标看不到 send_message 时不追加', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target', 'caller')

    await dispatchTo(env, caller, 'target')
    expect(promptBlocks(target)).toHaveLength(1)
  })

  it('目标不是调用方的子级时不追加（否则会让它调用必然被拒的工具）', async () => {
    const env = await install()
    env.addTool('send_message')
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    await dispatchTo(env, caller, 'target')
    expect(promptBlocks(target)).toHaveLength(1)
  })
})
