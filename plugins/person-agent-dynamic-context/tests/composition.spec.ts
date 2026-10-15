// 组合测试：走真实 cordis Context——真实 inject 解析、真实 waterfall 事件
// 派发与逆序清理，仅以假实现提供被注入的服务面；并锁定四字段会话信息与
// "仅变化追加"的语义。
// Composition test: goes through a real cordis Context - real inject
// resolution, real waterfall dispatch and reverse-order disposal - with only
// the injected service faces swapped for fakes; also locks the four-fact
// session line and append-on-change semantics.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { apply, inject, name } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { resolveConfig, snapshotTexts } from './support.js'
import type { LogSeq, LoggedMessage } from './support.js'

/** One workspace as the renderer consumes it (host Workspace's read-only slice).
 * 渲染层消费的工作区块（宿主 Workspace 的只读切片）。 */
interface WorkspaceLike {
  id: string
  title: string
  path: string
  sessionIds: readonly string[]
}

/** Install the real apply on a real Context with mutable fakes. 在真实 Context 上安装真实 apply，假实现可变。 */
async function install(config: Partial<ConfigShape> = {}) {
  const ctx = new Context()
  const history: LoggedMessage[] = []
  const workspaces: WorkspaceLike[] = [{ id: 'ws-1', title: 'Demo', path: 'C:/demo', sessionIds: ['sess-1'] }]
  const runningIds = new Set<string>()
  ctx.provide('agents', {
    get: (id: string) => (runningIds.has(id) ? { status: 'running' } : undefined),
  })
  ctx.provide('sessions', {
    get: (id: string) => ({
      id,
      header: { createdAt: Date.UTC(2026, 9, 15), cwd: 'C:/demo', agentPreset: 'person-agent' },
      // 插件只在需要时读日志事件，这里给出空日志即可（形状与宿主一致）。
      // The plugin reads log events only when needed; an empty log with the host
      // shape is enough here.
      snapshotEvents: (_fromSeq?: number, _toSeqExclusive?: number) => [] as readonly LoggedMessage[],
      eventAt: (_seq: LogSeq) => undefined,
    }),
  })
  ctx.provide('sessionProjections', {
    stateOf: () => ({ lastUsed: { provider: 'deepseek', model: 'deepseek-chat' } }),
  })
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
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  })
  ctx.provide('sessionTitle', {
    get: () => ({ title: 'Greeting' }),
  })
  const fiber: Fiber = ctx.plugin({ name, inject, apply }, resolveConfig(config))
  await fiber
  return {
    ctx,
    fiber,
    history,
    /** Fire one real waterfall pre-step dispatch; committed messages land in history. 触发一次真实 waterfall pre-step 派发；追加的消息落账到历史。 */
    step: async (): Promise<void> => {
      const agent = {
        session: {
          id: 'sess-1',
          // 宿主的 seq 是品牌号；历史长度就是下一步的序号。
          // The host's seq is branded; the history length is the next sequence.
          seq: history.length as never,
          eventAt: (seq: LogSeq) => history[Number(seq)],
          snapshotEvents: (_fromSeq?: number, _toSeqExclusive?: number) => history,
        },
      }
      // 用宿主的真实决策类型收窄，再取 messages：与插件侧同一套写法，不在联合
      // 类型上直接取属性。
      // Narrow with the host's real decision type before reading messages, mirroring
      // the plugin side: the property is never taken off a union.
      const decision = await ctx.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, async () =>
        ({ kind: 'enter', messages: [] })) as PreStepDecision
      if (decision.kind === 'reject') return
      for (const message of decision.messages) {
        history.push({
          type: 'user/message',
          data: { source: message.source as { kind: string }, content: message.content as readonly { type: string, text?: string }[] },
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
  it('resolves inject through cordis and appends the four-fact session line', async () => {
    const { step, history } = await install()
    await step()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('## Agent Preset List')
    expect(texts[0]).toContain('## Workspace List')
    expect(texts[0]).toContain('1. Greeting · preset person-agent · deepseek/deepseek-chat · created 2026-10-15')
  })

  it('removes the listener when the fiber unloads', async () => {
    // 真实 fiber 卸载必须移除监听器（注册贡献不泄漏：卸载后 emit 不再追加）。
    // A real fiber unload must remove the listener (no registry contribution
    // leak: emit no longer appends after unload).
    const { fiber, step, history } = await install()
    await step()
    expect(snapshotTexts(history)).toHaveLength(1)
    await fiber.dispose()
    await step()
    expect(snapshotTexts(history)).toHaveLength(1)
  })

  it('honors config toggles through the real config path', async () => {
    const { step, history } = await install({ includePresetRoster: false })
    await step()
    const texts = snapshotTexts(history)
    expect(texts[0]).not.toContain('## Agent Preset List')
    expect(texts[0]).toContain('## Workspace List')
  })

  it('appends a fresh snapshot when a registry changes between steps', async () => {
    // 真实事件分发下的精确新鲜度：变化后的第一次 emit 就拿到新值。
    // Exact freshness on the real dispatch path: the first emit after a
    // change already reads the new values.
    const { step, history, setWorkspaces } = await install()
    await step()
    setWorkspaces([{ id: 'ws-2', title: 'Fresh', path: 'C:/fresh', sessionIds: ['sess-2'] }])
    await step()
    const texts = snapshotTexts(history)
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain('- Fresh(ws-2):C:/fresh')
    expect(texts[1]).toContain('1. Greeting')
  })
})
