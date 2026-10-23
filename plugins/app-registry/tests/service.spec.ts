import { describe, expect, it } from 'vitest'
import { createElement } from '@veren/prompt-core'
import { Context, Service } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '../src/index.ts'
import { AppErrorCode, AppRegistryError } from '../src/index.ts'
import type { AppId, ApplicationDefinition } from '../src/index.ts'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'

/** 构造一个最小合法应用定义 / minimal valid app definition */
function appDef(id: string, overrides: Partial<ApplicationDefinition> = {}): ApplicationDefinition {
  return { id: id as AppId, name: id, description: `app ${id}`, entry: 'main' as never, ...overrides }
}

/** 组件页夹具（组件形态，RFC prompt-page-render §3.5）：返回 [PageFC, meta] 二元组
 * / a component-page fixture (the component form): returns a [PageFC, meta] tuple */
function pageDef(appId: string, name: string, path = name): [PageFC, ComponentPageMeta] {
  const url = `/apps/${appId}/${path}`
  return [
    () => createElement('p', { children: name }),
    { url, description: `page ${name}` },
  ]
}

/** 首页夹具：无参入口 / a home fixture: parameterless entry */
function homeDef(appId: string, name: string, path = name): [PageFC, ComponentPageMeta] {
  return pageDef(appId, name, path)
}

/** 详情页夹具：带 :param + writes + 说明（规则 3 的说明半边；工具半边在挂载期判）
 * / a detail fixture: a :param + writes + instructions (rule 3's instructions half; the tool half is judged at mount) */
function detailDef(appId: string, name: string, path: string): [PageFC, ComponentPageMeta] {
  const [component, meta] = pageDef(appId, name, path)
  return [component, { ...meta, writes: true, instructions: `handle one ${name} record` }]
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
    const removeEntry = pages.register(...homeDef('todo', 'main'))
    expect(apps.get('todo' as AppId)?.state).toBe('active')
    removeEntry()
    removeEntry() // 幂等 / idempotent
    expect(apps.get('todo' as AppId)?.state).toBe('broken')
    dispose()
  })

  it('disable 后 get/catalog 仍可见但 state=disabled；enable 恢复（broken 不被掩盖）', () => {
    const { apps } = setup('todo')
    apps.pages('todo' as AppId).register(...homeDef('todo', 'main')) // 先愈合为 active
    apps.disable('todo' as AppId)
    expect(apps.get('todo' as AppId)?.state).toBe('disabled')
    apps.enable('todo' as AppId)
    expect(apps.get('todo' as AppId)?.state).toBe('active')
  })

  it('get 未知应用返回 undefined；pages 未知应用抛 NotFound', () => {
    const { apps } = setup()
    expect(apps.get('ghost' as AppId)).toBeUndefined()
    expect(() => apps.pages('ghost' as AppId)).toThrowError(AppErrorCode.NotFound)
  })
})

