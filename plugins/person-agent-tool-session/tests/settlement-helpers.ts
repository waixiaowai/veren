// 结算 spec 共用的两步动作与断言面：发起一次带回报的派发、读调用方收到的通知正文。
// The two-step action and assertion face shared by the settlement specs: fire one
// reporting dispatch, and read the notice bodies the caller received.
import type { FakeAgent } from './harness-fake-agent.js'
import type { Env } from './harness-env.js'

/**
 * 发起一次带回报的派发。Dispatch once with reporting on.
 * @param env - 测试环境。The test environment.
 * @param caller - 调用方 Agent。The caller Agent.
 * @param targetId - 目标会话 id。The target session id.
 * @returns 派发收据。The dispatch receipt.
 */
export async function dispatchTo(env: Env, caller: FakeAgent, targetId: string): Promise<Record<string, unknown>> {
  return await env.run(
    'session_dispatch',
    { sessionId: targetId, prompt: 'do the work' },
    { agent: caller },
  ) as Record<string, unknown>
}

/**
 * 调用方收到的最后一条通知正文。The last notice body the caller received.
 * @param caller - 调用方 Agent。The caller Agent.
 * @returns 通知正文（无通知时为空串）。The notice body (empty when no notice arrived).
 */
export function noticeText(caller: FakeAgent): string {
  const message = caller.received.at(-1) ?? caller.steered.at(-1)
  if (message === undefined) return ''
  return message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}
