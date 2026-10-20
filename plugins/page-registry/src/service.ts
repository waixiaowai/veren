/**
 * PageRegistryService：页面注册表 + URL 索引 + 页面运行时的宿主服务。
 * PageRegistryService: page registry + instance index + page runtime, host-side.
 *
 * - 注册表是部署级共享状态：顶层作用域挂载，会话子作用域经 inject 解析到同一实例；
 * - 索引持久化在 `app-pages` 存储域（storageDomain 路子，与 notebook/forum 一致）；
 *   存储缺失时降级为带 page/index-unavailable 码的失败索引，不静默假成功；
 * - 会话/应用/任务三个宿主对接面用惰性端口解析：A（apps）、B（taskCenter）
 *   尚未激活时 openUrl 给出明确错误码，不卡死、不假成功。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, PageError, PageErrorCode, PageRegistry, canonicalizePageUrl, formatPath } from '@veren/prompt-page'
import type { InstanceKvPort, PageCatalogEntry, PageDefinition, PageInstanceIndex, PageInstanceRecord, PageInstanceKey, PageMatch, PageParams } from '@veren/prompt-page'
import { APP_PAGES_DOMAIN_NAME, appPagesDomain, instanceTableView } from './storage.ts'
import { openPageUrl } from './runtime.ts'
import type { AppFace, OpenPageOptions, OpenPageResult, PageRuntimePorts, PageSessionPort, RuntimeAppRecord, TaskFace, ToolsFace } from './runtime.ts'

/** 服务名（ctx.pageRegistry / inject 'pageRegistry'）/ service name */
export const PAGE_REGISTRY_NAME = 'pageRegistry'

/** 存储不可用时的失败索引：所有操作给 page/index-unavailable / the failing index */
class UnavailableIndex implements PageInstanceIndex {
  lookup(): Promise<undefined> { return Promise.reject(unavailable()) }
  reserve(): Promise<PageInstanceRecord> { return Promise.reject(unavailable()) }
  commit(): Promise<PageInstanceRecord> { return Promise.reject(unavailable()) }
  fail(): Promise<void> { return Promise.reject(unavailable()) }
  forget(): Promise<void> { return Promise.reject(unavailable()) }
  listByApp(): Promise<readonly PageInstanceRecord[]> { return Promise.reject(unavailable()) }
  sweepReserved(): Promise<readonly PageInstanceKey[]> { return Promise.reject(unavailable()) }
}

function unavailable(): PageError {
  return new PageError(PageErrorCode.IndexUnavailable, `storage domain "${APP_PAGES_DOMAIN_NAME}" is unavailable; the instance index is read-only-failing`)
}

/** 一次重激活可能留下上一个激活打开的同名域：先关掉再开（与 notebook 同型） */
async function openDomain(ctx: Context): Promise<InstanceKvPort | undefined> {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) return undefined
  const stale = facility.get(APP_PAGES_DOMAIN_NAME)
  if (stale !== undefined) {
    try {
      await stale.close()
      ctx.logger.warn('page-registry: closed the storage domain left open by a previous activation')
    } catch (error: unknown) {
      ctx.logger.warn(`page-registry: the previous storage domain could not close: ${String(error)}`)
    }
  }
  const domain = await facility.open(appPagesDomain)
  // 句柄归本服务：卸载时关闭，给下一次激活腾出名字
  ctx.effect(() => () => domain.close(), 'page-registry:storage')
  return instanceTableView(domain.table('instances'))
}

/**
 * 惰性解析 A/B 的宿主面：此刻它们可能还是空壳，缺了就返回 undefined，
 * 由 openUrl 给出明确错误码（app/not-found、page/host-unavailable）。
 */
