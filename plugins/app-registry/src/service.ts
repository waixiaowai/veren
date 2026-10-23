/**
 * AppRegistryService：宿主级应用注册表（`ctx.apps`）。
 * AppRegistryService: the host-level application registry (`ctx.apps`).
 *
 * - register/get/catalog：应用清单（id 全局唯一，重复注册 fail loud）；
 * - pages(id)/tools(id)：只有应用自己的 fiber 能拿到的注册面；
 * - 生命周期：应用与注册它的插件 fiber 绑定，fiber 销毁 → 整应用（页面+工具）摘除，幂等。
 * - register/get/catalog: the application catalog (globally unique ids, fail loud);
 * - pages(id)/tools(id): registrars only the owning app fiber may obtain;
 * - lifecycle: an app is bound to the fiber that registered it; disposing that
 *   fiber removes the whole app (pages + tools), idempotently.
 *
 * 字段语义以 docs/application-concept.cn.md §2/§6/§7 为准；契约类型冻结在 ./types.ts。
 * Field semantics follow the design doc §2/§6/§7; contract types are frozen in ./types.ts.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { PageError, PageErrorCode, defineAppPage, defineComponentPage, pageArchetypeOf, patternParamsOf } from '@veren/prompt-page'
import type { ComponentPageMeta, PageDefinition, PageFC, PageLiveBinding } from '@veren/prompt-page'
import { AppErrorCode } from './types.ts'
import type { AppId, AppPageRegistrar, AppRecord, ApplicationDefinition, PageKey, PageMirrorFace, PageRegistration } from './types.ts'
import { AppRegistryError, fail } from './errors.ts'

/** 服务名（ctx.apps / inject 'apps'）/ service name */
export const APPS_NAME = 'apps'

/** 工具前缀规则：小写字母开头，仅小写字母/数字/下划线，≤32 字符 / tool-prefix slug rule */
const TOOL_PREFIX_RE = /^[a-z][a-z0-9_]{0,31}$/

/** 一条应用的内嵌运行时记录 / internal runtime record of one app */
interface AppEntry {
  definition: ApplicationDefinition
  /** 注册时从 fiber 推导的提供包名 / owner package name derived from the fiber */
  owner: string
  /** 组合包版本快照（第 1 阶段占位）/ bundle version snapshot (placeholder in phase 1) */
  version: string
  /** 分配到的最终工具前缀 / assigned final tool prefix */
  toolPrefix: string
  state: 'active' | 'disabled' | 'broken'
  brokenReason?: string
  /** 注册方 fiber 上下文（归属校验 + 生命周期绑定）/ owning fiber context */
  ownerContext?: Context
  /** 已注册页面，键为应用内页面键 / registered pages keyed by app-internal page key */
  pages: Map<string, PageRegistration>
  /** 镜像注销器（应用级兜底，防止调用方丢弃 disposer）/ mirror disposers (app-level fallback) */
  mirrorDisposers: Array<() => void>
}

export class AppRegistryService extends Service {
  /** id → 内嵌记录 / app id → internal record */
  private readonly apps = new Map<string, AppEntry>()
  /** 工具前缀 → 占用它的应用 id / tool prefix → owning app id */
  private readonly prefixOwners = new Map<string, string>()
  private readonly host: Context
  /**
   * 页面镜像面（缺口 3 收敛）：registerPage 内部自动把页面同步进
   * page-registry，应用作者只调 `ctx.apps.pages(id).register()` 一次。
   * The page mirror (gap-3 convergence): registerPage mirrors every page into
   * page-registry automatically, so app authors call register() once.
   */
  private mirror: PageMirrorFace | undefined

  constructor(ctx: Context) {
    super(ctx, APPS_NAME)
    this.host = ctx
  }

  /**
   * 装配镜像面（宿主装配/测试用）：app-host 在装配时显式接上。没接时注册页面
   * 只告警——目录可见但 openUrl 解析不到的漂移由 pageRegistry.auditAppPages 发现。
   * Install the mirror face (wired explicitly by app-host; host assembly/tests).
   * Without it a warning is logged; residual drift is surfaced by auditAppPages.
   */
  setPageMirror(mirror: PageMirrorFace | undefined): void {
    this.mirror = mirror
  }

