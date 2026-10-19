// 单测：独立插件以 pre-step 追加快照消息——工作记忆拆成三条具名小消息
// （Agent Preset List / Model Catalog / Workspace List），逐块变化检测：只有
// 变化的区块才追加；工作区区块只列工作区本身，不含会话信息；配置可裁剪。
// Unit tests: the standalone plugin appends snapshot messages at pre-step. The
// working memory is split into three named small messages (Agent Preset List /
// Model Catalog / Workspace List) with per-section change detection: only
// changed sections are appended. The workspace section lists workspaces only —
// no session info. Config can trim the snapshot.
import { describe, expect, it, vi } from 'vitest'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { apply, renderAgentPreset, renderWorkspace } from '../src/index.js'
import { resolveConfig, latestSectionText, snapshotTexts } from './support.js'
import type { LogSeq, LoggedMessage } from './support.js'

/** 监听器在测试里被调用的形态（与宿主 agent/pre-step 声明一致）。
 * The shape this test invokes the listener with (matches the host declaration). */
type PreStepListener = (input: { agent: Agent, signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

/** One fake host context wiring the pre-step listener to fake services. 把 pre-step 监听器接到假服务的假宿主 context。 */
function fakeCtx(options: { presets?: unknown[], workspaces?: unknown[], failList?: boolean, failModelCatalog?: boolean } = {}): {
  ctx: Parameters<typeof apply>[0]
  step: (history: LoggedMessage[]) => Promise<void>
  logger: { warn: ReturnType<typeof vi.fn> }
  disposers: Array<() => unknown>
  setLists: (next: { presets?: unknown[], workspaces?: unknown[] }) => void
} {
  const logger = { warn: vi.fn() }
  let presets = options.presets ?? [{ id: 'standard', name: 'Standard', description: 'default mode' }]
  let workspaces = options.workspaces ?? [
    { id: 'ws-1', title: 'Demo', path: 'C:/demo' },
  ]
  const disposers: Array<() => unknown> = []
  const handlers: Record<string, unknown> = {}
  // 当前 step 的历史，供日志假实现读取。
  // The current step's history, read by the fake log.
  let currentHistory: LoggedMessage[] = []
  const ctx = {
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
        return []
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
    },
    step: async (history: LoggedMessage[]) => {
      if (handlers['agent/pre-step'] === undefined) throw new Error('pre-step listener not registered')
      currentHistory = history
      const listener = handlers['agent/pre-step'] as PreStepListener
      const agent = {
        session: {
          seq: history.length,
          // 宿主把 seq 铸成品牌号，测试里用同一形状保持一致。
          // The host brands seq; the test mirrors the same shape.
          eventAt: (seq: LogSeq) => currentHistory[Number(seq)],
          snapshotEvents: () => currentHistory,
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
          seq: SessionSeq(history.length + 1),
          time: Date.now(),
          surfaceOp: 'append',
          data: message,
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
  it('appends three small messages: roster, model catalog, workspace list', async () => {
    // 首步三条消息各一个区块；工作区区块只列工作区行，不含任何会话信息。
    // The first step appends three messages, one section each; the workspace
    // section lists workspace lines only, no session info.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(3)
    expect(texts[0]).toBe(latestSectionText(history, 'Agent Preset List'))
    expect(texts[0]).toContain('## Agent Preset List')
    expect(texts[0]).toContain('- Standard(standard):default mode')
    expect(texts[1]).toContain('## Model Catalog')
    expect(texts[2]).toBe(latestSectionText(history, 'Workspace List'))
    expect(texts[2]).toContain('## Workspace List')
    expect(texts[2]).toContain('- Demo(ws-1):C:/demo')
  })

  it('appends only the sections that changed between steps', async () => {
    // 按块变化检测：模型目录没变 → 不追加；名单与工作区都变了 → 各补一条。
    // Per-section change detection: the unchanged model catalog appends
    // nothing; the changed roster and workspace each append one message.
    const { ctx, step, setLists } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    setLists({
      presets: [{ id: 'reporter', name: 'Reporter', description: 'new mode' }],
      workspaces: [{ id: 'ws-2', title: 'Fresh', path: 'C:/fresh' }],
    })
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(5)
    // 名单与工作区拿到新值；模型目录仍指向首步的旧文本（未追加）。
    // Roster and workspace picked up the new values; the model catalog still
    // points at the first step's text (nothing appended).
    expect(latestSectionText(history, 'Agent Preset List')).toContain('- Reporter(reporter):new mode')
    expect(latestSectionText(history, 'Model Catalog')).toContain('## Model Catalog')
    expect(latestSectionText(history, 'Workspace List')).toContain('- Fresh(ws-2):C:/fresh')
    expect(texts[3]).toContain('## Agent Preset List')
    expect(texts[4]).toContain('## Workspace List')
  })

  it('appends nothing while the values are unchanged', async () => {
    // 变更检测：三个区块都不变则不追加，会话历史零噪音。
    // Change detection: unchanged sections append nothing, keeping history
    // clean.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    await step(history)
    await step(history)
    expect(snapshotTexts(history)).toHaveLength(3)
  })

  it('keeps working when the roster read fails', async () => {
    const { ctx, step, logger } = fakeCtx({ failList: true })
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    expect(logger.warn).toHaveBeenCalled()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[0]).not.toContain('## Agent Preset List')
    expect(texts[1]).toContain('## Workspace List')
  })

  it('omits the roster when includePresetRoster is false', async () => {
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig({ includePresetRoster: false }))
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[0]).not.toContain('## Agent Preset List')
    expect(texts[1]).toContain('## Workspace List')
  })

  it('omits the workspace list when includeWorkspaceList is false', async () => {
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig({ includeWorkspaceList: false }))
    const history: LoggedMessage[] = []
    await step(history)
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('## Agent Preset List')
    expect(latestSectionText(history, 'Workspace List')).toBeUndefined()
  })

  it('appends the model catalog with modality and context window', async () => {
    // 模型目录：provider 分组、多模态输入（text-only）与上下文窗口逐模型一行。
    // Model catalog: provider groups, modality (text-only) and context window,
    // one line per model.
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    const catalog = latestSectionText(history, 'Model Catalog')
    expect(catalog).toContain('## Model Catalog')
    expect(catalog).toContain('- DeepSeek(deepseek)')
    expect(catalog).toContain('- DeepSeek-V4(deepseek-chat): input text · context 65536 tokens')
  })

  it('omits the model catalog when includeModelCatalog is false', async () => {
    const { ctx, step } = fakeCtx()
    apply(ctx, resolveConfig({ includeModelCatalog: false }))
    const history: LoggedMessage[] = []
    await step(history)
    expect(snapshotTexts(history)).toHaveLength(2)
    expect(latestSectionText(history, 'Model Catalog')).toBeUndefined()
  })

  it('keeps working when the model catalog read fails', async () => {
    // 目录读取失败只告警并剔除该区块，其余两个区块不受影响。
    // A failed catalog read warns and drops that section; the other two are
    // unaffected.
    const { ctx, step, logger } = fakeCtx({ failModelCatalog: true })
    apply(ctx, resolveConfig())
    const history: LoggedMessage[] = []
    await step(history)
    expect(logger.warn).toHaveBeenCalled()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('## Agent Preset List')
    expect(latestSectionText(history, 'Model Catalog')).toBeUndefined()
    expect(texts[1]).toContain('## Workspace List')
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
