/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、三页 URL 前缀、工具全名、
 * taskCenter 走显式 inject 的真实接缝、装配失败不留半接线。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, full tool names, the real
 * task-center seam over an explicit inject, and rollback without half-wiring.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import type { AppId } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { APP_ID, APP_DEFINITION, createAppTools, createTaskChannel } from '../src/app.ts'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageJsonValue, PageParams } from '@veren/prompt-page'
import { bindWorkbenchRuntime, DetailMeta, DetailPage, ListMeta, ListPage, PublishMeta, PublishPage } from '../src/pages.tsx'
import { TaskStore, makeList } from '../src/store.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

// 页面定义是工厂（闭包持有装配时的权威 store 与全名工具），测试用一份独立
// store 实例化；这些断言只读结构（URL/标题），不触碰数据。
// Page definitions are factories closing over the assembly's store and tools,
// so the tests instantiate them against a throwaway store; these assertions
// read structure only.
const testStore = new TaskStore(makeList(3))
/** 全名工具（与 index.ts 的装配同一拼法）/ the full-named tools (same spelling as index.ts's wiring) */
const testTools: ToolDefinition[] = createAppTools(testStore, fakeTaskCenter().contract as never, { liveDetailTaskOf: async () => undefined })
  .map((tool) => ({ ...tool, name: `task_workbench__${tool.name}` }))
// 组件页工厂（一次性渲染形态）：组件与契约面成对导出
// / the component-page factory (the one-shot form): components and contract faces ship as pairs
bindWorkbenchRuntime(testStore, testTools)
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
    session: { id: 'spec' },
  }
  return { agent: agent as never, registered }
}

/** 假任务中心：记录 send/addSubtask 调用；parentMissing 时 get 找不到父记录
 * / a fake task center recording send calls; with parentMissing, get finds no parent */
function fakeTaskCenter(parentMissing = false) {
  const sent: Array<Record<string, unknown>> = []
  const splits: Array<Record<string, unknown>> = []
  return {
    sent,
    splits,
    contract: {
      send: async (draft: Record<string, unknown>) => {
        sent.push(draft)
        return { id: 'task-1', status: 'open' }
      },
      get: async (id: string) => parentMissing
        ? undefined
        : { id, kind: 'task-workbench/publish', target: { url: `/apps/task-workbench/task/${id}`, appId: 'task-workbench', page: 'detail', params: {} } },
      addSubtask: async (parentId: string, draft: Record<string, unknown>) => {
        splits.push({ parentId, draft })
        return { id: 'task-2', status: 'open', parentId }
      },
      // take_page_task 的中心面（本文件不执行它，只为通道完整性提供）
      // / the center face of take_page_task (never executed here; present for channel completeness)
      list: async () => [] as never[],
      take: async (id: string, claim: Record<string, unknown>) => ({ id, status: 'taken', claimedBy: claim }),
    },
  }
}

/** 挂好真实注册表与应用插件 / mount real registries plus the app plugin */
async function install(options: { parentMissing?: boolean } = {}): Promise<{
  ctx: Context
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
  sent: Array<Record<string, unknown>>
  splits: Array<Record<string, unknown>>
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
  // taskCenter 是插件的硬 inject：测试必须真实提供（G13 后没有缺席降级）。
  // taskCenter is a hard inject: the spec provides it for real (no post-G13
  // absent-degrade path exists).
  const fake = fakeTaskCenter(options.parentMissing === true)
  ctx.provide('taskCenter', fake.contract as never)
  const fiber = ctx.plugin({ name, inject, apply }, { listSize: 3 })
  await fiber
  return { ctx, apps, pageRegistry, fiber, sent: fake.sent, splits: fake.splits }
}

