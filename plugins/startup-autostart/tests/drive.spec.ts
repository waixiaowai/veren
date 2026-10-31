/**
 * Every successful start runs the item: no run history, cooldown, or restart
 * gap ever suppresses the next drive.
 *
 * 每次成功启动都会执行启动项：任何运行历史、冷却或重启间隔都不会压掉下一次驱动。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { boot, cleanupTempRoots, item, seed, settle, tempRoot } from './harness.ts'

afterEach(cleanupTempRoots)

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
    await settle(ctx, 4)

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
    await settle(first.ctx, 1)
    expect(first.layer.calls.created).toHaveLength(1)
    expect((await first.ctx.startupAutostart.catalog())[0]?.runCount).toBe(1)
    await first.ctx.fiber.dispose()

    const second = await boot({ root })
    await settle(second.ctx, 2)
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
    await settle(ctx, 8)

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

    // No enabled item means no run stamp, so the drive's completion is observed
    // through the drive itself: nothing is delivered and the count stays put.
    // The catalog is read before disposal, because disposing unregisters the
    // service by design.
    // 没有启用项就没有运行戳记，因此驱动结束由驱动自身表明：什么都不投递，计数不变。
    // 先读目录再卸载：卸载本就会注销该服务。
    expect(layer.calls.created).toHaveLength(0)
    expect((await ctx.startupAutostart.catalog())[0]?.runCount).toBe(0)
    await ctx.fiber.dispose()
  })
})
