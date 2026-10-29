/**
 * 端到端工具充分性干跑（docs/unattended-page-contract.cn.md 验收 2/4）：
 * 真实注册表 + 真实任务中心 + 真实 forum/notebook 应用插件 + 内存会话端口，
 * 每应用一类投递任务走完 接取 → 执行（该页自有工具）→ 完成/失败——全程无人，
 * 完成带机器可查证据，失败带稳定码。"模型会找对工具"这一腿由 3080 真机清单
 * 用真实模型裁决（比 mock LLM 更强的外部裁决）；本套件裁决的是"挂载的工具面
 * 足以走完闭环"。
 * The end-to-end tool-sufficiency dry run (docs/unattended-page-contract.md
 * acceptance 2/4): the real registries + the real task center + the real
 * forum/notebook app plugins over the in-memory session port; one delivered
 * task class per app walks take → execute (the page's own tools) →
 * complete/fail — no human anywhere, completion carries machine-checkable
 * evidence, failure carries a stable code. The "model finds the tools" leg is
 * judged by the 3080 live checklist with the real model (stronger than a mock
 * LLM); this suite judges "the mounted tool face suffices for the loop".
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
import * as AppRegistry from '@veren/app-registry'
import * as PageRegistry from '@veren/page-registry'
import * as TaskCenter from '@veren/task-center'
import type { PageInstanceKey } from '@veren/prompt-page'
import type { TaskCenterService } from '@veren/task-center'
import type { PageRegistryService } from '@veren/page-registry'
import * as ForumServiceNS from '@veren/forum'
import * as ForumApp from '@veren/forum-app'
import * as NotebookServiceNS from '@veren/notebook'
import * as NotebookApp from '@veren/notebook-app'
import { MemorySessionPort } from './session-port.ts'

const roots: string[] = []
const fibers: Fiber[] = []

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose().catch(() => undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 起真实全栈：存储 + 双宿主服务 + 双应用插件 + 注册表镜像缝 + 任务中心 + 会话端口
 * / boot the real stack: storage + both host services + both app plugins + the mirror seam + the task center + the session port */
