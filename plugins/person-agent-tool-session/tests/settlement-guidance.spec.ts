// 返回指导：只有目标确实能回话（可见 send_message 且是调用方的直属子级）时，
// 派发提示才追加 send_message 指导块。
// Return guidance: the dispatch prompt gains the send_message guidance block only
// when the target can actually reply (send_message visible AND a direct child of
// the caller).
import { describe, expect, it } from 'vitest'
import { install } from './harness-env.js'
import type { FakeAgent } from './harness-fake-agent.js'
import { dispatchTo } from './settlement-helpers.js'

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
