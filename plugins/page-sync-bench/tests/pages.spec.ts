import { describe, expect, it } from 'vitest'
import { PageRegistry, mountPage } from '@veren/prompt-page'
import { detailPage, dispatchTaskTool, listPage, publishPage } from '../src/page.tsx'
import { TaskStore, makeList } from '../src/store.ts'
import type { TaskItem } from '../src/types.ts'

describe('detail page (data 块语义)', () => {
  it('经 registry 解析 URL 挂载；字段变更 → 仅该字段的 set op', () => {
    const store = new TaskStore(makeList(3))
    const registry = new PageRegistry<TaskItem[]>()
    registry.register(detailPage)

    const match = registry.resolve('/task-detail/t-1?focus=chat')
    expect(match).not.toBeNull()
    expect(match?.params).toEqual({ taskId: 't-1', focus: 'chat' })

    const detail = mountPage({ page: match!.page, store, params: match!.params })
    expect(detail.syncText()).toContain('"kind":"data"')
    expect(detail.syncText()).toContain('任务 1')

    const v0 = detail.version
    store.takeTask('t-1', 'u-1') // 只变 t-1 状态 → 详情页只产 status 的 set op
    const sync = detail.syncText(v0)
    expect(sync).toContain('"op":"set"')
    expect(sync).toContain('"path":"task.status"')
    expect(sync).not.toContain('"path":"task.title"') // title 未变 → 零 op
    detail.unsubscribe()
  })

  it('abandon 按钮：taken → open', () => {
    const store = new TaskStore(makeList(3))
    store.takeTask('t-0', 'u-1')
    expect(dispatchTaskTool(store, 'abandon_task', '{"task_id":"t-0"}').ok).toBe(true)
    expect(store.getState().find((task) => task.id === 't-0')).toMatchObject({ status: 'open', ownerId: null })
  })
})

describe('registry (三页面编排)', () => {
  it('catalog 暴露 name/url/description；resolve 失败返回 null', () => {
    const registry = new PageRegistry<TaskItem[]>()
    for (const page of [listPage, detailPage, publishPage]) registry.register(page)
    expect(registry.catalog()).toEqual([
      { name: 'task-list', url: '/task-list', description: '任务中心列表页：浏览全部任务，接取/完成任务' },
      { name: 'task-detail', url: '/task-detail/:taskId', description: '任务详情页：查看单个任务的标题/状态/负责人' },
      { name: 'publish-task', url: '/publish-task', description: '发布任务页：填写草稿并确认发布' },
    ])
    expect(registry.resolve('/nope')).toBeNull()
  })

  it('导航 = resolve(url) → 关旧会话 + mountPage 新会话 + 指针交接；状态不丢', () => {
    const store = new TaskStore(makeList(5))
    const registry = new PageRegistry<TaskItem[]>()
    for (const page of [listPage, detailPage, publishPage]) registry.register(page)

    function open(url: string) {
      const match = registry.resolve(url)
      if (match === null) throw new Error(`unknown url ${url}`)
      return mountPage({ page: match.page, store, params: match.params })
    }

    const list = open('/task-list')
    expect(list.pointerMessage).toBe('OPEN /task-list {}')
    store.commit(makeList(6))
    expect(list.syncText(0)).toContain('t-5') // 旧会话在打开期间持续同步

    const detail = open('/task-detail/t-3?focus=chat')
    expect(detail.pointerMessage).toBe('OPEN /task-detail/t-3 {"focus":"chat","taskId":"t-3"}')
    expect(detail.syncText()).toContain('详情页 t-3')
    // 状态跨会话存活：新页面从共享 store 取数
    expect(detail.syncText()).toContain('"value":"任务 3')

    const publish = open('/publish-task?draftTitle=新任务草稿')
    expect(publish.syncText()).toContain('"value":"新任务草稿"')

    list.unsubscribe()
    detail.unsubscribe()
    publish.unsubscribe()
  })
})