function hostPorts(ctx: Context, sessions: PageSessionPort): PageRuntimePorts {
  return {
    sessions,
    get apps(): AppFace | undefined {
      // A 的 AppRecord 是 { definition, state, version, toolPrefix } 形；
      // 运行时面要扁平的 { id, state, toolPrefix, version, instructions }，这里投影。
      const apps = (ctx.get('apps') as { get?: (id: string) => RuntimeAppRecord extends never ? never : { definition: { id: string; instructions?: string }; state: 'active' | 'disabled' | 'broken'; toolPrefix: string; version: string } | undefined } | undefined)
      if (apps?.get === undefined) return undefined
      return {
        get: (id) => {
          const record = apps.get!(id)
          if (record === undefined) return undefined
          return {
            id: record.definition.id,
            state: record.state,
            toolPrefix: record.toolPrefix,
            version: record.version,
            ...(record.definition.instructions === undefined ? {} : { instructions: record.definition.instructions }),
          }
        },
      }
    },
    get toolsOf(): ToolsFace | undefined {
      // 走 app-registry 的只读目录 listTools（外部名/参数/execute），
      // 不经过带 fiber 归属校验的 tools(id) 注册面。
      const apps = (ctx.get('apps') as { listTools?: (id: string) => ReadonlyArray<import('./runtime.ts').PageToolSpec & { externalName: string }> } | undefined)
      if (apps?.listTools === undefined) return undefined
      return (appId) => {
        try {
          return new Map(apps.listTools!(appId).map((tool) => [tool.name, tool]))
        } catch {
          return new Map()
        }
      }
    },
    get tasks(): TaskFace | undefined {
      const taskCenter = (ctx.get('taskCenter') as { take?: TaskFace['take'] } | undefined)
      return taskCenter?.take !== undefined ? { take: (id, claim) => taskCenter.take!(id, claim) } : undefined
    },
    get deliveries(): import('./runtime.ts').DeliveryFace | undefined {
      const taskCenter = (ctx.get('taskCenter') as {
        pendingDeliveries?: () => Promise<readonly { deliveryId: string; text: string }[]>
        markDelivered?: (id: string, error?: string) => Promise<unknown>
      } | undefined)
      if (taskCenter?.pendingDeliveries === undefined || taskCenter.markDelivered === undefined) return undefined
      return {
        pending: () => taskCenter.pendingDeliveries!(),
        mark: (id, error) => taskCenter.markDelivered!(id, error),
      }
    },
  }
}

/**
 * 默认会话端口：贴着宿主 `sessions` / `agents` 服务做能力探测，
 * 缺能力时给 page/host-unavailable，绝不假装成功。
 */
export function createHostSessionPort(ctx: Context): PageSessionPort {
  const sessions = () => ctx.get('sessions') as {
    get?: (id: string) => unknown
    create?: (id?: string, title?: string) => unknown
  } | undefined
  const agentOf = (sessionId: string): { followup?: (message: unknown) => void } | undefined => {
    const agents = (ctx.get('agents') as unknown as { get?: (id: string) => { followup?: (message: unknown) => void } } | undefined)
    return agents?.get?.(sessionId)
  }
  // 会话 → 该会话页面工具的整组注销器：释放/销毁时整组摘除（§3.4.4 兜底）
  // session → the group disposer of that session's page tools; released as a group
  const mounted = new Map<string, () => void>()
  const releaseMounted = (sessionId: string): void => {
    const dispose = mounted.get(sessionId)
    if (dispose !== undefined) {
      mounted.delete(sessionId)
      dispose()
    }
  }
  return {
    exists: (sessionId) => sessions()?.get?.(sessionId) !== undefined,
    mintId: () => crypto.randomUUID(),
    async create(sessionId, _title) {
      const store = sessions()
      if (store?.create === undefined) {
        throw new PageError(PageErrorCode.HostUnavailable, 'host "sessions" service cannot create sessions')
      }
      store.create(sessionId, _title)
    },
    async appendUserMessage(sessionId, text, source) {
      const agent = agentOf(sessionId)
      if (agent?.followup === undefined) {
        throw new PageError(PageErrorCode.HostUnavailable, `no live agent for session ${sessionId}; cannot append "${source}" block`)
      }
      agent.followup({ role: 'user', content: [{ type: 'text', text }], source: { kind: source } })
    },
    async mountTools(sessionId, tools) {
      // 宿主面缺失时报 host-unavailable；重挂路径先摘旧组再挂新组
      const registry = (ctx.get('tools') as { register?: (tool: unknown) => () => void } | undefined)
      if (registry?.register === undefined) {
        throw new PageError(PageErrorCode.HostUnavailable, 'host "tools" registry is unavailable; page tools cannot mount')
      }
      releaseMounted(sessionId)
      const disposers = tools.map((tool) => registry.register!(tool))
      mounted.set(sessionId, () => { for (const dispose of disposers.reverse()) dispose() })
    },
    hasTools: (sessionId) => mounted.has(sessionId),
    async releaseTools(sessionId) { releaseMounted(sessionId) },
    async focus(sessionId) {
      // GUI 切换属于第 2 阶段；第 1 阶段记录日志，不报错
      ctx.logger.info(`page-registry: focus session ${sessionId}`)
    },
    async destroy(sessionId) {
      // 工具跟会话走：销毁时整组摘除（§3.4.4 路径 1 的端口侧兜底）
      releaseMounted(sessionId)
      const store = sessions() as { get?: (id: string) => { dispose?: () => void } } | undefined
      store?.get?.(sessionId)?.dispose?.()
    },
  }
}

