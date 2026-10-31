/**
 * 组合测试 · 工具面口径（承诺=挂载，事实源如实）+ §3.10 页面信息组织：三页
 * 说明与组件体登记互相咬合（无死工具、越页点名即假承诺），首页能把"下一步
 * 打开哪个 URL"给全，首屏取真实投影数据（换 store 首屏随之变，不许写死）。
 * Composition specs — the tool-face doctrine (promise = mount, honest facts)
 * and §3.10's page-information organization: the three pages' instructions and
 * the bodies' registrations interlock (no dead tools, cross-page naming is a
 * false promise), the home hands over the next URL, and first screens read the
 * real projections (swap the store, the screen follows — never hard-coded).
 */

import { describe, expect, it } from 'vitest'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageParams } from '@veren/prompt-page'
import { bindWorkbenchRuntime } from '../src/pages.tsx'
import { ListMeta, ListPage } from '../src/page-list.tsx'
import { DetailMeta, DetailPage } from '../src/page-detail.tsx'
import { PublishMeta, PublishPage } from '../src/page-publish.tsx'
import { APP_DEFINITION, APP_ID, fakeAgent, install, testTools, testStore, trackDisposal } from './helpers/composition.ts'
import { TaskStore } from '../src/store.ts'
import type { AppId } from '@veren/app-registry'

describe('工具面口径（承诺=挂载，事实源如实）', () => {
  /** 三页的 meta 面与正文取词面（正文经一次性挂载渲染，验证 WYSIWYG 一致性）
   * / the three pages' meta faces and body text (bodies render via the one-shot mount, proving the WYSIWYG consistency) */
  const metas = [
    { key: 'list', meta: ListMeta, component: ListPage, params: {} as PageParams },
    { key: 'detail', meta: DetailMeta, component: DetailPage, params: { taskId: 't-1' } as PageParams },
    { key: 'publish', meta: PublishMeta, component: PublishPage, params: {} as PageParams },
  ] as const

  /** 组件正文取词面：用页面自己的 meta 挂载（与真实注册同一条路）；登记名随挂载返回
   * / the body-text face: mounts with the page's own meta (the same path as a real registration); the registered names come back with the mount */
  function bodyTextOf(component: (props: never, agent: never) => unknown, meta: ComponentPageMeta<never>, params: PageParams): { body: string; registered: string[] } {
    const { agent, registered } = fakeAgent()
    const body = defineComponentPage(component as PageFC, meta as ComponentPageMeta).live.mount(params, agent)
    return { body, registered }
  }

  it('页面=信息+工具，缺一不可：每页说明非空且至少登记一个工具', () => {
    for (const { key, meta, component, params } of metas) {
      expect((meta.instructions ?? '').trim().length, `${key} 页缺页面说明`).toBeGreaterThan(0)
      const { registered } = bodyTextOf(component, meta, params)
      expect(registered.length, `${key} 页缺登记工具`).toBeGreaterThan(0)
    }
  })

  it('每页登记的工具都在说明里点名（挂了就要说）', () => {
    for (const { key, meta, component, params } of metas) {
      const { registered } = bodyTextOf(component, meta, params)
      for (const fullName of registered) {
        const localName = fullName.split('__').pop() ?? fullName
        expect(meta.instructions, `${key} 页登记的 ${localName} 未在说明中点名`).toContain(localName)
      }
    }
  })

  it('每个工具都至少登记在一个页面上（无死工具）', () => {
    const mounted = new Set(metas.flatMap(({ component, meta, params }) => bodyTextOf(component, meta, params).registered))
    for (const tool of testTools) {
      expect(mounted.has(tool.name), `工具 ${tool.name} 没有登记在任何页面`).toBe(true)
    }
  })

  it('发布页不点名 split_task（它登记在详情页——越页点名就是假承诺）', () => {
    expect(PublishMeta.instructions).not.toContain('split_task')
    expect(bodyTextOf(PublishPage, PublishMeta, {}).body).not.toContain('split_task')
    // 路由表述仍在：接取者在其详情页现场拆分 / the routing stays: the claimant splits on its own detail page
    expect(PublishMeta.instructions).toContain('详情页现场拆分')
  })

  it('详情页的完成收口指向本应用 complete_task（中心优先；children-active 由中心返回）', () => {
    // v2：complete_task 走中心（接取者校验 + children-active 都由中心返回），
    // 页面说明点名 complete_task 的 summary 契约。
    // / v2: complete_task is center-first (claimant check + children-active both
    // come from the center); the page note names complete_task's summary contract.
    expect(DetailMeta.instructions).toContain('complete_task')
    expect(DetailMeta.instructions).toContain('summary')
    expect(DetailMeta.instructions).toContain('task/children-active')
  })
})

