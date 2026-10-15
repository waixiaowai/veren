// 单测：独立插件以 pre-step 追加快照消息——会话信息四字段（title / preset /
// provider+model / running）与 web 端会话列表同源、仅变化追加、配置可裁剪。
// Unit tests: the standalone plugin appends snapshot messages at pre-step -
// the four session facts (title / preset / provider+model / running) share the
// Web client's sources, additions happen only on change, config can trim the
// snapshot.
import { describe, expect, it, vi } from 'vitest'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { apply, renderAgentPreset, renderWorkspace } from '../src/index.js'
import type { SessionLogView } from '../src/index.js'
import { resolveConfig, snapshotTexts } from './support.js'
import type { LogSeq, LoggedMessage } from './support.js'

/** 监听器在测试里被调用的形态（与宿主 agent/pre-step 声明一致）。
 * The shape this test invokes the listener with (matches the host declaration). */
type PreStepListener = (input: { agent: Agent, signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

/** One fake host context wiring the pre-step listener to fake services. 把 pre-step 监听器接到假服务的假宿主 context。 */
function fakeCtx(options: { presets?: unknown[], workspaces?: unknown[], failList?: boolean, failModelCatalog?: boolean } = {}): {
  ctx: Parameters<typeof apply>[0]
  step: (history: LoggedMessage[], sessionId?: string) => Promise<void>
  logger: { warn: ReturnType<typeof vi.fn> }
  disposers: Array<() => unknown>
  setLists: (next: { presets?: unknown[], workspaces?: unknown[], archivedSessionIds?: string[] }) => void
  /** Fire one agent/status transition. 触发一次 agent/status 转换。 */
  setRunning: (sessionId: string, running: boolean) => void
} {
  const logger = { warn: vi.fn() }
  let presets = options.presets ?? [{ id: 'standard', name: 'Standard', description: 'default mode' }]
  let workspaces = options.workspaces ?? [{
    id: 'ws-1',
    title: 'Demo',
    path: 'C:/demo',
    sessionIds: ['sess-1', 'sess-2', 'sess-archived'],
  }]
  let archivedSessionIds = ['sess-archived']
  // 当前 step 的历史，供 sessions 假实现的 snapshotEvents 读取。
  // The current step's history, read by the fake sessions' snapshotEvents.
  let currentHistory: LoggedMessage[] = []
  const runningIds = new Set<string>()
  const disposers: Array<() => unknown> = []
  const handlers: Record<string, unknown> = {}
  // 会话存储假实现：任意 id 都解析出创建时间/工作目录/preset（与真实宿主一致）。
  // Fake session store: every id resolves creation time / cwd / preset like the
  // real host.
  const sessions = {
    get: (id: string) => ({
      id,
      header: { createdAt: Date.UTC(2026, 9, 15), cwd: 'C:/demo/deep', agentPreset: 'person-agent' },
      // 派生回退标题读取当前 step 的历史（由 step 注入）。
      // The fallback title derivation reads the current step's history
      // (injected by step).
      snapshotEvents: (_fromSeq?: number, _toSeqExclusive?: number) => currentHistory,
      eventAt: (seq: LogSeq) => currentHistory[Number(seq)],
    }),
  }
  const ctx = {
    agents: {
      get: (id: string) => (runningIds.has(id) ? { status: 'running' } : undefined),
    },
    sessions,
    sessionProjections: {
      // 投影假实现：modelSelection 的 lastUsed 为空 → 回退部署默认模型；
      // agentPreset 未选中 → undefined 走创建头兜底。
      // Projection fake: empty modelSelection lastUsed → deployment default
      // model fallback; no agentPreset selection → creation header fallback.
      stateOf: (_session: unknown, key: string) => key === 'modelSelection' ? { lastUsed: null } : undefined,
    },
    agentPresets: {
      list: async () => {
        if (options.failList === true) throw new Error('boom')
        return presets
      },
      defaultId: 'person-agent',
    },
    workspaceRegistry: {
      list: () => workspaces,
      get archivedSessionIds(): string[] {
        return archivedSessionIds
      },
    },
    // LLM 注册表假实现：一个 provider、一个纯文本模型（带上下文窗口）。
    // Fake LLM registry: one provider, one text-only model with a context window.
    llm: {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listModels: async () => {
        if (options.failModelCatalog === true) throw new Error('catalog boom')
        return [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek-V4' }]
      },
      resolveModelInfo: async () => ({
        provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek-V4',
        inputModalities: ['text'], context: { contextWindow: 65536 },
      }),
    },
    // 可选服务面：sessionTitle 提供标题；agentDefaultModel 提供默认路由。
    // Optional service faces: sessionTitle supplies titles; agentDefaultModel
    // supplies the deployment default route.
    get: (serviceName: string) => {
      if (serviceName === 'sessionTitle') {
        return { get: () => ({ title: 'Greeting' }) }
      }
      if (serviceName === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
      }
      return undefined
    },
    logger,
    // 模拟 cordis：ctx.on 按事件名注册监听器并返回卸载函数。
    // Mirror cordis: ctx.on registers listeners by event name and returns
    // their disposers.
    on: (event: string, handler: unknown, _options?: unknown): (() => void) => {
      handlers[event] = handler
      const disposer = () => {
        delete handlers[event]
      }
      disposers.push(disposer)
      return disposer
    },
  } as unknown as Parameters<typeof apply>[0]
  const signal = new AbortController().signal
  const baseDecision: PreStepDecision = { kind: 'enter', messages: [] }
  return {
    ctx,
    disposers,
    logger,
    setLists: (next) => {
      if (next.presets !== undefined) presets = next.presets
      if (next.workspaces !== undefined) workspaces = next.workspaces
      if (next.archivedSessionIds !== undefined) archivedSessionIds = next.archivedSessionIds
    },
    setRunning: (sessionId: string, running: boolean) => {
      if (running) runningIds.add(sessionId)
      else runningIds.delete(sessionId)
    },
    step: async (history: LoggedMessage[], sessionId = 'sess-1') => {
      if (handlers['agent/pre-step'] === undefined) throw new Error('pre-step listener not registered')
      currentHistory = history
      const listener = handlers['agent/pre-step'] as PreStepListener
      const agent = {
        session: {
          id: sessionId,
          seq: history.length,
          // 宿主把 seq 铸成品牌号，测试里用同一个构造器保持一致。
          // The host brands seq; the test uses the same constructor so both sides agree.
          eventAt: (seq: LogSeq) => history[Number(seq)],
          // 派生回退标题经 snapshotEvents 读取人类消息。
          // The fallback title derivation reads human messages through
          // snapshotEvents.
          snapshotEvents: (_fromSeq?: number, _toSeqExclusive?: number) => history,
        },
      } as unknown as Agent
      const result = await listener({ agent, signal }, async () => baseDecision)
      // 宿主循环行为：监听器追加的消息写回会话历史。先用类型谓词收窄，再取
      // messages，避免在联合类型上直接取属性。
      // Host-loop behavior: messages the listener appended are committed to the
      // session history. Narrow with a type predicate before reading messages, so
      // the property is never taken off a union.
      if (result.kind === 'reject') return
      for (const message of result.messages) {
        history.push({
          type: 'user/message',
          data: { source: message.source as { kind: string }, content: message.content as readonly { type: string, text?: string }[] },
        })
      }
    },
  }
}

describe('renderAgentPreset / renderWorkspace', () => {
  it('falls back to the preset id when the display name is absent', () => {
    expect(renderAgentPreset({ id: 'bare' } as never)).toBe('- bare(bare):')
    expect(renderAgentPreset({ id: 'standard', name: 'Standard', description: 'default mode' } as never))
      .toBe('- Standard(standard):default mode')
  })

  it('renders one workspace as title(id):path', () => {
    expect(renderWorkspace({ id: 'ws-1', title: 'Demo', path: 'C:/demo' } as never)).toBe('- Demo(ws-1):C:/demo')
  })
})

describe('personAgentDynamicContext', () => {
  it('appends one snapshot with the roster and the four session facts', async () => {
    // 四字段一行不缺：title / preset / provider+model / created。
    // All four facts render on one line: title / preset / provider+model /
    // created.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('## Agent Preset List')
    expect(texts[0]).toContain('- Standard(standard):default mode')
    expect(texts[0]).toContain('## Workspace List')
    expect(texts[0]).toContain('- Demo(ws-1):C:/demo')
    // 表格头 + 每会话一行：id / title / preset / provider / model / created at。
    // Table header plus one row per session: id / title / preset / provider /
    // model / created at.
    expect(texts[0]).toContain('| id | title | preset | provider | model | created at |')
    expect(texts[0]).toContain('| sess-1 | Greeting | person-agent | deepseek | deepseek-chat | 2026-10-15 |')
    expect(texts[0]).toContain('| sess-2 | Greeting | person-agent | deepseek | deepseek-chat | 2026-10-15 |')
    expect(texts[0]).not.toContain('sess-archived')
  })

  it('appends a fresh snapshot when a registry changes between steps', async () => {
    // 精确新鲜度：await 读取让变化后的第一次步骤就拿到新值，不经过缓存。
    // Exact freshness: the awaited read lets the first step after a change see
    // the new values with no cache in between.
    const { ctx, step, setLists } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    setLists({
      presets: [{ id: 'reporter', name: 'Reporter', description: 'new mode' }],
      workspaces: [{ id: 'ws-2', title: 'Fresh', path: 'C:/fresh', sessionIds: ['sess-9'] }],
    })
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain('- Reporter(reporter):new mode')
    expect(texts[1]).toContain('- Fresh(ws-2):C:/fresh')
  })

  it('appends nothing while the values are unchanged', async () => {
    // 变更检测：名单不变则不追加，会话历史零噪音。
    // Change detection: unchanged lists add nothing, keeping history clean.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    await step(history)
    await step(history)
    expect(snapshotTexts(history)).toHaveLength(1)
  })

  it('marks running sessions from the live agent registry', async () => {
    // 运行状态来自活跃 agent 注册表（ctx.agents.get(id)?.status）。
    // Running state reads the live agent registry (ctx.agents.get(id)?.status).
    const { ctx, step, setRunning } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    setRunning('sess-1', true)
    await step(history, 'sess-1')
    expect(snapshotTexts(history)[0]).toContain('2026-10-15 · running |')
    setRunning('sess-1', false)
    await step(history, 'sess-1')
    expect(snapshotTexts(history)[1]).not.toContain('· running')
  })

  it('keeps working when the roster read fails', async () => {
    const { ctx, step, logger } = fakeCtx({ failList: true })
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    expect(logger.warn).toHaveBeenCalled()
    const texts = snapshotTexts(history)
    expect(texts[0]).not.toContain('## Agent Preset List')
    expect(texts[0]).toContain('## Workspace List')
  })

  it('omits the roster when includePresetRoster is false', async () => {
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig({ includePresetRoster: false }))
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts[0]).not.toContain('## Agent Preset List')
    expect(texts[0]).toContain('## Workspace List')
  })

  it('omits the workspace list when includeWorkspaceList is false', async () => {
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig({ includeWorkspaceList: false }))
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts[0]).toContain('## Agent Preset List')
    expect(texts[0]).not.toContain('## Workspace List')
  })

  it('appends the model catalog with modality and context window', async () => {
    // 模型目录：provider 分组、多模态输入（text-only）与上下文窗口逐模型一行。
    // Model catalog: provider groups, modality (text-only) and context window,
    // one line per model.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts[0]).toContain('## Model Catalog')
    expect(texts[0]).toContain('- DeepSeek(deepseek)')
    expect(texts[0]).toContain('- DeepSeek-V4(deepseek-chat): input text · context 65536 tokens')
  })

  it('omits the model catalog when includeModelCatalog is false', async () => {
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig({ includeModelCatalog: false }))
    const history: LoggedMessage[] = []
    await step(history)
    expect(snapshotTexts(history)[0]).not.toContain('## Model Catalog')
  })

  it('keeps working when the model catalog read fails', async () => {
    // 目录读取失败只告警并剔除该 provider 组，快照其余区块不受影响。
    // A failed catalog read warns and drops the provider group; the other
    // snapshot sections are unaffected.
    const { ctx, step, logger } = fakeCtx({ failModelCatalog: true })
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    expect(logger.warn).toHaveBeenCalled()
    const texts = snapshotTexts(history)
    expect(texts[0]).not.toContain('## Model Catalog')
    expect(texts[0]).toContain('## Workspace List')
  })

  it('derives the title from the first human message when no accepted title exists', async () => {
    // 三级标题来源：已接纳标题 → 第一条人类消息前导词 → id 片段。
    // Title, three sources: accepted title → first human message's leading
    // words → id fragment.
    const { ctx, step } = fakeCtx()
    // 覆盖 sessionTitle：返回 undefined 强制走派生回退。
    // Override sessionTitle: return undefined to force the derivation
    // fallback.
    const withOverrides = ctx as { get: (name: string) => unknown }
    withOverrides.get = (serviceName: string) => serviceName === 'agentDefaultModel'
      ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
      : undefined
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我总结这个仓库的构建流程并给出改进建议' }] } },
    ]
    await step(history)
    expect(snapshotTexts(history)[0]).toContain('帮我总结这个仓库的构建流程并给出改进建议')
  })

  it('prefers the latest agent-preset/selected event over the creation header', async () => {
    // preset 切换记在日志（latest-wins）：创建头 standard 时先显示 standard；
    // 日志选中 person-agent 后（latest-wins）改显示 person-agent。
    // Preset switches are logged (latest-wins): a standard creation header
    // renders standard first; once the log selects person-agent, it renders
    // person-agent instead.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    // 直接向 sessions 假实现注入创建头与切换事件（真实宿主里由 registry.select
    // 追加事件）。
    // Inject the creation header and the selection event into the fake store
    // directly (the real host appends the event via registry.select).
    const store = (ctx as unknown as { sessions: { get: (id: string) => (SessionLogView & { header?: Record<string, unknown> }) | undefined } }).sessions
    const original = store.get
    let selected: string | undefined
    store.get = (id: string) => {
      const session = original.call(store, id)
      const events = session?.snapshotEvents?.() ?? []
      return {
        ...session,
        header: { ...(session?.header as Record<string, unknown> ?? {}), agentPreset: 'standard' },
        snapshotEvents: () => (selected === undefined
          ? events
          : [{ type: 'agent-preset/selected', data: { agentPreset: selected } }, ...events]),
      } as never
    }
    await step(history, 'sess-1')
    expect(snapshotTexts(history)[0]).toContain('| standard |')
    selected = 'person-agent'
    await step(history, 'sess-1')
    expect(snapshotTexts(history)[1]).toContain('| person-agent |')
  })

  it('unregisters the listener through the ctx.on disposer', async () => {
    // 注册返回的卸载函数必须移除监听器（HMR/卸载不泄漏）。
    // The registration disposer must remove the listener (no HMR/unload leak).
    const { ctx, step, disposers } = fakeCtx()
    apply(ctx, resolveConfig())
    expect(disposers.length).toBeGreaterThan(0)
    for (const dispose of [...disposers].reverse()) dispose()
    const history: LoggedMessage[] = []
    await expect(step(history)).rejects.toThrow('pre-step listener not registered')
  })
})
