// 单测：连续纯分析步数触发、同回合派活抑制、相邻提醒不重字、配置与卸载。
// Unit tests: consecutive analysis-only steps trigger, a same-turn dispatch
// suppresses, neighbouring notices differ, and config/disposal behave.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply, inject, name } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { callEvent, fakeAgent, preStep, reanchorEvent, resolveConfig, textOf, userEvent } from './support.js'

/** 安装真实插件到真实 Context。Install the real plugin into a real Context. */
async function install(overrides: Partial<ConfigShape> = {}): Promise<{ ctx: Context, fiber: Fiber }> {
  const ctx = new Context()
  const fiber = ctx.plugin({ name, inject, apply }, resolveConfig(overrides))
  await fiber
  return { ctx, fiber }
}

/** 追加一步 read 调用。Append one step that reads a file. */
function appendRead(history: SessionEvent[], turn: number, step: number, file: string): void {
  history.push(callEvent(history.length, turn, step, 'read', { file_path: file }))
}

describe('person-agent-reanchor', () => {
  it('injects after three consecutive analysis-only steps', async () => {
    // 连续三步只读文件 → pre-step 正好追加一条重锚消息。
    // Three consecutive read-only steps -> pre-step appends exactly one notice.
    const history: SessionEvent[] = [userEvent(0, '看看这个项目')]
    appendRead(history, 1, 1, 'src/a.ts')
    history.push(callEvent(history.length, 1, 2, 'grep', { pattern: 'serve', path: 'src' }))
    history.push(callEvent(history.length, 1, 3, 'glob', { pattern: '**/*.ts' }))
    const { ctx } = await install()
    const messages = await preStep(ctx, fakeAgent(history), 1, 4)

    expect(messages).toHaveLength(1)
    expect(messages[0]?.source.kind).toBe('person-agent-reanchor')
    expect(textOf(messages[0])).toContain('连续 3 步')
    expect(textOf(messages[0])).toContain('1 个文件')
    expect(textOf(messages[0])).toContain('派活 0 次')
  })

  it('does not inject when this turn already dispatched work', async () => {
    // 同一回合先派过活，之后又读了三步：不再提醒，避免刚交代完就挨骂。
    // A dispatch earlier in this turn followed by three analysis steps: no
    // notice, so a bridge that just handed work off is not nagged.
    const history: SessionEvent[] = [
      userEvent(0, '把这件事安排出去'),
      callEvent(1, 1, 1, 'session_dispatch', { session_id: 'sess-1', prompt: 'do it' }),
    ]
    appendRead(history, 1, 2, 'src/a.ts')
    appendRead(history, 1, 3, 'src/b.ts')
    appendRead(history, 1, 4, 'src/c.ts')
    const { ctx } = await install()
    const messages = await preStep(ctx, fakeAgent(history), 1, 5)

    expect(messages).toEqual([])
  })

  it('does not let a dispatch in an earlier turn suppress this turn\'s notice', async () => {
    // 上一回合派过活，本回合又连续三步自干：本回合仍需提醒。
    // A dispatch in an earlier turn does not excuse self-work in this turn.
    const history: SessionEvent[] = [
      userEvent(0, '先安排一件事'),
      callEvent(1, 1, 1, 'session_dispatch', { session_id: 'sess-1', prompt: 'do it' }),
    ]
    appendRead(history, 2, 2, 'src/a.ts')
    appendRead(history, 2, 3, 'src/b.ts')
    appendRead(history, 2, 4, 'src/c.ts')
    const { ctx } = await install()
    const messages = await preStep(ctx, fakeAgent(history), 2, 5)

    expect(messages).toHaveLength(1)
    expect(textOf(messages[0])).toContain('本回合派活 0 次')
  })

  it('never repeats the previous notice verbatim', async () => {
    // 第一次提醒落进日志后，再连续三步自干：第二次提醒带新的计数与措辞。
    // After the first notice lands in the log, three more analysis steps yield
    // a second notice with new counts and different wording.
    const history: SessionEvent[] = [userEvent(0, '读一读')]
    appendRead(history, 1, 1, 'src/a.ts')
    appendRead(history, 1, 2, 'src/b.ts')
    appendRead(history, 1, 3, 'src/c.ts')
    const { ctx } = await install()
    const first = await preStep(ctx, fakeAgent(history), 1, 4)
    expect(first).toHaveLength(1)
    const firstText = textOf(first[0])

    history.push(reanchorEvent(history.length, firstText))
    appendRead(history, 1, 4, 'src/d.ts')
    appendRead(history, 1, 5, 'src/e.ts')
    appendRead(history, 1, 6, 'src/f.ts')
    const second = await preStep(ctx, fakeAgent(history), 1, 7)

    expect(second).toHaveLength(1)
    const secondText = textOf(second[0])
    expect(secondText).not.toBe(firstText)
    expect(secondText).toContain('最近 3 步')
  })

  it('does nothing when disabled', async () => {
    // 整体关闭：连监听器都不注册。
    // Disabled entirely: not even the listener is registered.
    const history: SessionEvent[] = [userEvent(0, '读一读')]
    appendRead(history, 1, 1, 'src/a.ts')
    appendRead(history, 1, 2, 'src/b.ts')
    appendRead(history, 1, 3, 'src/c.ts')
    const { ctx } = await install({ enabled: false })
    const messages = await preStep(ctx, fakeAgent(history), 1, 4)

    expect(messages).toEqual([])
  })

  it('honours a custom threshold', async () => {
    // 阈值可配：5 步才提醒，4 步时不提醒。
    // Configurable threshold: five steps trigger, four do not.
    const history: SessionEvent[] = [userEvent(0, '读一读')]
    appendRead(history, 1, 1, 'src/a.ts')
    appendRead(history, 1, 2, 'src/b.ts')
    appendRead(history, 1, 3, 'src/c.ts')
    appendRead(history, 1, 4, 'src/d.ts')
    const { ctx } = await install({ threshold: 5 })
    expect(await preStep(ctx, fakeAgent(history), 1, 5)).toEqual([])

    appendRead(history, 1, 5, 'src/e.ts')
    expect(await preStep(ctx, fakeAgent(history), 1, 6)).toHaveLength(1)
  })

  it('removes the listener when the fiber unloads', async () => {
    // 卸载后不再注入：注册贡献必须可逆。
    // No injection after unload: the registration must be reversible.
    const history: SessionEvent[] = [userEvent(0, '读一读')]
    appendRead(history, 1, 1, 'src/a.ts')
    appendRead(history, 1, 2, 'src/b.ts')
    appendRead(history, 1, 3, 'src/c.ts')
    const { ctx, fiber } = await install()
    await fiber.dispose()
    expect(await preStep(ctx, fakeAgent(history), 1, 4)).toEqual([])
  })
})
