/**
 * 组合测试：真实 cordis Context + 真实注册表 + 真实任务中心（内存后端），
 * 锁定验收面：目录可发现、入口 URL 可解析、三页 URL 前缀、工具矩阵全名、
 * 同意门下的写流程、taskCenter 走显式 inject 的真实接缝、装配失败不留半接线。
 * Composition tests: real cordis Context with real registries and the real
 * task center (in-memory backend); locks catalog discovery, entry-url
 * resolution, url prefixes, the full tool matrix, consent-gated write flows,
 * the real task-center seam over an explicit inject, and rollback without
 * half-wiring.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import type { AppId } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import TaskCenterService from '@veren/task-center'
import { apply, inject, name } from '../src/index.ts'
import { APP_ID, APP_DEFINITION } from '../src/app.ts'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageParams } from '@veren/prompt-page'
import { bindWorkbenchRuntime } from '../src/pages.tsx'
import { ListMeta, ListPage } from '../src/page-list.tsx'
import { DetailMeta, DetailPage } from '../src/page-detail.tsx'
import { PublishMeta, PublishPage } from '../src/page-publish.tsx'
import { createAppTools } from '../src/tools.ts'
import { createTaskChannel } from '../src/channel.ts'
import type { TaskChannel } from '../src/channel.ts'
import { ConsentBook, DriveLedger } from '../src/consent.ts'
import { TaskStore } from '../src/store.ts'
import type { PageTaskScope } from '../src/types.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MemoryStorageBackend, mountMemoryBackend } from './helpers/fake-storage.ts'
import { armUserTurn, fakeSession } from './helpers/consent-events.ts'

/** 组件页工厂（一次性渲染形态）：组件与契约面成对导出
 * / the component-page factory (the one-shot form): components and contract faces ship as pairs */
const listPage = { ...ListMeta, component: ListPage }
const detailPage = { ...DetailMeta, component: DetailPage }
const publishPage = { ...PublishMeta, component: PublishPage }

/** 假会话 agent：记录组件体直登的工具（页面工具面的断言源）
 * / a fake session agent: records the body's direct registrations (the assertion source of a page's tool face) */
function fakeAgent() {
  const registered: string[] = []
  const agent = {
    ctx: {
      tools: { register: (definition: { name: string }) => { registered.push(definition.name); return () => undefined } },
      effect: () => async () => undefined,
      on: () => () => undefined,
    },
    session: fakeSession('spec'),
    followup: () => undefined,
  }
  return { agent: agent as never, registered }
}

/**
 * 起真实任务中心（内存后端，工具注册关闭）并返回工作台通道。
 * Boot the real task center (in-memory backend, tool registration off) and
 * return the workbench channel.
 */
async function bootCenter(ctx: Context): Promise<TaskChannel> {
  await ctx.plugin(Storage.default)
  mountMemoryBackend(ctx, new MemoryStorageBackend())
  await ctx.plugin(StorageDomain, { backend: 'memory' })
  const service = new TaskCenterService(ctx, { tools: { enabled: false } })
  service.setAppResolver(async () => ({ state: 'active', version: '0.0.0' }))
  return createTaskChannel(service)
}

/** 共享夹具：真实中心 + 门/台账 + 按本地名取工具（写用例先武装用户回合）
 * / the shared harness: the real center + book/ledger + tools by local name (write cases arm a user turn first) */
async function harness(): Promise<{
  channel: TaskChannel
  store: TaskStore
  book: ConsentBook
  ledger: DriveLedger
  toolOf(toolName: string): ToolDefinition
}> {
  const ctx = new Context()
  const channel = await bootCenter(ctx)
  const store = new TaskStore()
  const book = new ConsentBook()
  const ledger = new DriveLedger()
  const tools = createAppTools({
    store,
    channel,
    scope: { liveDetailTaskOf: async () => undefined } as PageTaskScope,
    book,
    ledger,
    catalog: () => [],
    openUrl: async (url: string) => ({ sessionId: 'nav-target', url, title: url }),
  })
  const toolOf = (toolName: string): ToolDefinition => {
    const found = tools.find((tool) => tool.name === toolName)
    if (found === undefined) throw new Error(`tool ${toolName} is not defined`)
    return found
  }
  return { channel, store, book, ledger, toolOf }
}

/** 全名工具（与 index.ts 的装配同一拼法）/ the full-named tools (same spelling as index.ts's wiring) */
const testStore = new TaskStore()
const testTools: ToolDefinition[] = createAppTools({
  store: testStore,
  channel: { list: async () => [] } as never,
  scope: { liveDetailTaskOf: async () => undefined } as PageTaskScope,
  book: new ConsentBook(),
  ledger: new DriveLedger(),
  catalog: () => [],
  openUrl: async (url: string) => ({ sessionId: 'x', url, title: url }),
}).map((tool) => ({ ...tool, name: `task_workbench__${tool.name}` }))
bindWorkbenchRuntime({ store: testStore, tools: testTools, catalog: () => [], channel: { list: async () => [] } as never, seedSize: 0 })

/** 挂好真实注册表与应用插件 / mount real registries plus the app plugin */
async function install(): Promise<{
  ctx: Context
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
}> {
  const ctx = new Context()
  // 两个注册表服务挂在同一个宿主上下文上，镜像面由测试显式接上（app-host 语义）。
  // Both registries live on one host context; the mirror is wired explicitly
  // (app-host's semantics).
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId: never, page: never, live: never) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  // taskCenter 是插件的硬 inject：真实服务在 ctx 上激活（构造即注册为服务，
  // ctx.taskCenter 可解析；G13 后没有缺席降级）。
  // taskCenter is a hard inject: the real service activates on the ctx (the
  // constructor registers it under its name, so ctx.taskCenter resolves; no
  // post-G13 absent-degrade path exists).
  await bootCenter(ctx)
  const fiber = ctx.plugin({ name, inject, apply }, { listSize: 2 })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

describe('应用可被发现与解析', () => {
  it('ctx.apps.catalog() 能发现 task-workbench：active、toolPrefix=task_workbench', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const record = apps.get(APP_ID as AppId)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('task_workbench')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('task-workbench')
  })

  it('入口页 URL 合法（/apps/task-workbench/list）且能被 page-registry 解析', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
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
    disposers.push(() => fiber.dispose())
    expect(apps.catalog()).toHaveLength(1)
  })
})

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

describe('生命周期', () => {
  it('插件 fiber 销毁 → 整应用从 catalog 与 URL 索引同时摘除', async () => {
    const { apps, pageRegistry, fiber } = await install()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/task-workbench/list')).toBeNull()
    expect(pageRegistry.resolve('/apps/task-workbench/task/t-1')).toBeNull()
  })
})

describe('§3.10 页面信息组织：首页必须把该给的信息给全', () => {
  it('首页（entry）能被结构校验放行：map 覆盖全部详情页模板', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
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
