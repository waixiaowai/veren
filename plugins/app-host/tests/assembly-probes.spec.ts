/**
 * 真机探针的可自动化收编（原 @veren/app-host-verify 六项中的 5/6 项）：
 * 重开同 URL 总是新建 + 任务通知落真实会话日志。
 * The automatable absorption of the live probes (5/6 of the former
 * @veren/app-host-verify items): reopening the same url always creates a fresh
 * session, and task notices land in the real session log.
 * @module tests/assembly-probes.spec
 */
import { describe, expect, it } from 'vitest'
import type { PageInstanceKey } from '@veren/prompt-page'
import { boot, registerMiniApp } from './app-host.harness.ts'

describe('真机探针的可自动化收编（原 @veren/app-host-verify 六项中的 5/6 项）', () => {
  it('重开同一 URL → 总是新会话：旧会话废弃、agent 退役，索引指向新会话（真实实例索引持久化，非替身）', async () => {
    const h = await boot()
    registerMiniApp(h)
    const first = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    // 打开即激活：旧会话的 agent 已在场（工具挂进它的作用域），再重开同 URL
    const scopeA = h.host.scopes.get(first.sessionId)
    if (scopeA === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scopeA.registry.keys()]).toEqual(['mini__read', 'mini__write'])
    const second = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(second.sessionId).not.toBe(first.sessionId)
    // 索引（URL 键）指向新会话；旧行挪进废弃历史且状态 deprecated
    const rows = await h.pages.instances.listByApp('mini')
    expect(rows.find((row) => row.url === '/apps/mini/task/1' && row.state === 'live')?.sessionId).toBe(second.sessionId)
    expect(rows.some((row) => row.state === 'deprecated' && row.sessionId === first.sessionId)).toBe(true)
    // 旧会话的 agent 已被废弃路径整体退役：作用域登记全部消失
    // / the old session's agent was retired whole by the deprecation path: every scope registration is gone
    expect(scopeA.registry.size).toBe(0)
  })

  it('任务通知经投递泵落进真实会话：重开后的新会话拿到 TASK 块与收件箱 [task-center] 文本', async () => {
    const h = await boot()
    registerMiniApp(h)
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    void opened // 第一次打开的会话马上被重开废弃；任务落在新会话上
    // 重开同 URL：新建会话（agent 打开即激活）
    const fresh = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const scope = h.host.scopes.get(fresh.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    const task = await h.tasks.send({
      kind: 'mini/kind' as never, title: '真机验证任务',
      target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'mini', page: 'task', params: { taskId: '1' } },
    })
    // 带 taskId 打开 = 再一次新建（废弃上一条），take 成功 → TASK 块进入新会话
    const opened2 = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey, { taskId: task.id })
    expect(opened2.sessionId).not.toBe(fresh.sessionId)
    const scope2 = h.host.scopes.get(opened2.sessionId)
    if (scope2 === undefined) throw new Error('expected the reopened page agent to activate at open')
    // TASK 块与收件箱通知在打开流程里 followup 进活 agent
    expect(scope2.followups.some((m) => m.includes(`TASK ${task.id}`))).toBe(true)
    expect(scope2.followups.some((m) => m.includes('[task-center] 真机验证任务'))).toBe(true)
    // 新会话 PAGE 块也在；旧会话没有收到任务的任何块
    expect(scope.followups.some((m) => m.includes(`TASK ${task.id}`))).toBe(false)
  })
})
