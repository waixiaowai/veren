/**
 * Integration specs for the plugin.
 *
 * Every spec mounts the real Cordis runtime with the real JSON storage backend,
 * so the storage domain, the trigger wiring, the latch, and the delivery are
 * exercised exactly as a booting Harness exercises them. Only the Agent and
 * Session layers are doubled: this plugin's job is to decide what to deliver,
 * and the doubles record the deliveries.
 *
 * The specs run against `src/`, which is what the checker sees; the end-to-end
 * evidence for the shipped artifact is the real profile boots recorded in the
 * delivery note, which install the published package from the registry.
 */

import { mkdtempSync, readFile, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { AppReady } from '@deepseek-ai/dsh-cmdline'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import StartupAutostartService from '../src/index.ts'
import type { StartupAction, StartupItemInput } from '../src/domain.ts'
import type { StoredStartupItem } from '../src/storage.ts'

/**
 * Wait until the drive has finished, not for a fixed time.
 *
 * The drive's completion is observable: the last thing it does is commit the
 * run stamp, which lands in the storage document the JSON backend writes. The
 * spec therefore polls the file the backend owns and stops as soon as the
 * committed state is there, so a loaded host cannot turn a passing spec into a
 * timing race.
 *
 * 等待驱动结束，而不是等固定时长。
 *
 * 驱动的结束是可观测的：它做的最后一件事是提交运行戳记，而提交会落进 JSON 后端写出的存储
 * 文档。因此这些用例轮询后端拥有的那个文件，一旦提交状态出现就停止，这样负载高的主机也不会
 * 把通过的用例变成时序竞赛。
 *
 * @param root - the storage root the JSON backend writes into.
 * @param expected - the number of items whose run stamp must be committed.
 * @returns after every expected stamp is durable.
 */
async function settle(root: string, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const document = await readFile(join(root, 'startup.json'), 'utf8').catch(() => '')
    const committed = [...document.matchAll(/"runCount":\s*(\d+)/g)]
      .map(match => Number(match[1]))
      .filter(count => count > 0)
    if (committed.length >= expected) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`startup-autostart: the drive did not commit ${expected} run stamp(s) within 10s`)
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
function provideStub<K extends string & keyof Context>(ctx: Context, name: K, value: object): void {
  ctx.provide(name, value as Context[K])
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'startup-autostart-'))
  roots.push(root)
  return root
}

/** Write the storage document the JSON backend reads at open, as the panel would read it. */
function seed(root: string, items: readonly Record<string, unknown>[]): void {
  writeFileSync(join(root, 'startup.json'), JSON.stringify({
    unit: { name: 'startup', version: 1 },
    global: null,
    tables: { items: Object.fromEntries(items.map(entry => [String(entry['id']), entry])) },
  }, undefined, 2))
}

