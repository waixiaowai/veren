// 构建器组合测试：真实 cordis Context 承载闭包里的宿主 ctx；sessionController
// 与 workspaceRegistry 用假实现替换，直接驱动构建器产出的工具定义，锁定
// 创建/改名/归档/置顶/派活的调用路径。
// （分叉工具 session_fork 已移交 session-fork-enhanced，此处不再覆盖。）
// Builder composition test: a real cordis Context carries the host ctx captured
// in the closures; sessionController and workspaceRegistry are fakes, and the
// builder products are driven directly to lock the
// create/rename/archive/pin/dispatch call paths. (The fork tool moved to the
// session-fork-enhanced plugin and is not covered here.)
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  buildSessionArchiveDefinition,
  buildSessionCreateDefinition,
  buildSessionDispatchDefinition,
  buildSessionPinDefinition,
  buildSessionRenameDefinition,
  buildSessionUnarchiveDefinition,
  buildSessionUnpinDefinition,
  createSettlementWatch,
  guardRemovedCwd,
} from '../src/index.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** 工具定义的最小执行面（测试只走 execute；方法签名保持双变，宿主 exec 由假实现顶替）。 */
/** The minimal execution face of a tool definition (tests drive execute only; the method signature stays bivariant, a fake stands in for the host exec). */
interface RegisteredTool {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 测试只走 execute：收窄到最小执行面（唯一的断言点，宿主 exec 由假对象顶替）。 */
/** Tests drive execute only: narrow to the minimal face (the single assertion point; an empty object stands in for the host exec). */
function drivable(definition: ToolDefinition): RegisteredTool {
  return definition as unknown as RegisteredTool
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

/** 记录调用的假工作区注册表（归档/置顶 + 工作区列表）。A fake registry with the archive/pin verbs and the workspace list. */
function fakeWorkspaceRegistry() {
  return {
    calls: [] as string[],
    workspaces: [] as Array<{ id: string, path: string, sessionIds: string[] }>,
    list() {
      return this.workspaces
    },
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

/** 构建全部工具定义（cwd 守卫与宿主注册路径同款），返回可驱动的映射。 */
/** Build every tool definition (the cwd guard exactly as the host path does) and return a drivable map. */
function install() {
  const ctx = new Context()
  const sessionController = fakeSessionController()
  const workspaceRegistry = fakeWorkspaceRegistry()
  ctx.provide('sessionController', sessionController)
  ctx.provide('workspaceRegistry', workspaceRegistry)
  // 派活看守需要存活 Agent 与会话存储；本文件只锁非看守路径，给最小可用的空实现。
  // The dispatch guard needs the live-Agent registry and the session store; this
  // file locks non-watch paths only, so they get minimal empty providers.
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessions', { get: () => undefined, flush: async () => true })
  const watch = createSettlementWatch(ctx, { maxReportChars: 4000, maxConcurrentWatches: 64 })
  const definitions = new Map<string, RegisteredTool>([
    ['session_create', drivable(guardRemovedCwd(buildSessionCreateDefinition(ctx), 'session_create'))],
    ['session_rename', drivable(buildSessionRenameDefinition(ctx))],
    ['session_dispatch', drivable(buildSessionDispatchDefinition(ctx, watch))],
    ['session_archive', drivable(buildSessionArchiveDefinition(ctx))],
    ['session_unarchive', drivable(buildSessionUnarchiveDefinition(ctx))],
    ['session_pin', drivable(buildSessionPinDefinition(ctx))],
    ['session_unpin', drivable(buildSessionUnpinDefinition(ctx))],
  ])
  return {
    sessionController,
    workspaceRegistry,
    run: async (tool: string, args: unknown, exec: unknown = {}): Promise<unknown> => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not built: ${tool}`)
      return await definition.execute(args, exec)
    },
    built: (): string[] => [...definitions.keys()].sort(),
  }
}

describe('person-agent-tool-session builders（真实装配路径 / real assembly path）', () => {
  it('builds all seven tool definitions', () => {
    const env = install()
    expect(env.built()).toEqual([
      'session_archive', 'session_create', 'session_dispatch', 'session_pin', 'session_rename', 'session_unarchive', 'session_unpin',
    ])
    // 分叉工具不由本包提供，避免与 session-fork-enhanced 重复。
    // No fork tool is provided here, avoiding duplication with
    // session-fork-enhanced.
    expect(env.built().some((tool) => tool.includes('fork'))).toBe(false)
  })

  it('fails loud on an empty prompt and an unresolvable session', async () => {
    const env = install()
    await expect(env.run('session_dispatch', { sessionId: 'sess-9', prompt: '   ' }, { agent: {} }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_PROMPT_EMPTY' })
    await expect(env.run('session_dispatch', { sessionId: 'sess-missing', prompt: 'task' }, { agent: {} }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_NOT_FOUND' })
    await expect(env.run('session_dispatch', { sessionId: 'sess-9', newSession: {}, prompt: 'task' }, { agent: {} }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_CONFLICT' })
    await expect(env.run('session_dispatch', { prompt: 'task' }, { agent: {} }))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_MISSING' })
    await expect(env.run('session_dispatch', { sessionId: 'sess-9', prompt: 'task' }, {}))
      .rejects.toMatchObject({ code: 'SESSION_DISPATCH_NO_CALLER' })
  })

  it('creates a session with preset, model selection, and title in order', async () => {
    const env = install()
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
    expect(env.sessionController.calls[0]).toContain('"workspaceId":"ws-1"')
  })

  it('inherits the calling session workspace when workspaceId is omitted', async () => {
    const env = install()
    env.workspaceRegistry.workspaces = [{ id: 'ws-1', path: 'C:/work/app', sessionIds: ['caller'] }]
    await env.run('session_create', { title: 'Inherited' }, { agent: { id: 'caller' } })
    expect(env.sessionController.calls[0]).toBe('create:{"workspaceId":"ws-1"}')
  })

  it('rejects session_create when neither workspaceId nor a caller workspace exists', async () => {
    const env = install()
    await expect(env.run('session_create', { title: 'Orphan' }, { agent: { id: 'caller' } }))
      .rejects.toMatchObject({
        code: 'SESSION_CREATE_WORKSPACE_UNKNOWN',
        message: expect.stringContaining('workspaceId'),
      })
    await expect(env.run('session_create', { title: 'Orphan' }))
      .rejects.toMatchObject({ code: 'SESSION_CREATE_WORKSPACE_UNKNOWN' })
    expect(env.sessionController.calls).toEqual([])
  })

  it('rejects the removed cwd argument and points at workspaceId', async () => {
    const env = install()
    await expect(env.run('session_create', { workspaceId: 'ws-1', cwd: 'C:/work/app' }))
      .rejects.toMatchObject({
        code: 'SESSION_CREATE_CWD_REMOVED',
        message: expect.stringContaining('workspaceId'),
      })
    await expect(env.run('session_create', { cwd: 'C:/work/app' }))
      .rejects.toMatchObject({ code: 'SESSION_CREATE_CWD_REMOVED' })
    expect(env.sessionController.calls).toEqual([])
  })

  it('attaches a dispatched new session to an explicit workspaceId', async () => {
    // 假 sessionController 会先记下 create 请求；随后新 id 解析不到目标，
    // 这个稳定错误正好让断言停在「派发如何请求宿主创建」这一步。
    // The fake controller records the create request first; the minted id is
    // then unresolvable, so the stable error lets the assertion stop at how the
    // dispatch asked the host to create the session.
    const env = install()
    await expect(env.run('session_dispatch', {
      newSession: { workspaceId: 'ws-1', agentPreset: 'person-agent' },
      prompt: 'task',
    }, { agent: { id: 'caller' } })).rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_NOT_FOUND' })
    expect(env.sessionController.calls[0]).toBe('create:{"workspaceId":"ws-1","agentPreset":"person-agent"}')
  })

  it('inherits the calling session workspace for a dispatched new session', async () => {
    const env = install()
    env.workspaceRegistry.workspaces = [{ id: 'ws-1', path: 'C:/work/app', sessionIds: ['caller'] }]
    await expect(env.run('session_dispatch', {
      newSession: { agentPreset: 'person-agent' },
      prompt: 'task',
    }, { agent: { id: 'caller' } })).rejects.toMatchObject({ code: 'SESSION_DISPATCH_TARGET_NOT_FOUND' })
    expect(env.sessionController.calls[0]).toBe('create:{"workspaceId":"ws-1","agentPreset":"person-agent"}')
  })

  it('rejects a dispatched new session when the caller has no workspace', async () => {
    const env = install()
    await expect(env.run('session_dispatch', {
      newSession: {},
      prompt: 'task',
    }, { agent: { id: 'caller' } })).rejects.toMatchObject({
      code: 'SESSION_CREATE_WORKSPACE_UNKNOWN',
      message: expect.stringContaining('workspaceId'),
    })
    expect(env.sessionController.calls).toEqual([])
  })

  it('rejects the removed cwd argument on session_dispatch', async () => {
    // 两条创建路径共用同一个 cwd 守卫，错误必须指向 workspaceId 且在创建前失败。
    // Both creation paths share the same cwd guard: the error must point at
    // workspaceId and fail before any host create.
    const env = install()
    await expect(env.run('session_dispatch', {
      newSession: { workspaceId: 'ws-1', cwd: 'C:/work/app' },
      prompt: 'task',
    }, { agent: { id: 'caller' } })).rejects.toMatchObject({
      code: 'SESSION_CREATE_CWD_REMOVED',
      message: expect.stringContaining('workspaceId'),
    })
    expect(env.sessionController.calls).toEqual([])
  })

  it('rejects an incomplete model selection', async () => {
    const env = install()
    await expect(env.run('session_create', { provider: 'deepseek' }))
      .rejects.toMatchObject({ code: 'SESSION_MODEL_SELECTION_INCOMPLETE' })
    expect(env.sessionController.calls).toHaveLength(0)
  })

  it('renames through the session controller', async () => {
    const env = install()
    expect(await env.run('session_rename', { sessionId: 'sess-9', title: 'New' }))
      .toMatchObject({ title: 'New', seq: 7 })
  })

  it('routes archive/pin verbs to the workspace registry', async () => {
    const env = install()
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
})
