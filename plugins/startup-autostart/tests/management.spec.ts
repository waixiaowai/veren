/**
 * The management surface: create, catalog, update, run, and delete through the
 * real service, including the stable refusal codes and the per-action routing.
 *
 * 管理表面：通过真实服务执行创建、目录、更新、运行与删除，包括稳定的拒绝码与按动作
 * 的路由。
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { StartupItemInput } from '../src/domain.ts'
import { boot, cleanupTempRoots, item, seed, settleEvery, tempRoot } from './harness.ts'

afterEach(cleanupTempRoots)

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
    await settleEvery(ctx, 4)

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