  // ---- 注册与注销 / register & unregister ----

  /**
   * 注册一个应用；返回注销函数（幂等）。
   * `owner` 传入调用方（应用插件）自己的 fiber 上下文：
   * 该 fiber 销毁时整应用自动摘除；`pages`/`tools` 的归属校验也以此为凭。
   * Register an app; returns an idempotent disposer. Pass the caller's own fiber
   * context as `owner`: disposing that fiber removes the whole app, and the
   * ownership checks of `pages`/`tools` are validated against it.
   */
  register(definition: ApplicationDefinition, owner?: Context): () => void {
    const id = this.validateDefinition(definition)
    const toolPrefix = definition.toolPrefix ?? id.replace(/-/g, '_')
    this.validateToolPrefix(toolPrefix, id)
    const entry: AppEntry = {
      definition,
      owner: owner?.fiber?.name ?? 'unknown',
      version: '0.0.0',
      toolPrefix,
      state: 'active',
      pages: new Map(),
      tools: new Map(),
      mirrorDisposers: [],
      ownerContext: owner,
    }
    this.apps.set(id, entry)
    // 入口页面允许“先注册、页面后补”：暂缺则标 broken，不抛到宿主启动（§7）。
    // The entry page may be registered after the app: a missing entry breaks the
    // app (with a reason) instead of failing host startup.
    this.refreshEntryState(entry, id)
    const disposeApp = (): void => { this.removeApp(id, entry) }
    if (owner) owner.effect(() => disposeApp, `apps.register(${id})`)
    return disposeApp
  }

  /** 按 id 取应用记录；不存在返回 undefined / look up an app record by id */
  get(id: AppId): AppRecord | undefined {
    const entry = this.apps.get(id)
    return entry ? this.toRecord(entry) : undefined
  }

  /** 应用目录（注册顺序）/ the application catalog in registration order */
  catalog(): readonly AppRecord[] {
    return [...this.apps.values()].map((entry) => this.toRecord(entry))
  }

  /** 注销一个应用（幂等；宿主/测试用，正常路径走 fiber 清理）/ remove an app (idempotent) */
  private removeApp(id: string, entry: AppEntry): void {
    // 已被 fiber 清理或手工注销过：直接返回，保证幂等 / already removed: no-op
    if (this.apps.get(id) !== entry) return
    this.apps.delete(id)
    if (this.prefixOwners.get(entry.toolPrefix) === id) this.prefixOwners.delete(entry.toolPrefix)
    // 卸载语义（§7.2/§7.4）：镜像面（page-registry）先摘该应用所有活会话的
    // 页面工具，会话保留；fire-and-forget，失败只记日志。
    // Uninstall semantics: the mirror (page-registry) strips this app's page
    // tools from live sessions first; sessions are kept. Fire-and-forget.
    void Promise.resolve(this.mirror?.releaseApp?.(id as AppId)).catch((error: unknown) => {
      this.host.logger.warn(`apps: releaseApp(${id}) failed: ${String(error)}`)
    })
    for (const dispose of entry.mirrorDisposers.splice(0)) dispose()
    entry.pages.clear()
  }

  // ---- pages 注册面 / page registrar ----

  /**
   * 页面注册面：只允许注册该应用的 fiber 自己获取（校验调用方归属）。
   * The page registrar: only the fiber that registered the app may obtain it.
   */
  pages(id: AppId, caller?: Context): AppPageRegistrar {
    const entry = this.requireOwned(id, caller, 'pages')
    const owner = caller ?? this.host
    // 组件页是唯一形态（RFC prompt-page-render 减法）：PageFC + meta →
    // defineComponentPage → PageDefinition + 每会话视图。没有第二种页面。
    // The component page is the only shape (RFC prompt-page-render subtraction):
    // PageFC + meta → defineComponentPage → PageDefinition + a per-session view.
    // There is no second kind of page.
    const register = ((componentOrRegistration: PageFC | import('@veren/prompt-page').ComponentPageRegistration, meta?: ComponentPageMeta): (() => void) => {
      // 两种形态：PageFC + meta（现场适配）｜预构建注册对象（调用方自持）
      // / two shapes: PageFC + meta (adapted here) | a pre-built registration (caller-held)
      const registration = typeof componentOrRegistration === 'function'
        ? defineComponentPage(componentOrRegistration as PageFC, (meta ?? {}) as ComponentPageMeta, owner)
        : componentOrRegistration
      return this.registerPage(entry, id, registration.page, registration.live, true)
    }) as unknown as AppPageRegistrar['register']
    return { register }
  }

