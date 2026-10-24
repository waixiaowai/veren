/**
 * 页面实例与 URL 契约 / page-instance & url contract
 *
 * 应用侧（app-registry）与任务侧（task-center）共用的最小面集中在这里；
 * prompt-page 不 import 任何插件包——插件来实现本文件的接口（依赖方向：插件 → 本包）。
 * The minimal face shared by the two plugins lives here; plugins depend on this
 * package, never the reverse (no import cycles).
 *
 * 归属：本文件的实现（URL 索引读写、规范化函数体）由会话 C 完成；第 0 步只锁签名。
 * Implementation (index storage, canonicalizer body) belongs to session C.
 */
import { normalizePath } from './registry.ts'
import type { PageDefinition } from './types.ts'

/** 规范 URL：页面实例的主键（brand，零运行时开销）/ canonical url, the page-instance primary key */
export type PageInstanceKey = string & { readonly __brand: 'PageInstanceKey' }

/** 应用 id（最小字符串面；完整契约在 @veren/app-registry）/ app id minimal string face */
export type AppIdString = string

/**
 * URL 规范化函数签名（§3.5.1：路径规范化、查询串参与身份、query 按 key/value
 * 排序、去空查询串、拒绝片段）。实现在下方。
 * Signature of the canonicalizer; the implementation follows below.
 */
export type CanonicalizePageUrl = (input: string) => PageInstanceKey

/**
 * URL 规范化（§3.5.1）：
 * 1. 拒绝片段（`#...` 不是页面身份的一部分）；
 * 2. 路径规范化：补前导 `/`、去尾 `/`（根除外）、折叠空段、每段解码后按
 *    RFC 3986 重新编码（percent 编码统一）；不做 host/scheme 规范化；
 * 3. 查询串参与身份：按 key 排序（同 key 多值再按 value 排序），去空查询串。
 * 规范 URL 是索引、任务、通知共用的那一份；失败 fail loud（page/url-invalid）。
 * Canonicalizes per §3.5.1; fails loud on malformed input.
 */
