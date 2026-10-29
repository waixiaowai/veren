/**
 * 性质测试（docs/task-workbench-modes-dispatch §7）：全部跑在**真实**任务中心
 * 服务上（内存存储后端，状态机零漂移），探针先于实现写定：
 * - P1 任务不丢：任意操作序列后，非终态记录 ⇒ 策略视图队列行或活租约；
 * - P2 未经同意的写被拒，且变异掉同意门必须变红（同输入下无门路径放行）；
 * - P3 派发至多一次送达（幂等键去重）+ 退回队列（returned → requeue）。
 * Property tests (§7 of the design doc), all over the REAL task-center service
 * (in-memory storage; zero state-machine drift), probes written before the
 * implementation: P1 no task lost; P2 unauthorized writes refused with the
 * mutation turning red; P3 at-most-once dispatch delivery plus queue return.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterService from '@veren/task-center'
import type { TaskRecord } from '@veren/task-center'
import { ConsentBook, DriveLedger, beginDrive } from '../src/consent.ts'
import { createTaskChannel } from '../src/channel.ts'
import type { TaskChannel } from '../src/channel.ts'
import { TaskStore } from '../src/store.ts'
import { strategyView, SELF_APP_ID } from '../src/strategy.ts'
import { completeTaskAction, publishTaskAction, requeueTaskAction, takeTaskAction } from '../src/actions-queue.ts'
import { armFirstScreen, armUserTurn, fakeSession, noticeEvent } from './helpers/consent-events.ts'
import { MemoryStorageBackend, mountMemoryBackend } from './helpers/fake-storage.ts'

/** 终态集合（P1 的"非终态"判定，与 task-center 同口径）/ the terminal set (P1's non-terminal test) */
const TERMINAL: ReadonlySet<TaskRecord['status']> = new Set(['done', 'failed', 'expired', 'cancelled', 'orphaned'])

const boots: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of boots.reverse()) await dispose()
  boots.length = 0
})

/** 起真实任务中心（内存后端）+ 工作台通道/门/台账。工具注册关闭（本测试不经全局 task_*）。 */
async function boot(): Promise<{
  channel: TaskChannel
  store: TaskStore
  book: ConsentBook
  ledger: DriveLedger
  ports: Parameters<typeof takeTaskAction>[0]
}> {
  const ctx = new Context()
  const fibers = [await ctx.plugin(Storage.default)]
  mountMemoryBackend(ctx, new MemoryStorageBackend())
  fibers.push(await ctx.plugin(StorageDomain, { backend: 'memory' }))
  const service = new TaskCenterService(ctx, { tools: { enabled: false } })
  service.setAppResolver(async (appId) => (appId === SELF_APP_ID || appId === 'person-agent'
    ? { state: 'active', version: '0.0.0' }
    : undefined))
  boots.push(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose().catch(() => undefined)
  })
  const channel = createTaskChannel(service)
  const store = new TaskStore()
  const book = new ConsentBook()
  const ledger = new DriveLedger()
  const ports = {
    store,
    channel,
    book,
    ledger,
    catalog: () => [{
      definition: { id: 'person-agent', name: 'Person Agent', description: '个人代理', entry: 'overview' },
      owner: 'spec',
      version: '0.0.0',
      toolPrefix: 'person_agent',
      state: 'active' as const,
      pages: new Map([['overview', { url: '/apps/person-agent/overview', description: '总览页', component: true }]]),
    }],
    openUrl: async (url: string) => ({ sessionId: 'target-session', url, title: url }),
  }
  return { channel, store, book, ledger, ports: ports as never }
}

/** P1 断言：每条非终态记录都在策略视图的队列 lane 里，held 必带未过期租约。 */
async function assertNoTaskLost(channel: TaskChannel, store: TaskStore): Promise<void> {
  const records = await channel.list()
  const view = strategyView(records)
  store.rebuildFrom(records)
  const byRecord = new Map(view.rows.map((row) => [row.recordId, row]))
  for (const record of records) {
    if (TERMINAL.has(record.status)) continue
    const row = byRecord.get(record.id)
    expect(row, `non-terminal record ${record.id} (${record.status}) vanished from the strategy view`).toBeDefined()
    expect(['takeable', 'dispatched', 'held'], `record ${record.id} landed in lane ${String(row?.lane)}`)
      .toContain(row?.lane)
    if (record.status === 'taken') {
      expect(row?.lane).toBe('held')
      expect(Date.parse(row?.leaseUntil ?? '')).toBeGreaterThan(Date.now())
    }
  }
}

