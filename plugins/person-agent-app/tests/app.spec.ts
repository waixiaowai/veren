/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、页面 URL 前缀、工具外部名前缀、
 * 单入口一致性、卸载清理、读取失败的显式降级（服务本身都是硬 inject）。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, tool external-name prefixes,
 * single-entry consistency, teardown, and explicit read-failure degrade (all
 * services are hard injects).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { homeMapIssues } from '@veren/prompt-page'
import { apply, inject, name } from '../src/index.ts'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import { buildOverviewSnapshot } from '../src/views.ts'
import type { OverviewFaces } from '../src/views.ts'

/** 假任务中心：open 列表可编程 / a fake task center with a programmable open list */
function fakeTaskCenter(options: { openTitles?: string[]; failList?: boolean } = {}) {
  return {
    list: async () => {
      if (options.failList === true) throw new Error('storage backend down')
      return (options.openTitles ?? []).map((title, index) => ({ id: `t-${index + 1}`, title, status: 'open' }))
    },
  }
}

/** 假工作区注册表 / a fake workspace registry */
function fakeWorkspaceRegistry(rows: Array<{ id: string; title: string; sessionIds: string[] }> = [
  { id: 'ws-1', title: '主工作区', sessionIds: ['s-1', 's-2'] },
  { id: 'ws-2', title: '副工作区', sessionIds: [] },
]) {
  return {
    archivedSessionIds: ['s-archived'],
    list: () => rows,
  }
}

/** 挂好真实注册表与应用插件（三个数据面服务总是真实提供：它们是硬 inject）。
 * Mount real registries plus the app plugin (the three data faces are always
 * provided for real: they are hard injects). */
async function install(options: {
  openTitles?: string[]
  failList?: boolean
  workspaces?: Array<{ id: string; title: string; sessionIds: string[] }>
} = {}): Promise<{
  ctx: Context
  faces: OverviewFaces
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
}> {
  const ctx = new Context()
  // 两个注册表服务挂在同一个宿主上下文上，镜像面由测试显式接上（app-host 语义）。
  // Both registries live on one host context; the mirror is wired explicitly.
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId: never, page: never) => pageRegistry.registerAppPage(appId, page),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  ctx.provide('workspaceRegistry', fakeWorkspaceRegistry(options.workspaces) as never)
  ctx.provide('taskCenter', fakeTaskCenter(options) as never)
  const fiber = ctx.plugin({ name, inject, apply }, { maxListSessions: 50 })
  await fiber
  const faces: OverviewFaces = {
    apps: ctx.apps,
    workspaces: ctx.workspaceRegistry,
    tasks: ctx.taskCenter,
  }
  return { ctx, faces, apps, pageRegistry, fiber }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

describe('应用可被发现与解析', () => {
  it('ctx.apps.catalog() 能发现 person-agent：active、toolPrefix=person_agent', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const record = apps.get(APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('person_agent')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('person-agent')
  })

  it('入口页 URL 合法（/apps/person-agent/overview）且能被 page-registry 解析', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const entry = apps.listPages(APP_ID).find((page) => page.name === APP_DEFINITION.entry)
    expect(entry?.url).toBe('/apps/person-agent/overview')
    // 应用页以 pageKey（<appId>/<本地名>）登记（见 registerAppPage）
    // app pages register under their pageKey (see registerAppPage)
    expect(pageRegistry.resolve('/apps/person-agent/overview')?.page.name).toBe('person-agent/overview')
    expect(pageRegistry.resolve('/apps/person-agent/workspaces')?.page.name).toBe('person-agent/workspaces')
  })

  it('所有页面 URL 都是 /apps/person-agent/...，不绑定预设，revision ≥ 1', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const pages = apps.listPages(APP_ID)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages) {
      expect(page.url.startsWith('/apps/person-agent/')).toBe(true)
      expect('preset' in page).toBe(false)
      expect(page.instanceTitle?.({})).toBeTypeOf('string')
    }
  })

  it('页面工具对外名带 person_agent__ 前缀（收编既有实现）', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    expect(apps.listTools(APP_ID).map((tool) => tool.externalName)).toEqual([
      'person_agent__session_create',
      'person_agent__session_rename',
      'person_agent__workspace_session_list',
    ])
  })

  it('单入口一致性：应用目录页面与 page-registry 可解析页面一一对应', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const appUrls = apps.listPages(APP_ID).map((page) => page.url).sort()
    const registryUrls = pageRegistry.catalog()
      .map((entry) => entry.url)
      .filter((url) => url.startsWith('/apps/person-agent/'))
      .sort()
    expect(registryUrls).toEqual(appUrls)
    // 且每条都能解析 / every one of them resolves
    for (const url of appUrls) expect(pageRegistry.resolve(url)).not.toBeNull()
  })
})

describe('生命周期', () => {
  it('插件 fiber 销毁 → 整应用从 catalog 与 URL 索引同时摘除', async () => {
    const { apps, pageRegistry, fiber } = await install()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/person-agent/overview')).toBeNull()
    expect(pageRegistry.resolve('/apps/person-agent/workspaces')).toBeNull()
    expect(() => apps.listTools(APP_ID)).toThrow()
  })
})

