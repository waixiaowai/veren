/**
 * Storage-domain lifecycle across reloads.
 *
 * The forum service owns one open domain handle. A live reinstall, a hot reload,
 * or a second activation must not turn the leftover handle into the permanent
 * "domain 'forum' is already open" failure that disables the whole forum. These
 * specs mount the real storage stack and drive the same activation shapes a
 * booting Harness does.
 *
 * 重载之间的存储域生命周期。
 *
 * 论坛服务持有一个已打开的域句柄。热重装、热重载或第二次激活，都不能让上一次遗留的
 * 句柄变成「domain 'forum' is already open」这种永久性失败，从而让整个论坛不可用。
 * 这些用例挂载真实的存储栈，并驱动与启动中的 Harness 相同的激活形态。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ForumService from '../src/index.ts'
import { forumDomain } from '../src/storage.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forum-lifecycle-'))
  roots.push(root)
  return root
}

/**
 * Publish one Host-service double the forum only reads.
 *
 * The forum's contract with these services is narrow, so the doubles implement
 * only the members an inactive auto-post runner and a catalog read touch; the
 * storage stack stays real.
 * @param ctx - root context receiving the service.
 * @param name - service key being replaced.
 * @param value - the members the forum calls.
 */
function provideStub<K extends string & keyof Context>(ctx: Context, name: K, value: object): void {
  ctx.provide(name, value as Context[K])
}

/**
 * Mount the real storage stack plus the forum service on one fresh root.
 * @param root - directory serving the JSON storage backend.
 * @returns the root context after every plugin settled.
 */
async function boot(root: string): Promise<Context> {
  const ctx = new Context()
  provideStub(ctx, 'agents', { get: () => undefined })
  provideStub(ctx, 'sessions', { flush: async () => true })
  provideStub(ctx, 'systemPrompt', { context: () => () => {} })
  provideStub(ctx, 'tools', { register: () => () => {} })
  provideStub(ctx, 'agentPresets', { list: async () => [] })
  provideStub(ctx, 'llm', {})
  // Declared hard injects of the service (G13): minimal slices for the paths
  // these specs drive (no board resolution, no drafting selection).
  // 服务的声明的硬 inject（G13）：为这些用例驱动的路径提供最小切片（无板块解析、无起草选择）。
  provideStub(ctx, 'workingDirectory', { get: () => undefined })
  provideStub(ctx, 'workspaceRegistry', { list: () => [] })
  provideStub(ctx, 'agentDefaultModel', { currentSelection: () => undefined })
  // The app registry is a hard inject of the forum service; the real service
  // keeps the app registration under test honest. The registry service is
  // constructed on its own host context, as the real host assembly does.
  // 应用注册表是论坛服务的硬注入；用真实服务让应用注册路径也处在被测状态。
  // 注册表服务构造在自己的宿主上下文上，与真实宿主装配一致。
  ctx.provide('apps', new AppRegistryService(new Context()))
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

describe('forum storage lifecycle', () => {
  it('takes over a domain left open by a previous activation and reads three times', async () => {
    const ctx = await boot(tempRoot())
    // Exactly the state a prior activation that never closed its handle leaves.
    const leftover = await ctx.storageDomain.open(forumDomain)

    const fiber = ctx.plugin(ForumService)
    await fiber

    for (let read = 0; read < 3; read += 1) {
      await expect(ctx.forum.catalog({})).resolves.toMatchObject({ boards: [] })
    }
    expect(ctx.storageDomain.get('forum')).not.toBe(leftover)

    await fiber.dispose()
    expect(ctx.storageDomain.get('forum')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('reopens the domain across a hot reload and still reads the thread', async () => {
    const ctx = await boot(tempRoot())
    const fiber = ctx.plugin(ForumService)
    await fiber
    const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: '/work' })
    const published = await ctx.forum.publish({
      boardId: board.id,
      author: 'standard',
      title: 'hello',
      body: 'first post',
    })
    await ctx.forum.comment({ postId: published.value.id, author: 'ptc', body: 'first reply' })

    await fiber.restart()

    const detail = await ctx.forum.post({ postId: published.value.id, reader: 'standard' })
    expect(detail.post.title).toBe('hello')
    expect(detail.body).toBe('first post')
    expect(detail.comments.map(node => node.body)).toEqual(['first reply'])

    await fiber.dispose()
    expect(ctx.storageDomain.get('forum')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
