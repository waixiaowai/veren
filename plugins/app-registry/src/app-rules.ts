/**
 * 应用注册表的规则集（纯函数，零状态持有）：清单校验、工具前缀规则、页面
 * URL/键约束与入口状态机。规则在此一处，注册表服务只做编排。
 * The app-registry rule set (pure functions, no state): manifest validation,
 * the tool-prefix rule, page url/key constraints, and the entry state machine.
 * The rules live here once; the registry service only orchestrates.
 *
 * @module @veren/app-registry/app-rules
 */
import { PageError, PageErrorCode, patternParamsOf } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
import { AppErrorCode, RESERVED_APP_IDS } from './types.ts'
import type { ApplicationDefinition, PageKey } from './types.ts'
import { fail } from './errors.ts'
import type { AppEntry } from './app-entry.ts'

/** 工具前缀规则：小写字母开头，仅小写字母/数字/下划线，≤32 字符 / tool-prefix slug rule */
const TOOL_PREFIX_RE = /^[a-z][a-z0-9_]{0,31}$/

/** 校验应用定义：id 格式/保留字/必填字段；重复 id fail loud / validate the definition */
export function validateDefinition(apps: ReadonlyMap<string, AppEntry>, definition: ApplicationDefinition): string {
  const id = definition.id as string
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id) || RESERVED_APP_IDS.includes(id)) {
    fail(AppErrorCode.ManifestInvalid, `invalid app id ${JSON.stringify(id)} (lowercase slug, ≤32 chars, not reserved)`, { id })
  }
  if (apps.has(id)) {
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

/** 校验工具前缀：格式 + 全宿主唯一（冲突时报出双方）；通过即登记占用 / validate the tool prefix; claim it on success */
export function validateAndClaimToolPrefix(prefixOwners: Map<string, string>, prefix: string, id: string): void {
  if (!TOOL_PREFIX_RE.test(prefix)) {
    fail(AppErrorCode.ManifestInvalid,
      `invalid tool prefix ${JSON.stringify(prefix)} (lowercase [a-z0-9_], ≤32 chars)`, { id, toolPrefix: prefix })
  }
  const holder = prefixOwners.get(prefix)
  if (holder !== undefined && holder !== id) {
    fail(AppErrorCode.ToolPrefixConflict,
      `tool prefix "${prefix}" of app "${id}" conflicts with app "${holder}"`,
      { toolPrefix: prefix, existingApp: holder, newApp: id })
  }
  prefixOwners.set(prefix, id)
}

/** 页面 URL 必须落在应用自己的命名空间下 / the page url must live under the app's own namespace */
export function assertPageUnderApp(page: PageDefinition<never>, id: string): void {
  const urlSegments = page.url.split('/').filter((segment) => segment.length > 0)
  if (urlSegments[1] !== id) {
    fail(AppErrorCode.ManifestInvalid,
      `page "${page.name}" url must live under /apps/${id}/, got ${JSON.stringify(page.url)}`,
      { appId: id, url: page.url })
  }
}

/** 页面键应用内唯一（重复 fail loud）/ the page key is unique within the app (duplicates fail loud) */
export function assertPageKeyAvailable(entry: AppEntry, id: string, page: PageDefinition<never>): void {
  if (entry.pages.has(page.name)) {
    fail(AppErrorCode.ManifestInvalid, `duplicate page key "${id}/${page.name}" in app "${id}"`,
      { appId: id, page: page.name })
  }
}

/**
 * §3.10.5 规则 1（注册期，fail loud；2026-10-21 收窄）：首页 URL 不含 :param；
 * map **仅当本应用还有记录页（详情/只读详情 viewer）时**强制非空——单页应用/
 * 纯仪表盘应用的空 map 合法，不许因此报错。规则在两个注册序上都成立：先记录
 * 页后首页 → 首页注册时在本页查；先首页后记录页 → 记录页注册时回头查已登记
 * 的首页。规则 4 的 entry-not-home broken 态（refreshEntryState）是未来旁路
 * 注册的兜底；经本注册面的参数化 entry 页在此即被拒。
 * §3.10.5 rule 1 (registration time, fail loud; narrowed 2026-10-21): the
 * home page carries no :param, and its map is demanded **only while the app
 * also has record pages (detail / viewer)** — an empty map is legal for
 * single-page / pure-dashboard apps and must never be rejected. The rule
 * holds on both registration orders: record-page-then-home is checked here
 * (at the home's own registration); home-then-record-page re-checks the
 * registered home when the record page arrives. Rule 4's entry-not-home
 * broken state (refreshEntryState) stays the backstop for any future bypass;
 * through this registration path a parameterized entry page is rejected here.
 */
export function assertHomeWithoutParams(entry: AppEntry, id: string, page: PageDefinition<never>): void {
  const entryParams = page.name === entry.definition.entry ? patternParamsOf(page.url) : []
  if (entryParams.length > 0) {
    throw new PageError(PageErrorCode.HomeInvalid,
      `home page "${id}/${page.name}" must be parameter-free, got :params ${JSON.stringify(entryParams)}`,
    )
  }
}

/**
 * 入口页面在位且为首页（home 档，无 :param）→ active；缺失 → broken
 * （EntryMissing）；在位但带 :param → broken（§3.10.5 规则 4 的 entry-not-home，
 * 同路不抛异常）。经正常注册面参数化的 entry 页已在注册时被拒（规则 1），
 * 本分支是旁路的兜底。
 * Entry page present and a home page (the home archetype, no :param) → active;
 * missing → broken (EntryMissing); present but parameterized → broken
 * (§3.10.5 rule 4's entry-not-home, same route, no throw). The normal
 * registration path already rejects a parameterized entry (rule 1); this
 * branch is the bypass backstop.
 */
export function refreshEntryState(entry: AppEntry): void {
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