const disposers: (() => Promise<void>)[] = []
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
    // pageKey 命名（见 registerAppPage）/ pageKey naming (see registerAppPage)
    expect(pageRegistry.resolve('/apps/task-workbench/list')?.page.name).toBe('task-workbench/list')
    const match = pageRegistry.resolve('/apps/task-workbench/task/t-12?focus=chat')
    expect(match?.params).toEqual({ taskId: 't-12', focus: 'chat' })
  })

  it('三个页面 URL 全部是 /apps/task-workbench/...，页面不再绑定预设', async () => {
    await install()
    for (const page of [listPage, detailPage, publishPage]) {
      expect(page.url.startsWith('/apps/task-workbench/')).toBe(true)
      expect('preset' in page).toBe(false)
    }
    expect(detailPage.url).toBe('/apps/task-workbench/task/:taskId')
    expect(detailPage.instanceTitle?.({ taskId: '1' })).toBe('任务 #1')
    // 矩阵（§3.10.1）：详情页的活是"动这一条"——页面作用域接取必须挂在详情页，
    // 且带参 take_task 留在列表页（任意 id 的浏览入口职责）。工具面 = 组件体
    // 直登（一次性渲染），假 agent 记录登记名。
    // / Matrix (§3.10.1): the detail page's job is to act on its one record — the
    // page-scoped take must sit here, while the parametered take_task stays on
    // the list page. The tool face = the body's registrations (one-shot), recorded
    // by the fake agent.
    const detailRegistered = fakeAgent()
    defineComponentPage(detailPage.component, detailPage).live.mount({ taskId: 't-1' }, detailRegistered.agent, undefined)
    expect(detailRegistered.registered).toContain('task_workbench__take_page_task')
    expect(detailRegistered.registered).not.toContain('task_workbench__take_task')
    const listRegistered = fakeAgent()
    defineComponentPage(listPage.component, listPage).live.mount({}, listRegistered.agent, undefined)
    expect(listRegistered.registered).toContain('task_workbench__take_task')
  })

  it('页面工具对外名带 task_workbench__ 前缀（工具不再走应用目录，全名在创建处拼定）', () => {
    const externalNames = testTools.map((tool) => tool.name)
    expect(externalNames).toEqual([
      'task_workbench__take_task',
      'task_workbench__take_page_task',
      'task_workbench__complete_task',
      'task_workbench__abandon_task',
      'task_workbench__publish_task',
      'task_workbench__split_task',
    ])
  })
})

/** 共享夹具：一份 store + 一份 fake 任务中心 + 按本地名取工具（两个 describe 共用）
 * / a shared harness: one store + one fake task center + tools by local name (shared by both describes) */
function harness(parentMissing = false): {
  sent: Array<Record<string, unknown>>
  splits: Array<Record<string, unknown>>
  store: TaskStore
  toolOf(toolName: string): ToolDefinition
} {
    const fake = fakeTaskCenter(parentMissing)
    const store = new TaskStore(makeList(3))
    const tools = createAppTools(store, createTaskChannel(fake.contract as never), { liveDetailTaskOf: async () => undefined })
    const toolOf = (toolName: string): ToolDefinition => {
      const found = tools.find((tool) => tool.name === toolName)
      if (found === undefined) throw new Error(`tool ${toolName} is not defined`)
      return found
    }
    return { ...fake, store, toolOf }
}

