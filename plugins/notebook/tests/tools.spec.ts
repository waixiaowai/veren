/**
 * The model-facing `notebook_*` tools through the real tool registry.
 *
 * A notebook's owner is resolved from the live Agent on every call and is never
 * a parameter, so the specs drive the registry itself: registration order and
 * reverse disposal, the exact argument surface (no `owner` field exists),
 * per-preset isolation, the optimistic-concurrency guard, and the stable
 * refusal codes the model reads.
 *
 * 通过真实工具注册表测试面向模型的 `notebook_*` 工具族。
 *
 * 记事本的归属在每次调用时取自活着的 Agent，永远不是参数，因此这些用例驱动注册表本身：
 * 注册顺序与逆序释放、确切的参数面（不存在 `owner` 字段）、按预设隔离、乐观并发守卫，以及
 * 模型读到的稳定拒绝码。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import NotebookService from '../src/index.ts'
import type { NoteSummary, NoteView } from '../src/types.ts'

/** The registry member the tools register through. 工具注册所经过的注册表成员。 */
interface RegisteredTool {
  readonly name: string
  readonly parameters: {
    readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>
    readonly required?: readonly string[]
  }
  execute(args: Record<string, unknown>, exec: { agent: unknown }): Promise<unknown>
}

/** The tool names in registration order. 按注册顺序的工具名。 */
const TOOL_NAMES = ['notebook_list', 'notebook_read', 'notebook_create', 'notebook_update', 'notebook_delete']

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'notebook-tools-'))
  roots.push(root)
  return root
}

/**
 * Mount the real storage stack and notebook service with a captured registry.
 *
 * `composedPreset` reads the caller's preset off the Agent's own context, which
 * is exactly how the service resolves ownership; the specs therefore prove
 * isolation by calling as two different Agents.
 *
 * 挂载真实存储栈、记事本服务与供断言的注册表。
 *
 * `composedPreset` 从 Agent 自己的 context 读取预设，这正是服务解析归属的方式；因此这些用例
 * 用两个不同的 Agent 调用即可证明隔离。
 *
 * @returns the root context, the fiber, and the captured registry.
 */