  /** 校验并以应用内唯一键登记一个页面；live 是组件页的每会话视图绑定（必填）
   * / validate and register one page under its unique key; `live` is the component page's per-session view binding (required) */
  private registerPage(
    entry: AppEntry,
    id: AppId,
    raw: PageDefinition<never>,
    live: PageLiveBinding,
    component = false,
  ): () => void {
    // 走 prompt-page 的 defineAppPage：强制 /apps/<appId>/... 形态与契约缺省。
    // Re-run prompt-page's defineAppPage: enforces the /apps/<appId>/... shape.
    const page = defineAppPage(raw)
    const urlSegments = page.url.split('/').filter((segment) => segment.length > 0)
    if (urlSegments[1] !== id) {
      fail(AppErrorCode.ManifestInvalid,
        `page "${page.name}" url must live under /apps/${id}/, got ${JSON.stringify(page.url)}`,
        { appId: id, url: page.url })
    }
    if (entry.pages.has(page.name)) {
      fail(AppErrorCode.ManifestInvalid, `duplicate page key "${id}/${page.name}" in app "${id}"`,
        { appId: id, page: page.name })
    }
    // §3.10.5 规则 1（注册期，fail loud；2026-10-21 收窄）：首页 URL 不含 :param；
    // map **仅当本应用还有记录页（详情/只读详情 viewer）时**强制非空——单页应用/
    // 纯仪表盘应用的空 map 合法，不许因此报错。规则在两个注册序上都成立：先记录
    // 页后首页 → 首页注册时在本页查；先首页后记录页 → 记录页注册时回头查已登记
    // 的首页。规则 4 的 entry-not-home broken 态（refreshEntryState）是未来旁路
    // 注册的兜底；经本注册面的参数化 entry 页在此即被拒。
    // §3.10.5 rule 1 (registration time, fail loud; narrowed 2026-10-21): the
    // home page carries no :param, and its map is demanded **only while the app
    // also has record pages (detail / viewer)** — an empty map is legal for
    // single-page / pure-dashboard apps and must never be rejected. The rule
    // holds on both registration orders: record-page-then-home is checked here
    // (at the home's own registration); home-then-record-page re-checks the
    // registered home when the record page arrives. Rule 4's entry-not-home
    // broken state (refreshEntryState) stays the backstop for any future bypass;
    // through this registration path a parameterized entry page is rejected here.
    const entryParams = page.name === entry.definition.entry ? patternParamsOf(page.url) : []
    if (entryParams.length > 0) {
      throw new PageError(PageErrorCode.HomeInvalid,
        `home page "${id}/${page.name}" must be parameter-free, got :params ${JSON.stringify(entryParams)}`,
      )
    }
    // 本页登记后的记录页（详情/只读详情）与首页各是谁（本页尚未进 entry.pages，
    // 两类都要把"正在注册的这页"算进去）/ the app's record pages (detail/viewer)
    // and home page as of this registration (the page under registration is not
    // in entry.pages yet, so both faces account for it explicitly)
    const archetype = pageArchetypeOf(page, entry.definition.entry)
    const recordAfter = archetype === 'detail' || archetype === 'viewer'
      || [...entry.pages.values()].some((registered) => patternParamsOf(registered.page.url).length > 0)
    const homeAfter = archetype === 'home' ? page : entry.pages.get(entry.definition.entry)?.page
    const registration: PageRegistration = { page, live, ...(component ? { component: true } : {}) }
    entry.pages.set(page.name, registration)
    this.refreshEntryState(entry, id)
    // 缺口 3：单入口——内部镜像进 page-registry；镜像失败回滚内部登记并抛原错。
    // Gap 3: single entry — mirror into page-registry; a mirror failure rolls
    // the internal registration back and rethrows the original error.
    const mirrorDispose = this.mirrorPage(id, page, registration.live)
    return () => {
      mirrorDispose?.()
      // 注销幂等：只在自己仍是当前登记时摘除 / idempotent: remove only if still current
      if (entry.pages.get(page.name)?.page === page) {
        entry.pages.delete(page.name)
        this.refreshEntryState(entry, id)
      }
    }
  }

