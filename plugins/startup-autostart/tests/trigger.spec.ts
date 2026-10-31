/**
 * The startup trigger: when a drive fires, how often, and what happens when the
 * launcher signal or the storage layer is missing.
 *
 * 启动触发器：驱动何时发生、发生几次，以及启动器信号或存储层缺失时的表现。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import StartupAutostartService from '../src/index.ts'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import {
  appReadyStub, boot, cleanupTempRoots, item, provideStub, seed, sessionLayer, settle, tempRoot,
} from './harness.ts'

afterEach(cleanupTempRoots)

describe('startup trigger', () => {
  it('drives on plugin activation when the launcher provides no appReady', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-a', name: 'wake the desk', action: 'new_session', cwd: 'C:/work', message: 'start the day' })])
    const { ctx, layer } = await boot({ root })
    await settle(ctx, 1)

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
    await settle(ctx, 1)
    expect(layer.calls.followup).toHaveLength(1)

    // A second commit, and a late subscriber on the same activated service, must
    // not deliver again: the latch is what makes one drive per activation.
    ready.commit()
    ctx.get('appReady')?.onReady(() => {})
    await settle(ctx, 1)
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
    await settle(ctx, 1)
    expect((await ctx.startupAutostart.catalog())[0]?.runCount).toBe(1)
    await ctx.fiber.dispose()

    // A reload is a new activated service with its own latch, so it drives
    // again. That is the intended trade: no debounce anywhere, including here.
    // 重载是一个带自有闩锁的新激活服务，因此它会再驱动一次。这就是权衡所在：哪里都没有防抖。
    const { ctx: another } = await boot({ root, appReady: ready })
    // The second drive re-runs the same row, so its count is already 2; waiting
    // for 2 on the new context covers both starts.
    // 第二轮驱动重跑同一行，因此计数已是 2；在新上下文上等 2 即覆盖两次启动。
    await settle(another, 2)
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
    await ctx.plugin(Storage.default)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(StartupAutostartService)
    await settle(ctx, 1)

    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.lastOutcome?.status).toBe('failed')
    expect(stored[0]?.lastOutcome?.detail).toContain('persistence')
    await ctx.fiber.dispose()
  })

  it('stays inert and loud-but-harmless when the storage domain cannot open', async () => {
    const root = tempRoot()
    const ctx = new Context()
    const layer = sessionLayer()
    provideStub(ctx, 'agents', layer.services.agents)
    provideStub(ctx, 'sessions', layer.services.sessions)
    provideStub(ctx, 'sessionController', layer.services.sessionController)
    provideStub(ctx, 'storageDomain', { open: async () => { throw new Error('backend "json" is missing') } })
    await ctx.plugin(StartupAutostartService)
    // A closed storage domain means no item is ever delivered, so the drive is
    // over as soon as activation finished. 存储域打不开意味着永不投递，因此激活一结束驱动就结束了。
    expect(layer.calls.created).toHaveLength(0)

    await expect(ctx.startupAutostart.catalog()).rejects.toMatchObject({ code: 'storage_unavailable' })
    await expect(ctx.startupAutostart.create({ name: 'x', action: 'resume_session', sessionId: 's' }))
      .rejects.toMatchObject({ code: 'storage_unavailable' })
    await ctx.fiber.dispose()
    expect(root).toBeTruthy()
  })
})