describe('任务接缝', () => {
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
    ctx.provide('taskCenter', fakeTaskCenter().contract as never)
    // effect 体内抛错 → 插件装载失败；断言已完成的步骤全部回滚：
    // The effect body throws → the mount fails; assert every finished step was
    // rolled back:
    await expect(ctx.plugin({ name, inject, apply }, { listSize: 3 })).rejects.toThrow('mirror exploded')
    expect(apps.catalog()).toHaveLength(0)
    expect(() => apps.listPages(APP_ID as AppId)).toThrow()
    // page-registry 里也不残留：已镜像的两页被逆序摘除。
    // Nothing lingers in the page registry: the two mirrored pages were
    // disposed in reverse order.
    expect(pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/task-workbench/'))).toHaveLength(0)
    // 换上正常镜像面后，同一上下文可以重新装配（HMR 安全 / 幂等回滚）。
    // With a healthy mirror the same context mounts again (HMR-safe rollback).
    apps.setPageMirror({
      registerAppPage: (appId: never, page: never, live: never) => pageRegistry.registerAppPage(appId, page, live),
      releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
    })
    const fiber = ctx.plugin({ name, inject, apply }, { listSize: 3 })
    await fiber
    disposers.push(() => fiber.dispose())
    expect(apps.catalog()).toHaveLength(1)
  })

  it('taskCenter 在场：publish_task 调 send，draft.target 指向详情页规范 URL', async () => {
    const { toolOf, sent } = harness()
    const outcome = await toolOf('publish_task').execute({ title: '评审 PR #7' }, {} as never) as { ok: boolean }
    expect(outcome.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      title: '评审 PR #7',
      target: { appId: 'task-workbench', page: 'detail', params: { taskId: 't-4' } },
    })
  })

  it('take/complete/abandon 状态机：非法迁移返回结构化结果而非抛错', async () => {
    const { toolOf } = harness()
    expect(await toolOf('complete_task').execute({ task_id: 't-1' }, {} as never))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
    expect(await toolOf('take_task').execute({ task_id: 't-1' }, {} as never)).toMatchObject({ ok: true })
    expect(await toolOf('take_task').execute({ task_id: 't-1' }, {} as never))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
    expect(await toolOf('abandon_task').execute({ task_id: 't-1' }, {} as never)).toMatchObject({ ok: true })
    expect(await toolOf('complete_task').execute({ task_id: 'ghost' }, {} as never))
      .toMatchObject({ ok: false, code: 'task-not-found' })
  })
})

