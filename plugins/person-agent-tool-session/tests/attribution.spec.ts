// 归属与并发派发回归：一个目标同时只能有一个未结清的看守，而且每条回报都写明它
// 答复的是哪一次派发。
// 上一轮的缺陷现场：同一个会话连派两条、两条都开回报 —— 两个看守在同一瞬间以同一段
// 收尾输出定案，调用方收到两条逐字相同、谁也对不上的通知，先跑那条任务的结果再也没
// 有送达。本文件把那个现场钉成回归。
// Attribution and concurrent-dispatch regressions: at most one unsettled watch
// per target, and every notice names the dispatch it answers.
// The defect this pins: two reporting dispatches onto one session produced two
// byte-identical notices, both carrying the LAST turn's output, while the earlier
// task's result was never delivered.
import { describe, expect, it } from 'vitest'
import { install, settleAsync } from './settlement-harness.js'
import type { Env, FakeAgent } from './settlement-harness.js'

/** 一次派发收据里断言用得到的字段。The receipt fields the assertions read. */
interface Receipt {
  readonly watchId: string | null
  readonly messageId: string
  readonly reporting: boolean
}

/**
 * 派发一次。Dispatch once.
 * @param env - 测试环境。The test environment.
 * @param caller - 调用方 Agent。The caller Agent.
 * @param sessionId - 目标会话。The target session.
 * @param prompt - 提示正文。The prompt.
 * @param report - 是否回报；省略即默认。Whether to report; omitted means the default.
 * @returns 收据。The receipt.
 */
async function dispatch(
  env: Env,
  caller: FakeAgent,
  sessionId: string,
  prompt: string,
  report?: boolean,
): Promise<Receipt> {
  return await env.run(
    'session_dispatch',
    { sessionId, prompt, ...report === undefined ? {} : { report } },
    { agent: caller },
  ) as Receipt
}

/**
 * 跑完目标身上一个已排队的回合，然后让它真正静止。
 * Run one queued turn on the target, then let it reach true quiescence.
 * @param target - 目标 Agent。The target Agent.
 * @param closing - 收尾输出。The closing output.
 */
async function runTurn(target: FakeAgent, closing: string): Promise<void> {
  target.claimNext()
  target.say(closing)
  target.turnEnd('completed')
  target.finish()
  await settleAsync(8)
}

/**
 * 调用方收到的全部通知正文：投递走 `followup` 还是 `steer` 取决于调用方当时忙不忙，
 * 所以两条路径都要看。
 * Every notice body the caller received: delivery goes by `followup` or `steer`
 * depending on whether the caller was busy, so both arrays are read.
 * @param caller - 调用方 Agent。The caller Agent.
 * @returns 通知正文，投递顺序。The notice bodies, in delivery order.
 */
