/**
 * The notebook tool builders driven directly (the composition face).
 *
 * Builders only produce `defineTool` products, so the specs mount the real
 * storage stack and the real service, build the five definitions against the
 * service's own tools port, and drive `execute` through the minimal face. The
 * owner is resolved from the live Agent on every call and is never a
 * parameter, so the specs prove isolation by calling as two different Agents.
 *
 * 直驱记事本工具构建器（组合面）。
 *
 * 构建器只产出 `defineTool` 产物，因此用例挂载真实存储栈与真实服务，对着服务自己的
 * 工具端口构建五个定义，并经最小执行面驱动 `execute`。归属在每次调用时取自活着的
 * Agent，永远不是参数，因此用例用两个不同的 Agent 调用即可证明隔离。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import NotebookService, {
  buildNotebookDeleteDefinition, buildNotebookListDefinition, buildNotebookReadDefinition,
  buildNotebookRewriteDefinition, buildNotebookWriteDefinition, Config,
} from '../src/index.ts'
import type { NoteSummary, NoteView } from '../src/types.ts'

/** The builder products in build order, keyed by local name. 按本地名为键、按构建顺序排列的构建产物。 */
const TOOL_NAMES = ['list_notes', 'read_note', 'write_note', 'rewrite_note', 'delete_note']

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
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

/** 工具定义的最小执行面（测试只走 execute；方法签名保持双变，宿主 exec 由假实现顶替）。 */
/** The minimal execution face of a tool definition (tests drive execute only; the method signature stays bivariant, a fake stands in for the host exec). */
interface RegisteredTool {
  execute: (args: Record<string, unknown>, exec: { agent?: unknown }) => Promise<unknown>
}

/** 测试只走 execute：收窄到最小执行面（唯一的断言点，宿主 exec 由假对象顶替）。 */
/** Tests drive execute only: narrow to the minimal face (the single assertion point; an empty object stands in for the host exec). */
function drivable(definition: ToolDefinition): RegisteredTool {
  return definition as unknown as RegisteredTool
}

/**
 * Mount the real storage stack and notebook service, then build all five tool
 * definitions against the service's own tools port.
 *
 * `composedPreset` reads the caller's preset off the Agent's own context, which
 * is exactly how the builders resolve ownership.
 *
 * 挂载真实存储栈与记事本服务，再对着服务自己的工具端口构建全部五个工具定义。
 *
 * `composedPreset` 从 Agent 自己的 context 读取预设，这正是构建器解析归属的方式。
 */
