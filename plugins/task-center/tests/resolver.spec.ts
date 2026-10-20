/**
 * 缺口 2 收尾：与 app-registry 的接线。默认 resolver 结构探测宿主 `apps`
 * 服务（零配置）；`apps` 缺席 → 只告警放行（B 的既有行为）；应用不存在 →
 * 懒孤儿判定把 open/taken 翻成 orphaned（§7.4，进程重启安全）。
 * Gap-2 wiring: the default resolver probes the host `apps` service
 * structurally; absent service → warn-and-pass (existing behavior); missing
 * app → lazy orphan sweep on the next operation (§7.4).
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
import type { TaskCenterService } from '../src/index.ts'
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

/** 起真实存储栈 + 任务中心；apps 服务由用例自选提供与否 */
async function boot(options: { apps?: { get(id: string): { state: string; version: string } | undefined } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'task-center-resolver-'))
  roots.push(root)
  const ctx = new Context()
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', { register: () => () => {} })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  if (options.apps !== undefined) (ctx.provide as unknown as (n: string, v: unknown) => void)('apps', options.apps)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
  await ctx.plugin(TaskCenterPlugin)
  return { tasks: ctx.taskCenter as TaskCenterService, warn }
}

describe('默认 app resolver（结构探测）', () => {
  it('apps 服务缺席 → 只告警放行（既有降级不回退）', async () => {
    const { tasks, warn } = await boot()
    const record = await tasks.send(draft('no-registry'))
    expect(record.status).toBe('open')
    expect(warn.mock.calls.some(([message]) => String(message).includes('no app resolver wired'))).toBe(true)
  })

  it('apps 服务在、应用未注册 → send 拒绝；注册后放行', async () => {
    const registered = new Map<string, { state: string; version: string }>()
    const { tasks } = await boot({ apps: { get: (id) => registered.get(id) } })
    await expect(tasks.send(draft('ghost'))).rejects.toMatchObject({ code: 'task/send-forbidden' })
    registered.set('real', { state: 'active', version: '1.0.0' })
    const record = await tasks.send(draft('real'))
    expect(record.appVersion).toBe('1.0.0')
    registered.set('real', { state: 'disabled', version: '1.0.0' })
    await expect(tasks.send(draft('real'))).rejects.toMatchObject({ code: 'task/send-forbidden' })
  })

  it('卸载语义：应用从注册表消失后，下次操作把 open/taken 判成 orphaned（§7.4）', async () => {
    const registered = new Map<string, { state: string; version: string }>([
      ['real', { state: 'active', version: '1.0.0' }],
    ])
    const { tasks } = await boot({ apps: { get: (id) => registered.get(id) } })
    const record = await tasks.send(draft('real'))
    const taken = await tasks.take(record.id, { sessionId: 's-1', actor: 'agent', leaseUntil: new Date(Date.now() + 60_000).toISOString() })
    expect(taken.status).toBe('taken')
    registered.delete('real') // 应用卸载
    const after = await tasks.get(record.id) // 下一次操作触发懒清扫
    expect(after?.status).toBe('orphaned')
  })
})
