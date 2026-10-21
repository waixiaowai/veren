/**
 * Framework-absent deployment specs for the notebook host (the G2 acceptance
 * face, "framework absent" half): the host no longer declares `apps`, so on a
 * context with no application framework at all the service must still
 * activate, the global `notebook_*` tools must register and work end to end,
 * and the activation must raise no inject/wait warning. The "framework
 * present" half lives in `@veren/notebook-app`'s own suite.
 *
 * 记事本宿主的「框架缺席」部署用例（G2 验收面的缺席半边）：宿主不再声明 `apps`，
 * 因此在完全没有应用框架的上下文上，服务必须照常激活、全局 `notebook_*` 工具必须
 * 登记且端到端可用、激活过程不得产生任何注入等待告警。「框架在场」半边在
 * `@veren/notebook-app` 自己的套件里。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import NotebookService, { Config } from '../src/index.ts'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'notebook-headless-'))
  roots.push(root)
  return root
}

/** The execution context one tool call carries. 一次工具调用携带的执行上下文。 */
function execution(preset: string): { agent: unknown } {
  return { agent: { ctx: { preset }, session: { header: { agentPreset: preset } } } }
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
function toolValue<T>(result: unknown): T {
  return result as T
}

/** One registered global tool as the specs drive it. 用例驱动的全局工具。 */
interface RegisteredTool {
  readonly name: string
  execute(args: Record<string, unknown>, exec?: { agent?: unknown }): Promise<unknown>
}

/** The global tools in registration order. 按注册顺序的全局工具名。 */
const TOOL_NAMES = [
  'notebook_list', 'notebook_read', 'notebook_create', 'notebook_update', 'notebook_delete',
]

/**
 * Mount the real storage stack and the host service on a context that carries
 * no application framework at all, capturing every logger line emitted while
 * the activation settles.
 * 在一个完全不带应用框架的上下文上挂载真实存储栈与宿主服务，并捕获激活稳定期间产生的
 * 每一条日志。
 */
async function mountFrameworkAbsent(): Promise<{
  ctx: Context
  fiber: Fiber
  tools: Map<string, RegisteredTool>
  lines: string[]
}> {
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
  // No 'apps', no 'pageRegistry', no 'taskCenter': this context IS the
  // framework-absent deployment.
  // 没有 'apps'、'pageRegistry'、'taskCenter'：这个上下文就是框架缺席的部署。
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })

  const lines: string[] = []
  const warn = console.warn
  const error = console.error
  console.warn = (line: unknown, ...rest: unknown[]) => { lines.push([line, ...rest].map(String).join(' ')) }
  console.error = (line: unknown, ...rest: unknown[]) => { lines.push([line, ...rest].map(String).join(' ')) }
  try {
    const fiber = await ctx.plugin(NotebookService, Config({ tools: { enabled: true } }))
    return { ctx, fiber, tools, lines }
  } finally {
    console.warn = warn
    console.error = error
  }
}

describe('框架缺席仍能激活 / activates without the framework', () => {
  it('无应用框架时宿主照常激活，无任何注入等待告警', async () => {
    const { ctx, fiber, lines } = await mountFrameworkAbsent()

    // The framework really is absent on this context.
    // 框架确实缺席。
    expect(ctx.get('apps')).toBeUndefined()
    expect(ctx.get('pageRegistry')).toBeUndefined()
    // The host activated anyway and [Service.init] ran.
    // 宿主照样激活，[Service.init] 已执行。
    expect(ctx.notebook).toBeDefined()
    await fiber.dispose()
    expect(lines).toHaveLength(0)
  })

  it('框架缺席时全局 notebook_* 工具照常登记并端到端可用', async () => {
    const { fiber, tools } = await mountFrameworkAbsent()

    expect([...tools.keys()]).toEqual(TOOL_NAMES)
    // The global capability face works end to end without any framework.
    // 全局能力面在没有任何框架的情况下端到端可用。
    const created = toolValue<{ note: { id: string } }>(
      await tools.get('notebook_create')?.execute({ title: 'headless', body: 'still works' }, execution('ada')),
    )
    const listed = toolValue<{ notes: Array<{ id: string }> }>(
      await tools.get('notebook_list')?.execute({}, execution('ada')),
    )
    expect(listed.notes.map((note) => note.id)).toEqual([created.note.id])

    await fiber.dispose()
  })
})
