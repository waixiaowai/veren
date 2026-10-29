/**
 * The seven `task_*` tools, executed directly against a real service.
 *
 * The tools registry is a capturing stub: we assert that exactly the seven
 * contract tools register, that their `execute` paths enforce claimant
 * identity and surface stable error codes to the model, and that the
 * model-facing guidance names tools that actually exist at the delivery
 * surface (page sessions mask app_open; page_send and the task_* face remain).
 *
 * 七个 `task_*` 工具，直接打在真实服务上。
 *
 * 工具注册表用捕获桩：断言恰好注册了七个契约工具，`execute` 路径会校验接取者身份、
 * 把稳定错误码暴露给模型，且面向模型的指引只点名投递面上真实存在的工具
 * （页面会话屏蔽 app_open；page_send 与 task_* 面仍在）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterService, { noticeText } from '../src/index.ts'
import { MemoryStorageBackend, mountMemoryBackend } from './fake-storage.ts'

interface RegisteredTool {
  readonly name: string
  readonly description: string
  execute(args: Record<string, unknown>, exec: { agent?: unknown }): Promise<unknown>
}

/**
 * Construct the service over the real hub + domain stack on the in-memory
 * backend (no disk IO; see fake-storage.ts), with a capturing tools registry.
 * 构建服务：真实 hub + domain 栈跑在内存后端上（零落盘，见 fake-storage.ts），
 * 工具注册表用捕获桩。
 */
async function boot(): Promise<{ service: TaskCenterService; byName: Map<string, RegisteredTool> }> {
  const tools: RegisteredTool[] = []
  const ctx = new Context()
  ctx.provide('tools', { register: (tool: unknown) => (tools.push(tool as RegisteredTool), () => undefined) } as never)
  await ctx.plugin(Storage.default)
  mountMemoryBackend(ctx, new MemoryStorageBackend())
  await ctx.plugin(StorageDomain, { backend: 'memory' })
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
  it('registers exactly the contract tools', async () => {
    const { byName } = await boot()
    expect([...byName.keys()].sort()).toEqual([
      'task_cancel', 'task_complete', 'task_fail', 'task_get', 'task_list', 'task_split', 'task_take',
    ])
  })

  it('task_complete enforces claimant identity before the write', async () => {
    const { service, byName } = await boot()
    const task = await service.send(draftTask())
    await service.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })

    const complete = byName.get('task_complete')!
    await expect(complete.execute({ id: task.id, summary: 'ok' }, { agent: { session: { id: 's2' } } }))
      .rejects.toMatchObject({ code: 'task/not-claimant' })
    await expect(complete.execute({ id: task.id, summary: 'done work' }, { agent: { session: { id: 's1' } } }))
      .resolves.toMatchObject({ task: { status: 'done', result: { summary: 'done work' } } })
  })

  it('task_list / task_get round-trip; take and fail surface stable codes', async () => {
    const { service, byName } = await boot()
    const task = await service.send(draftTask())

    await expect(byName.get('task_list')!.execute({}, {})).resolves.toMatchObject({ tasks: [{ id: task.id }] })
    await expect(byName.get('task_get')!.execute({ id: task.id }, {})).resolves.toMatchObject({ task: { id: task.id } })
    await expect(byName.get('task_take')!.execute({ id: 'task-none' }, { agent: { session: { id: 's1' } } }))
      .rejects.toMatchObject({ code: 'task/not-found' })
    await expect(byName.get('task_fail')!.execute({ id: task.id, code: 'x', message: 'y' }, {}))
      .rejects.toMatchObject({ code: 'task/invalid-state' })
  })

  it('model-facing guidance names only tools that exist at the delivery surface', async () => {
    // 投递面事实：收件泵只把通知注进新建的页面会话（page-registry §5.2），而页面
    // 会话 deny app_open（app-host/session-port）——指引 app_open 就是假承诺；
    // page_send 与 task_* 面在页面会话里真实存在。
    // / The delivery-surface facts: the inbox pump only feeds fresh page
    // sessions (page-registry §5.2), which deny app_open (app-host's
    // session-port) — instructing app_open is a false promise; page_send and
    // the task_* face do exist there.
    const { service, byName } = await boot()
    expect(byName.get('task_take')!.description).toContain('page_send')
    expect(byName.get('task_take')!.description).not.toContain('with app_open')
    // task_cancel 的"释放"指引指向真实路径：接取者收口或租约到点，没有 release 工具
    // / task_cancel's release guidance names the real paths: the claimant's own
    // completion or lease expiry — no release tool exists
    expect(byName.get('task_cancel')!.description).toContain('lease expires')
    const task = await service.send(draftTask())
    const text = noticeText(task)
    expect(text).toContain('task_take')
    expect(text).toContain('page_send')
    expect(text).not.toContain('app_open 打开')
    // 任务 id 单独成行：投递同意按它收窄（工作台同意门的 §2 投递指令面）
    // / the task id on its own line: delivery consent narrows by it (the workbench gate's §2 delivery face)
    expect(text).toContain(`任务：${task.id}`)
  })
})
