/**
 * Package specs for the fake session ports / agent scopes: tools land in the
 * owning session's scope only, scope teardown removes them, and the root
 * stubs clean up paired.
 *
 * 假会话端口 / 假 agent 作用域的包级测试：工具只落进所属会话的作用域，作用域
 * 销毁即摘除，根替身的清理同样成对。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { installFakeSessions, ToolTable } from '../src/index.ts'

// 品牌铸造沿用仓库惯例（零运行时开销）/ brand minting per repo idiom
const asSession = (id: string): SessionId => id as SessionId

/** 一个真实 ToolDefinition（与页面工具同形）。One real ToolDefinition (same shape as a page tool). */
function namedTool(name: string) {
  return defineTool({
    name, description: '测试工具', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  })
}

describe('ToolTable 登记与注销成对', () => {
  it('注销器只摘自己那一条；dispose 逆序清空且可复用', () => {
    const table = new ToolTable()
    table.register(namedTool('a'))
    const undoB = table.register(namedTool('b'))
    expect(table.names()).toEqual(['a', 'b'])
    undoB()
    expect(table.names()).toEqual(['a'])
    table.register(namedTool('c'))
    table.dispose()
    expect(table.names()).toEqual([])
    table.register(namedTool('d'))
    expect(table.names()).toEqual(['d'])
  })
})

describe('installFakeSessions 作用域互斥与销毁', () => {
  it('两个会话各自的作用域只看得到自己的工具；销毁 A 后 B 原样', () => {
    const ctx = new Context()
    const fake = installFakeSessions(ctx)
    const a = fake.startAgent('s-a')
    const b = fake.startAgent('s-b')
    // 页面运行时经作用域 ctx.tools.register 挂工具（与真实接线同路径）
    // The page runtime lands tools via scope ctx.tools.register (the real path).
    a.ctx.tools.register(namedTool('mini__read'))
    b.ctx.tools.register(namedTool('mini__read'))
    expect(a.toolNames()).toEqual(['mini__read'])
    expect(b.toolNames()).toEqual(['mini__read'])
    expect(a.ctx).not.toBe(b.ctx)
    fake.stopAgent('s-a')
    expect(a.toolNames()).toEqual([])
    expect(b.toolNames()).toEqual(['mini__read'])
    expect(fake.isAlive('s-a')).toBe(false)
    expect(fake.isAlive('s-b')).toBe(true)
    fake.dispose()
    expect(b.toolNames()).toEqual([])
  })

  it('followup 经 agents 端口进入会话记录；未激活的会话没有 agent', async () => {
    const ctx = new Context()
    const fake = installFakeSessions(ctx)
    expect(ctx.get('agents')?.get(asSession('ghost'))).toBeUndefined()
    const scope = fake.startAgent('s-1')
    const agent = ctx.get('agents')?.get(asSession('s-1'))
    if (agent === undefined) throw new Error('the activated session has no agent view')
    expect(agent.ctx).toBe(scope.ctx)
    // followup 的消息面按真实类型构造（text ContentBlock）。
    // The followup message is built with the real message face (text blocks).
    agent.followup({
      content: [{ type: 'text', text: 'PAGE ' }, { type: 'text', text: 'main' }],
    } as never)
    expect(scope.followups).toEqual(['PAGE main'])
    fake.stopAgent('s-1')
    expect(ctx.get('agents')?.get(asSession('s-1'))).toBeUndefined()
  })
})
