/**
 * PageRegistryService：页面注册表 + URL 索引 + 页面运行时的宿主服务。
 * PageRegistryService: page registry + instance index + page runtime, host-side.
 *
 * - 注册表是部署级共享状态：顶层作用域挂载，会话子作用域经 inject 解析到同一实例；
 * - 索引持久化在 `app-pages` 存储域（storageDomain 路子，与 notebook/forum 一致）；
 *   存储打不开时降级为带 page/index-unavailable 码的失败索引，不静默假成功；
 * - 运行时端口（sessions/apps/toolsOf/tasks/deliveries/releaseLeases）全部由装配层
 *   （app-host）经 `bindPorts` **纯参数**传入（G13 显式接线）：本服务从不摸 ctx 上的
 *   兄弟服务；端口未接线时 openUrl/releaseApp 给 page/host-unavailable，不假成功。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, PageError, PageErrorCode, PageRegistry, canonicalizePageUrl, formatPath } from '@veren/prompt-page'
import type { InstanceKvPort, PageCatalogEntry, PageDefinition, PageInstanceIndex, PageInstanceKey, PageInstanceRecord, PageLiveBinding, PageMatch, PageParams } from '@veren/prompt-page'
import { APP_PAGES_DOMAIN_NAME, appPagesDomain, instanceTableView } from './storage.ts'
import { mountPreviewTools, openPageUrl } from './runtime.ts'
import type { OpenPageOptions, OpenPageResult, PagePreview, PageRuntimePorts } from './runtime.ts'
import { deliverToPageUrl, HopLedger } from './delivery.ts'
import type { DeliverPageOptions, DeliveryResult } from './delivery.ts'

/** 服务名（ctx.pageRegistry / inject 'pageRegistry'）/ service name */
export const PAGE_REGISTRY_NAME = 'pageRegistry'

/** 存储不可用时的失败索引：所有操作给 page/index-unavailable / the failing index */
class UnavailableIndex implements PageInstanceIndex {
  lookup(): Promise<undefined> { return Promise.reject(unavailable()) }
  reserve(): Promise<PageInstanceRecord> { return Promise.reject(unavailable()) }
  commit(): Promise<PageInstanceRecord> { return Promise.reject(unavailable()) }
  deprecate(): Promise<PageInstanceRecord | undefined> { return Promise.reject(unavailable()) }
  fail(): Promise<void> { return Promise.reject(unavailable()) }
  forget(): Promise<void> { return Promise.reject(unavailable()) }
  listByApp(): Promise<readonly PageInstanceRecord[]> { return Promise.reject(unavailable()) }
  sweepReserved(): Promise<readonly PageInstanceKey[]> { return Promise.reject(unavailable()) }
}

function unavailable(): PageError {
  return new PageError(PageErrorCode.IndexUnavailable, `storage domain "${APP_PAGES_DOMAIN_NAME}" is unavailable; the instance index is read-only-failing`)
}

/**
 * 页面注册表服务：register/resolve 以 disposer 收口（HMR/卸载安全）。
 * resolve/get 以泛型转发（消费方声明自己的 state 类型）。
 */
export class PageRegistryService extends Service {
  /** 存储域是本插件声明过的依赖（属主合法访问）；装配顺序由 Loader 保证。 */
  static inject = ['storageDomain']

  private indexFace: PageInstanceIndex = new UnavailableIndex()
  private readonly registry: PageRegistry<never>
  /** 运行时端口：装配层 bindPorts 纯参数传入；未接线前是 undefined（fail loud）。 */
  private runtimePorts: PageRuntimePorts | undefined
  /** 投递链深台账（§3.9 级联闸门的状态）/ the hop ledger (§3.9 cascade gate state) */
  private readonly ledger = new HopLedger()

  /** 页面实例索引：规范 URL → 当前活会话 + 废弃历史（持久化在 app-pages 域）*/
  get instances(): PageInstanceIndex { return this.indexFace }

