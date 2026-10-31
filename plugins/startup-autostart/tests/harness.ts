/**
 * Shared test fixtures for the startup-autostart specs.
 *
 * Every spec mounts the real Cordis runtime with the real JSON storage backend,
 * so the storage domain, the trigger wiring, the latch, and the delivery are
 * exercised exactly as a booting Harness exercises them. Only the Agent and
 * Session layers are doubled: this plugin's job is to decide what to deliver,
 * and the doubles record the deliveries. This module holds what every scenario
 * needs; the scenario specs hold their own setup on top of it.
 *
 * 启动自启动各用例共享的测试夹具。每个用例都挂载真实 Cordis 运行时与真实 JSON 存储
 * 后端，因此存储域、触发接线、闩锁与投递都按真实启动 Harness 的方式被锻炼。只有 Agent
 * 与会话层使用替身：本插件的职责是决定投递什么，替身负责记录投递。本模块放各场景都要
 * 用的部分，场景专属的搭建放在各场景 spec 里。
 *
 * The specs run against `src/`, which is what the checker sees; the end-to-end
 * evidence for the shipped artifact is the real profile boots recorded in the
 * delivery note, which install the published package from the registry.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AppReady } from '@deepseek-ai/dsh-cmdline'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import StartupAutostartService from '../src/index.ts'
import type { StoredStartupItem } from '../src/storage.ts'

/**
 * Wait until one row's committed run count reaches the expected value.
 *
 * The service's catalog is the same authoritative state the assertions read, so
 * polling it waits for the drive without depending on when the JSON backend
 * flushes the document. Matching the exact value (not "any positive count")
 * keeps a seeded 3/7 from satisfying the wait before the drive runs.
 *
 * 等待某行已提交的运行次数达到期望值。
 *
 * 服务的目录就是断言读取的权威状态，轮询它即可等驱动结束，且不依赖 JSON 后端何时刷盘。匹配
 * 确切数值（而不是“任意正数”）可避免种子的 3/7 在驱动执行前就满足等待。
 *
 * @param ctx - the root context owning the service. 持有服务的根上下文。
 * @param expected - the run count some row must reach. 某行必须达到的运行次数。
 * @returns after a row's committed count equals `expected`. 某行已提交计数等于期望值后返回。
 */
export async function settle(ctx: Context, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const rows = await ctx.startupAutostart.catalog().catch(() => [])
    if (rows.some(row => row.runCount === expected)) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`startup-autostart: no row reached runCount ${expected} within 10s`)
}

/**
 * Wait until every row of a multi-item drive has committed one run.
 *
 * @param ctx - the root context owning the service. 持有服务的根上下文。
 * @param rows - how many rows must show a positive run count. 必须显示正运行计数的行数。
 * @returns after that many rows are stamped. 达到该行数后返回。
 */
export async function settleEvery(ctx: Context, rows: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const catalog = await ctx.startupAutostart.catalog().catch(() => [])
    if (catalog.filter(row => row.runCount > 0).length >= rows) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`startup-autostart: fewer than ${rows} rows were stamped within 10s`)
}

/**
 * Publish a test double for one Host service.
 *
 * A double implements only the members the plugin calls, and some of those
 * members hand back an Agent the double cannot construct in full, so it is
 * deliberately narrower than the service it replaces. This helper is the single
 * place the spec crosses that boundary; every other line keeps real member names.
 * @param ctx - the root context to publish on.
 * @param name - the service key being replaced.
 * @param value - the members the plugin calls.
 */
export function provideStub<K extends string & keyof Context>(ctx: Context, name: K, value: object): void {
  ctx.provide(name, value as Context[K])
}

const roots: string[] = []

/** Remove every temporary storage root this process created. */
export function cleanupTempRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** One temporary storage root, removed after the spec. */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'startup-autostart-'))
  roots.push(root)
  return root
}

/** Write the storage document the JSON backend reads at open, as the panel would read it. */
export function seed(root: string, items: readonly Record<string, unknown>[]): void {
  writeFileSync(join(root, 'startup.json'), JSON.stringify({
    unit: { name: 'startup', version: 1 },
    global: null,
    tables: { items: Object.fromEntries(items.map(entry => [String(entry['id']), entry])) },
  }, undefined, 2))
}

