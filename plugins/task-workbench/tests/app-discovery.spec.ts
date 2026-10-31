/**
 * 组合测试 · 应用可发现与可解析 + 生命周期：真实 cordis Context + 真实注册表
 * + 真实任务中心（内存后端）。锁定：目录可发现且 active、入口 URL 可解析、
 * 三页 URL 前缀与矩阵分页、工具矩阵 12 个全名、fiber 销毁整应用摘除。
 * Composition specs — discovery, resolution, and lifecycle: a real cordis
 * Context with real registries and the real task center (in-memory backend).
 * Locks: catalog discovery and active state, entry-url resolution, the three
 * url prefixes and the matrix split, the 12 full-named tools, and whole-app
 * teardown on fiber dispose.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { AppId } from '@veren/app-registry'
import { defineComponentPage } from '@veren/prompt-page'
import {
  APP_DEFINITION, APP_ID, detailPage, disposeTracked, fakeAgent, install, listPage,
  publishPage, testTools, trackDisposal,
} from './helpers/composition.ts'

afterEach(async () => { await disposeTracked() })

describe('应用可被发现与解析', () => {
  it('ctx.apps.catalog() 能发现 task-workbench：active、toolPrefix=task_workbench', async () => {
    const { apps, fiber } = await install()
    trackDisposal(() => fiber.dispose())
    const record = apps.get(APP_ID as AppId)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('task_workbench')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('task-workbench')
  })

  it('入口页 URL 合法（/apps/task-workbench/list）且能被 page-registry 解析', async () => {
    const { apps, pageRegistry, fiber } = await install()
    trackDisposal(() => fiber.dispose())
    const entryKey = APP_DEFINITION.entry
    const entry = apps.listPages(APP_ID as AppId).find((page) => page.name === entryKey)
    expect(entry?.url).toBe('/apps/task-workbench/list')
    // 子注册表解析：入口与实例化详情页都能命中 / the child registry resolves both
    expect(pageRegistry.resolve('/apps/task-workbench/list')?.page.name).toBe('task-workbench/list')
    const match = pageRegistry.resolve('/apps/task-workbench/task/t-12?focus=chat')
    expect(match?.params).toEqual({ taskId: 't-12', focus: 'chat' })
  })

  it('三个页面 URL 全部是 /apps/task-workbench/...，矩阵（§3.10.1 v2）分页正确', async () => {
    await install()
    for (const page of [listPage, detailPage, publishPage]) {
      expect(page.url.startsWith('/apps/task-workbench/')).toBe(true)
      expect('preset' in page).toBe(false)
    }
    expect(detailPage.url).toBe('/apps/task-workbench/task/:taskId')
    expect(detailPage.instanceTitle?.({ taskId: '1' })).toBe('任务 #1')
    // 矩阵：带参 take_task 留在列表页；页面作用域接取 + 拆分留在详情页；
    // drive 两件 + 导航在两页都在；工具面 = 组件体直登（一次性渲染）。
    // / Matrix: the parametered take_task stays on the list; the page-scoped
    // take + split stay on the detail page; the drive pair + navigation sit on
    // both. The tool face = the body's registrations (one-shot).
    const detailRegistered = fakeAgent()
    defineComponentPage(detailPage.component, detailPage).live.mount({ taskId: 't-1' }, detailRegistered.agent)
    expect(detailRegistered.registered).toContain('task_workbench__take_page_task')
    expect(detailRegistered.registered).not.toContain('task_workbench__take_task')
    expect(detailRegistered.registered).toContain('task_workbench__drive_begin')
    expect(detailRegistered.registered).toContain('task_workbench__open_task_page')
    const listRegistered = fakeAgent()
    defineComponentPage(listPage.component, listPage).live.mount({}, listRegistered.agent)
    expect(listRegistered.registered).toContain('task_workbench__take_task')
    expect(listRegistered.registered).not.toContain('task_workbench__split_task')
  })

  it('工具矩阵 12 个，全名带 task_workbench__ 前缀（§4 扩展表的顺序）', () => {
    expect(testTools.map((tool) => tool.name)).toEqual([
      // 队列半边 / the queue half
      'task_workbench__list_tasks',
      'task_workbench__take_task',
      'task_workbench__complete_task',
      'task_workbench__abandon_task',
      'task_workbench__publish_task',
      'task_workbench__requeue_task',
      // 页面半边 / the page half
      'task_workbench__get_page_task',
      'task_workbench__take_page_task',
      'task_workbench__split_task',
      // drive/导航面 / the drive/navigation face
      'task_workbench__drive_begin',
      'task_workbench__drive_end',
      'task_workbench__open_task_page',
    ])
  })
})

describe('生命周期', () => {
  it('插件 fiber 销毁 → 整应用从 catalog 与 URL 索引同时摘除', async () => {
    const { apps, pageRegistry, fiber } = await install()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/task-workbench/list')).toBeNull()
    expect(pageRegistry.resolve('/apps/task-workbench/task/t-1')).toBeNull()
  })
})