export const canonicalizePageUrl: CanonicalizePageUrl = (input: string): PageInstanceKey => {
  const fail = (why: string): never => {
    throw new PageError(PageErrorCode.UrlInvalid, `canonicalizePageUrl: ${why}: ${JSON.stringify(input)}`)
  }
  if (typeof input !== 'string' || input.length === 0) fail('url must be a non-empty string')
  if (input.includes('#')) fail('fragment is not part of a page identity')
  const queryIndex = input.indexOf('?')
  const rawPath = queryIndex === -1 ? input : input.slice(0, queryIndex)
  const rawQuery = queryIndex === -1 ? '' : input.slice(queryIndex + 1)
  // 路径：拆段 → 解码 → 重编码（统一 percent 形态）；根路径保持 "/"
  const segments = normalizePath(rawPath).split('/').filter((segment) => segment.length > 0)
  const path = `/${segments.map((segment) => {
    try {
      return encodeURIComponent(decodeURIComponent(segment))
    } catch {
      return fail('path segment has malformed percent-encoding')
    }
  }).join('/')}`
  // 查询：key 排序（同 key 按 value），空查询串去掉
  const pairs = [...new URLSearchParams(rawQuery)].sort((a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
  )
  const queryString = new URLSearchParams(pairs).toString()
  return `${path}${queryString.length > 0 ? `?${queryString}` : ''}` as PageInstanceKey
}

// ---- 结构化错误（稳定 code）/ structured errors with stable codes ----

/**
 * 页面侧稳定错误码（§5.6）。错误码常量冻结；本表是会话 C 对 §5.6 的落地，
 * 新增码先报告。Stable page-side codes; frozen — report before adding.
 */
export const PageErrorCode = {
  /** URL 不合法 / url failed canonicalization */
  UrlInvalid: 'page/url-invalid',
  /** URL 没有命中任何已注册页面 / url matched no registered page */
  PageNotFound: 'page/not-found',
  /** 页面工具与既有工具重名 / page tool name conflicts with an existing tool */
  ToolConflict: 'page/tool-conflict',
  /** 页面引用了不存在的工具 / page references an unknown tool */
  UnknownTool: 'page/unknown-tool',
  /** 索引不可用（存储失败）/ instance index unavailable */
  IndexUnavailable: 'page/index-unavailable',
  /** 索引冲突：URL 已有行 / sessionId 已被占用 / index conflict on url or sessionId */
  IndexConflict: 'page/index-conflict',
  /** 会话创建失败 / session creation failed */
  SessionCreateFailed: 'page/session-create-failed',
  /** 宿主能力缺失（sessions/agents 等）/ host capability missing */
  HostUnavailable: 'page/host-unavailable',
  /** 应用未注册 / app not registered */
  AppNotFound: 'app/not-found',
  /** 应用被禁用或损坏 / app disabled or broken */
  AppDisabled: 'app/disabled',
  /** 任务已过期 / task expired before take */
  TaskExpired: 'task/expired',
  /**
   * 投递链深超硬上限（§3.9 级联闸门）：A 投 B、B 投 C…… 超过
   * MAX_DELIVERY_HOPS 跳即拒绝，构造上阻断"页面自开页"式级联复发。
   * Delivery chain exceeded the hard hop cap (§3.9 cascade gate): A→B→C…
   * is refused past MAX_DELIVERY_HOPS — a structural brake, not caller discipline.
   */
  HopLimit: 'page/hop-limit',
  /**
   * 首页（home 档）结构不合规（§3.10.5 规则 1）：URL 带 :param，或——仅当本应用
   * 还有详情页时——map 为空。单页/纯仪表盘应用的空 map 合法，不报错。
   * / home page structurally invalid (§3.10.5 rule 1): the url carries a :param,
   * or — only when the app also has detail pages — the map is empty. An empty
   * map is legal for single-page / pure-dashboard apps and must not be rejected.
   */
  HomeInvalid: 'page/home-invalid',
  /**
   * 详情页结构不合规（§3.10.5 规则 3）：带 `:param` 且声明 `writes: true` 的页
   * 缺工具或说明为空，注册期拒绝。带 `:param` 而未声明 writes = viewer（只读
   * 详情），不走本门禁——如实注册是它的合法形态。
   * / detail page structurally invalid (§3.10.5 rule 3): a `:param` page that
   * declares `writes: true` yet lacks tools or instructions; registration is
   * refused. A `:param` page without a writes declaration is a viewer (a
   * read-only drilldown) and never sees this gate — honest registration is its
   * legal shape.
   */
  DetailInvalid: 'page/detail-invalid',
  /**
   * PAGE 块 params 与 URL 模式 :param 不一致（§3.10.5 规则 5），挂载期 fail loud。
   * / the PAGE block params disagree with the url pattern's :params (rule 5);
   * fails loud at mount.
   */
  ParamsMismatch: 'page/params-mismatch',
  /**
   * 首屏 load 失败（§3.10.3）：错误本身写进 PAGE 块 data 行，附重试指引。
   * / the first-screen load failed (§3.10.3): the error lands in the PAGE
   * block's data line with a retry hint.
   */
} as const

export type PageErrorCode = (typeof PageErrorCode)[keyof typeof PageErrorCode]

/** 带稳定 code 的结构化错误 / a structured error carrying a stable code */
export class PageError extends Error {
  /**
   * @param code - 稳定错误码 / stable machine-readable code
   * @param message - 人读说明 / human-readable account
   */
  constructor(readonly code: PageErrorCode, message: string) {
    super(message)
    this.name = 'PageError'
  }
}

/**
 * 页面实例状态（§3.5.2）/ instance states:
 * - `reserved`：两阶段创建中（会话尚未建成，崩溃遗迹可清扫）；
 *   in the two-phase create (session not built yet; crash remnants sweepable);
 * - `live`：该 URL 当前的活会话；一个 URL 同一时刻至多一行 live；
 *   the url's one current live session (at most one live row per url);
 * - `deprecated`：被"重开同 URL"取代的历史会话行；仍可读，但不再通过 URL
 *   访问、不再挂页面工具、租约已释放。/ a historical session superseded by a
 *   fresh open of the same url; still readable, but never addressed via the
 *   url again, its page tools stripped and its task leases released.
 */
export type PageInstanceState = 'reserved' | 'live' | 'deprecated'

/** 一条页面实例记录 / one page-instance record */
export interface PageInstanceRecord {
  /** 规范 URL（主键，唯一）/ canonical url (unique) */
  readonly url: PageInstanceKey
  readonly state: PageInstanceState
  readonly appId: AppIdString
  /** 页面键：`appId/pageName` / page key */
  readonly page: string
  /** 对应的 DSH 会话（唯一）/ bound session id (unique) */
  readonly sessionId: string
  /** 会话列表里展示的实例标题 / instance title shown in session lists */
  readonly instanceTitle: string
  /** 参数快照 / params snapshot */
  readonly params: Readonly<Record<string, string>>
  /** 创建时的应用版本 / app version at creation */
  readonly appVersion: string
  readonly createdAt: string
  readonly lastOpenedAt: string
  /** 废弃时间（仅 `state = deprecated` 的历史行携带）/ deprecation time (deprecated history rows only) */
  readonly deprecatedAt?: string
}

/**
 * 页面实例索引（§3.5）：规范 URL → "当前活会话" 指针 + 历史废弃行。
 * 打开 URL 一律新建会话（用户决策，§9.1）：索引不再是"身份找回"，只回答
 * "这个 URL 现在哪条会话是活的、历史上哪些已废弃"。
 * 两阶段创建保留：崩溃中的创建最多留下 reserved 行（可清扫），不会把一条
 * 没建成的会话写成 live 指针或废弃历史。
 * The instance index (§3.5): canonical url → the current live session, plus
 * deprecated history rows. Opening a url ALWAYS creates a fresh session (user
 * decision, §9.1): the index no longer "recovers identity", it only records
 * which session is live on a url and which history rows were deprecated.
 * The two-phase create stays: a crash mid-creation leaves at most a reserved
 * row (sweepable); a half-built session never becomes a live pointer or a
 * deprecated history row.
 */
export interface PageInstanceIndex {
  /** 查规范 URL 当前指向的实例（deprecated 行不在此列，走 history 行）/ the url's current row */
  lookup(url: PageInstanceKey): Promise<PageInstanceRecord | undefined>
  /** 写 reserved 行（两阶段第一步）/ write a reserved row */
  reserve(url: PageInstanceKey, sessionId: string, snapshot: InstanceSnapshot): Promise<PageInstanceRecord>
  /** reserved → live（两阶段第二步）/ flip a reserved row to live */
  commit(url: PageInstanceKey, sessionId: string): Promise<PageInstanceRecord>
  /**
   * 把当前行标废弃并挪进历史（键 `deprecated:<sessionId>`），腾出 URL；
   * 返回废弃行，无行时返回 undefined。/ deprecate the current row into history
   * (key `deprecated:<sessionId>`), freeing the url; returns the deprecated row
   * or undefined when absent.
   */
  deprecate(url: PageInstanceKey, reason: string): Promise<PageInstanceRecord | undefined>
  /** 创建失败：删除 reserved 行，不留幽灵索引 / creation failed: drop the reserved row */
  fail(url: PageInstanceKey, reason: string): Promise<void>
  /** 会话已被删除：忘记这一行（下次打开重建）/ session gone: forget the row */
  forget(url: PageInstanceKey): Promise<void>
  /** 按应用列实例（含废弃历史；分组/卸载清理用）/ list instances of one app (history included) */
  listByApp(appId: AppIdString): Promise<readonly PageInstanceRecord[]>
  /**
   * 启动清扫：删掉会话已不在的 reserved 残留行，返回被删 URL（§3.5.3/§7.5）。
   * 没有会话存活探测能力时返回空数组（确认不了就不删，不假装做了）。
   * Startup sweep: drop reserved rows whose session is gone; without a
   * liveness probe it drops nothing (no confirmation, no pretend).
   */
  sweepReserved(): Promise<readonly PageInstanceKey[]>
}

/** reserve 时的快照入参 / snapshot accepted by reserve() */
export interface InstanceSnapshot {
  readonly appId: AppIdString
  readonly page: string
  readonly instanceTitle: string
  readonly params: Readonly<Record<string, string>>
  readonly appVersion: string
}

// ---- 应用作用域 URL 形态校验 / app-scoped url shape validation ----

/** 页面 URL 统一前缀 / the one page-url prefix */
export const APPS_URL_PREFIX = '/apps'

/** 应用 id 保留字 / reserved app ids */
export const RESERVED_APP_IDS: readonly string[] = ['api', 'apps', 'system', '__global__']

const APP_SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/

/** 应用 id 是否合法 slug / whether an app id is a valid slug */
export function isValidAppId(id: string): boolean {
  return APP_SLUG_RE.test(id) && !RESERVED_APP_IDS.includes(id)
}

/**
 * 校验页面 URL 模式为 `/apps/<appId>/<应用内路径>` 形态（保留 `:param` 规则）。
 * 应用内路径不能以 `apps` 段开头；查询串不允许出现在模式里。
 * Validates the `/apps/<appId>/...` pattern shape; keeps `:param` rules.
 * @throws Error 形态不合法时 / on an invalid shape
 */
export function assertAppUrlPattern(pageName: string, url: string): void {
  const fail = (why: string): never => {
    throw new Error(`[page-url] page "${pageName}" ${why}: ${JSON.stringify(url)}`)
  }
  if (!url.startsWith(`${APPS_URL_PREFIX}/`)) fail(`url must start with ${APPS_URL_PREFIX}/<appId>/`)
  if (url.includes('?') || url.includes('#')) fail('url pattern must not carry a query or fragment')
  const segments = normalizePath(url).split('/').filter((segment) => segment.length > 0)
  const appId = segments[1]!
  if (!isValidAppId(appId)) fail(`has an invalid app id segment ${JSON.stringify(appId)}`)
  if (segments[2] === 'apps') fail('app-internal path must not start with the "apps" segment')
  const paramNames = new Set<string>()
  for (const segment of segments.slice(2)) {
    if (!segment.startsWith(':')) continue
    const paramName = segment.slice(1)
    if (paramName.length === 0 || paramNames.has(paramName)) {
      fail(`has an invalid or duplicate :param ${JSON.stringify(segment)}`)
    }
    paramNames.add(paramName)
  }
}

/**
 * `/apps/<appId>/<应用内路径>` 是否合法形态。仅供测试/对外契约——生产校验走
 * `assertAppUrlPattern`（fail loud），本函数是其布尔查询面。
 * Whether a url has a valid app-scoped shape. Test-only / external contract:
 * production validation is `assertAppUrlPattern` (fail loud); this is its
 * boolean query face.
 */
export function isAppUrlPattern(url: string): boolean {
  try {
    assertAppUrlPattern('check', url)
    return true
  } catch {
    return false
  }
}

/** URL 模式里声明的全部 `:param` 名（按出现顺序）/ every `:param` name a url pattern declares, in order */
export function patternParamsOf(url: string): readonly string[] {
  return url.split('/').filter((segment) => segment.startsWith(':') && segment.length > 1).map((segment) => segment.slice(1))
}

/**
 * 页面档位（§3.10.1 两轴四档 + 只读剩余形态）：**记录身份**（URL 是否带 `:param`）
 * × **写意图**（是否声明 `writes: true`）两轴，加 entry 归属，推出五个格子——
 * home（入口）/ detail（带参写）/ viewer（带参只读）/ action（无参写）/
 * readonly（无参只读，剩余形态）。viewer 是 2026-10-21 补上的最后一块：
 * 只读详情页（如 `/workspace/:wsId` 下钻）不再被迫声明 `writes: true` 才能注册。
 * The page archetype (§3.10.1's two-axis, four-tier taxonomy plus the read-only
 * leftover): **record identity** (a `:param` in the url) × **write intent** (a
 * `writes: true` declaration), plus the entry flag, yields five cells — home
 * (the entry) / detail (parameterized + writing) / viewer (parameterized +
 * read-only) / action (parameterless + writing) / readonly (parameterless +
 * read-only, the legal leftover). `viewer` closes the last gap (2026-10-21):
 * a read-only drilldown (e.g. `/workspace/:wsId`) no longer has to claim
 * `writes: true` just to register.
 */
export type PageArchetype = 'home' | 'detail' | 'viewer' | 'action' | 'readonly'

/**
 * 两轴四档推导（§3.10.1）：URL 带 `:param` → 声明 `writes: true` 是 `detail`，
 * 未声明是 `viewer`（只读详情，如实注册，无额外要求）；无参且是 entry → `home`；
 * 无参、非 entry、声明 `writes: true` → `action`；无参非入口只读 → `readonly`
 * （只读副页，仪表盘应用的合法第二屏）。`entryKey` 缺省 = 调用方不知道入口
 * （裸注册场景），此时无参页面不判 `home`。分类写进注册契约：推导规则只有
 * 这一份，app-registry 的注册校验与文档口径共用它。
 * The two-axis, four-tier derivation (§3.10.1): a `:param` url → `detail` when
 * `writes: true` is declared, `viewer` otherwise (a read-only drilldown that
 * registers honestly, nothing demanded); parameterless and the entry → `home`;
 * parameterless, non-entry, declaring `writes: true` → `action`; parameterless
 * non-entry read-only → `readonly` (a legal secondary page of dashboard apps).
 * Without `entryKey` the caller does not know the entry (raw registration), so
 * a parameterless page is never classified home. The taxonomy is part of the
 * registration contract: this is the one derivation, shared by app-registry's
 * registration checks and the doc's wording.
 */
export function pageArchetypeOf(
  page: Pick<PageDefinition<never>, 'name' | 'url' | 'writes'>,
  entryKey?: string,
): PageArchetype {
  if (patternParamsOf(page.url).length > 0) return page.writes === true ? 'detail' : 'viewer'
  if (entryKey !== undefined && page.name === entryKey) return 'home'
  return page.writes === true ? 'action' : 'readonly'
}

/**
 * §3.10.5 规则 5（挂载期，写 PAGE 块前）：实例参数必须覆盖 URL 模式声明的
 * 每个 `:param`，逐字一致。查询参数允许作为额外键存在（模式不含查询串）。
 * 解析器（matchPath）在构造上已保证这一点；本断言是挂载路径的廉价防线，
 * 违反即 `page/params-mismatch` fail loud。
 * §3.10.5 rule 5 (mount-time, before the PAGE block): the instance params must
 * cover every `:param` the pattern declares, verbatim. Query params may appear
 * as extra keys (patterns never carry a query). The resolver guarantees this by
 * construction; this assertion is the mount path's cheap tripwire, failing loud
 * with `page/params-mismatch`.
 */
export function assertParamsMatchPattern(pattern: string, params: Readonly<Record<string, string>>): void {
  const missing = patternParamsOf(pattern).filter((name) => !(name in params))
  if (missing.length > 0) {
    throw new PageError(PageErrorCode.ParamsMismatch,
      `params ${JSON.stringify(Object.keys(params))} do not cover the :params ${JSON.stringify(missing)} declared by ${JSON.stringify(pattern)}`)
  }
}