/** One complete stored row, with the fields a spec does not override. */
export function item(overrides: Partial<StoredStartupItem> & { readonly id: string }): Record<string, unknown> {
  const instant = new Date().toISOString()
  return {
    name: 'seeded',
    enabled: true,
    action: 'new_session',
    createdAt: instant,
    updatedAt: instant,
    runCount: 0,
    ...overrides,
  }
}

/** The recorded Session-layer effects of one mounted plugin. */
export interface SessionCalls {
  readonly created: Record<string, unknown>[]
  readonly followup: { readonly sessionId: string; readonly text: string }[]
  readonly inject: { readonly sessionId: string; readonly text: string }[]
  readonly model: Record<string, unknown>[]
  flush: number
}

/** A Session-layer double plus the calls it recorded. */
export interface SessionLayer {
  readonly calls: SessionCalls
  readonly services: {
    readonly agents: object
    readonly sessions: object
    readonly sessionController: object
  }
}

/** A fake Agent recording the inbox operations the runtime performs on it. */
function fakeAgent(sessionId: string, calls: SessionCalls): Record<string, unknown> {
  return {
    session: { id: sessionId },
    followup: (message: { content: readonly { text: string }[] }) => {
      calls.followup.push({ sessionId, text: message.content[0]?.text ?? '' })
    },
    inject: (message: { content: readonly { text: string }[] }) => {
      calls.inject.push({ sessionId, text: message.content[0]?.text ?? '' })
    },
  }
}

/** The recorded Session-layer effects of one mounted plugin, with its doubles. */
export function sessionLayer(): SessionLayer {
  const calls: SessionCalls = { created: [], followup: [], inject: [], model: [], flush: 0 }
  return {
    calls,
    services: {
      agents: { withoutInitiator: <T>(work: () => T): T => work() },
      sessions: { flush: async () => { calls.flush += 1; return true } },
      sessionController: {
        async create(request: Record<string, unknown>) {
          calls.created.push(request)
          return { sessionId: 'session-created-1' }
        },
        async resolveAgent(sessionId: string) {
          return { agent: fakeAgent(sessionId, calls) }
        },
        async selectModel(request: Record<string, unknown>) {
          calls.model.push(request)
        },
      },
    },
  }
}

/** A ready-made appReady service that records its listener and commits on demand. */
export interface AppReadyDouble {
  readonly service: AppReady
  commit(): void
  readonly committed: boolean
}

export function appReadyStub(): AppReadyDouble {
  const listeners = new Set<() => void>()
  let committed = false
  return {
    service: {
      onReady(listener: () => void): () => void {
        if (committed) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit(): void {
      committed = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
    get committed(): boolean { return committed },
  }
}

/**
 * Mount the storage stack and then the plugin on one real Cordis root.
 *
 * Activation is awaited, but the startup drive is not: a spec that wants the
 * drive finished waits for it itself, because only that spec knows whether the
 * trigger has fired yet.
 *
 * 在一个真实 Cordis 根上挂载存储栈，然后挂载插件。
 *
 * 这里只等激活完成，不等启动驱动结束：想让驱动跑完的用例自己等，因为只有用例知道触发是否
 * 已经发生。
 *
 * @param options - the storage root, the launcher signal, and a storage stub.
 * @returns the root context and the recorded Session-layer effects.
 */
export async function boot(options: {
  readonly root: string
  readonly appReady?: AppReadyDouble
  readonly storageDomain?: Partial<Context['storageDomain']>
}): Promise<{ ctx: Context; layer: SessionLayer }> {
  const ctx = new Context()
  const layer = sessionLayer()
  provideStub(ctx, 'agents', layer.services.agents)
  provideStub(ctx, 'sessions', layer.services.sessions)
  provideStub(ctx, 'sessionController', layer.services.sessionController)
  if (options.appReady !== undefined) provideStub(ctx, 'appReady', options.appReady.service)
  if (options.storageDomain !== undefined) {
    provideStub(ctx, 'storageDomain', options.storageDomain)
  } else {
    // Each storage layer is awaited in order. The service injects
    // `storageDomain`, and awaiting only the service fiber leaves the domain
    // plugin still loading when the service resolves, so the service stays
    // pending and never registers.
    // 每一层存储都按序 await。服务注入 `storageDomain`；只 await 服务 fiber 时，
    // domain 插件仍在加载，服务因此永远 pending，不会注册。
    await ctx.plugin(Storage.default)
    await ctx.plugin(StorageJson, { root: options.root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
  }
  const fiber = ctx.plugin(StartupAutostartService)
  await fiber
  return { ctx, layer }
}