async function mount(): Promise<{
  fiber: Fiber
  definitions: Map<string, ToolDefinition>
  run: (tool: string, args: unknown, exec: { agent?: unknown }) => Promise<unknown>
}> {
  const ctx = new Context()
  ctx.provide('agentPresets', {
    list: async () => [],
    composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
  })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = await ctx.plugin(NotebookService, Config({}))
  const port = ctx.notebook.toolsPort()
  const definitions = new Map<string, ToolDefinition>([
    ['list_notes', buildNotebookListDefinition(ctx, () => port)],
    ['read_note', buildNotebookReadDefinition(ctx, () => port)],
    ['write_note', buildNotebookWriteDefinition(ctx, () => port)],
    ['rewrite_note', buildNotebookRewriteDefinition(ctx, () => port)],
    ['delete_note', buildNotebookDeleteDefinition(ctx, () => port)],
  ])
  return {
    fiber,
    definitions,
    run: async (tool, args, exec) => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not built: ${tool}`)
      return await drivable(definition).execute(args as Record<string, unknown>, exec)
    },
  }
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

describe('notebook tool builders / 记事本工具构建器', () => {
  it('builds exactly the five page tools under their local names', async () => {
    const { definitions, fiber } = await mount()

    expect([...definitions.keys()]).toEqual(TOOL_NAMES)
    // 全局 notebook_* 名已退役：构建产物的本地名不带旧全局前缀。
    // The global notebook_* names are retired: no local name carries the old global prefix.
    for (const name of TOOL_NAMES) expect(name.startsWith('notebook_')).toBe(false)

    await fiber.dispose()
  })

  it('never exposes an owner argument', async () => {
    const { definitions, fiber } = await mount()

    for (const name of TOOL_NAMES) {
      const parameters = definitions.get(name)?.parameters as {
        properties?: Record<string, unknown>
        required?: readonly string[]
      }
      expect(parameters.properties ?? {}, name).not.toHaveProperty('owner')
    }
    const create = definitions.get('write_note')?.parameters as { required?: readonly string[] }
    expect(create.required).toEqual(expect.arrayContaining(['title', 'body']))
    for (const name of ['read_note', 'rewrite_note', 'delete_note']) {
      const parameters = definitions.get(name)?.parameters as { required?: readonly string[] }
      expect(parameters.required, name).toContain('id')
    }

    await fiber.dispose()
  })

  it('writes, reads, lists, updates, and deletes inside the caller notebook', async () => {
    const { run, fiber } = await mount()
    const exec = execution('ada')

    expect(toolValue<{ notes: NoteSummary[] }>(await run('list_notes', {}, exec)).notes).toEqual([])

    const created = toolValue<{ note: NoteView }>(
      await run('write_note', { title: 'Plan', body: 'first draft' }, exec),
    )
    expect(created.note).toMatchObject({ title: 'Plan', body: 'first draft' })

    const read = toolValue<{ note: NoteView }>(await run('read_note', { id: created.note.id }, exec))
    expect(read.note.body).toBe('first draft')

    const listed = toolValue<{ notes: NoteSummary[] }>(await run('list_notes', {}, exec))
    expect(listed.notes.map(note => note.id)).toEqual([created.note.id])
    expect(listed.notes[0]).not.toHaveProperty('body')

    const updated = toolValue<{ note: NoteView }>(
      await run('rewrite_note', { id: created.note.id, title: 'Plan v2' }, exec),
    )
    expect(updated.note).toMatchObject({ title: 'Plan v2', body: 'first draft' })

    expect(toolValue<{ deleted: boolean }>(await run('delete_note', { id: created.note.id }, exec)).deleted)
      .toBe(true)
    await expect(run('read_note', { id: created.note.id }, exec))
      .rejects.toMatchObject({ name: 'NotebookToolError', code: 'notebook/note-not-found' })

    await fiber.dispose()
  })

  it('keeps two presets notebooks apart even with the other id in hand', async () => {
    const { run, fiber } = await mount()
    const ada = execution('ada')
    const bob = execution('bob')

    const created = toolValue<{ note: NoteView }>(
      await run('write_note', { title: 'Private', body: 'only ada' }, ada),
    )

    expect(toolValue<{ notes: NoteSummary[] }>(await run('list_notes', {}, bob)).notes).toEqual([])
    await expect(run('read_note', { id: created.note.id }, bob))
      .rejects.toMatchObject({ code: 'notebook/note-not-found' })

    await fiber.dispose()
  })

  it('refuses a stale update instead of overwriting a newer edit', async () => {
    const { run, fiber } = await mount()
    const exec = execution('ada')
    const created = toolValue<{ note: NoteView }>(await run('write_note', { title: 'T', body: 'B' }, exec))

    await run('rewrite_note', { id: created.note.id, body: 'newer' }, exec)
    await expect(run('rewrite_note', {
      id: created.note.id,
      body: 'stale',
      expectedUpdatedAt: created.note.updatedAt,
    }, exec)).rejects.toMatchObject({ name: 'NotebookToolError', code: 'notebook/conflict' })

    await fiber.dispose()
  })

  it('refuses every tool when the call has no agent', async () => {
    const { run, fiber } = await mount()
    const args = { id: 'n1', title: 'T', body: 'B' }

    for (const name of TOOL_NAMES) {
      await expect(run(name, args, execution(undefined)), name)
        .rejects.toMatchObject({ name: 'NotebookToolError', code: 'no_caller' })
    }

    await fiber.dispose()
  })

  it('refuses an empty title with the stable validation code', async () => {
    const { run, fiber } = await mount()

    await expect(run('write_note', { title: '   ', body: 'B' }, execution('ada')))
      .rejects.toMatchObject({ name: 'NotebookToolError', code: 'notebook/title-required' })

    await fiber.dispose()
  })
})
