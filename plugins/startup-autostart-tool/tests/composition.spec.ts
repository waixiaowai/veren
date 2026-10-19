/**
 * The startup tools through the real Cordis composition.
 *
 * A mounting scope decides who gets these tools, so the specs mount the real
 * plugin and drive the registry the way the Loader does: registration and
 * reverse disposal, the exact flattened argument surface, the argument-to-
 * service mapping (snake_case tool fields to camelCase input), the malformed-id
 * guard, and the error codes the model reads.
 *
 * 通过真实 Cordis 组合测试启动项工具。
 *
 * 挂载作用域决定谁能拿到这些工具，因此这些用例挂载真实插件并像 Loader 一样驱动注册表：
 * 注册与逆序释放、确切的扁平参数面、参数到服务的映射（工具的下划线字段到输入的驼峰字段）、
 * 畸形 id 守卫，以及模型读到的错误码。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { StartupInputError } from '@veren/startup-autostart'
import { apply, inject, name } from '../src/index.ts'

/** The registry member the tools register through. 工具注册所经过的注册表成员。 */
interface RegisteredTool {
  readonly name: string
  readonly parameters: {
    readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>
    readonly required?: readonly string[]
  }
  execute(args: Record<string, unknown>): Promise<unknown>
}

/** The Host service calls one spec made, in order. 一次用例按顺序发出的宿主服务调用。 */
interface HostCall {
  readonly method: string
  readonly input: unknown
}

/**
 * Mount the tool plugin with a fake Host service.
 *
 * The double records every call and can refuse the next one, which is enough to
 * prove the mapping and the refusal conversion without a real startup store.
 *
 * 用假宿主服务挂载工具插件。假实现记录每次调用并可拒绝下一次调用，足以在不使用真实启动项存储
 * 的情况下证明映射与拒绝转换。
 *
 * @param options - the value `catalog` resolves to and the error the next call throws.
 * @returns the fiber, the captured registry, and the recorded Host calls.
 */
async function mount(options: { catalog?: readonly unknown[], throwNext?: Error } = {}) {
  const ctx = new Context()
  const tools = new Map<string, RegisteredTool>()
  const calls: HostCall[] = []
  const state = { throwNext: options.throwNext }

  ctx.provide('tools', {
    register(tool: RegisteredTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('startupAutostart', {
    async catalog() {
      calls.push({ method: 'catalog', input: undefined })
      if (state.throwNext !== undefined) throw state.throwNext
      return options.catalog ?? []
    },
    async create(input: unknown) { calls.push({ method: 'create', input }); return input },
    async update(input: unknown) { calls.push({ method: 'update', input }); return input },
    async delete(input: unknown) { calls.push({ method: 'delete', input }); return input },
    async run(input: unknown) { calls.push({ method: 'run', input }); return input },
  } as unknown as Context['startupAutostart'])

  // The plugin config is empty, so mounting takes no second argument.
  // 插件配置为空，因此挂载时不传第二个参数。
  const fiber = ctx.plugin({ apply, inject, name })
  await fiber
  return { ctx, fiber, tools, calls, state }
}

describe('startup autostart tool composition / 启动项工具组合', () => {
  it('registers five model tools and removes every registration on unload', async () => {
    const { fiber, tools } = await mount()

    expect([...tools.keys()].sort()).toEqual([
      'startup_create', 'startup_delete', 'startup_list', 'startup_run', 'startup_update',
    ])

    await fiber.dispose()
    expect(tools.size).toBe(0)
  })

  it('exposes the documented argument surface', async () => {
    const { fiber, tools } = await mount()
    const required = (tool: string) => tools.get(tool)?.parameters.required ?? []
    const properties = (tool: string) => tools.get(tool)?.parameters.properties ?? {}

    expect(properties('startup_create')['action']?.enum).toEqual([
      'new_session', 'resume_session', 'message_session', 'queue_message',
    ])
    expect(properties('startup_create')).not.toHaveProperty('id')
    for (const tool of ['startup_update', 'startup_delete', 'startup_run']) {
      expect(required(tool), tool).toContain('id')
    }
    expect(properties('startup_run')).toHaveProperty('force')

    await fiber.dispose()
  })

  it('maps flattened snake_case arguments onto the service input', async () => {
    const { fiber, tools, calls } = await mount()

    await tools.get('startup_create')?.execute({
      name: 'Daily',
      action: 'resume_session',
      session_id: 'session-1',
      workspace_id: 'space-1',
      model: { provider: 'deepseek', model: 'v4', reasoning_effort: 'high' },
    })

    expect(calls).toEqual([{
      method: 'create',
      input: {
        name: 'Daily',
        action: 'resume_session',
        sessionId: 'session-1',
        workspaceId: 'space-1',
        model: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' },
      },
    }])

    await fiber.dispose()
  })

  it('omits fields the caller did not supply instead of sending undefined', async () => {
    const { fiber, tools, calls } = await mount()

    await tools.get('startup_create')?.execute({ name: 'Only a name' })

    expect(calls[0]?.input).toEqual({ name: 'Only a name' })
    await fiber.dispose()
  })

  it('lists items without starting a session', async () => {
    const items = [{ id: 's1', name: 'Daily', enabled: true, action: 'new_session' }]
    const { fiber, tools, calls } = await mount({ catalog: items })

    await expect(tools.get('startup_list')?.execute({})).resolves.toEqual(items)
    expect(calls).toEqual([{ method: 'catalog', input: undefined }])

    await fiber.dispose()
  })

  it('refuses a malformed id before the service sees it', async () => {
    const { fiber, tools, calls } = await mount()

    for (const tool of ['startup_update', 'startup_delete', 'startup_run']) {
      await expect(tools.get(tool)?.execute({ id: ' padded ' }), tool)
        .resolves.toMatchObject({ code: 'invalid_id' })
    }
    expect(calls).toEqual([])

    await fiber.dispose()
  })

  it('forwards the force flag when running an item', async () => {
    const { fiber, tools, calls } = await mount()

    await tools.get('startup_run')?.execute({ id: 's1', force: true })

    expect(calls).toEqual([{ method: 'run', input: { id: 's1', force: true } }])
    await fiber.dispose()
  })

  it('reports a structured input refusal and withholds internal failures', async () => {
    const refused = await mount({
      throwNext: new StartupInputError('invalid_name', 'name must be non-empty.'),
    })

    await expect(refused.tools.get('startup_list')?.execute({})).resolves.toEqual({
      code: 'invalid_name',
      message: 'name must be non-empty.',
    })
    await refused.fiber.dispose()

    const failed = await mount({ throwNext: new Error('disk on fire') })
    await expect(failed.tools.get('startup_list')?.execute({})).resolves.toEqual({
      code: 'internal_error',
      message: 'The startup item operation failed.',
    })
    await failed.fiber.dispose()
  })
})