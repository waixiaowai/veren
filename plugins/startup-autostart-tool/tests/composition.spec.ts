// Real Cordis composition checks injection, tool registration, and reverse disposal.
// 使用真实 Cordis 组合测试注入、工具注册及逆序卸载。
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, apply, inject, name } from '../src/index.ts'

interface RegisteredTool {
  readonly name: string
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

/** Mount the tool row with a fake Host service; exercise the real Loader lifecycle. / 用假宿主服务走真实 Loader 生命周期。 */
async function mount() {
  const ctx = new Context()
  const tools = new Map<string, RegisteredTool>()
  const calls: string[] = []
  ctx.provide('tools', {
    register(tool: RegisteredTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('startupAutostart', {
    async catalog() { calls.push('catalog'); return [] },
    async create(input: unknown) { calls.push('create'); return input },
    async update(input: unknown) { calls.push('update'); return input },
    async delete(input: unknown) { calls.push('delete'); return input },
    async run(input: unknown) { calls.push('run'); return input },
  } as unknown as Context['startupAutostart'])
  const fiber = ctx.plugin({ Config, apply, inject, name }, {})
  await fiber
  return { fiber, tools, calls }
}

describe('startup autostart tool composition', () => {
  it('registers five model tools and removes each registration on unload', async () => {
    const { fiber, tools, calls } = await mount()
    expect([...tools.keys()].sort()).toEqual([
      'startup_create', 'startup_delete', 'startup_list', 'startup_run', 'startup_update',
    ])
    expect(await tools.get('startup_list')?.execute({})).toEqual([])
    expect(calls).toEqual(['catalog'])
    await fiber.dispose()
    expect(tools.size).toBe(0)
  })
})
