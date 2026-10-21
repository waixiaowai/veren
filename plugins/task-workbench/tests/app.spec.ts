/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、三页 URL 前缀、工具外部名前缀、
 * taskCenter 走显式 inject 的真实接缝、装配失败不留半接线。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, tool external names, the real
 * task-center seam over an explicit inject, and rollback without half-wiring.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import type { AppId } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { APP_ID, APP_DEFINITION } from '../src/app.ts'
import { createDetailPage, createListPage, createPublishPage } from '../src/pages.tsx'
import { TaskStore, makeList } from '../src/store.ts'

// 页面定义是工厂（闭包持有装配时的权威 store），测试用一份独立 store 实例化；
// 这些断言只读结构（URL/标题），不触碰数据。
// Page definitions are factories closing over the assembly's store, so the tests
// instantiate them against a throwaway store; these assertions read structure only.
const testStore = new TaskStore(makeList(3))
const listPage = createListPage(testStore)
const detailPage = createDetailPage(testStore)
const publishPage = createPublishPage()

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
    registerAppPage: (appId: never, page: never) => pageRegistry.registerAppPage(appId, page),
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
  })

  it('页面工具对外名带 task_workbench__ 前缀', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const externalNames = apps.listTools(APP_ID as AppId).map((tool) => tool.externalName)
    expect(externalNames).toEqual([
      'task_workbench__take_task',
      'task_workbench__complete_task',
      'task_workbench__abandon_task',
      'task_workbench__publish_task',
      'task_workbench__split_task',
    ])
  })
})

describe('任务接缝', () => {
  it('装配中途失败（第三页镜像抛错）→ 应用、工具、已镜像页面整组回滚，不留半接线', async () => {
    // 镜像面在前两页照常、第三页（publish）抛错：插件注册到第三步的中途才失败，
    // 此时应用定义、全部工具、前两页的镜像都已完成——正是要验证的"半接线"场景。
    // The mirror behaves for the first two pages and throws on the third
    // ("publish"): the plugin fails midway through step 3 with the definition,
    // every tool, and two mirrored pages already in place — the half-wiring
    // scenario under test.
    const ctx = new Context()
    const hostCtx = new Context()
    const apps = new AppRegistryService(hostCtx)
    const pageRegistry = new PageRegistryService(hostCtx)
    ctx.provide('apps', apps)
    ctx.provide('pageRegistry', pageRegistry)
    apps.setPageMirror({
      registerAppPage: (appId: never, page: never) => {
        if ((page as { name: string }).name === 'publish') throw new Error('mirror exploded on publish')
        return pageRegistry.registerAppPage(appId, page)
      },
      releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
    })
    ctx.provide('taskCenter', fakeTaskCenter().contract as never)
    // effect 体内抛错 → 插件装载失败；断言已完成的步骤全部回滚：
    // The effect body throws → the mount fails; assert every finished step was
    // rolled back:
    await expect(ctx.plugin({ name, inject, apply }, { listSize: 3 })).rejects.toThrow('mirror exploded')
    expect(apps.catalog()).toHaveLength(0)
    expect(() => apps.listTools(APP_ID as AppId)).toThrow()
    expect(() => apps.listPages(APP_ID as AppId)).toThrow()
    // page-registry 里也不残留：已镜像的两页被逆序摘除。
    // Nothing lingers in the page registry: the two mirrored pages were
    // disposed in reverse order.
    expect(pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/task-workbench/'))).toHaveLength(0)
    // 换上正常镜像面后，同一上下文可以重新装配（HMR 安全 / 幂等回滚）。
    // With a healthy mirror the same context mounts again (HMR-safe rollback).
    apps.setPageMirror({
      registerAppPage: (appId: never, page: never) => pageRegistry.registerAppPage(appId, page),
      releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
    })
    const fiber = ctx.plugin({ name, inject, apply }, { listSize: 3 })
    await fiber
    disposers.push(() => fiber.dispose())
    expect(apps.catalog()).toHaveLength(1)
  })

  it('taskCenter 在场：publish_task 调 send，draft.target 指向详情页规范 URL', async () => {
    const { apps, fiber, sent } = await install()
    disposers.push(() => fiber.dispose())
    const publish = apps.listTools(APP_ID as AppId).find((tool) => tool.name === 'publish_task')
    const outcome = await publish?.execute({ title: '评审 PR #7' }, {} as never) as { ok: boolean }
    expect(outcome.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      title: '评审 PR #7',
      target: { appId: 'task-workbench', page: 'detail', params: { taskId: 't-4' } },
    })
  })

  it('take/complete/abandon 状态机：非法迁移返回结构化结果而非抛错', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const toolOf = (toolName: string) =>
      apps.listTools(APP_ID as AppId).find((tool) => tool.name === toolName)!
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
  const toolOf = (apps: AppRegistryService, toolName: string) =>
    apps.listTools(APP_ID as AppId).find((tool) => tool.name === toolName)!

  it('taskCenter 在场：split_task 走 addSubtask，父 id 与标题透传', async () => {
    const { apps, fiber, splits } = await install()
    disposers.push(() => fiber.dispose())
    // 本地门槛：只有 taken 节点能拆 / local gate: taken nodes only
    expect(await toolOf(apps, 'split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never))
      .toMatchObject({ ok: false, code: 'bad-task-state' })
    expect(await toolOf(apps, 'take_task').execute({ task_id: 't-1' }, {} as never)).toMatchObject({ ok: true })
    expect(await toolOf(apps, 'split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never))
      .toMatchObject({ ok: true })
    expect(splits).toHaveLength(1)
    expect(splits[0]).toMatchObject({ parentId: 't-1', draft: { title: '子步骤' } })
  })

  it('taskCenter 找不到父任务：split_task 以工具错误失败（fail loud），树形事实留在本地', async () => {
    const { apps, fiber } = await install({ parentMissing: true })
    disposers.push(() => fiber.dispose())
    await toolOf(apps, 'take_task').execute({ task_id: 't-1' }, {} as never)
    await expect(toolOf(apps, 'split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never))
      .rejects.toThrow('parent task t-1 not found')
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
