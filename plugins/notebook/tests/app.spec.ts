/**
 * Framework-absent deployment specs for the notebook host (the G2 acceptance
 * face, "framework absent" half): the host declares no application-framework
 * inject, so on a context with no application framework at all the service
 * must still activate, register nothing into any tools registry (the global
 * `notebook_*` registration retired in 0.2.0), and raise no inject/wait
 * warning; the headless capability face is the service's own tools port. The
 * "framework present" half — the only registration face — lives in
 * `@veren/notebook-app`'s own suite.
 *
 * 记事本宿主的「框架缺席」部署用例（G2 验收面的缺席半边）：宿主不声明任何应用框架
 * inject，因此在完全没有应用框架的上下文上，服务必须照常激活、不向任何工具注册表登记
 * （全局 `notebook_*` 注册已在 0.2.0 退役）、激活过程不得产生任何注入等待告警；
 * headless 的能力面就是服务自己的工具端口。「框架在场」半边——唯一的注册面——住在
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

/** One registered global tool as the retirement specs observe it. 退役用例观察的全局注册工具。 */
interface RegisteredTool {
  readonly name: string
}

/**
 * Mount the real storage stack and the host service on a context that carries
 * no application framework at all, with a recording `tools` registry and every
 * logger line captured while the activation settles.
 * 在一个完全不带应用框架的上下文上挂载真实存储栈与宿主服务：带一个记录型 `tools`
 * 注册表，并捕获激活稳定期间产生的每一条日志。
 */
async function mountFrameworkAbsent(): Promise<{
  ctx: Context
  fiber: Fiber
  tools: Map<string, RegisteredTool>
  lines: string[]
}> {
  const ctx = new Context()
  const tools = new Map<string, RegisteredTool>()
  // A recording registry: if the host ever registered a global tool again, this
  // map would catch it — the retirement contract stays observable.
  // 记录型注册表：宿主若再注册任何全局工具，这个 map 就会抓到——退役契约保持可观测。
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
    const fiber = await ctx.plugin(NotebookService, Config({}))
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

  it('全局 notebook_* 注册已退役：激活不向任何工具注册表登记', async () => {
    const { tools, fiber } = await mountFrameworkAbsent()

    // The single registration face is the application layer; the host registers
    // nothing, in a framework-absent deployment or anywhere else.
    // 唯一的注册面是应用层；宿主什么也不注册——框架缺席的部署与其他任何地方都一样。
    expect(tools.size).toBe(0)

    await fiber.dispose()
  })

  it('headless 能力面 = 服务端口：create + list 端到端可用', async () => {
    const { ctx, fiber } = await mountFrameworkAbsent()

    // Whoever mounts the exported builders (or reads the port directly) gets the
    // full capability face even with no framework present.
    // 即使框架缺席，构建器的任何挂载方（或端口的直接读者）拿到的能力面都是完整的。
    const port = ctx.notebook.toolsPort()
    const created = await port.create('ada', 'headless', 'still works')
    const listed = await port.list('ada')
    expect(listed.map(note => note.id)).toEqual([created.id])

    await fiber.dispose()
  })
})