  /** 镜像一次页面注册（live 必填）；失败回滚内部登记 / mirror one page (live required); roll back on failure */
  private mirrorPage(id: AppId, page: PageDefinition<never>, live: PageLiveBinding): (() => void) | undefined {
    const face = this.mirror
    if (face === undefined) {
      this.host.logger.warn(
        `apps: no page mirror wired; page "${id}/${page.name}" is visible in the app catalog but not resolvable by openUrl`,
      )
      return undefined
    }
    try {
      const dispose = face.registerAppPage(id, page, live)
      const entry = this.apps.get(id)
      entry?.mirrorDisposers.push(dispose)
      return () => {
        const holder = this.apps.get(id)
        const index = holder?.mirrorDisposers.indexOf(dispose) ?? -1
        if (holder !== undefined && index >= 0) holder.mirrorDisposers.splice(index, 1)
        dispose()
      }
    } catch (error: unknown) {
      const entry = this.apps.get(id)
      if (entry !== undefined && entry.pages.get(page.name)?.page === page) {
        entry.pages.delete(page.name)
        this.refreshEntryState(entry, id)
      }
      throw error
    }
  }

  /** 列出应用已注册页面 / list the app's registered pages */
  listPages(id: AppId): readonly PageDefinition<never>[] {
    return this.listPageEntries(id).map((entry) => entry.page)
  }

  /**
   * 列出应用已注册页面的完整登记（含实时绑定）：宿主装配的回填镜像走这里，
   * 保证"先注册、后装配"的页面不丢 live 绑定。
   * The full registrations (live bindings included): the host assembly's
   * backfill mirror reads this so pages registered before the assembly keep
   * their live bindings.
   */
  listPageEntries(id: AppId): readonly PageRegistration[] {
    const entry = this.apps.get(id)
    if (!entry) fail(AppErrorCode.NotFound, `app "${id}" is not registered`, { appId: id })
    return [...entry.pages.values()]
  }

  // ---- 状态机 / state machine ----

  /** 禁用应用（get/catalog 仍可见，state=disabled）/ disable an app (still listed) */
  disable(id: AppId): void {
    const entry = this.requireApp(id)
    if (entry.state !== 'broken') entry.state = 'disabled'
  }

  /** 重新启用应用（broken 不可被 enable 掩盖）/ re-enable (a broken app stays broken) */
  enable(id: AppId): void {
    const entry = this.requireApp(id)
    if (entry.state === 'disabled') entry.state = 'active'
  }

  /**
   * 入口页面在位且为首页（home 档，无 :param）→ active；缺失 → broken
   * （EntryMissing）；在位但带 :param → broken（§3.10.5 规则 4 的 entry-not-home，
   * 同路不抛异常）。经正常注册面参数化的 entry 页已在 registerPage 被拒（规则 1），
   * 本分支是旁路的兜底。
   * Entry page present and a home page (the home archetype, no :param) → active;
   * missing → broken (EntryMissing); present but parameterized → broken
   * (§3.10.5 rule 4's entry-not-home, same route, no throw). The normal
   * registration path already rejects a parameterized entry (rule 1); this
   * branch is the bypass backstop.
   */
  private refreshEntryState(entry: AppEntry, id: string): void {
    const entryPage = entry.pages.get(entry.definition.entry as PageKey)
    if (entryPage !== undefined && patternParamsOf(entryPage.page.url).length > 0) {
      entry.state = 'broken'
      entry.brokenReason = `${AppErrorCode.EntryNotHome}: entry page "${entry.definition.entry}" (${entryPage.page.url}) carries :params; the entry must be a home page`
      return
    }
    const hasEntry = entryPage !== undefined
    if (hasEntry && entry.state !== 'disabled') {
      entry.state = 'active'
      entry.brokenReason = undefined
    } else if (!hasEntry) {
      entry.state = 'broken'
      entry.brokenReason = `${AppErrorCode.EntryMissing}: entry page "${entry.definition.entry}" is not registered yet`
    }
  }