/**
 * 页面注册表服务：register/resolve 以 disposer 收口（HMR/卸载安全）。
 * resolve/get 以泛型转发（消费方声明自己的 state 类型）。
 */
export class PageRegistryService extends Service {
  private indexFace: PageInstanceIndex = new UnavailableIndex()
  private readonly registry: PageRegistry<never>
  private runtimePorts: PageRuntimePorts

  /** 页面实例索引：规范 URL → 会话（持久化在 app-pages 域）*/
  get instances(): PageInstanceIndex { return this.indexFace }

  /**
   * @param ctx - 宿主上下文 / host context
   */
  constructor(ctx: Context) {
    super(ctx, PAGE_REGISTRY_NAME)
    this.registry = new PageRegistry<never>()
    // 域打开是异步的：先给失败索引，打开成功后原位换实现（打开失败保持降级）
    this.runtimePorts = hostPorts(ctx, createHostSessionPort(ctx))
    void openDomain(ctx).then(async (table) => {
      if (table !== undefined) {
        this.indexFace = new KvPageInstanceIndex(table, {
          sessionExists: (id) => this.runtimePorts.sessions.exists(id),
        })
        // 启动清扫：reserved 残留行（崩溃遗迹）→ 没有对应活会话就删（§3.5.3/§7.5）
        try {
          const dropped = await this.indexFace.sweepReserved()
          if (dropped.length > 0) ctx.logger.info(`page-registry: swept ${dropped.length} stale reserved row(s) at startup`)
        } catch (error: unknown) {
          ctx.logger.warn(`page-registry: reserved-row sweep failed: ${String(error)}`)
        }
        // 索引重建扫描（§3.5.4）：第 1 阶段不做——会话端口没有枚举会话/读
        // app/page 事件的面，做不了真实重建；此处如实标注而非含糊带过，
        // 见 docs/application-concept.cn.md §8.1 收尾说明。
      } else {
        ctx.logger.warn(`page-registry: storage domain "${APP_PAGES_DOMAIN_NAME}" unavailable; instance index is disabled`)
      }
    }, (error: unknown) => {
      ctx.logger.error(`page-registry: storage domain "${APP_PAGES_DOMAIN_NAME}" failed to open: ${String(error)}`)
    })
  }

  /**
   * 测试/装配缝隙：换掉会话端口或索引（宿主装配与单测注入用）。
   * Test/assembly seam: swap the session ports or the index.
   */
  bindPorts(ports: Partial<PageRuntimePorts> & { sessions?: PageSessionPort }, index?: PageInstanceIndex): void {
    this.runtimePorts = { ...this.runtimePorts, ...ports } as PageRuntimePorts
    if (index !== undefined) this.indexFace = index
  }

