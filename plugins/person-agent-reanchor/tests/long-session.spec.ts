// 长会话回归：假适配器连续 30 步、约 40 万字符上下文，检查重锚在第 25 步之后
// 仍然出现；同一个脚本不装插件时一条都不出现。
// Long-session regression: a fake adapter drives 30 steps and roughly 400k
// characters of context; the re-anchor still appears after step 25, while the
// same script without the plugin produces none.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SOURCE } from '../src/analyze.js'
import { apply, inject, name } from '../src/index.js'
import { callEvent, fakeAgent, preStep, reanchorEvent, resultEvent, resolveConfig, textOf, userEvent } from './support.js'

/** 30 步、每步约 14k 字符的读取结果，总量约 42 万字符（中文约 1 字符 ≈ 1 token）。 */
/** 30 steps, about 14k characters of read output each: ~420k characters, roughly the same token count in Chinese. */
const STEPS = 30
const CHARS_PER_STEP = 14_000
const HUGE_FILE = '文件内容。'.repeat(CHARS_PER_STEP / '文件内容。'.length)

/**
 * 假适配器：每一步都产出一个 read 工具调用和一份巨大的结果，从不派活。
 * Fake adapter: every step emits one read call and a huge result, and never
 * dispatches.
 */

/**
 * 跑完 30 步；返回每次 pre-step 注入的步骤号。注入的消息像真实循环一样落回
 * 日志，下一步的计数才会从这条提醒之后重新开始。
 * Run all 30 steps; return the step numbers at which pre-step injected
 * something. Injected messages land back in the log as the real loop would,
 * so the next count restarts after the notice.
 * @param ctx - context that may or may not carry the plugin. 可能装了插件的上下文。
 * @param history - mutable log. 可变日志。
 * @returns each injected notice's step number. 每条注入提醒的步骤号。
 */
async function runSession(ctx: Context, history: SessionEvent[]): Promise<number[]> {
  const injected: number[] = []
  for (let step = 1; step <= STEPS; step += 1) {
    const messages = await preStep(ctx, fakeAgent(history), 1, step)
    const reanchor = messages.filter(message => message.source.kind === SOURCE)
    if (reanchor.length > 0) injected.push(step)
    for (const message of reanchor) history.push(reanchorEvent(history.length, textOf(message)))
    history.push(callEvent(history.length, 1, step, 'read', { file_path: `src/file-${step}.ts` }))
    history.push(resultEvent(history.length, 1, step, HUGE_FILE))
  }
  return injected
}

describe('long Person Agent session', () => {
  it('keeps re-anchoring after step 25 in a 400k-character session', async () => {
    // 真实插件挂在真实 Context 上，日志滚到 42 万字符后仍然能看到提醒。
    // The real plugin on a real Context keeps producing notices after the log
    // has grown to 420k characters.
    const ctx = new Context()
    const fiber: Fiber = ctx.plugin({ name, inject, apply }, resolveConfig())
    await fiber
    const history: SessionEvent[] = [userEvent(0, '把这个仓库读一遍')]
    const injected = await runSession(ctx, history)

    const text = history.flatMap(event => (event.type === 'tool/result' ? event.data.message.content : []))
      .flatMap(block => (block.type === 'text' ? [block.text] : []))
      .join('')
    expect(text.length).toBeGreaterThan(400_000)
    // 每 3 步一条，从第 4 步开始；第 25 步之后还有第 28 步那一条。
    // One every three steps starting at step 4; step 28 is still after step 25.
    expect(injected).toEqual([4, 7, 10, 13, 16, 19, 22, 25, 28])
    await fiber.dispose()
  })

  it('produces no notice without the plugin', async () => {
    // 同一份脚本、同一个日志规模，不装插件时零提醒——对照组成立。
    // Same script and log size, no plugin: zero notices, so the comparison holds.
    const ctx = new Context()
    const history: SessionEvent[] = [userEvent(0, '把这个仓库读一遍')]
    const injected = await runSession(ctx, history)

    expect(injected).toEqual([])
    expect(history.some(event => event.type === 'user/message' && event.data.source.kind === SOURCE)).toBe(false)
  })
})
