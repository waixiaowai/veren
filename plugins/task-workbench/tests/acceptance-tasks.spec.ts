/**
 * 第 1 阶段验收 · 场景 5–7（docs/application-concept.cn.md §8.1）：两个应用
 * 同名工具按前缀共存、发任务→通知→接取→完成的端到端闭环、过期与禁用的拒绝。
 * Phase-1 acceptance, scenarios 5–7 (§8.1): same-named tools of two apps
 * coexisting by prefix, the end-to-end send → notice → take → complete loop,
 * and the expired/disabled refusals.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { AppId, PageKey } from '@veren/app-registry'
import type { PageInstanceKey } from '@veren/prompt-page'
import { boot, disposeTrackedBoot, errorCode, open, tempRoot } from './helpers/acceptance-boot.ts'

afterEach(async () => { await disposeTrackedBoot() })

// ---- 场景 5 ----

describe('场景 5：两个应用同名工具 → 不同前缀共存', () => {
  it('同名本地工具以 <toolPrefix>__ 同时可见，互不覆盖', async () => {
    const { ctx, apps, pages, tools } = await boot(tempRoot())
    // 第二个应用：同名工具 take_task，页面 /apps/other-app/task/:taskId
    const { createElement } = await import('@veren/prompt-core')
    apps.register({ id: 'other-app' as AppId, name: '另一个应用', description: '同名工具共存验证', entry: 'list' as PageKey }, ctx)
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    const otherPages = apps.pages('other-app' as AppId, ctx)
    // 一级页（entry）：map 由注册表推导（§3.5），不再手写 / the home: the map is registry-derived (§3.5)
    otherPages.register(
      () => createElement('p', { children: 'other list' }),
      { url: '/apps/other-app/list', description: '另一应用列表页', instructions: '这是 other-app 的首页：看列表，去详情。' },
    )
    // 二级页：带 :param + writes + 工具 + 说明（规则 3）
    // detail page: a :param plus writes, a tool and instructions (rule 3)
    otherPages.register(
      (_props: { taskId?: string }, agent) => {
        // 工具只在页面存在：组件体直登全名（设计律；工具不再走目录声明）
        // / a tool exists only inside a page: the body registers the full name (design law; no catalog indirection)
        agent.ctx.tools.register(defineTool({
          name: 'other_app__take_task', description: '另一个应用的 take_task', parameters: {},
          output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
          execute: async () => ({ ok: true }),
        }))
        return createElement('p', { children: 'other task' })
      },
      { url: '/apps/other-app/task/:taskId', description: '另一应用任务页', writes: true, instructions: '只处理 params.taskId 指定的这一条任务。' },
    )
    const a = await open(pages, '1')
    const b = await pages.openUrl('/apps/other-app/task/1')
    const names = [...tools.keys()]
    // 详情页挂 complete_task/abandon_task；另一应用挂自己的 take_task——前缀共存
    expect(names).toContain('task_workbench__complete_task')
    expect(names).toContain('other_app__take_task')
    // DSH ToolDefinition 本体直达模型侧：output 契约字段未在挂载路上丢失
    const mounted = tools.get('task_workbench__complete_task')
    expect(mounted?.output?.schema).toBeDefined()
    expect(mounted?.presentCall).toBeTypeOf('function')
    expect(mounted?.name).toBe('task_workbench__complete_task')
    expect(a.sessionId).not.toBe(b.sessionId)
  })
})

// ---- 场景 6 ----

describe('场景 6：发任务 → 通知进会话 → app_open 接取 → 完成 → 应用收到 task/completed', () => {
  it('端到端闭环：投递文本正确、TASK 块、完成事件', async () => {
    const { ctx, pages, tasks, store } = await boot(tempRoot())
    const completed: Array<{ taskId: string; appId: string }> = []
    ;(ctx.on as unknown as (event: string, listener: (payload: unknown) => void) => void)(
      'task-center/completed',
      (payload: unknown) => { completed.push(payload as { taskId: string; appId: string }) },
    )
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '审阅 PR #42 的错误处理',
      target: {
        url: '/apps/task-workbench/task/1' as PageInstanceKey,
        appId: 'task-workbench', page: 'detail', params: { taskId: '1' },
      },
    })
    // 通知还没进任何会话（尚未打开页面）
    const opened = await open(pages, '1', { taskId: record.id })
    // 活会话收到通知：投递泵把渲染好的文本注进了刚建的页面会话
    const messages = store.messages(opened.sessionId)
    const notice = messages.find((m) => m.includes('[task-center]'))
    expect(notice).toBeDefined()
    expect(notice).toContain('审阅 PR #42 的错误处理')
    expect(notice).toContain('/apps/task-workbench/task/1')
    // 通知已回报 delivered
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('taken') // openUrl 带 taskId → 先 take 再写 TASK 块
    expect(messages.some((m) => m.startsWith(`TASK ${record.id}`))).toBe(true)
    // 完成 → 应用收到 task/completed
    await tasks.complete(record.id, { summary: '已审阅，两处建议补充边界检查' })
    expect(completed).toMatchObject([{ taskId: record.id, appId: 'task-workbench' }])
  })
})

// ---- 场景 7 ----

describe('场景 7：任务过期 → task/expired；应用禁用 → app/disabled', () => {
  it('过期任务打开被拒；禁用应用后页面打不开', async () => {
    const { apps, pages, tasks } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '会过期的任务',
      target: { url: '/apps/task-workbench/task/2' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '2' } },
      expiresAt: new Date(Date.now() + 30).toISOString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect((await tasks.get(record.id))?.status).toBe('expired')
    expect(await errorCode(open(pages, '2', { taskId: record.id }))).toBe('task/expired')
    apps.disable('task-workbench' as AppId)
    expect(await errorCode(open(pages, '2'))).toBe('app/disabled')
    // 禁用的应用不能再发任务（resolver 生效）
    expect(await errorCode(tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '禁用后发送',
      target: { url: '/apps/task-workbench/task/3' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '3' } },
    }))).toBe('task/send-forbidden')
  })
})