describe('P1 任务不丢（随机操作序列下的不变式）', () => {
  it('publish/take/complete/abandon/fail/requeue 交错后，非终态记录全在队列或活租约', async () => {
    const { channel, store, book, ledger, ports } = await boot()
    const session = fakeSession('p1-driver')
    const { agent, exec } = driverOf(session)
    let serial = 0
    // 三轮×六动作的确定性交错（伪随机但可复现）：每步后都断言不变式
    // / a deterministic interleave of three rounds × six ops (pseudo-random yet
    // reproducible); the invariant is asserted after every step
    const ops: Array<() => Promise<unknown>> = [
      () => publishTaskAction(ports, exec, { title: `单 ${++serial}` }),
      () => publishTaskAction(ports, exec, { title: `派 ${++serial}`, target_app: 'person-agent' }),
      async () => {
        const view = strategyView(await channel.list())
        const first = view.rows.find((row) => row.lane === 'takeable')
        if (first !== undefined) return takeTaskAction(ports, exec, { task_id: first.id })
        return undefined
      },
      async () => {
        const view = strategyView(await channel.list())
        const held = view.rows.find((row) => row.lane === 'held')
        if (held === undefined) return undefined
        if (serial % 2 === 0) return completeTaskAction(ports, exec, { task_id: held.id, summary: '做完了' })
        return channel.failAsClaimant(held.recordId as never, { code: 'spec/reject', message: '干不了' }, 'p1-driver')
      },
      async () => {
        const view = strategyView(await channel.list())
        const returned = view.rows.find((row) => row.lane === 'returned')
        if (returned === undefined) return undefined
        return requeueTaskAction(ports, exec, { task_id: returned.id })
      },
      async () => {
        const view = strategyView(await channel.list())
        const held = view.rows.find((row) => row.lane === 'held')
        if (held !== undefined) return channel.releaseAsClaimant(held.recordId as never, 'spec abandon', 'p1-driver')
        return undefined
      },
    ]
    for (let round = 0; round < 3; round += 1) {
      armUserTurn(book, session)
      beginDrive(book, ledger, agent, { reason: `p1 round ${round + 1}` })
      for (const op of ops) {
        await op()
        await assertNoTaskLost(channel, store)
      }
    }
  })
})

/** 稳定的驱动者身份：同一会话的 agent 包装对象只造一次（drive 台账按它键控）
 * / one stable driver identity: an agent wrapper is built once per session (the drive ledger keys on it) */
function driverOf(session: object): { readonly agent: { readonly session: object }; readonly exec: never } {
  const agent = { session }
  return { agent, exec: { agent } as never }
}

describe('P2 未经同意的写被拒（变异掉同意门必须变红）', () => {
  it('首屏形态（仅 PAGE 块）：take/complete/publish/requeue 全部 consent/required', async () => {
    const { channel, book, ledger, ports } = await boot()
    const session = fakeSession('p2-browser')
    const record = await channel.send({
      kind: 'task-workbench/publish' as never,
      title: '未同意的单',
      target: { url: '/apps/task-workbench/task/t-1' as never, appId: SELF_APP_ID, page: 'detail', params: { taskId: 't-1' } },
    })
    const { exec } = driverOf(session)
    armFirstScreen(book, session)
    expect(await takeTaskAction(ports, exec, { task_id: 't-1' }))
      .toMatchObject({ ok: false, code: 'consent/required' })
    expect(await completeTaskAction(ports, exec, { task_id: 't-1', summary: '顺手完成' }))
      .toMatchObject({ ok: false, code: 'consent/required' })
    expect(await publishTaskAction(ports, exec, { title: '顺手发布' }))
      .toMatchObject({ ok: false, code: 'consent/required' })
    expect(await requeueTaskAction(ports, exec, { task_id: record.id }))
      .toMatchObject({ ok: false, code: 'consent/required' })
    // 台账缺席（有用户同意但没 drive_begin）：consent/drive-required
    // / a missing grant (user consent but no drive_begin): consent/drive-required
    armUserTurn(book, session)
    expect(await takeTaskAction(ports, exec, { task_id: 't-1' }))
      .toMatchObject({ ok: false, code: 'consent/drive-required' })
  })

  it('变异体：同意门恒真时同一输入放行——门是仅有的闸门，删门即红', async () => {
    const { channel, book, ledger, ports } = await boot()
    await channel.send({
      kind: 'task-workbench/publish' as never,
      title: '变异对照单',
      target: { url: '/apps/task-workbench/task/t-1' as never, appId: SELF_APP_ID, page: 'detail', params: { taskId: 't-1' } },
    })
    const { agent, exec } = driverOf(fakeSession('p2-mutant'))
    // 变异：book 恒真 + 台账预置 = 等价于"把门拆掉"。同一输入必须放行，
    // 否则上一条测试的"被拒"断言就不是门在起作用。
    // / The mutation: an always-true book plus a pre-armed ledger = the gate
    // removed. The SAME input must pass, or the refusal asserted above proves
    // nothing about the gate.
    const mutantBook = new ConsentBook()
    mutantBook.consentOf = () => ({ userTurn: true, deliveredTaskIds: [] })
    const mutantLedger = new DriveLedger()
    mutantLedger.begin(agent, { scope: 'turn', taskIds: new Set(), reason: 'mutation', at: new Date().toISOString() })
    const mutantPorts = { ...ports, book: mutantBook, ledger: mutantLedger }
    expect(await takeTaskAction(mutantPorts as never, exec, { task_id: 't-1' }))
      .toMatchObject({ ok: true })
  })

  it('投递回合：只有被点名的任务放行，别的任务仍然 consent/required', async () => {
    const { channel, book, ledger, ports } = await boot()
    const sent: TaskRecord[] = []
    for (const id of ['t-1', 't-2']) {
      sent.push(await channel.send({
        kind: 'task-workbench/publish' as never,
        title: `单 ${id}`,
        target: { url: `/apps/task-workbench/task/${id}` as never, appId: SELF_APP_ID, page: 'detail', params: { taskId: id } },
      }))
    }
    const { agent, exec } = driverOf(fakeSession('p2-delivery'))
    // 通知点名真实铸出的记录 id（noticeText 的 `任务：<id>` 行）
    // / the notice names the really minted record id (noticeText's `任务：<id>` line)
    book.observe(agent.session, { type: 'turn/start' } as never)
    book.observe(agent.session, noticeEvent(sent[0]!.id) as never)
    const view = strategyView(await channel.list())
    const t1 = view.rows.find((row) => row.id === 't-1')
    const t2 = view.rows.find((row) => row.id === 't-2')
    expect(beginDrive(book, ledger, agent, {
      reason: '处理投递来的 t-1',
      scope: 'tasks',
      task_ids: t1 === undefined ? [] : [t1.recordId],
    })).toMatchObject({ ok: true })
    expect(await takeTaskAction(ports, exec, { task_id: t1?.id })).toMatchObject({ ok: true })
    expect(await takeTaskAction(ports, exec, { task_id: t2?.id }))
      .toMatchObject({ ok: false, code: 'consent/required' })
  })
})