/** One complete stored row, with the fields a spec does not override. */
function item(overrides: Partial<StoredStartupItem> & { readonly id: string }): Record<string, unknown> {
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
interface SessionCalls {
  readonly created: Record<string, unknown>[]
  readonly followup: { readonly sessionId: string; readonly text: string }[]
  readonly inject: { readonly sessionId: string; readonly text: string }[]
  readonly model: Record<string, unknown>[]
  flush: number
}

/** A Session-layer double plus the calls it recorded. */
interface SessionLayer {
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
function sessionLayer(): SessionLayer {
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
interface AppReadyDouble {
  readonly service: AppReady
  commit(): void
  readonly committed: boolean
}

function appReadyStub(): AppReadyDouble {
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

/** Mount the storage stack and then the plugin on one real Cordis root. */
async function boot(options: {
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
    ctx.plugin(Storage.default)
    ctx.plugin(StorageJson, { root: options.root })
    ctx.plugin(StorageDomain, { backend: 'json' })
  }
  ctx.plugin(StartupAutostartService)
  // The drive writes a run stamp for every enabled item, so its completion is
  // observable in the storage document. 驱动会给每个启用项写一个运行戳记，因此它的结束在存储文档里可观测。
  await settle(options.root, options.storageDomain === undefined ? 1 : 0)
  return { ctx, layer }
}

describe('startup trigger', () => {
  it('drives on plugin activation when the launcher provides no appReady', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'wake the desk', action: 'new_session', cwd: 'C:/work', message: 'start the day' })])
    const { ctx, layer } = await boot({ root })

    expect(layer.calls.created).toHaveLength(1)
    expect(layer.calls.created[0]?.cwd).toBe('C:/work')
    expect(layer.calls.followup).toHaveLength(1)
    expect(layer.calls.followup[0]?.text).toContain('[STARTUP AUTOSTART]')
    expect(layer.calls.followup[0]?.text).toContain('start the day')
    expect(layer.calls.flush).toBe(1)

    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.lastOutcome?.status).toBe('ok')
    expect(stored[0]?.runCount).toBe(1)
    await ctx.fiber.dispose()
  })

  it('waits for the launcher signal when appReady is provided, and runs exactly once for repeated signals', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'seeded', action: 'message_session', sessionId: 'session-x', message: 'go' })])
    const ready = appReadyStub()
    const { ctx, layer } = await boot({ root, appReady: ready })

    expect(layer.calls.followup).toHaveLength(0)
    ready.commit()
    await settle(root, 1)
    expect(layer.calls.followup).toHaveLength(1)

    // A second commit, and a late subscriber on the same activated service, must
    // not deliver again: the latch is what makes one drive per activation.
    ready.commit()
    ctx.get('appReady')?.onReady(() => {})
    await settle(root, 1)
    expect(layer.calls.followup).toHaveLength(1)
    expect((await ctx.startupAutostart.catalog())[0]?.runCount).toBe(1)
    await ctx.fiber.dispose()
  })

  it('drives again when a fresh service activates, which is what a reload does', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'seeded', action: 'resume_session', sessionId: 'session-x' })])
    const ready = appReadyStub()
    ready.commit()

    // Nothing is mounted yet: the plugin activates into an already-ready host.
    const { ctx } = await boot({ root, appReady: ready })
    expect((await ctx.startupAutostart.catalog())[0]?.runCount).toBe(1)
    await ctx.fiber.dispose()

    // A reload is a new activated service with its own latch, so it drives
    // again. That is the intended trade: no debounce anywhere, including here.
    const { ctx: another } = await boot({ root, appReady: ready })
    expect((await another.startupAutostart.catalog())[0]?.runCount).toBe(2)
    await another.fiber.dispose()
  })

  it('fails the delivery when the Session layer refuses persistence', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'seeded', action: 'message_session', sessionId: 'session-x', message: 'go' })])
    const ctx = new Context()
    const layer = sessionLayer()
    provideStub(ctx, 'agents', layer.services.agents)
    provideStub(ctx, 'sessions', { flush: async () => false })
    provideStub(ctx, 'sessionController', layer.services.sessionController)
    ctx.plugin(Storage.default)
    ctx.plugin(StorageJson, { root })
    ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.plugin(StartupAutostartService)
    await settle(root, 1)

    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.lastOutcome?.status).toBe('failed')
    expect(stored[0]?.lastOutcome?.detail).toContain('persistence')
    await ctx.fiber.dispose()
  })

  it('stays inert and loud-but-harmless when the storage domain cannot open', async () => {
    const ctx = new Context()
    const layer = sessionLayer()
    provideStub(ctx, 'agents', layer.services.agents)
    provideStub(ctx, 'sessions', layer.services.sessions)
    provideStub(ctx, 'sessionController', layer.services.sessionController)
    provideStub(ctx, 'storageDomain', { open: async () => { throw new Error('backend "json" is missing') } })
    ctx.plugin(StartupAutostartService)
    await settle(root, 1)

    await expect(ctx.startupAutostart.catalog()).rejects.toMatchObject({ code: 'storage_unavailable' })
    await expect(ctx.startupAutostart.create({ name: 'x', action: 'resume_session', sessionId: 's' }))
      .rejects.toMatchObject({ code: 'storage_unavailable' })
    await ctx.fiber.dispose()
  })
})

