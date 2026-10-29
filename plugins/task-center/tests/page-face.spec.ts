/**
 * 页面作用域完成回报面（page-face.ts）单测：真实服务 + 真实 JSON 栈（临时目录），
 * 锁四件事——接取（无参数、按目标 URL 解析）、幂等续租、他人持有拒绝、
 * 完成/失败收口（summary 必填的完成证据面）。
 * Unit tests for the page-scoped completion face (page-face.ts): the real
 * service over the real JSON stack (temp dir), locking four behaviors — the
 * parameterless take resolved by target url, idempotent renewal, the
 * other-claimant refusal, and the complete/fail closure (summary as the
 * required evidence).
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
import type { PageInstanceKey } from '@veren/prompt-page'
import TaskCenterPlugin, { buildPageTaskTools } from '../src/index.ts'
import type { TaskCenterService } from '../src/index.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

const roots: string[] = []
const fibers: Fiber[] = []

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose().catch(() => undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 起真实服务（含 config.tools.enabled=false：页面会话不该看到全局面，本面独立于它）
 * / boot the real service (tools off: page sessions never saw the global face; this face is independent of it) */
async function boot(): Promise<{ tasks: TaskCenterService; tools: ToolDefinition[] }> {
  const ctx = new Context()
  const root = mkdtempSync(join(tmpdir(), 'page-face-'))
  roots.push(root)
  ctx.provide('tools', { register: () => () => undefined })
  fibers.push(await ctx.plugin(Storage.default))
  fibers.push(await ctx.plugin(StorageJson, { root }))
  fibers.push(await ctx.plugin(StorageDomain, { backend: 'json' }))
  fibers.push(await ctx.plugin(TaskCenterPlugin, { tools: { enabled: false } }))
  const tasks = ctx.taskCenter
  // 页面作用域：urlOfSession 把"会话 s1"映到 /apps/x/page/1（一个假想的目标页）
  // / the page scope: session s1 maps to /apps/x/page/1 (an imagined target page)
  const tools = buildPageTaskTools(() => tasks, {
    urlOfSession: async (sessionId) => (sessionId === 's1' ? '/apps/x/page/1' : undefined),
  })
  return { tasks, tools }
}

/** 投递一条目标为该假想页的任务 / deliver one task targeting the imagined page */
function deliver(tasks: TaskCenterService, url: string) {
  return tasks.send({
    kind: 'x/req' as never,
    title: '投递到页面的一条任务',
    target: { url: url as PageInstanceKey, appId: 'x', page: 'page', params: { id: '1' } },
  })
}

/** 按本地名取工具 / pick a tool by name */
function toolOf(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`tool ${name} missing`)
  return found
}

/**
 * 页面会话的执行上下文（真实 ToolRunContext 的最小投影，测试只走 agent.session；
 * as never 收窄——与 acceptance.spec 的假 exec 同一口径）。
 * / A page session's execution context (a minimal projection of the real
 * ToolRunContext; the tests only walk agent.session — cast as never, the same
 * reading as acceptance.spec's fake exec).
 */
const execOf = (sessionId: string): unknown => ({ agent: { session: { id: sessionId } } })
const execAs = (sessionId: string) => execOf(sessionId) as never

describe('页面作用域完成回报面（§6 投递闭环的最后一环）', () => {
  it('task_take 无参数接取目标为本页的那条；同会话重复接取幂等续租', async () => {
    const { tasks, tools } = await boot()
    const record = await deliver(tasks, '/apps/x/page/1')
    const taken = await toolOf(tools, 'task_take').execute({}, execAs('s1'))
    expect(taken).toMatchObject({ task: { id: record.id, status: 'taken' } })
    // 续租：同会话再接取原样返回（幂等），claimedBy 仍是本会话
    // / renewal: a re-take returns as-is (idempotent), still claimed by this session
    const again = await toolOf(tools, 'task_take').execute({}, execAs('s1'))
    expect(again).toMatchObject({ task: { id: record.id, status: 'taken' } })
  })

  it('他页会话解析不到任务（page-task-unresolvable）；本页任务被他人持有拒绝', async () => {
    const { tasks, tools } = await boot()
    await deliver(tasks, '/apps/x/page/1')
    // 非页面会话：urlOfSession 返回 undefined → 结构化拒绝
    // / a non-page session: urlOfSession yields undefined → the structured refusal
    await expect(toolOf(tools, 'task_take').execute({}, execAs('elsewhere')))
      .rejects.toMatchObject({ code: 'page-task-unresolvable' })
    // 别的会话先接走 → s1 再接取被任务中心 CAS 拒绝（稳定码透传）
    // / another session takes first → s1's take is refused by the center's CAS (stable code)
    await toolOf(tools, 'task_take').execute({}, execAs('s1'))
    const other = buildPageTaskTools(() => tasks, {
      urlOfSession: async (sessionId) => (sessionId === 's2' ? '/apps/x/page/1' : undefined),
    })
    await expect(toolOf(other, 'task_take').execute({}, execAs('s2')))
      .rejects.toMatchObject({ code: 'task/already-taken' })
  })

  it('task_complete 收口：summary 必填（完成证据），artifacts 引用透传；task_fail 带稳定码', async () => {
    const { tasks, tools } = await boot()
    const record = await deliver(tasks, '/apps/x/page/1')
    await toolOf(tools, 'task_take').execute({}, execAs('s1'))
    // 空 summary = 无证据，拒绝（task/draft-invalid）
    // / an empty summary = no evidence, refused (task/draft-invalid)
    await expect(toolOf(tools, 'task_complete').execute({ summary: '  ' }, execAs('s1')))
      .rejects.toMatchObject({ code: 'task/draft-invalid' })
    const completed = await toolOf(tools, 'task_complete').execute(
      { summary: '已在本页完成该任务', artifacts: ['note-9'] }, execAs('s1'))
    expect(completed).toMatchObject({ task: { id: record.id, status: 'done' } })
    expect((await tasks.get(record.id))?.result).toMatchObject({ summary: '已在本页完成该任务', artifacts: ['note-9'] })
    // 失败路：再投一条、接取、task_fail 落 failed + 稳定码
    // / the failure path: deliver again, take, task_fail lands failed with the stable code
    const second = await deliver(tasks, '/apps/x/page/1')
    await toolOf(tools, 'task_take').execute({}, execAs('s1'))
    await toolOf(tools, 'task_fail').execute({ code: 'target-unavailable', message: '目标不可达' }, execAs('s1'))
    expect(await tasks.get(second.id)).toMatchObject({ status: 'failed', failure: { code: 'target-unavailable' } })
  })
})