function notices(caller: FakeAgent): string[] {
  return [...caller.received, ...caller.steered].map(message =>
    message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n'))
}

describe('session_dispatch 归属与并发 / attribution and concurrent dispatch', () => {
  it('同一目标上第二条派发被当场拒绝：不再有两条相同的通知，也不再丢结果', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const first = await dispatch(env, caller, 'target', 'F1: 6x7')

    await expect(dispatch(env, caller, 'target', 'F2: 9x9')).rejects.toMatchObject({
      code: 'SESSION_DISPATCH_WATCH_BUSY',
      fields: { sessionId: 'target', watchId: first.watchId },
    })
    // 拒绝发生在投递之前：被拒的提示从未进入目标，调用方也没收到任何回报。
    expect(target.inbox.nextTurn).toHaveLength(1)
    expect(caller.received).toHaveLength(0)

    await runTurn(target, 'DISPATCH-F1 OK 42')

    const received = notices(caller)
    expect(received).toHaveLength(1)
    expect(received[0]).toContain(`dispatch ${String(first.watchId)}`)
    expect(received[0]).toContain('DISPATCH-F1 OK 42')
    expect(received.join('\n')).not.toContain('9x9')
  })

  it('report=false 的同目标派发同样被拒绝：它会把待结清看守的收尾输出换成别的任务', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const first = await dispatch(env, caller, 'target', 'F1: 6x7')

    await expect(dispatch(env, caller, 'target', 'F2: 9x9', false)).rejects.toMatchObject({
      code: 'SESSION_DISPATCH_WATCH_BUSY',
      fields: { sessionId: 'target', watchId: first.watchId },
    })
    expect(target.inbox.nextTurn).toHaveLength(1)
  })

  it('同一步里并发发出的两条派发不可能都登记：恰好一条被接受，回报只答复它', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    // 真实 F 组现场：两条派发在同一个 step 里一起发出（工具声明了 isConcurrencySafe，
    // 宿主可以并发执行它们）。查账与登记因此必须同处一个同步块，否则两条都会通过。
    // The live F-group scene: both dispatches are issued in one step and the tool
    // declares isConcurrencySafe, so the host may run them concurrently. The check
    // and the registration must therefore share one synchronous block.
    const settled = await Promise.allSettled([
      dispatch(env, caller, 'target', 'F1: 6x7'),
      dispatch(env, caller, 'target', 'F2: 9x9'),
    ])
    const accepted = settled.filter((outcome): outcome is PromiseFulfilledResult<Receipt> => outcome.status === 'fulfilled')
    const refused = settled.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    expect(accepted).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.reason).toMatchObject({ code: 'SESSION_DISPATCH_WATCH_BUSY' })

    // 只有被接受那条投递了出去：因此只有一个回合、一份回报。
    expect(target.inbox.nextTurn).toHaveLength(1)
    const firstBlock = target.received[0]?.content[0]
    const delivered = firstBlock?.type === 'text' ? firstBlock.text : ''
    expect(['F1: 6x7', 'F2: 9x9']).toContain(delivered)

    await runTurn(target, 'ACCEPTED-DONE 42')

    const received = notices(caller)
    expect(received).toHaveLength(1)
    expect(received[0]).toContain(`"${delivered}"`)
    expect(received[0]).toContain('ACCEPTED-DONE 42')
  })

  it('前一条结清之后同一目标可以再派，两条通知各自可归属（拒绝不是永久封禁）', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const first = await dispatch(env, caller, 'target', 'F1: 6x7')
    await runTurn(target, 'DISPATCH-F1 OK 42')
    const second = await dispatch(env, caller, 'target', 'F2: 9x9')
    await runTurn(target, 'DISPATCH-F2 OK 81')

    const received = notices(caller)
    expect(received).toHaveLength(2)
    expect(received[0]).not.toBe(received[1])
    expect(received[0]).toContain(`dispatch ${String(first.watchId)}`)
    expect(received[0]).toContain('DISPATCH-F1 OK 42')
    // 只拿另一条任务自己的收尾行做否证：随机 uuid 里可能出现 "42" 这样的短数字串，
    // 用裸数字判断会假阳性。
    // Only the other dispatch's own closing line disproves a swap: a random uuid may
    // contain short digit runs such as "42", so bare numbers would be false positives.
    expect(received[0]).not.toContain('DISPATCH-F2 OK 81')
    expect(received[1]).toContain(`dispatch ${String(second.watchId)}`)
    expect(received[1]).toContain('DISPATCH-F2 OK 81')
    expect(received[1]).not.toContain('DISPATCH-F1 OK 42')
  })

  it('不同目标并发派发互不干扰，各自的通知写明自己的看守与提示', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const alpha = env.addAgent('alpha')
    const beta = env.addAgent('beta')

    const first = await dispatch(env, caller, 'alpha', 'A: 17x23')
    const second = await dispatch(env, caller, 'beta', 'B: 88/4')

    await runTurn(alpha, 'A-DONE 391')
    await runTurn(beta, 'B-DONE 22')

    const received = notices(caller)
    expect(received).toHaveLength(2)
    const alphaNotice = received.find(text => text.includes('session alpha')) ?? ''
    const betaNotice = received.find(text => text.includes('session beta')) ?? ''
    expect(alphaNotice).toContain(`dispatch ${String(first.watchId)}`)
    expect(alphaNotice).toContain('A-DONE 391')
    expect(alphaNotice).not.toContain('B-DONE')
    expect(betaNotice).toContain(`dispatch ${String(second.watchId)}`)
    expect(betaNotice).toContain('B-DONE 22')
    expect(betaNotice).not.toContain('A-DONE')
  })

  it('通知的来源元数据带上看守与消息身份，供宿主与界面配对', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    const first = await dispatch(env, caller, 'target', 'F1: 6x7')
    await runTurn(target, 'DONE')

    // 调用方空闲，因此这条通知走 followup。
    expect(caller.received[0]?.source).toMatchObject({
      kind: 'session-dispatch-notice',
      watchId: first.watchId,
      messageId: first.messageId,
    })
  })

  it('归属行把提示折成一行并截断，长提示不会撑爆通知', async () => {
    const env = await install()
    const caller = env.addAgent('caller')
    const target = env.addAgent('target')

    await dispatch(env, caller, 'target', `line one\n\nline two ${'x'.repeat(500)}`)
    await runTurn(target, 'DONE')

    const text = notices(caller)[0] ?? ''
    const line = text.split('\n').find(part => part.startsWith('That report answers ')) ?? ''
    expect(line).toContain('"line one line two ')
    expect(line.endsWith('…".')).toBe(true)
    expect(line).not.toContain('x'.repeat(200))
  })
})
