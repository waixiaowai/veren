// 组合测试：走真实 cordis Context——真实 inject 解析、真实 waterfall 事件
// 派发与逆序清理，仅以假实现提供被注入的服务面；并锁定三条具名小消息、
// "按块变化检测"与"工作区只列工作区"的语义。
// Composition test: goes through a real cordis Context - real inject
// resolution, real waterfall dispatch and reverse-order disposal - with only
// the injected service faces swapped for fakes; also locks the three named
// small messages, per-section change detection, and the "workspaces only"
// workspace section.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import { apply, inject, name } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { fakeAgent, resolveConfig, latestSectionText, snapshotTexts } from './support.js'
import type { LogSeq, LoggedMessage } from './support.js'

/** One workspace as the renderer consumes it (host Workspace's read-only slice).
 * 渲染层消费的工作区块（宿主 Workspace 的只读切片）。 */
interface WorkspaceLike {
  id: string
  title: string
  path: string
}

/** Install the real apply on a real Context with mutable fakes. 在真实 Context 上安装真实 apply，假实现可变。 */
async function install(config: Partial<ConfigShape> = {}) {
  const ctx = new Context()
  const history: LoggedMessage[] = []
  const workspaces: WorkspaceLike[] = [{ id: 'ws-1', title: 'Demo', path: 'C:/demo' }]
  ctx.provide('agentPresets', {
    list: async () => [{ id: 'standard', name: 'Standard', description: 'default mode' }],
    defaultId: 'person-agent',
  })
  ctx.provide('workspaceRegistry', {
    list: () => workspaces,
    get archivedSessionIds(): readonly string[] {
      return []
    },
  })
  // LLM 注册表假实现：一个 provider、一个纯文本模型（带上下文窗口）。
  // Fake LLM registry: one provider, one text-only model with a context window.
  ctx.provide('llm', {
    listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
    listModels: async () => [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek-V4' }],
    resolveModelInfo: async () => ({
      provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek-V4',
      inputModalities: ['text'], context: { contextWindow: 65536 },
    }),
  })
  const fiber: Fiber = ctx.plugin({ name, inject, apply }, resolveConfig(config))
  await fiber
  return {
    ctx,
    fiber,
    history,
    /** Fire one real waterfall pre-step dispatch; committed messages land in history. 触发一次真实 waterfall pre-step 派发；追加的消息落账到历史。 */
    step: async (): Promise<void> => {
      // 完整 Agent 面由 support 的 fakeAgent 提供，这里只给出插件可读的日志切片；
      // 其余成员被触达即失败，避免假实现悄悄放行越界读取。
      // support.fakeAgent supplies the full Agent face; this test only provides the
      // log slice the plugin may read, and every other member fails when touched.
      const agent = fakeAgent({
        id: SessionId('agent-composition'),
        seq: SessionLogOffset(history.length),
        eventAt: (seq: LogSeq) => history[Number(seq)],
        snapshotEvents: () => history,
      })
      // 用宿主的真实决策类型收窄，再取 messages：与插件侧同一套写法，不在联合
      // 类型上直接取属性。
      // Narrow with the host's real decision type before reading messages, mirroring
      // the plugin side: the property is never taken off a union.
      const decision = await ctx.waterfall(
        'agent/pre-step',
        { agent, messages: [], turn: 0, step: 0, signal: new AbortController().signal },
        async () => ({ kind: 'enter', messages: [] }),
      ) as PreStepDecision
      if (decision.kind === 'reject') return
      for (const message of decision.messages) {
        history.push({
          type: 'user/message',
          seq: SessionSeq(history.length + 1),
          time: Date.now(),
          surfaceOp: 'append',
          data: message,
        })
      }
    },
    /** Point the workspace registry at a new list. 让工作区注册表改读新名单。 */
    setWorkspaces: (next: WorkspaceLike[]) => {
      workspaces.splice(0, workspaces.length, ...next)
    },
  }
}

describe('personAgentDynamicContext composition（真实装配路径 / real assembly path）', () => {
  it('resolves inject through cordis and appends the three named sections', async () => {
    // 首步三条消息各一个区块；工作区区块只有工作区行，没有会话表格。
    // The first step appends three messages, one section each; the workspace
    // section carries workspace lines only, no session table.
    const { step, history } = await install()
    await step()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(3)
    expect(texts[0]).toContain('## Agent Preset List')
    expect(texts[1]).toContain('## Model Catalog')
    expect(texts[2]).toContain('## Workspace List')
    expect(texts[2]).toContain('- Demo(ws-1):C:/demo')
    expect(texts[2]).not.toContain('| sess-1 |')
  })

  it('removes the listener when the fiber unloads', async () => {
    // 真实 fiber 卸载必须移除监听器（注册贡献不泄漏：卸载后 emit 不再追加）。
    // A real fiber unload must remove the listener (no registry contribution
    // leak: emit no longer appends after unload).
    const { fiber, step, history } = await install()
    await step()
    expect(snapshotTexts(history)).toHaveLength(3)
    await fiber.dispose()
    await step()
    expect(snapshotTexts(history)).toHaveLength(3)
  })

  it('honors config toggles through the real config path', async () => {
    const { step, history } = await install({ includePresetRoster: false })
    await step()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[0]).not.toContain('## Agent Preset List')
    expect(texts[1]).toContain('## Workspace List')
  })

  it('appends only the sections that changed between steps', async () => {
    // 真实事件分发下的按块变化检测：名单/目录未变不追加；工作区变了只补一条。
    // Per-section change detection on the real dispatch path: unchanged
    // roster/catalog append nothing; the changed workspace appends one message.
    const { step, history, setWorkspaces } = await install()
    await step()
    setWorkspaces([{ id: 'ws-2', title: 'Fresh', path: 'C:/fresh' }])
    await step()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(4)
    expect(texts[3]).toContain('## Workspace List')
    expect(texts[3]).toContain('- Fresh(ws-2):C:/fresh')
    expect(latestSectionText(history, 'Agent Preset List')).toContain('- Standard(standard):default mode')
  })
})