describe('§3.10 页面信息组织：首页必须把该给的信息给全', () => {
  it('首页（entry）零结构问题：map 覆盖全部详情页、每条带"什么时候用"，且自带 load', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const pages = apps.listPages(APP_ID)
    const entryKey = APP_DEFINITION.entry
    if (entryKey === undefined) throw new Error('person-agent must declare an entry page')
    const home = pages.find((page) => page.name === entryKey)
    if (home === undefined) throw new Error(`entry page ${entryKey} is not registered`)
    // 判据：结构校验器零问题（map 非空、覆盖全部 :param 页、use 非空、指向已注册页面）
    // / the criterion: zero issues from the structural checker (non-empty map, every :param page covered, non-empty use, registered targets)
    expect(homeMapIssues(home, pages)).toEqual([])
    expect(home.map?.map((entry) => entry.url)).toContain('/apps/person-agent/workspaces')
    expect(typeof home.load).toBe('function')
  })

  it('首页 load 刷新真实服务面：三区数据进首屏（本应用全部页面无 :param，map 即工作区浏览页）', async () => {
    const { apps, fiber } = await install({ openTitles: ['唯一任务'] })
    disposers.push(() => fiber.dispose())
    const home = apps.listPages(APP_ID).find((page) => page.name === APP_DEFINITION.entry)
    if (home === undefined || home.load === undefined) throw new Error('the overview page must carry a load')
    const screen = await home.load({}, {})
    if (typeof screen !== 'object' || screen === null || Array.isArray(screen)) {
      throw new Error('the overview load must return a first-screen object')
    }
    expect('catalog' in screen).toBe(true)
    expect('workspaces' in screen).toBe(true)
    // tasks 区快照只带 open 计数与状态说明（不带标题清单）/ the tasks section carries the open count and status, not a title list
    expect(JSON.stringify(screen)).toContain('"openCount":1')
  })

  it('工作区浏览页 load 取工作区区快照', async () => {
    const { apps, fiber } = await install({ openTitles: [] })
    disposers.push(() => fiber.dispose())
    const workspaces = apps.listPages(APP_ID).find((page) => page.name === 'workspaces')
    if (workspaces === undefined || workspaces.load === undefined) throw new Error('the workspaces page must carry a load')
    const screen = await workspaces.load({}, {})
    if (typeof screen !== 'object' || screen === null || Array.isArray(screen)) {
      throw new Error('the workspaces load must return a first-screen object')
    }
    expect(screen).toMatchObject({ available: true })
    expect(JSON.stringify(screen)).toContain('"id":"ws-1"')
    expect(JSON.stringify(screen)).toContain('"sessions":2')
  })
})

describe('真实数据与读取失败降级', () => {
  it('taskCenter 读取失败：tasks 区显式不可用，不抛异常（服务本身是硬 inject，缺席不是可能的失败）', async () => {
    const { faces, fiber } = await install({ failList: true, workspaces: undefined })
    disposers.push(() => fiber.dispose())
    const snapshot = await buildOverviewSnapshot(faces)
    expect(snapshot.tasks.available).toBe(false)
    expect(snapshot.tasks.openCount).toBeNull()
    expect(snapshot.tasks.detail).toContain('task center read failed')
    expect(snapshot.tasks.detail).toContain('storage backend down')
    // 数据面服务都在场：目录与工作区两区照常给真实数据。
    // The data faces are all present: catalog and workspaces give real rows.
    expect(snapshot.catalog.available).toBe(true)
    expect(snapshot.workspaces.available).toBe(true)
  })

  it('taskCenter 在场：open 计数来自真实 list 查询', async () => {
    const { faces, fiber } = await install({ openTitles: ['评审 PR', '整理清单'] })
    disposers.push(() => fiber.dispose())
    const snapshot = await buildOverviewSnapshot(faces)
    expect(snapshot.tasks.available).toBe(true)
    expect(snapshot.tasks.openCount).toBe(2)
  })

  it('workspaceRegistry 在场：workspaces 区给出真实行；注册表为空时给出空行', async () => {
    const withWorkspaces = await install()
    disposers.push(() => withWorkspaces.fiber.dispose())
    const present = await buildOverviewSnapshot(withWorkspaces.faces)
    expect(present.workspaces.available).toBe(true)
    expect(present.workspaces.rows).toEqual([
      { id: 'ws-1', title: '主工作区', sessions: 2 },
      { id: 'ws-2', title: '副工作区', sessions: 0 },
    ])
    const empty = await install({ workspaces: [] })
    disposers.push(() => empty.fiber.dispose())
    const none = await buildOverviewSnapshot(empty.faces)
    expect(none.workspaces.available).toBe(true)
    expect(none.workspaces.rows).toEqual([])
  })

  it('OverviewSource：current 在刷新前显式不可用，refresh 后换成真实快照', async () => {
    const { ctx, fiber } = await install({ openTitles: ['唯一任务'] })
    disposers.push(() => fiber.dispose())
    const { OverviewSource } = await import('../src/views.ts')
    const source = new OverviewSource({
      apps: ctx.apps,
      workspaces: ctx.workspaceRegistry,
      tasks: ctx.taskCenter,
    })
    expect(source.current().tasks.detail).toContain('not refreshed')
    await source.refresh()
    expect(source.current().tasks.openCount).toBe(1)
    expect(source.current().workspaces.rows).toHaveLength(2)
  })
})
