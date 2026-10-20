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
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineAppPage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
import { AppErrorCode } from './types.ts'
import type { AppCapability, AppId, AppPageRegistrar, AppRecord, AppToolEntry, AppToolRegistrar, ApplicationDefinition, PageKey, PageMirrorFace } from './types.ts'
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
  pages: Map<string, PageDefinition<never>>
  /** 工具目录：本地名 → DSH 工具本体 + 注册期元数据 / local name → DSH tool + meta */
  tools: Map<string, AppToolEntry>
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
   * 装配镜像面（宿主装配/测试用）：给定了就自动镜像；没给定只在注册页面时
   * 告警——目录可见但 openUrl 解析不到的漂移由 pageRegistry.auditAppPages 发现。
   * Install the mirror face (host assembly / tests). Without it a warning is
   * logged at page registration; residual drift is surfaced by auditAppPages.
   */
  setPageMirror(mirror: PageMirrorFace | undefined): void {
    this.mirror = mirror
  }

  /** 显式装配优先，否则零配置结构探测宿主 `pageRegistry` 服务。 */
  private resolveMirror(): PageMirrorFace | undefined {
    if (this.mirror !== undefined) return this.mirror
    const pageRegistry = this.host.get('pageRegistry') as
      | {
        registerAppPage?: (appId: string, page: PageDefinition<never>) => () => void
        releaseApp?: (appId: string) => Promise<void>
      }
      | undefined
    if (pageRegistry?.registerAppPage === undefined) return undefined
    this.mirror = {
      registerAppPage: (appId, page) => pageRegistry.registerAppPage!(appId, page),
      ...(pageRegistry.releaseApp === undefined ? {} : { releaseApp: (appId) => pageRegistry.releaseApp!(appId) }),
    }
    return this.mirror
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
    entry.tools.clear()
  }

  // ---- pages 注册面 / page registrar ----

  /**
   * 页面注册面：只允许注册该应用的 fiber 自己获取（校验调用方归属）。
   * The page registrar: only the fiber that registered the app may obtain it.
   */
  pages(id: AppId, caller?: Context): AppPageRegistrar {
    const entry = this.requireOwned(id, caller, 'pages')
    return {
      register: (page: PageDefinition<never>): (() => void) => this.registerPage(entry, id, page),
    }
  }

  /** 校验并以应用内唯一键登记一个页面 / validate and add one page under its unique key */
  private registerPage(entry: AppEntry, id: AppId, raw: PageDefinition<never>): () => void {
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
    for (const localName of page.tools ?? []) {
      if (!entry.tools.has(localName)) {
        fail(AppErrorCode.ManifestInvalid,
          `page "${page.name}" references unknown tool "${localName}" (define tools before pages)`,
          { appId: id, page: page.name, tool: localName })
      }
    }
    entry.pages.set(page.name, page)
    this.refreshEntryState(entry, id)
    // 缺口 3：单入口——内部镜像进 page-registry；镜像失败回滚内部登记并抛原错。
    // Gap 3: single entry — mirror into page-registry; a mirror failure rolls
    // the internal registration back and rethrows the original error.
    const mirrorDispose = this.mirrorPage(id, page)
    return () => {
      mirrorDispose?.()
      // 注销幂等：只在自己仍是当前登记时摘除 / idempotent: remove only if still current
      if (entry.pages.get(page.name) === page) {
        entry.pages.delete(page.name)
        this.refreshEntryState(entry, id)
      }
    }
  }

  /** 镜像一次页面注册；失败回滚内部登记 / mirror one page; roll back on failure */
  private mirrorPage(id: AppId, page: PageDefinition<never>): (() => void) | undefined {
    const face = this.resolveMirror()
    if (face === undefined) {
      this.host.logger.warn(
        `apps: no page mirror wired; page "${id}/${page.name}" is visible in the app catalog but not resolvable by openUrl`,
      )
      return undefined
    }
    try {
      const dispose = face.registerAppPage(id, page)
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
      if (entry !== undefined && entry.pages.get(page.name) === page) {
        entry.pages.delete(page.name)
        this.refreshEntryState(entry, id)
      }
      throw error
    }
  }

  // ---- tools 注册面 / tool registrar ----

  /** 工具注册面：同样校验 fiber 归属 / the tool registrar, ownership-checked as well */
  tools(id: AppId, caller?: Context): AppToolRegistrar {
    const entry = this.requireOwned(id, caller, 'tools')
    return {
      define: (tool, meta): (() => void) => this.defineTool(entry, id, tool, meta),
    }
  }

  /** 校验并登记一个工具（本地名应用内唯一；本体保持纯 DSH 形状）/ validate and add one tool */
  private defineTool(entry: AppEntry, id: AppId, tool: ToolDefinition, meta?: { readonly requires?: readonly AppCapability[] }): () => void {
    const name = tool.name
    if (typeof name !== 'string' || name.length === 0 || name.length > 24 || name.trim() !== name) {
      fail(AppErrorCode.ManifestInvalid,
        `tool local name must be non-empty, trimmed and ≤24 chars, got ${JSON.stringify(name)}`,
        { appId: id, tool: name })
    }
    if (entry.tools.has(name)) {
      fail(AppErrorCode.ToolDuplicate,
        `tool "${name}" already defined in app "${id}"`, { appId: id, tool: name })
    }
    entry.tools.set(name, { tool, ...(meta?.requires === undefined ? {} : { requires: meta.requires }) })
    return () => {
      if (entry.tools.get(name)?.tool === tool) entry.tools.delete(name)
    }
  }

  /** 工具对外最终名：`<toolPrefix>__<本地名>` / the exported name `<toolPrefix>__<local>` */
  exportToolName(id: AppId, localName: string): string {
    const entry = this.apps.get(id)
    if (!entry) fail(AppErrorCode.NotFound, `app "${id}" is not registered`, { appId: id })
    return `${entry.toolPrefix}__${localName}`
  }

  /**
   * 列出应用工具目录：DSH `ToolDefinition` 本体（未改字段）+ 对外名 + requires。
   * The app's catalog: DSH definitions untouched, plus external names and requires.
   */
  listTools(id: AppId): ReadonlyArray<ToolDefinition & { readonly externalName: string; readonly requires?: readonly AppCapability[] }> {
    const entry = this.apps.get(id)
    if (!entry) fail(AppErrorCode.NotFound, `app "${id}" is not registered`, { appId: id })
    return [...entry.tools.values()].map(({ tool, requires }) => ({
      ...tool,
      externalName: `${entry.toolPrefix}__${tool.name}`,
      ...(requires === undefined ? {} : { requires }),
    }))
  }

  /** 列出应用已注册页面 / list the app's registered pages */
  listPages(id: AppId): readonly PageDefinition<never>[] {
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

  /** 入口页面在位 → active；缺失 → broken（带 EntryMissing 原因），不抛异常 */
  /** Entry page present → active; missing → broken with an EntryMissing reason. */
  private refreshEntryState(entry: AppEntry, id: string): void {
    const hasEntry = entry.pages.has(entry.definition.entry as PageKey)
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
    }
  }
}

/** 类型仅在内部使用时仍需导出面最小化（保持 index 出口干净）/ keep AppRegistryError exported for consumers */
export { AppRegistryError }