describe('P3 派发至多一次送达 + 可退回队列', () => {
  it('同幂等键二次 send 返回同一记录（至多一次）；requeue 后新单 open、旧单留历史', async () => {
    const { channel } = await boot()
    const draft = {
      kind: 'task-workbench/publish' as never,
      title: '同键单',
      target: { url: '/apps/person-agent/overview' as never, appId: 'person-agent', page: 'overview', params: {} },
      idempotencyKey: 'task-workbench/t-9/person-agent-a1',
    }
    const first = await channel.send(draft)
    const second = await channel.send(draft)
    expect(second.id).toBe(first.id)
    expect((await channel.list()).filter((record) => record.title === '同键单')).toHaveLength(1)
  })

  it('returned → requeue：新记录 open 落回队列，旧 failed 记录保留为历史；改派到别的应用翻 dispatched', async () => {
    const { channel, book, ledger, ports } = await boot()
    const { agent, exec } = driverOf(fakeSession('p3-driver'))
    armUserTurn(book, agent.session)
    beginDrive(book, ledger, agent, { reason: 'p3 全程' })
    await publishTaskAction(ports, exec, { title: '会失败的单' })
    const view1 = strategyView(await channel.list())
    const order = view1.rows[0]!
    await takeTaskAction(ports, exec, { task_id: order.id })
    await channel.failAsClaimant(order.recordId as never, { code: 'spec/reject', message: '干不了' }, 'p3-driver')
    expect(strategyView(await channel.list()).rows[0]?.lane).toBe('returned')
    // 退回：新记录 open（回队列），旧记录 failed 留历史
    // / return: the new record is open (back in the queue); the failed record stays as history
    expect(await requeueTaskAction(ports, exec, { task_id: order.id })).toMatchObject({ ok: true })
    const after = strategyView(await channel.list())
    expect(after.rows.filter((row) => row.id === order.id)).toHaveLength(1)
    expect(after.rows[0]?.lane).toBe('takeable')
    expect(after.rows[0]?.attempts).toBe(2)
    const history = (await channel.list()).filter((record) => record.status === 'failed')
    expect(history).toHaveLength(1)
    // 改派：returned → requeue 到 person-agent → dispatched lane
    // / re-file: returned → requeue at person-agent → the dispatched lane
    await takeTaskAction(ports, exec, { task_id: order.id })
    await channel.failAsClaimant(after.rows[0]!.recordId as never, { code: 'spec/reject', message: '还是干不了' }, 'p3-driver')
    expect(await requeueTaskAction(ports, exec, { task_id: order.id, target_app: 'person-agent' }))
      .toMatchObject({ ok: true })
    const refilled = strategyView(await channel.list())
    expect(refilled.rows[0]?.lane).toBe('dispatched')
    expect(refilled.rows[0]?.dispatchedTo).toBe('person-agent')
  })
})
