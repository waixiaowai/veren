import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context, Service } from '@deepseek-ai/cordis'
import type { PageDefinition } from '@veren/prompt-page'
import AppRegistryPlugin, { AppRegistryService } from '../src/index.ts'
import { AppErrorCode, AppRegistryError } from '../src/index.ts'
import type { AppId, ApplicationDefinition } from '../src/index.ts'

/** 构造一个最小合法应用定义 / minimal valid app definition */
function appDef(id: string, overrides: Partial<ApplicationDefinition> = {}): ApplicationDefinition {
  return { id: id as AppId, name: id, description: `app ${id}`, entry: 'main' as never, ...overrides }
}

/** 构造一个最小合法页面定义（URL 走 /apps/<appId>/ 形态）/ minimal valid page definition */
function pageDef(appId: string, name: string, path = name): PageDefinition<never> {
  return {
    name,
    url: `/apps/${appId}/${path}`,
    description: `page ${name}`,
    tree: (() => []) as unknown as PageDefinition<never>['tree'],
  }
}

/** defineTool 产物：目录测试通用的最小工具 / minimal defineTool product */
function makeTool(name = 'read') {
  return defineTool({
    name,
    description: 'd',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({}),
  })
}
/** 建好服务并注册一个应用（无 fiber 绑定的便捷入口）/ service with one registered app */
function setup(id = 'todo'): { apps: AppRegistryService; dispose: () => void } {
  const apps = new AppRegistryService(new Context())
  return { apps, dispose: apps.register(appDef(id)) }
}

describe('AppRegistryService（骨架）', () => {
  it('是 Service 子类；默认导出即插件入口；可在真实 cordis 作用域内解析', () => {
    expect(AppRegistryService.prototype instanceof Service).toBe(true)
    expect(AppRegistryPlugin).toBe(AppRegistryService)
    const service = new AppRegistryService(new Context())
    expect(service).toBeInstanceOf(AppRegistryService)
  })

  it('错误码常量稳定（跨会话合同，改动必须先报告）', () => {
    expect(AppErrorCode.Disabled).toBe('app/disabled')
    expect(AppErrorCode.NotFound).toBe('app/not-found')
    expect(AppErrorCode.PresetRestricted).toBe('app/preset-restricted')
  })
})

describe('register：id 与定义校验', () => {
  it('重复 id 拒绝（fail loud，不静默覆盖）', () => {
    const { apps } = setup('todo')
    expect(() => apps.register(appDef('todo'))).toThrowError(AppRegistryError)
    expect(() => apps.register(appDef('todo'))).toThrowError(/already registered/)
    expect(apps.catalog()).toHaveLength(1)
  })

  it('id 非法（大写/保留字）拒绝，错误码 ManifestInvalid', () => {
    const { apps } = setup()
    expect(() => apps.register(appDef('Bad-Id'))).toThrowError(AppErrorCode.ManifestInvalid)
    expect(() => apps.register(appDef('apps'))).toThrowError(AppErrorCode.ManifestInvalid)
  })

  it('必填字段缺失拒绝', () => {
    const { apps } = setup()
    expect(() => apps.register(appDef('x', { description: '' }))).toThrowError(AppErrorCode.ManifestInvalid)
  })
})

describe('register：toolPrefix 推导与冲突', () => {
  it('缺省从 id 推导（连字符换下划线）', () => {
    const { apps } = setup('review-workbench')
    expect(apps.get('review-workbench' as AppId)?.toolPrefix).toBe('review_workbench')
  })

  it('显式前缀冲突拒绝，并说明冲突双方', () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('alpha', { toolPrefix: 'shared' as never }))
    try {
      apps.register(appDef('beta', { toolPrefix: 'shared' as never }))
      expect.unreachable('must reject')
    } catch (error) {
      expect((error as AppRegistryError).code).toBe(AppErrorCode.ToolPrefixConflict)
      expect((error as AppRegistryError).message).toContain('alpha')
      expect((error as AppRegistryError).message).toContain('beta')
    }
  })
})

describe('entry 与状态机', () => {
  it('entry 指向不存在的页面键 → 应用标 broken（带 EntryMissing 原因），不抛到宿主启动', () => {
    const { apps } = setup('todo')
    const record = apps.get('todo' as AppId)
    expect(record?.state).toBe('broken')
    expect(record?.brokenReason).toContain(AppErrorCode.EntryMissing)
    expect(record?.brokenReason).toContain('main')
  })

  it('入口页面注册后自动愈合为 active；注销入口页又回到 broken', () => {
    const { apps, dispose } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    const removeEntry = pages.register(pageDef('todo', 'main'))
    expect(apps.get('todo' as AppId)?.state).toBe('active')
    removeEntry()
    removeEntry() // 幂等 / idempotent
    expect(apps.get('todo' as AppId)?.state).toBe('broken')
    dispose()
  })

  it('disable 后 get/catalog 仍可见但 state=disabled；enable 恢复（broken 不被掩盖）', () => {
    const { apps } = setup('todo')
    apps.pages('todo' as AppId).register(pageDef('todo', 'main')) // 先愈合为 active
    apps.disable('todo' as AppId)
    expect(apps.get('todo' as AppId)?.state).toBe('disabled')
    apps.enable('todo' as AppId)
    expect(apps.get('todo' as AppId)?.state).toBe('active')
  })

  it('get 未知应用返回 undefined；pages/tools 未知应用抛 NotFound', () => {
    const { apps } = setup()
    expect(apps.get('ghost' as AppId)).toBeUndefined()
    expect(() => apps.pages('ghost' as AppId)).toThrowError(AppErrorCode.NotFound)
    expect(() => apps.tools('ghost' as AppId)).toThrowError(AppErrorCode.NotFound)
  })
})