  /** 端口读取口：未接线即 fail loud（misconfiguration fails loud）/ ports accessor; unbound → fail loud */
  private get ports(): PageRuntimePorts {
    const ports = this.runtimePorts
    if (ports === undefined) {
      throw new PageError(PageErrorCode.HostUnavailable,
        'page-registry has no bound ports; the host assembly (app-host bindPorts) must run before the page runtime is used')
    }
    return ports
  }

  /**
   * @param ctx - 宿主上下文 / host context
   */
  constructor(ctx: Context) {
    super(ctx, PAGE_REGISTRY_NAME)
    this.registry = new PageRegistry<never>()
    // 域打开是异步的：先给失败索引，打开成功后原位换实现（打开失败保持降级）
    void this.openDomain().then(async (table) => {
      if (table === undefined) return
      this.indexFace = new KvPageInstanceIndex(table, {
        sessionExists: (id) => this.ports.sessions.exists(id),
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
    }, (error: unknown) => {
      ctx.logger.error(`page-registry: storage domain "${APP_PAGES_DOMAIN_NAME}" failed to open: ${String(error)}`)
    })
  }

  /**
   * 打开 app-pages 存储域。storageDomain 是本服务声明过的 inject 依赖；这里
   * 捕获的是"存储域打不开/服务缺席"的运行故障 → 失败索引 + 告警，是既有文档
   * 化的降级语义，不是对兄弟服务的运行期探测（G13 禁的是后者）。
   * Open the app-pages storage domain. storageDomain is a declared inject; the
   * catch handles genuine storage failures (documented degrade to the failing
   * index), not sibling probing, which G13 forbids.
   */
  private async openDomain(): Promise<InstanceKvPort | undefined> {
    try {
      // 一次重激活可能留下上一个激活打开的同名域：先关掉再开（与 notebook 同型）
      const stale = this.ctx.storageDomain.get(APP_PAGES_DOMAIN_NAME)
      if (stale !== undefined) {
        try {
          await stale.close()
          this.ctx.logger.warn('page-registry: closed the storage domain left open by a previous activation')
        } catch (error: unknown) {
          this.ctx.logger.warn(`page-registry: the previous storage domain could not close: ${String(error)}`)
        }
      }
      const domain = await this.ctx.storageDomain.open(appPagesDomain)
      // 句柄归本服务：卸载时关闭，给下一次激活腾出名字
      this.ctx.effect(() => () => domain.close(), 'page-registry:storage')
      return instanceTableView(domain.table('instances'))
    } catch (error: unknown) {
      this.ctx.logger.warn(`page-registry: storage domain "${APP_PAGES_DOMAIN_NAME}" unavailable (${String(error)}); instance index is disabled`)
      return undefined
    }
  }

  /**
   * 装配缝隙（唯一的端口来源）：所需端口全部由参数传入（G13 规则 2），整体
   * 替换、不与旧端口合并——"半端口"状态在类型上不存在。
   * Assembly seam (the only port source): all ports arrive as pure parameters
   * and replace the previous set wholesale — no partial-port state can exist.
   */
  bindPorts(ports: PageRuntimePorts, index?: PageInstanceIndex): void {
    this.runtimePorts = ports
    if (index !== undefined) this.indexFace = index
  }

  /** 注册页面；重名/URL 模式冲突 fail loud；返回 disposer / register with a disposer */
  register(page: PageDefinition<never>): () => void {
    return this.registry.register(page)
  }

  /**
   * 应用作用域注册（对接 A 的 `ctx.apps.pages(id)`）：URL 必须已是
   * `/apps/<appId>/...` 形态；这是 `page.<name>` 预设路径的替代入口。
   * 页面在注册表里以 pageKey（`<appId>/<本地名>`，§3.4.3 的全局页面身份）为名：
   * 本地名（list/detail…）跨应用必然重名，全局按裸名登记会让第二个应用在
   * duplicate-name 上炸掉或被幂等检查跳过——第四轮真机 task-workbench 失败点。
   * App-scoped registration (pairs with app-registry's `ctx.apps.pages(id)`):
   * the url must already be `/apps/<appId>/...`. Pages register under their
   * pageKey (`<appId>/<localName>`, the §3.4.3 global page identity): local
   * names (list/detail…) necessarily collide across apps, and registering them
   * bare makes the second app explode on duplicate-name or get silently
   * skipped by idempotency checks — the round-4 live task-workbench failure.
   */
  registerAppPage(appId: string, page: PageDefinition<never>, live?: PageLiveBinding): () => void {
    if (!page.url.startsWith(`/apps/${appId}/`)) {
      throw new PageError(PageErrorCode.UrlInvalid, `page "${page.name}" of app "${appId}" must register under /apps/${appId}/, got ${page.url}`)
    }
    const scoped: PageDefinition<never> = { ...page, name: `${appId}/${page.name}` }
    return this.registry.register(scoped, live)
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
   * 打开一个页面 URL：一律新建会话；同 URL 旧会话先废弃（§3.5.3、§9.1）。
   * 端口未接线时给 page/host-unavailable（装配缺失 fail loud）。
   */
  openUrl(url: PageInstanceKey | string, options: OpenPageOptions = {}): Promise<OpenPageResult> {
    // async：端口未接线的 fail loud 以 rejected promise 透出，而非同步抛
    return Promise.resolve().then(() => openPageUrl(this.registry, this.instances, this.ports, url, options))
  }

  /**
   * 预挂页面工具面（"选中应用 ≠ 开始会话"）：渲染页面（含首屏 load）收集
   * catalog + 动态工具并挂到该会话的 agent 作用域，但不建实例、不写索引、不追加
   * PAGE 块。首条消息正式提升走 openUrl 的复用路径，同一套定义重挂——模型第一步
   * 的工具面即最终形态。
   * Pre-mount a page's tool face (picking an app is not a session start): render
   * the page (first-screen load included), collect catalog + dynamic tools and
   * mount them on the session's agent scope — no instance, no index row, no PAGE
   * block. The first message's promotion re-mounts the same definitions through
   * openUrl's reuse path, so step 1 already sees the final tool face.
   * @param sessionId - 用户的普通会话 / the user's ordinary session
   * @param url - 页面 URL / the page url
   * @returns 预挂的 URL、标题与工具面 / the pre-mounted url, title, and tool face
   */
  mountPreview(sessionId: string, url: string): Promise<PagePreview> {
    return Promise.resolve().then(() => mountPreviewTools(this.registry, this.ports, sessionId, url))
  }

  /**
   * 撤销预挂（用户改主意 / 提升失败）：摘掉该会话上的页面工具并复位引导工具
   * 屏蔽。只作用于预挂面——真实页面会话的释放走 releaseApp/废弃路径。
   * Release a pre-mounted face (the user changed their mind / promotion failed):
   * strip the page tools and restore the bootstrap deny. Scoped to the preview
   * face — a real page session releases through releaseApp/deprecation.
   * @param sessionId - 预挂所在的会话 / the session holding the preview
   */
  releasePreview(sessionId: string): Promise<void> {
    return Promise.resolve().then(async () => { await this.ports.sessions.releaseTools(sessionId) })
  }

  /**
   * 按 URL 幂等投递（§3.9）：该 URL 有活会话则直接 append（唤醒它干活），
   * 没有则新建会话再投。级联硬上限与废弃竞态重投都在投递运行时收口。
   * Idempotent url-addressed delivery (§3.9): append to the url's live session,
   * or create one first. The cascade hard cap and the deprecation-race
   * re-delivery both close inside the delivery runtime.
   */
  deliverUrl(url: PageInstanceKey | string, options: DeliverPageOptions): Promise<DeliveryResult> {
    return Promise.resolve().then(() => deliverToPageUrl(this.registry, this.instances, this.ports, this.ledger, url, options))
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
        await this.ports.sessions.releaseTools(row.sessionId)
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
        // 应用页以 pageKey（<appId>/<name>）登记，见 registerAppPage
        // app pages register under their pageKey, see registerAppPage
        if (this.registry.get(`${appId}/${page.name}`) === undefined) {
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
