/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、三页 URL 前缀、工具外部名前缀、
 * taskCenter 缺席降级。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, tool external names, and the
 * task-center-absent degrade path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import type { AppId } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { APP_ID, APP_DEFINITION } from '../src/app.ts'
import { detailPage, listPage, publishPage } from '../src/pages.tsx'

/** 假任务中心：记录 send 调用 / a fake task center recording send calls */
function fakeTaskCenter() {
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
      get: async (id: string) => ({ id, kind: 'task-workbench/publish', target: { url: `/apps/task-workbench/task/${id}`, appId: 'task-workbench', page: 'detail', params: {} } }),
      addSubtask: async (parentId: string, draft: Record<string, unknown>) => {
        splits.push({ parentId, draft })
        return { id: 'task-2', status: 'open', parentId }
      },
    },
  }
}

/** 挂好真实注册表与应用插件 / mount real registries plus the app plugin */
async function install(options: { taskCenter?: boolean } = {}): Promise<{
  ctx: Context
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
  sent: Array<Record<string, unknown>>
  splits: Array<Record<string, unknown>>
}> {
  const ctx = new Context()
  // 缺口 3 收敛后的真实接线：两个注册表服务挂在同一个宿主上下文上，
  // app-registry 的镜像面靠 ctx.get('pageRegistry') 零配置解析。
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  // 装配接线（app-host 的镜像面语义，测试里显式接）
  apps.setPageMirror({
    registerAppPage: (appId: never, page: never) => pageRegistry.registerAppPage(appId, page),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  const sent = fakeTaskCenter()
  if (options.taskCenter) ctx.provide('taskCenter', sent.contract as never)
  const fiber = ctx.plugin({ name, inject, apply }, { listSize: 3 })
  await fiber
  return { ctx, apps, pageRegistry, fiber, sent: sent.sent, splits: sent.splits }
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
    expect(pageRegistry.resolve('/apps/task-workbench/list')?.page.name).toBe('list')
    const match = pageRegistry.resolve('/apps/task-workbench/task/t-12?focus=chat')
    expect(match?.params).toEqual({ taskId: 't-12', focus: 'chat' })
  })

  it('三个页面 URL 全部是 /apps/task-workbench/...，页面不再绑定预设', async () => {
    await install()
    for (const page of [listPage, detailPage, publishPage]) {
      expect(page.url.startsWith('/apps/task-workbench/')).toBe(true)
      expect(page.pageRevision).toBeGreaterThanOrEqual(1)
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
  it('taskCenter 缺席：publish_task 优雅降级（degraded 标记），不抛异常，任务留本地', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const publish = apps.listTools(APP_ID as AppId).find((tool) => tool.name === 'publish_task')
    const outcome = await publish?.execute({ title: '评审 PR #7' }, {} as never) as { ok: boolean; degraded?: boolean }
    expect(outcome.ok).toBe(false)
    expect(outcome.degraded).toBe(true)
  })

  it('taskCenter 在场：publish_task 调 send，draft.target 指向详情页规范 URL', async () => {
    const { apps, fiber, sent } = await install({ taskCenter: true })
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
    const { apps, fiber, splits } = await install({ taskCenter: true })
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

  it('taskCenter 缺席：split_task 降级（degraded 标记），树形事实留在本地 store', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    await toolOf(apps, 'take_task').execute({ task_id: 't-1' }, {} as never)
    const outcome = await toolOf(apps, 'split_task').execute({ task_id: 't-1', title: '子步骤' }, {} as never) as { ok: boolean; degraded?: boolean }
    expect(outcome.ok).toBe(false)
    expect(outcome.degraded).toBe(true)
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
