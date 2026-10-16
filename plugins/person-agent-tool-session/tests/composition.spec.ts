// 组合测试：走真实 cordis Context——真实 inject 解析与真实 effect 逆序清理；
// sessionController 与 workspaceRegistry 用假实现替换，直接驱动被注册的
// 工具定义，锁定创建/改名/分叉/归档/置顶/派活的调用路径。
// Composition test: real cordis Context - real inject resolution and real
// effect reverse-order disposal; sessionController and workspaceRegistry are
// fakes, and the registered tool definitions are driven directly to lock the
// create/rename/fork/archive/pin/prompt call paths.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { resolveConfig } from './support.js'

/** 被注册工具定义的最小执行面（测试只走 execute）。 */
/** The minimal execution face of a registered tool (tests drive execute only). */
interface RegisteredTool {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 记录调用序列的假 sessionController。A fake sessionController recording calls. */
function fakeSessionController() {
  return {
    calls: [] as string[],
    async create(request: Record<string, unknown>) {
      this.calls.push(`create:${JSON.stringify(request)}`)
      return { sessionId: `sess-${this.calls.length}` as never, agentPreset: request.agentPreset as string | undefined }
    },
    async selectModel(request: Record<string, unknown>) {
      this.calls.push(`selectModel:${JSON.stringify(request)}`)
      return { selected: { provider: request.provider, model: request.model } }
    },
    async rename(request: Record<string, unknown>) {
      this.calls.push(`rename:${JSON.stringify(request)}`)
      return { title: request.title, seq: 7 }
    },
    async fork(request: Record<string, unknown>) {
      this.calls.push(`fork:${JSON.stringify(request)}`)
      return { sessionId: 'sess-forked' as never }
    },
    // resolveAgent 假实现：返回带记录能力的假 Agent；未知名返回稳定错误。
    // resolveAgent fake: a recording fake Agent; unknown names return the
    // stable error shape.
    resolvedAgents: new Map<string, { followupCalls: unknown[], whenIdleCalls: number }>(),
    async resolveAgent(sessionId: string) {
      const existing = this.resolvedAgents.get(sessionId)
      if (existing !== undefined) return { agent: fakeAgent(existing) }
      return { error: new Error(`session "${sessionId}" not found`) }
    },
  }
}

/** 带调用记录的假 Agent。A fake Agent with call recording. */
function fakeAgent(record: { followupCalls: unknown[], whenIdleCalls: number }) {
  return {
    followup(message: unknown) {
      record.followupCalls.push(message)
    },
    async whenIdle() {
      record.whenIdleCalls += 1
    },
  }
}

/** 记录调用的假工作区注册表（只含归档/置顶方法）。A fake registry with only the archive/pin verbs. */
function fakeWorkspaceRegistry() {
  return {
    calls: [] as string[],
    async archiveSession(id: string, options?: { stopActivity?: boolean }) {
      this.calls.push(`archiveSession:${String(id)}:${String(options?.stopActivity === true)}`)
    },
    async unarchiveSession(id: string) {
      this.calls.push(`unarchiveSession:${String(id)}`)
    },
    async pinSession(id: string) {
      this.calls.push(`pinSession:${String(id)}`)
    },
    async unpinSession(id: string) {
      this.calls.push(`unpinSession:${String(id)}`)
    },
  }
}

/** 安装真实 apply 与可变假服务，返回被捕获的工具定义。 */
/** Install the real apply with mutable fakes; return the captured tool definitions. */
async function install(config: Partial<ConfigShape> = {}) {
  const ctx = new Context()
  const sessionController = fakeSessionController()
  const workspaceRegistry = fakeWorkspaceRegistry()
  const definitions = new Map<string, RegisteredTool>()
  ctx.provide('tools', {
    // 与宿主一致：register 返回精确卸载函数，供 cordis effect 逆序清理。
    // Host contract: register returns the exact disposer for cordis effect
    // reverse-order cleanup.
    register: (definition: { name: string } & RegisteredTool) => {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  })
  ctx.provide('sessionController', sessionController)
  ctx.provide('workspaceRegistry', workspaceRegistry)
  const fiber: Fiber = ctx.plugin({ name, inject, apply }, resolveConfig(config))
  await fiber
  return {
    sessionController,
    workspaceRegistry,
    run: async (tool: string, args: unknown): Promise<unknown> => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not registered: ${tool}`)
      return await definition.execute(args, {})
    },
    registered: (): string[] => [...definitions.keys()].sort(),
    unload: async (): Promise<void> => {
      await fiber.dispose()
    },
  }
}

describe('personAgentToolSession composition（真实装配路径 / real assembly path）', () => {
  it('registers all eight tools by default', async () => {
    const env = await install()
    expect(env.registered()).toEqual([
      'session_archive', 'session_create', 'session_fork', 'session_pin', 'session_prompt', 'session_rename', 'session_unarchive', 'session_unpin',
    ])
  })

  it('delivers a prompt through the host enqueue path and wakes the session', async () => {
    // 派活路径锁定：resolveAgent 拿活跃 Agent → followup 入队 kind:'user' 消息。
    // Locked dispatch path: resolveAgent yields the live Agent → followup
    // enqueues a kind:'user' message.
    const env = await install()
    const agentRecord = { followupCalls: [] as unknown[], whenIdleCalls: 0 }
    env.sessionController.resolvedAgents.set('sess-9', agentRecord)
    const result = await env.run('session_prompt', { sessionId: 'sess-9', prompt: ' hello world task ' })
    expect(result).toMatchObject({ sessionId: 'sess-9', accepted: true, waited: false })
    expect(agentRecord.followupCalls).toHaveLength(1)
    expect(agentRecord.whenIdleCalls).toBe(0)
  })

  it('waits for idle when wait is set', async () => {
    const env = await install()
    const agentRecord = { followupCalls: [] as unknown[], whenIdleCalls: 0 }
    env.sessionController.resolvedAgents.set('sess-9', agentRecord)
    await env.run('session_prompt', { sessionId: 'sess-9', prompt: 'task', wait: true })
    expect(agentRecord.whenIdleCalls).toBe(1)
  })

  it('fails loud on an empty prompt and an unresolvable session', async () => {
    const env = await install()
    await expect(env.run('session_prompt', { sessionId: 'sess-9', prompt: '   ' }))
      .rejects.toMatchObject({ code: 'SESSION_PROMPT_EMPTY' })
    await expect(env.run('session_prompt', { sessionId: 'sess-missing', prompt: 'task' }))
      .rejects.toMatchObject({ code: 'SESSION_PROMPT_NOT_FOUND' })
  })

  it('creates a session with preset, model selection, and title in order', async () => {
    const env = await install()
    const result = await env.run('session_create', {
      title: ' Helper ', presetId: 'person-agent', provider: 'deepseek', model: 'deepseek-chat', workspaceId: 'ws-1',
    })
    expect(result).toMatchObject({
      sessionId: 'sess-1', agentPreset: 'person-agent', title: 'Helper',
      selected: { provider: 'deepseek', model: 'deepseek-chat' },
    })
    // 调用顺序锁定：先创建，再装模型，最后写标题。
    // Locked call order: create first, then model selection, then title.
    expect(env.sessionController.calls.map((call) => call.split(':')[0])).toEqual(['create', 'selectModel', 'rename'])
  })

  it('rejects an incomplete model selection and a location conflict', async () => {
    const env = await install()
    await expect(env.run('session_create', { provider: 'deepseek' }))
      .rejects.toMatchObject({ code: 'SESSION_MODEL_SELECTION_INCOMPLETE' })
    await expect(env.run('session_create', { workspaceId: 'ws-1', cwd: 'C:/x' }))
      .rejects.toMatchObject({ code: 'SESSION_CREATE_LOCATION_CONFLICT' })
    expect(env.sessionController.calls).toHaveLength(0)
  })

  it('renames and fork through the session controller', async () => {
    const env = await install()
    expect(await env.run('session_rename', { sessionId: 'sess-9', title: 'New' }))
      .toMatchObject({ title: 'New', seq: 7 })
    expect(await env.run('session_fork', { sessionId: 'sess-9', atSeq: 4 }))
      .toMatchObject({ sessionId: 'sess-forked', sourceSessionId: 'sess-9' })
    expect(env.sessionController.calls.some((call) => call.includes('"atSeq":4'))).toBe(true)
  })

  it('routes archive/pin verbs to the workspace registry', async () => {
    const env = await install()
    await env.run('session_archive', { sessionId: 'sess-1', stopActivity: true })
    await env.run('session_unarchive', { sessionId: 'sess-1' })
    await env.run('session_pin', { sessionId: 'sess-2' })
    await env.run('session_unpin', { sessionId: 'sess-2' })
    expect(env.workspaceRegistry.calls).toEqual([
      'archiveSession:sess-1:true',
      'unarchiveSession:sess-1',
      'pinSession:sess-2',
      'unpinSession:sess-2',
    ])
  })

  it('honors config toggles', async () => {
    const env = await install({ allowCreate: false, allowPrompt: false, allowFork: false, allowArchive: false, allowPin: false })
    expect(env.registered()).toEqual(['session_rename'])
  })

  it('unregisters every tool on dispose (HMR safety)', async () => {
    const env = await install()
    expect(env.registered()).toHaveLength(8)
    await env.unload()
    expect(env.registered()).toHaveLength(0)
  })
})
