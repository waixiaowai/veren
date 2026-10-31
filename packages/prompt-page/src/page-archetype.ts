/**
 * 页面档位：两轴四档推导（§3.10.1）与挂载期参数门禁（§3.10.5 规则 5）。
 * Page archetypes: the two-axis, four-tier derivation (§3.10.1) and the
 * mount-time params gate (§3.10.5 rule 5).
 *
 * @module @veren/prompt-page/page-archetype
 */
import { PageError, PageErrorCode } from './page-errors.ts'
import { patternParamsOf } from './app-url.ts'
import type { PageDefinition } from './types.ts'

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