async function boot(): Promise<{
  ctx: Context
  pages: PageRegistryService
  tasks: TaskCenterService
  port: MemorySessionPort
}> {
  const ctx = new Context()
  const root = mkdtempSync(join(tmpdir(), 'page-delivery-dryrun-'))
  roots.push(root)
  const port = new MemorySessionPort()
  ctx.provide('tools', { register: () => () => undefined })
  ctx.provide('agentPresets', { list: async () => [], composedPreset: (a?: { preset?: string }) => a?.preset })
  // forum-app 的 inject 还要这两个身份解析面（干跑给最小替身）
  // / forum-app's inject also needs these two identity faces (minimal stubs here)
  ctx.provide('workingDirectory', { get: () => 'C:/work/demo' })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', path: 'C:/work/demo', title: 'Demo' }] })
  // 两个宿主服务声明的其余宿主面（forum: agents/sessions/systemPrompt/llm/agentDefaultModel）
  // / the remaining host faces both host services declare (forum: agents/sessions/systemPrompt/llm/agentDefaultModel)
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('systemPrompt', { context: () => () => undefined })
  ctx.provide('llm', {})
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined })
  fibers.push(await ctx.plugin(Storage.default))
  fibers.push(await ctx.plugin(StorageJson, { root }))
  fibers.push(await ctx.plugin(StorageDomain, { backend: 'json' }))
  // 注册表 + 任务中心（真实插件激活，一条路径）
  // / the registries + the task center (real plugin activation, one path)
  fibers.push(await ctx.plugin(AppRegistry.default))
  fibers.push(await ctx.plugin(PageRegistry.default))
  fibers.push(await ctx.plugin(TaskCenter.default, { tools: { enabled: false } }))
  fibers.push(await ctx.plugin(ForumServiceNS.default, ForumServiceNS.Config({})))
  fibers.push(await ctx.plugin(NotebookServiceNS.default, NotebookServiceNS.Config({})))
  const pages = ctx.pageRegistry
  const tasks = ctx.taskCenter
  // 真实装配三步（app-host 同缝）：resolver ← apps、镜像面 ← pageRegistry、bindPorts
  // 纯参数——镜像与端口必须在应用插件挂载**之前**接好，应用注册页面时才镜像得到。
  // / The real three-step assembly (app-host's seam): resolver ← apps, mirror ←
  // pageRegistry, bindPorts as pure parameters — the mirror and the ports must
  // wire BEFORE the app plugins mount, or their page registrations never mirror.
  tasks.setAppResolver(async (appId) => {
    const record = ctx.apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })
  ctx.apps.setPageMirror({
    registerAppPage: (appId, page, live) => pages.registerAppPage(appId, page, live),
    releaseApp: (appId) => pages.releaseApp(appId),
  })
  pages.bindPorts({
    sessions: port,
    apps: ctx.apps,
    tasks,
    deliveries: {
      pending: () => tasks.pendingDeliveries(),
      mark: (deliveryId, error) => tasks.markDelivered(deliveryId, error),
    },
    releaseLeases: async (sessionId) => {
      const taken = await tasks.list({ status: 'taken', claimedBySession: sessionId })
      for (const task of taken) await tasks.release(task.id, `session ${sessionId} deprecated`).catch(() => undefined)
    },
  })
  // 两个应用插件都是命名导出（无 default）：按 Service 插件对象形态装配
  // / both app plugins are named exports (no default): assemble as plugin objects
  fibers.push(await ctx.plugin({ name: ForumApp.name, inject: ForumApp.inject, apply: ForumApp.apply }, ForumApp.Config({ reserved: false })))
  fibers.push(await ctx.plugin({ name: NotebookApp.name, inject: NotebookApp.inject, apply: NotebookApp.apply }, NotebookApp.Config({})))
  return { ctx, pages, tasks, port }
}

/** 工具执行上下文（干跑的"模型"就是这段脚本；会话头带预设——callerOf 的身份来源）
 * / the tool execution context (the dry run's "model" is this script; the session
 * header carries the preset — callerOf's identity source) */
const execOf = (sessionId: string) => ({
  agent: { session: { id: sessionId, header: { agentPreset: 'standard' } } },
}) as never

/** 在页面会话里按名取工具并执行 / fetch one tool by name in the page session and run it */
async function runIn(
  port: MemorySessionPort,
  sessionId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const tool = port.toolOf(sessionId, name)
  if (tool === undefined) throw new Error(`tool ${name} not mounted in ${sessionId}`)
  return await tool.execute(args, execOf(sessionId)) as Record<string, unknown>
}

