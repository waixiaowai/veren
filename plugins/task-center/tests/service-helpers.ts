/**
 * Shared fixtures for the TaskCenterService behavior specs: every spec boots
 * a fresh temporary JSON storage root, so specs are safe under concurrent
 * vitest workers and never touch the repository. The service is exercised
 * through its public contract; app checks go through the lazily wired
 * resolver (session A is not required).
 *
 * TaskCenterService 行为测试的共享夹具：每个用例都启动全新的临时 JSON 存储根目录，
 * 并发 worker 下安全，也不会碰仓库。应用校验走惰性接线的 resolver，不要求会话 A 的实现。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterPlugin from '../src/index.ts'
import type { TaskDraft, TaskKind } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'task-center-'))
  roots.push(root)
  return root
}

function provideStub<K extends string & keyof Context>(ctx: Context, name: K, value: object): void {
  ctx.provide(name, value as Context[K])
}

/** Boot the real storage stack plus the task center on one fresh root. */
export async function boot(root: string): Promise<{ ctx: Context; fiber: Promise<unknown>; dispose: () => Promise<void> }> {
  const ctx = new Context()
  provideStub(ctx, 'tools', { register: () => () => {} })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = ctx.plugin(TaskCenterPlugin)
  return {
    ctx,
    fiber: fiber as unknown as Promise<unknown>,
    // 只卸插件 fiber；根 fiber 连着存储栈，留给断言用 / only the plugin fiber; keep storage
    dispose: async () => { await fiber.then(f => f.dispose()) },
  }
}

export const HOUR = 60 * 60 * 1000

export function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    kind: 'review-workbench/review-request' as TaskKind,
    title: 'Review PR #42',
    target: {
      url: '/apps/review-workbench/review/pr-42' as PageInstanceKey,
      appId: 'review-workbench',
      page: 'review',
      params: { pr: '42' },
    },
    ...overrides,
  }
}

export function errorOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => { throw new Error('expected the call to throw') },
    (error: { code?: string }) => error.code ?? String(error),
  )
}