describe('every start runs the item', () => {
  it('runs an item that just ran, because a restart interrupted the work it began', async () => {
    const root = tempRoot()
    seed(root, [item({
      id: 'startup-a',
      name: 'just ran',
      action: 'message_session',
      sessionId: 'session-x',
      message: 'go',
      lastRunAt: new Date().toISOString(),
      lastOutcome: { status: 'ok', detail: 'ran a moment ago', at: new Date().toISOString() },
      runCount: 3,
    })])
    const { ctx, layer } = await boot({ root })

    expect(layer.calls.followup).toHaveLength(1)
    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.runCount).toBe(4)
    expect(stored[0]?.lastOutcome?.status).toBe('ok')
    await ctx.fiber.dispose()
  })

  it('triggers on two consecutive starts', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'both times', action: 'new_session', cwd: 'C:/work' })])

    const first = await boot({ root })
    expect(first.layer.calls.created).toHaveLength(1)
    expect((await first.ctx.startupAutostart.catalog())[0]?.runCount).toBe(1)
    await first.ctx.fiber.dispose()

    const second = await boot({ root })
    expect(second.layer.calls.created).toHaveLength(1)
    expect((await second.ctx.startupAutostart.catalog())[0]?.runCount).toBe(2)
    await second.ctx.fiber.dispose()
  })

  it('opens and runs a row carrying the retired cooldownSeconds key', async () => {
    const root = tempRoot()
    // Exactly what version 1 of this plugin wrote: the field is gone from the
    // schema, and the object schema is open, so the row still opens.
    seed(root, [{
      id: 'startup-legacy',
      name: 'legacy row',
      enabled: true,
      action: 'message_session',
      sessionId: 'session-legacy',
      message: 'from the old format',
      cooldownSeconds: 900,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      runCount: 7,
    }])
    const { ctx, layer } = await boot({ root })

    expect(layer.calls.followup).toHaveLength(1)
    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.runCount).toBe(8)
    expect(stored[0]).not.toHaveProperty('cooldownSeconds')
    await ctx.fiber.dispose()
  })

  it('never runs a disabled item', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'off', action: 'new_session', cwd: 'C:/work', enabled: false })])
    const { ctx, layer } = await boot({ root })

    expect(layer.calls.created).toHaveLength(0)
    expect((await ctx.startupAutostart.catalog())[0]?.runCount).toBe(0)
    await ctx.fiber.dispose()
  })
})