  /** 注册页面；重名/URL 模式冲突 fail loud；返回 disposer / register with a disposer */
  register(page: PageDefinition<never>): () => void {
    return this.registry.register(page)
  }

  /**
   * 应用作用域注册（对接 A 的 `ctx.apps.pages(id)`）：URL 必须已是
   * `/apps/<appId>/...` 形态；这是 `page.<name>` 预设路径的替代入口。
   */
  registerAppPage(appId: string, page: PageDefinition<never>): () => void {
    if (!page.url.startsWith(`/apps/${appId}/`)) {
      throw new PageError(PageErrorCode.UrlInvalid, `page "${page.name}" of app "${appId}" must register under /apps/${appId}/, got ${page.url}`)
    }
    return this.registry.register(page)
  }

  /** 解析 URL：路径参数 + query 合并（path 优先）/ resolve a url to a page match */
  resolve<S>(url: string): PageMatch<S> | null {
    return this.registry.resolve(url) as PageMatch<S> | null
  }

  /** 按名取页面定义 / look up a page definition by name */
  get<S>(name: string): PageDefinition<S> | undefined {
    return this.registry.get(name) as PageDefinition<S> | undefined
  }

  /** 目录清单（入口/面板渲染）/ catalog entries */
  catalog(): PageCatalogEntry[] {
    return this.registry.catalog()
  }

  /** 参数工具：路径模式 + 参数 → 具体 URL / format a concrete url from a pattern */
  format(pattern: string, params: PageParams): string {
    return formatPath(pattern, params)
  }

  /**
   * 打开一个页面 URL：命中恢复聚焦、未命中两阶段创建（§3.5.3）。
   * 测试注入口：直接换 runtimePorts.sessions 等端口。
   */
  openUrl(url: PageInstanceKey | string, options: OpenPageOptions = {}): Promise<OpenPageResult> {
    return openPageUrl(this.registry, this.instances, this.runtimePorts, url, options)
  }

  /**
   * 应用卸载/禁用（§3.4.4、§7.2/§7.4）：摘掉该应用所有活会话的页面工具，
   * 会话本身保留。app-registry 的应用清理器在 fiber 销毁时调用这里。
   * App teardown: strip this app's page tools from every live session while
   * keeping the sessions; called by app-registry's fiber cleanup.
   */
  async releaseApp(appId: string): Promise<void> {
    const rows = await this.instances.listByApp(appId)
    for (const row of rows) {
      if (row.state !== 'live') continue
      try {
        await this.runtimePorts.sessions.releaseTools(row.sessionId)
      } catch (error: unknown) {
        // 单个会话失败只影响该会话，记录后继续（§5.6 binding-release-failed 语义）
        this.ctx.logger.warn(`page-registry: releaseTools(${row.sessionId}) failed: ${String(error)}`)
      }
    }
  }

  /**
   * 一致性审计（缺口 3 的发现面）：应用目录里的每个页面都应能被 openUrl
   * 解析（即已同步进本注册表）；返回漂移清单——空数组即一致。
   * Consistency audit: every page of every app must be resolvable here;
   * returns the drift list — empty means consistent.
   */
  auditAppPages(apps: { catalog(): ReadonlyArray<{ definition: { id: string }; listPages?(id: string): readonly { name: string; url: string }[] }> }): ReadonlyArray<{ appId: string; page: string; url: string; problem: 'missing-in-page-registry' | 'unresolvable-url' }> {
    const drift: Array<{ appId: string; page: string; url: string; problem: 'missing-in-page-registry' | 'unresolvable-url' }> = []
    for (const record of apps.catalog()) {
      const appId = record.definition.id
      for (const page of record.listPages?.(appId) ?? []) {
        if (this.registry.get(page.name) === undefined) {
          drift.push({ appId, page: page.name, url: page.url, problem: 'missing-in-page-registry' })
          continue
        }
        if (this.registry.resolve(canonicalizePageUrl(page.url)) === null) {
          drift.push({ appId, page: page.name, url: page.url, problem: 'unresolvable-url' })
        }
      }
    }
    return drift
  }
}