  // ---- 内部校验 / internal validation ----

  /** 校验应用定义：id 格式/保留字/必填字段；重复 id fail loud / validate the definition */
  private validateDefinition(definition: ApplicationDefinition): string {
    const id = definition.id as string
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id) || ['api', 'apps', 'system', '__global__'].includes(id)) {
      fail(AppErrorCode.ManifestInvalid, `invalid app id ${JSON.stringify(id)} (lowercase slug, ≤32 chars, not reserved)`, { id })
    }
    if (this.apps.has(id)) {
      fail(AppErrorCode.ManifestInvalid,
        `app id "${id}" is already registered (ids are globally unique; not silently overwritten)`, { id })
    }
    for (const field of ['name', 'description', 'entry'] as const) {
      const value = definition[field]
      if (typeof value !== 'string' || value.length === 0) {
        fail(AppErrorCode.ManifestInvalid, `app "${id}" field "${field}" must be a non-empty string`, { id, field })
      }
    }
    return id
  }

  /** 校验工具前缀：格式 + 全宿主唯一（冲突时报出双方）/ validate the tool prefix */
  private validateToolPrefix(prefix: string, id: string): void {
    if (!TOOL_PREFIX_RE.test(prefix)) {
      fail(AppErrorCode.ManifestInvalid,
        `invalid tool prefix ${JSON.stringify(prefix)} (lowercase [a-z0-9_], ≤32 chars)`, { id, toolPrefix: prefix })
    }
    const holder = this.prefixOwners.get(prefix)
    if (holder !== undefined && holder !== id) {
      fail(AppErrorCode.ToolPrefixConflict,
        `tool prefix "${prefix}" of app "${id}" conflicts with app "${holder}"`,
        { toolPrefix: prefix, existingApp: holder, newApp: id })
    }
    this.prefixOwners.set(prefix, id)
  }

  /** 取应用记录或抛 NotFound / require an app record or throw NotFound */
  private requireApp(id: AppId): AppEntry {
    const entry = this.apps.get(id)
    if (!entry) fail(AppErrorCode.NotFound, `app "${id}" is not registered`, { appId: id })
    return entry
  }

  /**
   * fiber 归属校验：注册时绑定了 owner 上下文的应用，
   * 只有同一个上下文才能拿到 pages/tools 注册面（跨应用改动 → Forbidden）。
   * Ownership check: an app registered with an owner context hands its
   * registrars only to that same context (cross-app mutation → Forbidden).
   */
  private requireOwned(id: AppId, caller: Context | undefined, face: string): AppEntry {
    const entry = this.requireApp(id)
    if (entry.ownerContext && caller !== entry.ownerContext) {
      fail(AppErrorCode.Forbidden,
        `app "${id}" ${face} registrar is owned by another fiber`, { appId: id, face })
    }
    return entry
  }

  /** 内嵌记录 → 对外只读视图 / internal entry → the read-only public record */
  private toRecord(entry: AppEntry): AppRecord {
    return {
      definition: entry.definition,
      owner: entry.owner,
      version: entry.version,
      toolPrefix: entry.toolPrefix,
      state: entry.state,
      ...(entry.brokenReason === undefined ? {} : { brokenReason: entry.brokenReason }),
      // 页面投影（map 推导与规则 1 的事实源）：按访问重建，小应用零开销
      // / the page projection (the fact source for map derivation and rule 1): rebuilt per access, trivial for app-scale maps
      pages: new Map(
        [...entry.pages.entries()].map(([key, registered]) => [
          key,
          { url: registered.page.url, description: registered.page.description, component: registered.component ?? false },
        ]),
      ),
    }
  }
}

/** 类型仅在内部使用时仍需导出面最小化（保持 index 出口干净）/ keep AppRegistryError exported for consumers */
export { AppRegistryError }