describe('pages 注册面', () => {
  it('页面必须走 defineAppPage 形态校验：URL 前缀不对/应用段不符均拒绝', () => {
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    expect(() => pages.register(...pageDef('other', 'main'))).toThrowError(AppErrorCode.ManifestInvalid)
    expect(() => pages.register(...pageDef('todo', 'main', '../other/main'))).toThrowError()
    expect(apps.listPages('todo' as AppId)).toHaveLength(0)
  })

  it('页面键应用内唯一；注销后整组摘除', () => {
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    pages.register(...homeDef('todo', 'main'))
    expect(() => pages.register(...homeDef('todo', 'main'))).toThrowError(/duplicate page key/)
    pages.register(...detailDef('todo', 'detail', 'detail/:id'))
    expect(apps.listPages('todo' as AppId)).toHaveLength(2)
    const removeTmp = pages.register(...pageDef('todo', 'tmp'))
    expect(apps.listPages('todo' as AppId)).toHaveLength(3)
    removeTmp()
    removeTmp() // 幂等 / idempotent
    expect(apps.listPages('todo' as AppId)).toHaveLength(2)
  })

  it('§3.10.5 规则 1：entry 指向带 :param 的页面 → 注册期拒绝（page/home-invalid）', () => {
    const { apps } = setup('todo')
    // 规则 3 已在 defineAppPage 满足（writes/工具/说明齐全），拦下它的是规则 1
    // / rule 3 is satisfied at defineAppPage (writes/tools/instructions), so rule 1 is what rejects
    expect(() => apps.pages('todo' as AppId).register(...detailDef('todo', 'main', 'main/:id')))
      .toThrowError(expect.objectContaining({ code: 'page/home-invalid' }))
  })

  it('§3.10.5 规则 1（map 推导后收窄为构造成立）：单页应用合法', () => {
    // map 由注册表推导后，"列全记录页"构造上成立——单页应用注册不再有任何 map 负担
    // / with the registry-derived map, full coverage holds by construction — a
    // single-page app carries no map burden at all
    const { apps } = setup('todo')
    expect(() => apps.pages('todo' as AppId).register(...pageDef('todo', 'main'))).not.toThrow()
    expect(apps.get('todo' as AppId)?.state).toBe('active')
  })

  it('§3.10.5 规则 1（map 推导）：有详情页的应用，首页注册照常通过（推导 map 构造上列全）', () => {
    const { apps } = setup('todo')
    apps.pages('todo' as AppId).register(...pageDef('todo', 'main'))
    expect(() => apps.pages('todo' as AppId).register(...detailDef('todo', 'detail', 'detail/:id'))).not.toThrow()
    expect(apps.listPages('todo' as AppId)).toHaveLength(2)
  })

  it('§3.10.5 规则 1 不约束非 entry 页：合规二级页可正常注册', () => {
    const { apps } = setup('todo')
    apps.pages('todo' as AppId).register(...homeDef('todo', 'main'))
    expect(() => apps.pages('todo' as AppId).register(...detailDef('todo', 'detail', 'detail/:id'))).not.toThrow()
  })

  it('viewer 档（只读详情）：带 :param、不声明 writes → 如实注册；详情工具半边在挂载期判', () => {
    // 只读详情页（有记录身份、纯浏览）不声明 writes 即通过——它是合法的 viewer。
    // 设计律下页面定义没有工具清单；规则 3 的工具半边由 page-registry 在挂载期
    // 以真实登记面判（fail loud），注册期不再看得到也不再看工具。
    // / a read-only drilldown registers honestly — a legal viewer with no writes
    // claim. Under the design law the page definition carries no tool list;
    // rule 3's tool half is judged at mount by page-registry over the really-
    // collected face (fail loud) — registration no longer sees tools at all.
    const { apps } = setup('todo')
    const pages = apps.pages('todo' as AppId)
    pages.register(...pageDef('todo', 'main'))
    const [component, meta] = pageDef('todo', 'workspace', 'workspace/:wsId')
    expect(() => pages.register(component, meta)).not.toThrow()
    const registered = apps.listPages('todo' as AppId).find((page) => page.name === 'workspace')
    expect(registered?.writes).toBeUndefined()
    expect(registered).toBeDefined()
    expect('tools' in (registered ?? {})).toBe(false)
    const [fakeComponent, fakeMeta] = pageDef('todo', 'fake', 'fake/:id')
    // writes:true 的详情页必须带非空说明（规则 3 的说明半边，注册期拦）；
    // 说明补上后注册放行，工具半边才轮到挂载期判。
    // / a writes:true detail page must carry non-empty instructions (rule 3's
    // instructions half, refused at registration); with them the registration
    // passes and only the tool half waits for mount.
    expect(() => pages.register(fakeComponent, { ...fakeMeta, writes: true, instructions: '只处理 params.id 指定的这一条。' })).not.toThrow()
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
    const disposePage = apps.pages('gamma' as AppId).register(...homeDef('gamma', 'list'))
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
    expect(() => apps.pages('delta' as AppId).register(...homeDef('delta', 'list'))).toThrow('url pattern conflict')
    expect(apps.listPages('delta' as AppId)).toHaveLength(0) // 已回滚
    disposeApp()
  })

  it('无镜像面 → 只告警不崩（漂移由 pageRegistry.auditAppPages 发现）', () => {
    const ctx = new Context()
    const apps = new AppRegistryService(ctx)
    const definition = appDef('epsilon', { entry: 'list' as never })
    const disposeApp = apps.register(definition)
    expect(() => apps.pages('epsilon' as AppId).register(...homeDef('epsilon', 'list'))).not.toThrow()
    expect(apps.listPages('epsilon' as AppId)).toHaveLength(1)
    disposeApp()
  })
})