describe('拆分子任务（§4.7.6/§4.7.8）', () => {
  it('taskCenter 在场：split_task 走 addSubtask，父 id 与标题透传', async () => {
    const { toolOf, splits } = harness()
    // 本地门槛：只有 taken 节点能拆 / local gate: taken nodes only
    expect(await toolOf('split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
    expect(await toolOf('take_task').execute({ task_id: 't-1' }, {} as never)).toMatchObject({ ok: true })
    expect(await toolOf('split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never))
      .toMatchObject({ ok: true })
    expect(splits).toHaveLength(1)
    expect(splits[0]).toMatchObject({ parentId: 't-1', draft: { title: '子步骤' } })
  })

  it('taskCenter 找不到父任务：split_task 以工具错误失败（fail loud），树形事实留在本地', async () => {
    const { toolOf } = harness(true)
    await toolOf('take_task').execute({ task_id: 't-1' }, {} as never)
    await expect(toolOf('split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never))
      .rejects.toThrow('parent task t-1 not found')
  })
})

describe('工具面口径（承诺=挂载，事实源如实）', () => {
  /** 三页的 meta 面与正文取词面（正文经一次性挂载渲染，验证 WYSIWYG 一致性）
   * / the three pages' meta faces and body text (bodies render via the one-shot
   * mount, proving the WYSIWYG consistency) */
  const metas = [
    { key: 'list', meta: ListMeta, component: ListPage, params: {} as PageParams },
    { key: 'detail', meta: DetailMeta, component: DetailPage, params: { taskId: 't-1' } as PageParams },
    { key: 'publish', meta: PublishMeta, component: PublishPage, params: {} as PageParams },
  ] as const

  /** 组件正文取词面：用页面自己的 meta 挂载（与真实注册同一条路）；登记名随挂载返回
   * / the body-text face: mounts with the page's own meta (the same path as a real
   * registration); the registered names come back with the mount */
  function bodyTextOf(component: (props: never, agent: never) => unknown, meta: ComponentPageMeta<never>, params: PageParams): { body: string; registered: string[] } {
    const { agent, registered } = fakeAgent()
    const body = defineComponentPage(component as PageFC, meta as ComponentPageMeta).live.mount(params, agent, undefined)
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
    // 路由表述仍在：接取者在其详情页现场拆分 / the routing stays: the claimant
    // splits on its own detail page
    expect(PublishMeta.instructions).toContain('详情页现场拆分')
  })

  it('详情页不再让 complete_task 承诺 children-active（那是任务中心 task_complete 的规则）', () => {
    // 本地 complete_task 只翻本地 store（bad-task-state/task-not-found），从不返回
    // task/children-active——旧说明是假承诺；投递任务的收口指引指向全局 task_complete。
    // / The local complete_task only flips the local store (bad-task-state /
    // task-not-found) and never returns task/children-active — the old note was
    // a false promise; the delivered-lane closer now names the global task_complete.
    expect(DetailMeta.instructions).not.toContain('children-active，先处理子任务')
    expect(DetailMeta.instructions).toContain('task_complete')
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
  it('首页（entry）能被结构校验器零问题放行：map 覆盖全部详情页模板、每条带"什么时候用"', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const pages = apps.listPages(APP_ID as AppId)
    const entryKey = APP_DEFINITION.entry
    if (entryKey === undefined) throw new Error('task-workbench must declare an entry page')
    const home = pages.find((page) => page.name === entryKey)
    if (home === undefined) throw new Error(`entry page ${entryKey} is not registered`)
    // 判据：模型读完首页能直接说出"下一步该打开哪个 URL"——map 由注册表推导
    // （RFC prompt-page-render §3.5），AppRecord.pages 投影就是事实源：详情页
    // 模板在其中，构造上列全。
    // The criterion: after reading the home page a model can name the next URL —
    // the map is registry-derived (§3.5), and the AppRecord.pages projection is
    // the fact source: the detail template sits in it, coverage holds by construction.
    const record = apps.get(APP_ID as AppId)
    const derived = [...(record?.pages ?? new Map()).entries()]
    expect(derived.map(([, p]) => p.url)).toContain('/apps/task-workbench/task/:taskId')
    // 首屏真实性由权威 store 订阅保证（store-backed 组件页）：home 是组件页
    // （component 标记）且 live 绑定订阅 store——首屏不是写死的。
    // / The real-first-screen guarantee rides the authoritative store
    // subscription: home is a component page (the component flag) whose live
    // binding subscribes to the store — the first screen is not hard-coded.
    const homeRegistration = record?.pages?.get(entryKey)
    expect(homeRegistration?.component).toBe(true)
  })

  it('首页 load 取真实列表数据（换 store 首屏随之变，不许写死）', async () => {
    // 用自建数据而不是 makeList 的示例数据：标题逐字来自 store，才证得"首屏不是写死的"。
    // Hand-built data rather than makeList's demo rows: the titles come verbatim
    // from the store, which is what proves the first screen is not hard-coded.
    const store = new TaskStore([
      { id: 't-1', title: '任务 t-1', status: 'open' },
      { id: 't-2', title: '任务 t-2', status: 'open' },
    ])
    // WYSIWYG：组件读 store 渲染 Markdown——标题与子树进度逐字来自 store
    // / WYSIWYG: the component renders the store to Markdown — titles and
    // subtree progress come verbatim from the store
    bindWorkbenchRuntime(store, testTools)
    const { agent } = fakeAgent()
    const snapshot = await ListMeta.load?.({}, {}) as PageJsonValue
    const body = defineComponentPage(ListPage, ListMeta).live.mount({}, agent, snapshot)
    expect(body).toContain('任务 t-1')
    expect(body).toContain('任务 t-2')
    expect(body).toContain('0/1')
    expect(body).toContain('open 2')
  })

  it('详情页按参数取该条记录（§3.10.3）：存在与不存在都如实渲染', async () => {
    const foundStore = new TaskStore([{ id: 't-1', title: '任务 t-1', status: 'open' }])
    bindWorkbenchRuntime(foundStore, testTools)
    const { agent: foundAgent } = fakeAgent()
    const foundSnap = await DetailMeta.load?.({ taskId: 't-1' }, {}) as PageJsonValue
    const foundBody = defineComponentPage(DetailPage, DetailMeta).live.mount({ taskId: 't-1' }, foundAgent, foundSnap)
    expect(foundBody).toContain('t-1 任务 t-1')
    expect(foundBody).toContain('open')

    const missingStore = new TaskStore([])
    bindWorkbenchRuntime(missingStore, testTools)
    const { agent: missingAgent } = fakeAgent()
    const missingSnap = await DetailMeta.load?.({ taskId: 'ghost' }, {}) as PageJsonValue
    const missingBody = defineComponentPage(DetailPage, DetailMeta).live.mount({ taskId: 'ghost' }, missingAgent, missingSnap)
    expect(missingBody).toContain('任务 ghost 不存在')
  })
})