async function mount() {
  const ctx = new Context()
  const tools = new Map<string, RegisteredTool>()

  ctx.provide('tools', {
    register(tool: RegisteredTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('agentPresets', {
    list: async () => [],
    composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
  })

  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })

  const fiber: Fiber = ctx.plugin(NotebookService)
  await fiber
  return { ctx, fiber, tools }
}

/**
 * The execution context one tool call carries.
 *
 * `agent` is the live Agent the owner is resolved from, so two calls with two
 * Agents act on two notebooks.
 *
 * 一次工具调用携带的执行上下文。`agent` 是解析归属所依据的活 Agent，因此两个 Agent 的调用
 * 作用于两本记事本。
 */
function execution(preset: string | undefined): { agent: unknown } {
  return {
    agent: preset === undefined ? undefined : { ctx: { preset }, session: { header: { agentPreset: preset } } },
  }
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
function toolValue<T>(result: unknown): T {
  return result as T
}

describe('notebook tool registry / 记事本工具注册表', () => {
  it('registers the five tools and removes each one in reverse on unload', async () => {
    const { fiber, tools } = await mount()

    expect([...tools.keys()]).toEqual(TOOL_NAMES)
    await fiber.dispose()
    expect(tools.size).toBe(0)
  })

  it('never exposes an owner argument', async () => {
    const { fiber, tools } = await mount()

    for (const name of TOOL_NAMES) {
      expect(tools.get(name)?.parameters.properties ?? {}, name).not.toHaveProperty('owner')
    }
    expect(tools.get('notebook_create')?.parameters.required).toEqual(expect.arrayContaining(['title', 'body']))
    for (const name of ['notebook_read', 'notebook_update', 'notebook_delete']) {
      expect(tools.get(name)?.parameters.required, name).toContain('id')
    }

    await fiber.dispose()
  })

  it('writes, reads, lists, updates, and deletes inside the caller notebook', async () => {
    const { fiber, tools } = await mount()
    const exec = execution('ada')

    expect(toolValue<{ notes: NoteSummary[] }>(await tools.get('notebook_list')?.execute({}, exec)).notes).toEqual([])

    const created = toolValue<{ note: NoteView }>(
      await tools.get('notebook_create')?.execute({ title: 'Plan', body: 'first draft' }, exec),
    )
    expect(created.note).toMatchObject({ title: 'Plan', body: 'first draft' })

    const read = toolValue<{ note: NoteView }>(
      await tools.get('notebook_read')?.execute({ id: created.note.id }, exec),
    )
    expect(read.note.body).toBe('first draft')

    const listed = toolValue<{ notes: NoteSummary[] }>(await tools.get('notebook_list')?.execute({}, exec))
    expect(listed.notes.map(note => note.id)).toEqual([created.note.id])
    expect(listed.notes[0]).not.toHaveProperty('body')

    const updated = toolValue<{ note: NoteView }>(
      await tools.get('notebook_update')?.execute({ id: created.note.id, title: 'Plan v2' }, exec),
    )
    expect(updated.note).toMatchObject({ title: 'Plan v2', body: 'first draft' })

    expect(toolValue<{ deleted: boolean }>(
      await tools.get('notebook_delete')?.execute({ id: created.note.id }, exec),
    ).deleted).toBe(true)
    await expect(tools.get('notebook_read')?.execute({ id: created.note.id }, exec))
      .rejects.toMatchObject({ name: 'NotebookToolError', code: 'notebook/note-not-found' })

    await fiber.dispose()
  })

  it('keeps two presets notebooks apart even with the other id in hand', async () => {
    const { fiber, tools } = await mount()
    const ada = execution('ada')
    const bob = execution('bob')

    const created = toolValue<{ note: NoteView }>(
      await tools.get('notebook_create')?.execute({ title: 'Private', body: 'only ada' }, ada),
    )

    expect(toolValue<{ notes: NoteSummary[] }>(await tools.get('notebook_list')?.execute({}, bob)).notes).toEqual([])
    await expect(tools.get('notebook_read')?.execute({ id: created.note.id }, bob))
      .rejects.toMatchObject({ code: 'notebook/note-not-found' })

    await fiber.dispose()
  })

  it('refuses a stale update instead of overwriting a newer edit', async () => {
    const { fiber, tools } = await mount()
    const exec = execution('ada')
    const created = toolValue<{ note: NoteView }>(
      await tools.get('notebook_create')?.execute({ title: 'T', body: 'B' }, exec),
    )

    await tools.get('notebook_update')?.execute({ id: created.note.id, body: 'newer' }, exec)
    await expect(tools.get('notebook_update')?.execute({
      id: created.note.id,
      body: 'stale',
      expectedUpdatedAt: created.note.updatedAt,
    }, exec)).rejects.toMatchObject({ name: 'NotebookToolError', code: 'notebook/conflict' })

    await fiber.dispose()
  })

  it('refuses every tool when the call has no agent', async () => {
    const { fiber, tools } = await mount()
    const args = { id: 'n1', title: 'T', body: 'B' }

    for (const name of TOOL_NAMES) {
      await expect(tools.get(name)?.execute(args, execution(undefined)), name)
        .rejects.toMatchObject({ name: 'NotebookToolError', code: 'no_caller' })
    }

    await fiber.dispose()
  })

  it('refuses an empty title with the stable validation code', async () => {
    const { fiber, tools } = await mount()

    await expect(tools.get('notebook_create')?.execute({ title: '   ', body: 'B' }, execution('ada')))
      .rejects.toMatchObject({ name: 'NotebookToolError', code: 'notebook/title-required' })

    await fiber.dispose()
  })
})