/**
 * The six `task_*` tools, executed directly against a real service.
 *
 * The tools registry is a capturing stub: we assert that exactly the six
 * contract tools register and that their `execute` paths enforce claimant
 * identity and surface stable error codes to the model.
 *
 * 六个 `task_*` 工具，直接打在真实服务上。
 *
 * 工具注册表用捕获桩：断言恰好注册了六个契约工具，且 `execute` 路径会校验接取者身份、
 * 把稳定错误码暴露给模型。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TaskCenterService from '../src/index.ts'

interface RegisteredTool {
  readonly name: string
  execute(args: Record<string, unknown>, exec: { agent?: unknown }): Promise<unknown>
}

/** A tiny map-backed storage domain double, enough for the service to open. */
function fakeStorageDomain(): unknown {
  const open = async () => {
    const tables = new Map<string, Map<string, unknown>>()
    return {
      table: (name: string) => {
        const rows = tables.get(name) ?? tables.set(name, new Map()).get(name)!
        return {
          get: (key: string) => rows.get(key),
          put: async (key: string, value: unknown) => { rows.set(key, value) },
          delete: async (key: string) => rows.delete(key),
          entries: () => rows.entries(),
        }
      },
      close: async () => undefined,
    }
  }
  return { get: () => undefined, open }
}

/**
 * Construct the service with a capturing tools registry.
 * 构造服务，工具注册表用捕获桩。
 */
function boot(): { service: TaskCenterService; byName: Map<string, RegisteredTool> } {
  const tools: RegisteredTool[] = []
  const ctx = new Context()
  ctx.provide('storageDomain', fakeStorageDomain() as never)
  ctx.provide('tools', { register: (tool: unknown) => (tools.push(tool as RegisteredTool), () => undefined) } as never)
  const service = new TaskCenterService(ctx as Context, { tools: { enabled: true } })
  return { service, byName: new Map(tools.map(tool => [tool.name, tool])) }
}

function draftTask(): Parameters<TaskCenterService['send']>[0] {  return {
    kind: 'review-workbench/review-request' as never,
    title: 'Review PR #42',
    target: { url: '/apps/review-workbench/review/pr-42' as never, appId: 'review-workbench', page: 'review', params: {} },
  }
}

const HOUR = 60 * 60 * 1000

describe('task_* tools', () => {
  it('registers exactly the six contract tools', () => {
    const { byName } = boot()
    expect([...byName.keys()].sort()).toEqual([
      'task_cancel', 'task_complete', 'task_fail', 'task_get', 'task_list', 'task_take',
    ])
  })

  it('task_complete enforces claimant identity before the write', async () => {
    const { service, byName } = boot()
    const task = await service.send(draftTask())
    await service.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })

    const complete = byName.get('task_complete')!
    await expect(complete.execute({ id: task.id, summary: 'ok' }, { agent: { session: { id: 's2' } } }))
      .rejects.toMatchObject({ code: 'task/not-claimant' })
    await expect(complete.execute({ id: task.id, summary: 'done work' }, { agent: { session: { id: 's1' } } }))
      .resolves.toMatchObject({ task: { status: 'done', result: { summary: 'done work' } } })
  })

  it('task_list / task_get round-trip; take and fail surface stable codes', async () => {
    const { service, byName } = boot()
    const task = await service.send(draftTask())

    await expect(byName.get('task_list')!.execute({}, {})).resolves.toMatchObject({ tasks: [{ id: task.id }] })
    await expect(byName.get('task_get')!.execute({ id: task.id }, {})).resolves.toMatchObject({ task: { id: task.id } })
    await expect(byName.get('task_take')!.execute({ id: 'task-none' }, { agent: { session: { id: 's1' } } }))
      .rejects.toMatchObject({ code: 'task/not-found' })
    await expect(byName.get('task_fail')!.execute({ id: task.id, code: 'x', message: 'y' }, {}))
      .rejects.toMatchObject({ code: 'task/invalid-state' })
  })
})