describe('端到端工具充分性干跑（验收 2/4：无人、带证据、有出路）', () => {
  it('forum 证人：投递 → catalog 会话 task_take → forum__post 自有工具干活 → task_complete 带证据 → 记录 done', async () => {
    const { ctx, pages, tasks, port } = await boot()
    const record = await tasks.send({
      kind: 'forum/recap' as never,
      title: '在论坛发一条本周回顾帖',
      target: { url: '/apps/forum/catalog' as PageInstanceKey, appId: 'forum', page: 'catalog', params: {} },
    })
    // 打开 URL = 新建页面会话；投递泵把通知注进会话（source kind = task-center/notice）
    // / opening the url creates the page session; the pump injects the notice (source kind = task-center/notice)
    const opened = await pages.openUrl('/apps/forum/catalog', { focus: false })
    const notice = port.logOf(opened.sessionId).find((entry) => entry.source === 'task-center/notice')
    expect(notice?.text).toContain('[task-center]')
    expect(notice?.text).toContain(`任务：${record.id}`)
    // 会话挂了页面 task 三件（§6 完成路径在目标页真实在位）
    // / the session carries the page task trio (the §6 completion face really sits on the target page)
    expect(port.toolFace(opened.sessionId).map((entry) => entry.name)).toEqual(expect.arrayContaining(['task_take', 'task_complete', 'task_fail', 'forum__post']))
    // 接取 → 用自有工具干活 → 带证据完成（发帖前先确保板块存在：一工作区一板块）
    // / take → work with the page's own tool → complete with evidence (ensure the board first: one workspace, one board)
    expect(await runIn(port, opened.sessionId, 'task_take')).toMatchObject({ task: { id: record.id, status: 'taken' } })
    // @ts-expect-error 测试直取宿主服务面的排布动作 / the host service face
    await ctx.forum.toolsPort().ensureBoard('ws-1', 'demo')
    const posted = await runIn(port, opened.sessionId, 'forum__post', { title: '本周回顾', body: '三条要点' })
    // forum__post 返回 { value: <帖子> }：作者就是调用者预设，帖子即证据来源
    // / forum__post returns { value: <post> }: the author is the caller preset; the post IS the evidence source
    expect(posted.value).toMatchObject({ title: '本周回顾', author: 'standard', boardId: 'ws-1' })
    await runIn(port, opened.sessionId, 'task_complete', { summary: '已发回顾帖', artifacts: ['post:本周回顾'] })
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('done')
    expect(after?.result).toMatchObject({ summary: '已发回顾帖', artifacts: ['post:本周回顾'] })
  })

  it('notebook 证人：投递 → list 会话接取 → write_note → task_complete → 记录 done，任务中心机查', async () => {
    const { ctx, pages, tasks, port } = await boot()
    const record = await tasks.send({
      kind: 'notebook/jot' as never,
      title: '给部署笔记补一条运行备忘',
      target: { url: '/apps/notebook/list' as PageInstanceKey, appId: 'notebook', page: 'list', params: {} },
    })
    const opened = await pages.openUrl('/apps/notebook/list', { focus: false })
    // 会话头归属（write_note 的 owner 语义）：干跑里归属预设固定
    // / the session-header owner (write_note's owner semantics): fixed preset in the dry run
    await runIn(port, opened.sessionId, 'task_take')
    await runIn(port, opened.sessionId, 'notebook__write_note', { title: '运行备忘', body: '重启后先看队列' })
    await runIn(port, opened.sessionId, 'task_complete', { summary: '已写运行备忘', artifacts: ['note:运行备忘'] })
    expect(await tasks.get(record.id)).toMatchObject({ status: 'done' })
  })

  it('失败出路：task_fail 带稳定码落 failed（绝不静默悬置）', async () => {
    const { ctx, pages, tasks, port } = await boot()
    const record = await tasks.send({
      kind: 'forum/recap' as never,
      title: '一条做不了的任务',
      target: { url: '/apps/forum/catalog' as PageInstanceKey, appId: 'forum', page: 'catalog', params: {} },
    })
    const opened = await pages.openUrl('/apps/forum/catalog', { focus: false })
    await runIn(port, opened.sessionId, 'task_take')
    await runIn(port, opened.sessionId, 'task_fail', { code: 'target-unavailable', message: '目录数据源不可达' })
    expect(await tasks.get(record.id)).toMatchObject({ status: 'failed', failure: { code: 'target-unavailable' } })
  })

  it('无中生有不得回报：页面上没有可投递任务时 task_complete 稳定拒绝（task/not-found）', async () => {
    const { pages, port } = await boot()
    // 没投任何任务就打开页面：回报面必须拒绝凭空完成
    // / open the page with no delivery at all: the report face must refuse an invented completion
    const opened = await pages.openUrl('/apps/forum/catalog', { focus: false })
    await expect(runIn(port, opened.sessionId, 'task_complete', { summary: '凭空完成' }))
      .rejects.toMatchObject({ code: 'task/not-found' })
  })
})
