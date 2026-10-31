/**
 * 组合测试 · 同意门下的写流程 + 任务接缝（装配）：真实中心 + 门/台账；写流程
 * 逐动作锁定（publish/take/complete/abandon/split/requeue），装配中途失败整组
 * 回滚、不留半接线、换上健康镜像后可重装（HMR 安全）。
 * Composition specs — the consent-gated write flows and the assembly seam: the
 * real center plus book/ledger; each write action is locked (publish/take/
 * complete/abandon/split/requeue), a mid-assembly failure rolls the whole
 * group back with no half-wiring, and a healthy mirror allows remounting
 * (HMR-safe).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import type { AppId } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { APP_ID } from '../src/app.ts'
import { armUserTurn, fakeSession } from './helpers/consent-events.ts'
import { bootCenter, disposeTracked, harness, install, trackDisposal } from './helpers/composition.ts'

afterEach(async () => { await disposeTracked() })

describe('同意门下的写流程（真实中心）', () => {
  it('publish_task：门内发布落中心队列，draft 带 target 与幂等键；browse 直调被 consent/required 拒', async () => {
    const { channel, book, ledger, toolOf } = await harness()
    const session = fakeSession('publisher')
    const exec = { agent: { session } } as never
    // browse 直调：拒绝 / a bare browse call: refused
    expect(await toolOf('publish_task').execute({ title: '评审 PR #7' }, exec))
      .toMatchObject({ ok: false, code: 'consent/required' })
    // 武装用户回合 + drive 声明：放行，draft 落中心 / armed: the draft lands in the center
    armUserTurn(book, session)
    await expect(toolOf('drive_begin').execute({ reason: '发布评审单' }, exec)).resolves.toMatchObject({ ok: true })
    expect(await toolOf('publish_task').execute({ title: '评审 PR #7' }, exec))
      .toMatchObject({ ok: true })
    const records = await channel.list()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      title: '评审 PR #7',
      target: { appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    expect(records[0]?.idempotencyKey).toBe('task-workbench/t-1/task-workbench-a1')
  })

  it('take/complete/abandon 状态机（中心优先）：未接取先完成被拒；接取后完成/放弃按中心语义走', async () => {
    const { channel, book, ledger, toolOf } = await harness()
    const session = fakeSession('driver')
    const exec = { agent: { session } } as never
    armUserTurn(book, session)
    await toolOf('drive_begin').execute({ reason: '推进 t-1' }, exec)
    await toolOf('publish_task').execute({ title: '单 t-1' }, exec)
    // 未接取就完成：中心拒绝（只有 taken 能 complete）→ 结构化 bad-task-state
    // / completing before taking: the center refuses (taken only) → structured bad-task-state
    expect(await toolOf('complete_task').execute({ task_id: 't-1', summary: 'x' }, exec))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
    expect(await toolOf('take_task').execute({ task_id: 't-1' }, exec)).toMatchObject({ ok: true })
    // 放弃：中心 release，回 open 队列 / abandon: the center releases it back to open
    expect(await toolOf('abandon_task').execute({ task_id: 't-1' }, exec)).toMatchObject({ ok: true })
    expect((await channel.list())[0]?.status).toBe('open')
    // 再接取后完成：中心 complete 翻 done / take again, then complete flips done
    expect(await toolOf('take_task').execute({ task_id: 't-1' }, exec)).toMatchObject({ ok: true })
    expect(await toolOf('complete_task').execute({ task_id: 't-1', summary: '做完了' }, exec))
      .toMatchObject({ ok: true })
    expect((await channel.list())[0]?.status).toBe('done')
    // done 不可再接 / done is not claimable
    expect(await toolOf('take_task').execute({ task_id: 't-1' }, exec))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
  })

  it('split_task：未接取拒绝；接取后走中心 addSubtask（fail loud 保留）', async () => {
    const { channel, book, toolOf } = await harness()
    const session = fakeSession('splitter')
    const exec = { agent: { session } } as never
    armUserTurn(book, session)
    await toolOf('drive_begin').execute({ reason: '拆分 t-1' }, exec)
    await toolOf('publish_task').execute({ title: '单 t-1' }, exec)
    // 本地门槛：只有 taken 能拆 / the local gate: taken only
    expect(await toolOf('split_task').execute({ task_id: 't-1', title: '子步骤' }, exec))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
    await toolOf('take_task').execute({ task_id: 't-1' }, exec)
    expect(await toolOf('split_task').execute({ task_id: 't-1', title: '子步骤' }, exec))
      .toMatchObject({ ok: true })
    const records = await channel.list()
    expect(records.filter((record) => record.parentId !== undefined)).toHaveLength(1)
    expect(records.find((record) => record.parentId !== undefined)?.title).toBe('子步骤')
  })

  it('requeue_task：failed 退回 open 队列（新记录 + 旧历史）', async () => {
    const { channel, book, toolOf } = await harness()
    const session = fakeSession('requeuer')
    const exec = { agent: { session } } as never
    armUserTurn(book, session)
    await toolOf('drive_begin').execute({ reason: '退回 t-1' }, exec)
    await toolOf('publish_task').execute({ title: '会失败的单' }, exec)
    await toolOf('take_task').execute({ task_id: 't-1' }, exec)
    // 直接以接取者身份把它标失败（等价于干不下去）/ fail it as the claimant
    const records = await channel.list()
    const record = records.find((entry) => entry.parentId === undefined)
    await channel.failAsClaimant(record!.id, { code: 'spec/reject', message: '干不了' }, 'requeuer')
    expect(await toolOf('requeue_task').execute({ task_id: 't-1' }, exec)).toMatchObject({ ok: true })
    const after = await channel.list()
    expect(after.filter((entry) => entry.status === 'open')).toHaveLength(1)
    expect(after.filter((entry) => entry.status === 'failed')).toHaveLength(1)
  })
})

describe('任务接缝（装配）', () => {
  it('装配中途失败（第三页镜像抛错）→ 应用、已镜像页面整组回滚，不留半接线', async () => {
    // 镜像面在前两页照常、第三页（publish）抛错：插件注册到第三步的中途才失败，
    // 此时应用定义、前两页的镜像都已完成——正是要验证的"半接线"场景。
    // The mirror behaves for the first two pages and throws on the third
    // ("publish"): the plugin fails midway through step 3 with the definition
    // and two mirrored pages already in place — the half-wiring scenario under test.
    const ctx = new Context()
    const hostCtx = new Context()
    const apps = new AppRegistryService(hostCtx)
    const pageRegistry = new PageRegistryService(hostCtx)
    ctx.provide('apps', apps)
    ctx.provide('pageRegistry', pageRegistry)
    apps.setPageMirror({
      registerAppPage: (appId: never, page: never, live: never) => {
        if ((page as { name: string }).name === 'publish') throw new Error('mirror exploded on publish')
        return pageRegistry.registerAppPage(appId, page, live)
      },
      releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
    })
    await bootCenter(ctx)
    // effect 体内抛错 → 插件装载失败；断言已完成的步骤全部回滚：
    // The effect body throws → the mount fails; assert every finished step was rolled back:
    await expect(ctx.plugin({ name, inject, apply }, { listSize: 2 })).rejects.toThrow('mirror exploded')
    expect(apps.catalog()).toHaveLength(0)
    expect(() => apps.listPages(APP_ID as AppId)).toThrow()
    // page-registry 里也不残留：已镜像的两页被逆序摘除。
    // Nothing lingers in the page registry: the two mirrored pages were disposed in reverse order.
    expect(pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/task-workbench/'))).toHaveLength(0)
    // 换上正常镜像面后，同一上下文可以重新装配（HMR 安全 / 幂等回滚）。
    // With a healthy mirror the same context mounts again (HMR-safe rollback).
    apps.setPageMirror({
      registerAppPage: (appId: never, page: never, live: never) => pageRegistry.registerAppPage(appId, page, live),
      releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
    })
    const fiber = ctx.plugin({ name, inject, apply }, { listSize: 2 })
    await fiber
    trackDisposal(() => fiber.dispose())
    expect(apps.catalog()).toHaveLength(1)
  })
})