describe('§3.10 页面信息组织：首页必须把该给的信息给全', () => {
  it('首页（entry）能被结构校验放行：map 覆盖全部详情页模板', async () => {
    const { apps, fiber } = await install()
    trackDisposal(() => fiber.dispose())
    const pages = apps.listPages(APP_ID as AppId)
    const entryKey = APP_DEFINITION.entry
    if (entryKey === undefined) throw new Error('task-workbench must declare an entry page')
    const home = pages.find((page) => page.name === entryKey)
    if (home === undefined) throw new Error(`entry page ${entryKey} is not registered`)
    // 判据：模型读完首页能直接说出"下一步该打开哪个 URL"——map 由注册表推导
    // （RFC prompt-page-render §3.5），AppRecord.pages 投影就是事实源。
    // The criterion: after reading the home page a model can name the next URL —
    // the map is registry-derived (§3.5); the AppRecord.pages projection is the fact source.
    const record = apps.get(APP_ID as AppId)
    const derived = [...(record?.pages ?? new Map()).entries()]
    expect(derived.map(([, p]) => p.url)).toContain('/apps/task-workbench/task/:taskId')
    const homeRegistration = record?.pages?.get(entryKey)
    expect(homeRegistration?.component).toBe(true)
  })

  it('首页正文取真实投影数据（换 store 首屏随之变，不许写死）', () => {
    // 用自建数据：标题逐字来自 store，才证得"首屏不是写死的"。
    // Hand-built data: the titles come verbatim from the store, which proves the first screen is not hard-coded.
    const store = new TaskStore([
      { id: 't-1', title: '任务 t-1', status: 'open' },
      { id: 't-2', title: '任务 t-2', status: 'open' },
    ])
    bindWorkbenchRuntime({ store, tools: testTools, catalog: () => [], channel: { list: async () => [] } as never, seedSize: 0 })
    const { agent } = fakeAgent()
    const body = defineComponentPage(ListPage, ListMeta).live.mount({}, agent)
    expect(body).toContain('任务 t-1')
    expect(body).toContain('任务 t-2')
    expect(body).toContain('0/1')
    expect(body).toContain('可接取 2')
  })

  it('详情页按参数取该条投影（§3.10.3）：存在与缺失都如实渲染', () => {
    const foundStore = new TaskStore([{ id: 't-1', title: '任务 t-1', status: 'open' }])
    bindWorkbenchRuntime({ store: foundStore, tools: testTools, catalog: () => [], channel: { list: async () => [] } as never, seedSize: 0 })
    const { agent: foundAgent } = fakeAgent()
    const foundBody = defineComponentPage(DetailPage, DetailMeta).live.mount({ taskId: 't-1' }, foundAgent)
    expect(foundBody).toContain('t-1 任务 t-1')
    expect(foundBody).toContain('可接取')

    const missingStore = new TaskStore([])
    bindWorkbenchRuntime({ store: missingStore, tools: testTools, catalog: () => [], channel: { list: async () => [] } as never, seedSize: 0 })
    const { agent: missingAgent } = fakeAgent()
    const missingBody = defineComponentPage(DetailPage, DetailMeta).live.mount({ taskId: 'ghost' }, missingAgent)
    expect(missingBody).toContain('任务 ghost（中心记录加载中）')
  })
})