describe('pages 注册面', () => {
  it('页面必须走 defineAppPage 形态校验：URL 前缀不对/应用段不符均拒绝', () => {
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    expect(() => pages.register(pageDef('other', 'main'))).toThrowError(AppErrorCode.ManifestInvalid)
    expect(() => pages.register({ ...pageDef('todo', 'main'), url: '/other/main' as never })).toThrowError()
    expect(apps.listPages('todo' as AppId)).toHaveLength(0)
  })

  it('页面键应用内唯一；注销后整组摘除', () => {
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    pages.register(pageDef('todo', 'main'))
    expect(() => pages.register(pageDef('todo', 'main'))).toThrowError(/duplicate page key/)
    pages.register(pageDef('todo', 'detail', 'detail/:id'))
    expect(apps.listPages('todo' as AppId)).toHaveLength(2)
    const removeTmp = pages.register(pageDef('todo', 'tmp'))
    expect(apps.listPages('todo' as AppId)).toHaveLength(3)
    removeTmp()
    removeTmp() // 幂等 / idempotent
    expect(apps.listPages('todo' as AppId)).toHaveLength(2)
  })

  it('页面引用未定义工具 → ManifestInvalid（工具需先定义）', () => {
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    const bad = { ...pageDef('todo', 'main'), tools: ['nope'] } as unknown as PageDefinition<never>
    expect(() => pages.register(bad)).toThrowError(AppErrorCode.ManifestInvalid)
  })
})

describe('tools 注册面与命名空间', () => {
  it('工具本地名重复 → ToolDuplicate；对外名 = <toolPrefix>__<name>', () => {
    const { apps } = setup('todo')
    const tools = apps.tools('todo' as AppId)
    const tool = makeTool('add')
    tools.define(tool)
    expect(() => tools.define(tool)).toThrowError(AppErrorCode.ToolDuplicate)
    expect(apps.exportToolName('todo' as AppId, 'add')).toBe('todo__add')
  })

  it('两个应用注册同名工具 → 得到两个不同前缀的对外名', () => {
    const apps = new AppRegistryService(new Context())
    apps.register(appDef('alpha'))
    apps.register(appDef('beta'))
    const tool = makeTool()
    apps.tools('alpha' as AppId).define(tool)
    apps.tools('beta' as AppId).define(tool)
    const [alpha, beta] = [apps.exportToolName('alpha' as AppId, 'read'), apps.exportToolName('beta' as AppId, 'read')]
    expect(alpha).toBe('alpha__read')
    expect(beta).toBe('beta__read')
    expect(alpha).not.toBe(beta)
    expect(apps.listTools('alpha' as AppId)[0]?.externalName).toBe('alpha__read')
  })
})

describe('缺口 3 收尾：页面镜像面（单入口注册）', () => {
  it('register 一次 → 镜像面收到同一页面；镜像 disposer 随页面 disposer 摘除', () => {
    const apps = new AppRegistryService(new Context())
    const mirrored: string[] = []
    const mirrorDisposers: string[] = []
    apps.setPageMirror({
      registerAppPage: (appId, page) => {
        mirrored.push(`${appId}/${page.name}`)
        const key = `${appId}/${page.name}`
        return () => { mirrorDisposers.push(key) }
      },
    })
    const definition = appDef('gamma', { entry: 'list' as never })
    const disposeApp = apps.register(definition)
    apps.tools('gamma' as AppId).define(makeTool())
    const disposePage = apps.pages('gamma' as AppId).register(pageDef('gamma', 'list'))
    expect(mirrored).toEqual(['gamma/list'])
    disposePage()
    expect(mirrorDisposers).toEqual(['gamma/list']) // 先摘镜像再摘内部登记
    disposeApp()
  })

  it('镜像抛错 → 内部登记回滚并原样抛出（不产生目录可见却打不开的漂移）', () => {
    const apps = new AppRegistryService(new Context())
    apps.setPageMirror({
      registerAppPage: () => { throw new Error('url pattern conflict') },
    })
    const definition = appDef('delta', { entry: 'list' as never })
    const disposeApp = apps.register(definition)
    apps.tools('delta' as AppId).define(makeTool())
    expect(() => apps.pages('delta' as AppId).register(pageDef('delta', 'list'))).toThrow('url pattern conflict')
    expect(apps.listPages('delta' as AppId)).toHaveLength(0) // 已回滚
    disposeApp()
  })

  it('无镜像面 → 只告警不崩（漂移由 pageRegistry.auditAppPages 发现）', () => {
    const ctx = new Context()
    const apps = new AppRegistryService(ctx)
    const definition = appDef('epsilon', { entry: 'list' as never })
    const disposeApp = apps.register(definition)
    apps.tools('epsilon' as AppId).define(makeTool())
    expect(() => apps.pages('epsilon' as AppId).register(pageDef('epsilon', 'list'))).not.toThrow()
    expect(apps.listPages('epsilon' as AppId)).toHaveLength(1)
    disposeApp()
  })
})
