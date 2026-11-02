/** The taskhub Source kind: dispatch envelope → Trigger → Engine intake, channel replies through the bridge, end/decision hooks. */
/** taskhub 来源 kind：派发信封 → Trigger → 引擎接收；通道回复经桥上行；结束/拒绝挂点。 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Assessor, Executor, ReceiveResult, Ticket, Trigger } from '../src/core/index.ts'
import { Engine } from '../src/core/engine.ts'
import { Store } from '../src/app/store.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { Commands } from '../src/infra/commands.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { bindBridge, SOURCE, taskhubKind, triggerOf, notifyTaskhubEnded, TaskhubConfigSchema,
  type TaskhubBridge } from '../src/sources/taskhub.ts'
import type { DispatchEnvelope } from '../src/infra/taskhub/protocol.ts'
import { testDeployment } from './fixtures/deployment.ts'

const ENVELOPE: DispatchEnvelope = {
  taskId: '01JBYQ8XK3', intent: '修一下 CI',
  origin: { source: 'wechat', conversation: 'p2p:wxid_abc', requester: 'wxid_abc' },
  createdAt: 1762000000,
}

/** In-memory bridge capturing every uplink report. */
class FakeBridge implements TaskhubBridge {
  reports: { name: string; payload: unknown }[] = []
  report(name: string, payload: unknown): Promise<{ delivered: boolean }> {
    this.reports.push({ name, payload })
    return Promise.resolve({ delivered: true })
  }
  last(name: string): unknown { return this.reports.filter(row => row.name === name).at(-1)?.payload }
}

function host(overrides: Partial<SourceContextDeps> = {}) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'taskhub-')), 'db.sqlite'))
  store.saveSettings(SettingsSchema.parse({
    policy: { sources: { [SOURCE]: { allowed: [] } } }, eval: { mode: 'auto' },
    sources: { [SOURCE]: { enabled: true, config: TaskhubConfigSchema.parse({ url: 'wss://cms.test/v1/ws', token: 'k' }) } },
  }))
  const board = new HealthBoard()
  const sources = new SourceRegistry(() => store.settings(), board)
  sources.register(taskhubKind)
  const assessor: Assessor = { request: vi.fn(async () => {}) }
  const executor: Executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor, outbox })
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  const receive = vi.fn(async (trigger: Trigger): Promise<ReceiveResult> => {
    const result = engine.receive(trigger)
    engine.evaluateDue()
    return result
  })
  const parts: SourceContextDeps = { store, engine, outbox, commands, sources,
    deployment: testDeployment(), ready: Promise.resolve(), configured: () => true, receive, ...overrides }
  const context: SourceContext = sourceContextOf(parts, { kind: SOURCE, health: ['taskhub'] })
  return { ...parts, context, receive, store, engine }
}

function context(overrides: Partial<SourceContextDeps> = {}): SourceContext {
  return host(overrides).context
}

afterEach(() => { bindBridge(undefined) })

describe('taskhub source kind', () => {
  it('maps a dispatch envelope into an admissible human trigger with the origin as its channel', async () => {
    const receive = vi.fn(async (_trigger: Trigger): Promise<ReceiveResult> => 'stored')
    const ctx = context({ receive })
    const trigger = triggerOf(ENVELOPE)
    await ctx.receive(trigger)
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      id: ENVELOPE.taskId, source: SOURCE, human: true, addressed: 'direct', text: '修一下 CI',
      actor: { source: SOURCE, id: 'wxid_abc' },
      threads: [{ source: SOURCE, id: ENVELOPE.taskId }],
      channel: { source: SOURCE, thread: `taskhub:${ENVELOPE.taskId}`,
        address: { conversation: 'p2p:wxid_abc', requester: 'wxid_abc' } },
      meta: { taskId: ENVELOPE.taskId, originSource: 'wechat' },
    }))
  })

  it('sends channel replies through the bridge as task.reply events', async () => {
    const bridge = new FakeBridge()
    bindBridge(bridge)
    const result = await taskhubKind.channel!.send({} as never, {
      id: 'msg_1', channel: { source: SOURCE, thread: 'taskhub:t9', address: {} }, text: '在修了', kind: 'reply',
    })
    expect(result).toBe('sent')
    expect(bridge.last('taskhub.task.reply')).toEqual({ taskId: 't9', messageId: 'msg_1', text: '在修了' })
  })

  it('reports completion on ticket end, projecting the outcome closed set', () => {
    const bridge = new FakeBridge()
    bindBridge(bridge)
    const trigger = triggerOf(ENVELOPE)
    const ticket = (outcome: Ticket['ended']): Ticket => ({
      id: 'ticket-1', title: 't', decisionId: 'd', mandate: {} as never, channels: [], assignments: [],
      inputs: [], undelivered: [], origin: { triggerId: trigger.id, triggerIds: [trigger.id] },
      createdAt: '', updatedAt: '', ended: outcome,
    })
    notifyTaskhubEnded(trigger, ticket({ at: 'now', by: 'executor', outcome: 'merged' }))
    notifyTaskhubEnded(trigger, ticket({ at: 'now', by: 'human', outcome: 'stopped', reason: '人工叫停' }))
    expect(bridge.reports.filter(row => row.name === 'taskhub.task.result')).toHaveLength(2)
    expect(bridge.reports[0]!.payload).toMatchObject({ taskId: ENVELOPE.taskId, outcome: 'completed' })
    expect(bridge.reports[1]!.payload).toMatchObject({ taskId: ENVELOPE.taskId, outcome: 'stopped', summary: '人工叫停' })
  })

  it('evaluates a dispatched trigger on a real engine without a filtered rejection', async () => {
    const h = host()
    const trigger = triggerOf(ENVELOPE)
    h.engine.receive(trigger)
    h.engine.evaluateDue()
    // 闸门正断言：来源在册且触发器未被 scope 过滤（dispatched 任务必须进入评估）。
    const disposition = h.store.triggers.disposition(trigger.id)
    expect(disposition).toBeDefined()
    expect(disposition!.filtered).toBeUndefined()
    // 线程在册，评估待 assessor 回调后出 Decision；assessor 是桩，Decision 未出属正常。
    expect(h.store.threads.get(`taskhub:${ENVELOPE.taskId}`)).toBeDefined()
  })

  it('answers a re-dispatched taskId idempotently: the Engine intake dedups it', async () => {
    const h = host()
    const trigger = triggerOf(ENVELOPE)
    expect(h.engine.receive(trigger)).not.toBe('duplicate')
    // 租约过期重排/管理面回池会重发同一 taskId：二次 intake 必得 duplicate，
    // onCommand 据此照答 accepted，不重复建工单（契约 §3 幂等规则）。
    expect(h.engine.receive(trigger)).toBe('duplicate')
  })
})
