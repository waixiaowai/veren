import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import type { PageDefinition } from '@veren/prompt-page'
import { AppErrorCode, AppRegistryError, AppRegistryService } from '../src/index.ts'
import { createBootstrapTools } from '../src/bootstrap-tools.ts'
import type { AppId, ApplicationDefinition } from '../src/index.ts'

/** 最小应用定义 / minimal app definition */
function appDef(id: string): ApplicationDefinition {
  return { id: id as AppId, name: id, description: `app ${id}`, entry: 'main' as never }
}

/** defineTool 产物：目录测试通用的最小工具 / minimal defineTool product for catalog tests */
function makeTool(name: string) {
  return defineTool({
    name,
    description: 'd',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({}),
  })
}

/** 最小页面定义 / minimal page definition */
function pageDef(appId: string, name: string): PageDefinition<never> {
  return {
    name,
    url: `/apps/${appId}/${name}`,
    description: `page ${name}`,
    tree: (() => []) as unknown as PageDefinition<never>['tree'],
  }
}

/**
 * fiber 归属与生命周期（§7）：应用注册与插件 fiber 绑定。
 * Fiber ownership & lifecycle: an app is bound to its registering plugin fiber.
 */
describe('fiber 归属与生命周期', () => {
  it('插件 fiber 销毁 → 整应用（页面+工具）从 catalog() 摘除；销毁幂等', async () => {
    const root = new Context()
    const apps = new AppRegistryService(root)
    let dispose: (() => void) | undefined
    const fiber = await root.plugin((ctx: Context) => {
      dispose = apps.register(appDef('todo'), ctx)
      apps.pages('todo' as AppId, ctx).register(pageDef('todo', 'main'))
      apps.tools('todo' as AppId, ctx).define(makeTool('add'))
    })
    expect(apps.catalog()).toHaveLength(1)
    expect(apps.listPages('todo' as AppId)).toHaveLength(1)
    expect(apps.listTools('todo' as AppId)).toHaveLength(1)

    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(apps.get('todo' as AppId)).toBeUndefined()

    // 销毁后手动再调 disposer：幂等不抛 / disposing again is a no-op
    expect(() => dispose?.()).not.toThrow()
  })

  it('register 返回的 disposer 手动注销同样幂等', () => {
    const apps = new AppRegistryService(new Context())
    const dispose = apps.register(appDef('todo'))
    dispose()
    expect(() => dispose()).not.toThrow()
    expect(apps.catalog()).toHaveLength(0)
    // 前缀已释放，可复用 / the prefix is released and reusable
    expect(() => apps.register(appDef('todo'))).not.toThrow()
  })

  it('pages/tools 只允许注册 fiber 自己获取；跨 fiber → Forbidden', async () => {
    const root = new Context()
    const apps = new AppRegistryService(root)
    let ownerCtx: Context | undefined
    let otherCtx: Context | undefined
    await root.plugin((ctx: Context) => { ownerCtx = ctx; apps.register(appDef('todo'), ctx) })
    await root.plugin((ctx: Context) => { otherCtx = ctx })

    // 归属者自己可用 / the owner works
    expect(() => apps.pages('todo' as AppId, ownerCtx)).not.toThrow()
    // 他人被拒 / others are rejected
    expect(() => apps.pages('todo' as AppId, otherCtx)).toThrowError(AppErrorCode.Forbidden)
    expect(() => apps.tools('todo' as AppId, otherCtx)).toThrowError(AppRegistryError)
  })

  it('AppRegistryError 带稳定 code 与机器可读 details', () => {
    const apps = new AppRegistryService(new Context())
    try {
      apps.pages('ghost' as AppId)
      expect.unreachable()
    } catch (error) {
      expect((error as AppRegistryError).code).toBe(AppErrorCode.NotFound)
      expect((error as AppRegistryError).details).toEqual({ appId: 'ghost' })
    }
  })
})

/** 宿主引导工具 app_list / app_pages（app_open 归会话 C，不在本包）/ bootstrap tools */
describe('宿主引导工具 app_list / app_pages', () => {
  it('app_list 返回 id/entryUrl/state，broken 应用 entryUrl 为 null', async () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('todo'))
    apps.pages('todo' as AppId).register(pageDef('todo', 'main'))
    apps.register(appDef('ghost-app'))
    const tools = createBootstrapTools(apps)
    const result = await tools.appList.execute({}, {} as never) as { apps: Array<Record<string, unknown>> }
    const todo = result.apps.find((app) => app.id === 'todo')
    const ghost = result.apps.find((app) => app.id === 'ghost-app')
    expect(todo).toMatchObject({ state: 'active', entryUrl: '/apps/todo/main', toolPrefix: 'todo' })
    expect(ghost).toMatchObject({ state: 'broken' })
    expect(ghost?.entryUrl).toBeNull()
  })

  it('app_pages 返回页面键/URL 模式/入口标记/带前缀的工具名；disabled 返回结构化错误', async () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('todo'))
    apps.tools('todo' as AppId).define(makeTool('add'))
    apps.pages('todo' as AppId).register({ ...pageDef('todo', 'main'), tools: ['add'] } as PageDefinition<never>)
    const tools = createBootstrapTools(apps)
    const ok = await tools.appPages.execute({ appId: 'todo' }, {} as never) as { pages: Array<Record<string, unknown>> }
    expect(ok.pages[0]).toMatchObject({
      pageKey: 'todo/main',
      urlPattern: '/apps/todo/main',
      isEntry: true,
      tools: ['todo__add'],
    })
    apps.disable('todo' as AppId)
    const disabled = await tools.appPages.execute({ appId: 'todo' }, {} as never) as { error: { code: string } }
    expect(disabled.error.code).toBe(AppErrorCode.Disabled)
  })

  it('app_pages 入参与未知 appId 都返回结构化错误（不抛异常）', async () => {
    const apps = new AppRegistryService(new Context())
    const tools = createBootstrapTools(apps)
    const badArgs = (await tools.appPages.execute({ appId: '' }, {} as never)) as { error: { code: string } }
    expect(badArgs.error.code).toBe(AppErrorCode.ManifestInvalid)
    const unknownApp = (await tools.appPages.execute({ appId: 'ghost' }, {} as never)) as { error: { code: string } }
    expect(unknownApp.error.code).toBe(AppErrorCode.NotFound)
  })
})