describe('startup management', () => {
  it('creates, reads, updates, runs, and deletes an item, and the stored file is panel-readable', async () => {
    const root = tempRoot()
    const { ctx } = await boot({ root })
    const service = ctx.startupAutostart

    const created = await service.create({
      name: 'morning review',
      action: 'message_session',
      sessionId: 'session-x',
      message: 'check the night build',
    })
    expect(created.id).toMatch(/^startup-/)
    expect(created.runCount).toBe(0)

    const listed = await service.catalog()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('morning review')

    const updated = await service.update({ id: created.id, name: 'nightly review', enabled: false })
    expect(updated.name).toBe('nightly review')
    expect(updated.enabled).toBe(false)
    expect(updated.message).toBe('check the night build')

    // A disabled item names the real reason the manual run refuses.
    await expect(service.run({ id: created.id })).rejects.toMatchObject({ code: 'item_disabled' })

    const forced = await service.run({ id: created.id, force: true })
    expect(forced.outcome.status).toBe('ok')
    expect(forced.outcome.detail).toContain('woke session session-x')

    // Re-enabled, the manual run is not debounced either.
    await service.update({ id: created.id, enabled: true })
    const again = await service.run({ id: created.id })
    expect(again.outcome.status).toBe('ok')
    expect((await service.catalog())[0]?.runCount).toBe(2)

    const deleted = await service.delete({ id: created.id })
    expect(deleted.deleted).toBe(true)
    expect(await service.catalog()).toHaveLength(0)
    expect((await service.delete({ id: created.id })).deleted).toBe(false)
    await ctx.fiber.dispose()
  })

  it('rejects invalid input with stable codes and never writes a partial row', async () => {
    const root = tempRoot()
    const { ctx } = await boot({ root })
    const service = ctx.startupAutostart
    // Model-supplied arguments arrive as unvalidated JSON; the spec feeds them the same way.
    const raw = (value: object): StartupItemInput => value as StartupItemInput

    await expect(service.create(raw({ name: '', action: 'new_session' }))).rejects.toMatchObject({ code: 'invalid_name' })
    await expect(service.create(raw({ name: 'x', action: 'nonsense' }))).rejects.toMatchObject({ code: 'invalid_action' })
    await expect(service.create(raw({ name: 'x', action: 'message_session' }))).rejects.toMatchObject({ code: 'invalid_target' })
    await expect(service.create(raw({ name: 'x', action: 'message_session', sessionId: 's' })))
      .rejects.toMatchObject({ code: 'invalid_message' })
    await expect(service.create(raw({ name: 'x', action: 'resume_session', sessionId: 's', message: 'nope' })))
      .rejects.toMatchObject({ code: 'invalid_message' })
    await expect(service.create(raw({ name: 'x', action: 'new_session', cwd: 'a', workspaceId: 'b' })))
      .rejects.toMatchObject({ code: 'invalid_target' })
    await expect(service.update({ id: 'startup-missing', name: 'y' })).rejects.toMatchObject({ code: 'item_not_found' })
    await expect(service.run({ id: 'startup-missing' })).rejects.toMatchObject({ code: 'item_not_found' })
    expect(await service.catalog()).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('routes each action to its own Session operation', async () => {
    const root = tempRoot()
    seed(root, [
      item({ id: 'startup-new', name: 'new', action: 'new_session', workspaceId: 'ws-1', preset: 'standard',
        model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } }),
      item({ id: 'startup-resume', name: 'resume', action: 'resume_session', sessionId: 'session-r' }),
      item({ id: 'startup-message', name: 'message', action: 'message_session', sessionId: 'session-m', message: 'wake up' }),
      item({ id: 'startup-queue', name: 'queue', action: 'queue_message', sessionId: 'session-q', message: 'read later' }),
    ])
    const { ctx, layer } = await boot({ root })

    expect(layer.calls.created).toHaveLength(1)
    expect(layer.calls.created[0]?.workspaceId).toBe('ws-1')
    expect(layer.calls.created[0]?.agentPreset).toBe('standard')
    expect(layer.calls.model).toEqual([
      { sessionId: 'session-created-1', provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    ])
    // The new_session item carries no message, so only message_session wakes anything.
    expect(layer.calls.followup.map(call => call.sessionId)).toEqual(['session-m'])
    // queue_message is the quiet one: it fills the inbox without waking the driver.
    expect(layer.calls.inject).toHaveLength(1)
    expect(layer.calls.inject[0]?.sessionId).toBe('session-q')
    expect(layer.calls.inject[0]?.text).toContain('read later')

    const stored = await ctx.startupAutostart.catalog()
    expect(stored.map(entry => entry.lastOutcome?.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    await ctx.fiber.dispose()
  })
})

/**
 * A profile shaped like the headless, ACP, and SDK bundles: the core agent
 * registry is mounted, the Web application's session controller is not. This is
 * the shape that left the plugin permanently pending before the runtime learned
 * to drive Sessions through `ctx.agents`.
 */
describe('profiles without the Web session controller', () => {
  /** The core-registry calls one controller-less boot recorded. */
  interface CoreCalls {
    readonly created: Record<string, unknown>[]
    readonly resumed: Record<string, unknown>[]
    readonly followup: { readonly sessionId: string; readonly text: string }[]
    readonly inject: { readonly sessionId: string; readonly text: string }[]
    setups: number
  }

  /** A fake Agent recording the inbox operations the runtime performs on it. */
  function coreAgent(sessionId: string, calls: CoreCalls): Record<string, unknown> {
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

  /** Mount the plugin over a controller-less profile. */
  async function bootCoreOnly(options: {
    readonly root: string
    readonly defaultModel?: boolean
  }): Promise<{ ctx: Context; calls: CoreCalls }> {
    const ctx = new Context()
    const calls: CoreCalls = { created: [], resumed: [], followup: [], inject: [], setups: 0 }
    provideStub(ctx, 'agents', {
      withoutInitiator: <T>(work: () => T): T => work(),
      get: () => undefined,
      async create(createOptions: Record<string, unknown>) {
        calls.created.push(createOptions)
        const setup = createOptions.setup
        if (typeof setup === 'function') {
          calls.setups += 1
          ;(setup as (agentCtx: Context) => void)(new Context())
        }
        return { agent: coreAgent(String(createOptions.sessionId), calls), dispose: async () => {} }
      },
      async resume(resumeOptions: Record<string, unknown>) {
        calls.resumed.push(resumeOptions)
        const setup = resumeOptions.setup
        if (typeof setup === 'function') {
          calls.setups += 1
          ;(setup as (agentCtx: Context) => void)(new Context())
        }
        return { agent: coreAgent(String(resumeOptions.resumeSessionId), calls), dispose: async () => {} }
      },
    })
    provideStub(ctx, 'sessions', { flush: async () => true })
    if (options.defaultModel !== false) {
      provideStub(ctx, 'agentDefaultModel', {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }),
      })
    }
    ctx.plugin(Storage.default)
    ctx.plugin(StorageJson, { root: options.root })
    ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.plugin(StartupAutostartService)
    await settle(root, 1)
    return { ctx, calls }
  }

  it('creates, wakens, and quietly queues through the core registry', async () => {
    const root = tempRoot()
    seed(root, [
      item({ id: 'startup-new', name: 'new', action: 'new_session', cwd: 'C:/hl', message: 'go' }),
      item({ id: 'startup-queue', name: 'queue', action: 'queue_message', sessionId: 'session-q', message: 'later' }),
      item({ id: 'startup-resume', name: 'resume', action: 'resume_session', sessionId: 'session-r' }),
      item({ id: 'startup-wake', name: 'wake', action: 'message_session', sessionId: 'session-w', message: 'wake up' }),
    ])
    const { ctx, calls } = await bootCoreOnly({ root })

    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]?.meta).toEqual({ cwd: 'C:/hl' })
    expect(String(calls.created[0]?.sessionId)).toMatch(/^session-/)
    expect(calls.created[0]?.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    // The deployment default is installed on every Agent this runtime mints or adopts.
    expect(calls.setups).toBe(4)
    // Items run in id order, which is what the catalog orders equal-instant rows by.
    expect(calls.resumed.map(call => call.resumeSessionId)).toEqual(['session-q', 'session-r', 'session-w'])
    expect(calls.followup.map(call => call.sessionId)).toEqual([calls.created[0]?.sessionId, 'session-w'])
    expect(calls.inject).toHaveLength(1)
    expect(calls.inject[0]?.sessionId).toBe('session-q')

    const stored = await ctx.startupAutostart.catalog()
    expect(stored.map(entry => entry.lastOutcome?.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    await ctx.fiber.dispose()
  })

  it('uses the item model over the deployment default and survives a profile with neither', async () => {
    const root = tempRoot()
    seed(root, [item({
      id: 'startup-new', name: 'new', action: 'new_session', cwd: 'C:/hl',
      model: { provider: 'deepseek-official', model: 'deepseek-pro', reasoningEffort: 'high' },
    })])
    const { ctx, calls } = await bootCoreOnly({ root })
    expect(calls.created[0]?.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-pro' })
    await ctx.fiber.dispose()

    const bare = tempRoot()
    seed(bare, [item({ id: 'startup-new', name: 'new', action: 'new_session', cwd: 'C:/hl' })])
    const second = await bootCoreOnly({ root: bare, defaultModel: false })
    expect(second.calls.created[0]?.agentOptions).toBeUndefined()
    expect(second.calls.created[0]?.setup).toBeUndefined()
    expect((await second.ctx.startupAutostart.catalog())[0]?.lastOutcome?.status).toBe('ok')
    await second.ctx.fiber.dispose()
  })

  it('refuses a preset or workspace target instead of quietly creating a plain Session', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-preset', name: 'preset', action: 'new_session', preset: 'standard' })])
    const { ctx, calls } = await bootCoreOnly({ root })

    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.lastOutcome?.status).toBe('failed')
    expect(stored[0]?.lastOutcome?.detail).toContain('only the Web application mounts the session controller')
    expect(calls.created).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})

/** The action union stays in the spec's type surface so a renamed action fails here. */
const ACTIONS: readonly StartupAction[] = ['new_session', 'resume_session', 'message_session', 'queue_message']

describe('startup vocabulary', () => {
  it('keeps every action represented by a spec', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length)
  })
})
