/**
 * 第 1 阶段验收 · 场景 8–10：卸载语义（工具摘掉/会话保留/任务 orphaned/重装
 * 恢复）、废弃会话释放任务租约、以及投递闭环修复（page_send → 详情页
 * take_page_task 接取 → done）。
 * Phase-1 acceptance, scenarios 8–10: the uninstall semantics (tools stripped,
 * sessions kept, tasks orphaned, reinstall restores), the lease released when
 * a deprecated session held it, and the delivery-loop fix (page_send → the
 * detail page's take_page_task → done).
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { PageInstanceKey } from '@veren/prompt-page'
import { boot, disposeTrackedBoot, flush, open, tempRoot } from './helpers/acceptance-boot.ts'

afterEach(async () => { await disposeTrackedBoot() })

// ---- 场景 8 ----

describe('场景 8：卸载 → 工具摘掉、会话保留、任务 orphaned；重装后新建会话恢复工具', () => {
  it('fiber 销毁执行全部卸载语义；重装后打开新建会话，旧会话废弃但可读', async () => {
    const root = tempRoot()
    const first = await boot(root)
    const a = await open(first.pages, 't-1')
    const record = await first.tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '会被孤儿的任务',
      target: { url: '/apps/task-workbench/task/9' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '9' } },
    })
    expect(first.tools.has('task_workbench__complete_task')).toBe(true)
    await first.wb.dispose() // 卸载应用（fiber 销毁 → 镜像面摘工具）
    await new Promise((resolve) => setTimeout(resolve, 0)) // releaseApp 是 fire-and-forget，让它落定
    expect(first.tools.has('task_workbench__complete_task')).toBe(false) // 工具摘掉
    expect(first.store.alive(a.sessionId)).toBe(true) // 会话保留
    const orphaned = await first.tasks.get(record.id) // 懒孤儿判定（resolver 查不到应用）
    expect(orphaned?.status).toBe('orphaned')

    const second = await boot(root) // 重装（新宿主、同一持久目录）
    const reopened = await open(second.pages, 't-1')
    // 重装后打开 = 新建会话；索引指向新会话，旧会话落废弃历史但消息仍可读
    expect(reopened.sessionId).not.toBe(a.sessionId)
    const rows = await second.pages.instances.listByApp('task-workbench')
    expect(rows.find((row) => row.url === '/apps/task-workbench/task/t-1' && row.state === 'live')?.sessionId).toBe(reopened.sessionId)
    expect(rows.some((row) => row.state === 'deprecated' && row.sessionId === a.sessionId)).toBe(true)
    // 旧会话消息仍可读（PAGE 块在；首屏消息带过中心真身）
    // / the old session's log stays readable (the PAGE block is there; the first-screen message carried the center's real body)
    const pageBlockOld = second.store.messages(a.sessionId).find((m) => m.startsWith('PAGE task-workbench/detail'))
    expect(pageBlockOld).toBeDefined()
    expect(first.store.messages(a.sessionId).some((m) => m.includes('中心真身'))).toBe(true)
    // 新会话的页面工具照常挂载
    expect(second.tools.has('task_workbench__complete_task')).toBe(true)
  })
})

// ---- 场景 9（§9.1 反转的关键边角：废弃会话释放任务租约）----

describe('场景 9：旧会话持有任务租约时被废弃 → 租约释放 → 新会话可接取', () => {
  it('旧会话 taken 的任务，重开同 URL 后新会话再次 take 成功（不会被 already-taken 挡住）', async () => {
    const { pages, tasks, store } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '租约要随废弃释放的任务',
      target: { url: '/apps/task-workbench/task/1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '1' } },
    })
    const a = await open(pages, '1', { taskId: record.id })
    expect((await tasks.get(record.id))?.claimedBy?.sessionId).toBe(a.sessionId)
    // 重开同 URL：旧会话废弃；它持有的租约随之释放
    const b = await open(pages, '1', { taskId: record.id })
    expect(b.sessionId).not.toBe(a.sessionId)
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('taken')
    expect(after?.claimedBy?.sessionId).toBe(b.sessionId) // 新会话拿到，不再 already-taken
    // TASK 块在新会话里；旧会话的日志保持只有它自己的那一次
    expect(store.messages(b.sessionId).some((m) => m.startsWith(`TASK ${record.id}`))).toBe(true)
  })
})

// ---- 场景 10（投递闭环修复：§3.9 page_send → §3.10.1 详情页接取 → done）----
// 真机缺陷：page_send 把任务投给详情页会话，但详情页按当时的工具矩阵没有接取
// 工具（只有 complete/abandon 系），三轮跑满后任务落 failed/task-not-taken。
// The live defect: page_send delivered a task to a detail-page session, but the
// page's tool matrix had no take tool (complete/abandon only); after its turns
// ran out the task landed failed/task-not-taken.

describe('场景 10：page_send 投递 → 详情页 take_page_task 接取 → 完成 → 终态 done', () => {
  it('投递只投消息不接取；详情页会话接的就是本页那条；重复接取幂等；完成后任务翻 done', async () => {
    const { pages, tasks, tools, store } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '投递给详情页的任务',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    // §3.9 page_send：只投消息，不接取（openUrl 带 taskId 的宿主接取路径不在场）
    // / §3.9 page_send: message only, no take (the host's openUrl+taskId path is absent here)
    const delivered = await pages.deliverUrl('/apps/task-workbench/task/t-1', { message: `[task-center] 新任务 ${record.id} 请处理` })
    expect(delivered.created).toBe(true)
    // 断裂态重现：投了、会话在、任务没人接、没有 TASK 块
    // / the broken shape: delivered, session alive, nobody took it, no TASK block
    expect((await tasks.get(record.id))?.status).toBe('open')
    expect(store.messages(delivered.sessionId).some((m) => m.startsWith('TASK '))).toBe(false)
    // v2 投递闭环（§5 分解）：通知先进会话（投递同意按记录 id 收窄）→ drive_begin
    // 声明范围 → take_page_task 接取本页那条 → complete_task 提交。
    // / the v2 delivery loop (§5's decomposition): the notice lands first (delivery
    // consent narrowed to the record id) → drive_begin declares the scope →
    // take_page_task takes this page's order → complete_task submits.
    await flush()
    const take = tools.get('task_workbench__take_page_task')
    expect(take).toBeDefined()
    const session = store.sessionFace(delivered.sessionId)
    const exec = { agent: { session } } as never
    // 门未声明时先拒绝：先 take 会被 consent/drive-required 挡住
    // / with no declared drive the take is refused first: consent/drive-required
    expect(await take!.execute({}, exec)).toMatchObject({ ok: false, code: 'consent/drive-required' })
    const drive = tools.get('task_workbench__drive_begin')
    expect(await drive!.execute({ reason: '处理投递来的任务', scope: 'tasks', task_ids: [record.id] }, exec))
      .toMatchObject({ ok: true })
    expect(await take!.execute({}, exec)).toMatchObject({ ok: true })
    // 接取者就是本页会话（租约）；同会话重复接取幂等（§4.4）
    // / the claimant is this page session (the lease); re-take by the same session is idempotent (§4.4)
    const taken = await tasks.get(record.id)
    expect(taken?.status).toBe('taken')
    expect(taken?.claimedBy?.sessionId).toBe(delivered.sessionId)
    expect(await take!.execute({}, exec)).toMatchObject({ ok: true })
    // 接取者提交 → 终态 done，而不是 failed/task-not-taken
    // / the claimant submits → terminal done, not failed/task-not-taken
    expect(await tools.get('task_workbench__complete_task')!.execute({ task_id: 't-1', summary: '闭环完成' }, exec))
      .toMatchObject({ ok: true })
    expect((await tasks.get(record.id))?.status).toBe('done')
  })

  it('页面作用域限制：列表页会话调用 take_page_task 被结构化拒绝（page-task-unresolvable）', async () => {
    const { pages, tools } = await boot(tempRoot())
    const listed = await pages.openUrl('/apps/task-workbench/list')
    // 工具表里要有这个工具才轮得到"拒绝"：先开一个详情页让它挂载（列表页按矩阵不声明它）
    // / the tool must be in the table before a refusal is even possible: mount a
    // detail page first (the list page does not declare it, by the matrix)
    await open(pages, 't-1')
    const take = tools.get('task_workbench__take_page_task')!
    const outcome = await take.execute({}, { agent: { session: { id: listed.sessionId } } } as never) as { ok: boolean; code?: string }
    expect(outcome).toMatchObject({ ok: false, code: 'page-task-unresolvable' })
  })

  it('重开同 URL（旧会话废弃、租约释放）后，新会话依然接得了本页那条（§3.5.3 收敛）', async () => {
    const { pages, tasks, tools, store } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '废弃后要能被新会话接走的任务',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    const first = await open(pages, 't-1', { taskId: record.id })
    expect((await tasks.get(record.id))?.claimedBy?.sessionId).toBe(first.sessionId)
    const reopened = await open(pages, 't-1')
    expect(reopened.sessionId).not.toBe(first.sessionId)
    // §3.5.3 收敛在门内验证：旧会话废弃释放租约后，新会话经"用户点名 + drive"接走本页那条
    // / the §3.5.3 convergence inside the gate: after the deprecated session's lease
    // is released, the fresh session takes the order via a user turn + drive
    const session = store.sessionFace(reopened.sessionId)
    const exec = { agent: { session } } as never
    await flush()
    store.emitSessionEvent(session, { type: 'turn/start' })
    store.emitSessionEvent(session, { type: 'user/message', data: { message: { source: { kind: 'user' }, content: [{ type: 'text', text: '接了它' }] } } })
    expect(await tools.get('task_workbench__drive_begin')!.execute({ reason: '用户点名接取' }, exec))
      .toMatchObject({ ok: true })
    expect(await tools.get('task_workbench__take_page_task')!.execute({}, exec))
      .toMatchObject({ ok: true })
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('taken')
    expect(after?.claimedBy?.sessionId).toBe(reopened.sessionId)
  })
})
