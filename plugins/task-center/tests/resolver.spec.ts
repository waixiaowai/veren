/**
 * resolver 接线契约（装配层接上之后的语义）。
 * Resolver wiring contract — the semantics after app-host (or a test) wires it.
 *
 * 显式接线是唯一路径：`setAppResolver` 由宿主装配层（app-host）在装配时调用。
 * 未接线时 send 只告警放行（应用校验缺位的既有降级）；接线后：应用未注册 →
 * `task/send-forbidden`；应用从注册表消失 → 懒孤儿判定把 open/taken 翻成
 * `orphaned`（§7.4，进程重启安全）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterPlugin from '../src/index.ts'
import type { AppResolver, AppSnapshot, TaskCenterService } from '../src/index.ts'
import type { TaskDraft } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function draft(appId: string): TaskDraft {
  return {
    kind: `${appId}/kind` as TaskDraft['kind'],
    title: 't',
    target: { url: `/apps/${appId}/p/1` as PageInstanceKey, appId, page: 'p', params: {} },
  }
}

/** 起真实存储栈 + 任务中心（不预接 resolver；用例自行 setAppResolver） */
async function boot(): Promise<{ ctx: Context; tasks: TaskCenterService; warn: ReturnType<typeof vi.spyOn> }> {
  const root = mkdtempSync(join(tmpdir(), 'task-center-resolver-'))
  roots.push(root)
  const ctx = new Context()
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', { register: () => () => {} })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation((_message?: string) => undefined)
  await ctx.plugin(TaskCenterPlugin)
  return { ctx, tasks: ctx.taskCenter as TaskCenterService, warn }
}

describe('resolver 接线契约（app-host 显式装配）', () => {
  it('未接线 → 只告警放行（校验缺位的既有降级）', async () => {
    const { tasks, warn } = await boot()
    const record = await tasks.send(draft('no-registry'))
    expect(record.status).toBe('open')
    expect(warn.mock.calls.some(([message]: unknown[]) => String(message).includes('no app resolver wired'))).toBe(true)
  })

  it('显式接线：应用未注册 → send 拒绝；注册后放行；禁用后拒绝', async () => {
    const { tasks } = await boot()
    const registered = new Map<string, { state: 'active' | 'disabled' | 'broken'; version: string }>()
    const resolver: AppResolver = async (appId): Promise<AppSnapshot | undefined> => registered.get(appId)
    tasks.setAppResolver(resolver)
    await expect(tasks.send(draft('ghost'))).rejects.toMatchObject({ code: 'task/send-forbidden' })
    registered.set('real', { state: 'active', version: '1.0.0' })
    const record = await tasks.send(draft('real'))
    expect(record.appVersion).toBe('1.0.0')
    registered.set('real', { state: 'disabled', version: '1.0.0' })
    await expect(tasks.send(draft('real'))).rejects.toMatchObject({ code: 'task/send-forbidden' })
  })

  it('卸载语义：接线后应用消失，下次操作把 open/taken 判成 orphaned（§7.4）', async () => {
    const { tasks } = await boot()
    const registered = new Map<string, { state: 'active' | 'disabled' | 'broken'; version: string }>([
      ['real', { state: 'active', version: '1.0.0' }],
    ])
    tasks.setAppResolver(async (appId): Promise<AppSnapshot | undefined> => registered.get(appId))
    const record = await tasks.send(draft('real'))
    const taken = await tasks.take(record.id, { sessionId: 's-1', actor: 'agent', leaseUntil: new Date(Date.now() + 60_000).toISOString() })
    expect(taken.status).toBe('taken')
    registered.delete('real') // 应用卸载
    const after = await tasks.get(record.id) // 下一次操作触发懒清扫
    expect(after?.status).toBe('orphaned')
  })
})
