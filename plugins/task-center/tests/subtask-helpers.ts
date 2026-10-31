/**
 * Shared fixtures for the subtask specs (§4.7): boots over both media, draft
 * builders, and the error/grow drivers. Two media with two jobs:
 * persistence/restart semantics run the real JSON stack (a fresh temp root
 * per case, safe under concurrent workers); the safety limits only exercise
 * in-service tree arithmetic and run on the in-memory backend — hundreds of
 * bulk writes can no longer be dragged past vitest's default timeout by disk
 * fsync jitter (reproduced under sequential whole-repo runs).
 *
 * 子任务用例的共享夹具（§4.7）：两种介质的启动、草稿构造器与错误/建树驱动。两种介质
 * 各司其职：持久化/重启语义跑真实 JSON 栈（每个用例一份全新临时根，并发安全）；安全
 * 上限只关心服务里的树运算，跑内存后端——批量建树的几百次写不再被磁盘 fsync 抖动拖进
 * vitest 的默认超时（顺序整库跑下复现过的缺陷）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterPlugin from '../src/index.ts'
import type { TaskCenterService } from '../src/index.ts'
import type { TaskDraft, TaskKind, TaskRecord } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'
import { MemoryStorageBackend, mountMemoryBackend } from './fake-storage.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  // 假时钟不跨用例泄漏（用例中途失败也要还原）/ the fake clock must not leak
  // across cases (restore even on a mid-case failure)
  vi.useRealTimers()
})

export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'task-center-subtask-'))
  roots.push(root)
  return root
}

export async function boot(root: string): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} } as never)
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = ctx.plugin(TaskCenterPlugin)
  await fiber
  return { ctx, dispose: async () => { await (fiber as { dispose(): Promise<void> }).dispose() } }
}

/**
 * 内存介质启动：真实 hub + domain 栈，只有后端是 Map（见 fake-storage.ts）。
 * Memory-medium boot: the real hub and domain stack with a Map backend only
 * (see fake-storage.ts).
 */
export async function bootMemory(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} } as never)
  await ctx.plugin(Storage.default)
  mountMemoryBackend(ctx, new MemoryStorageBackend())
  await ctx.plugin(StorageDomain, { backend: 'memory' })
  const fiber = ctx.plugin(TaskCenterPlugin)
  await fiber
  return { ctx, dispose: async () => { await (fiber as { dispose(): Promise<void> }).dispose() } }
}

export const HOUR = 60 * 60 * 1000
export const lease = () => new Date(Date.now() + HOUR).toISOString()

export const URL = '/apps/review-workbench/review/pr-42' as PageInstanceKey

export function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    kind: 'review-workbench/review-request' as TaskKind,
    title: 'Review PR #42',
    target: { url: URL, appId: 'review-workbench', page: 'review', params: { pr: '42' } },
    ...overrides,
  }
}

/** 供 addSubtask 用的最小草稿：target 沿用父任务 / a minimal draft reusing the parent's target */
export function subDraft(task: TaskRecord, title: string): TaskDraft {
  return { kind: task.kind, title, target: task.target }
}

export function errorOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => { throw new Error('expected the call to throw') },
    (error: { code?: string }) => error.code ?? String(error),
  )
}

/** 建一棵 R → C → G 三层树 / build one R → C → G three-level tree */
export async function growTree(taskCenter: TaskCenterService): Promise<{ root: TaskRecord; child: TaskRecord; grandchild: TaskRecord }> {
  const root = await taskCenter.send(draft())
  const child = await taskCenter.addSubtask(root.id, subDraft(root, '拆出的子步骤'))
  const grandchild = await taskCenter.addSubtask(child.id, subDraft(child, '再拆一层'))
  return { root, child, grandchild }
}
