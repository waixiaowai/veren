/**
 * 区域（realm）定义：国内版与国际版两套 WorkBuddy 部署。
 * Region (realm) definitions for the two WorkBuddy deployments.
 *
 * 区域从第一天起就是一等概念：两套服务是独立账号体系（独立配额、独立登录、
 * 目录行为不同），区域以数据表驱动而非分支复制。端点表镜像官方 CLI 的
 * `realmConfig`：CN 的 API host 与 web origin 刻意是不同域名，登录端点按
 * `Origin` 校验——三域名不许"顺手合并"。
 * Regions are a first-class concept from day one: separate account systems with
 * separate quotas and different catalog behavior, driven by this data table, not
 * by branch copies. The endpoint table mirrors the official CLI's `realmConfig`:
 * CN's API host and web origin are deliberately different domains and the login
 * endpoints check `Origin` — never "tidy" the three domains into one.
 *
 * 证据：docs/workbuddy-protocol.cn.md §0；卷宗 dsh-workbuddy-oauth/src/region.ts。
 * Evidence: docs/workbuddy-protocol.md §0; dossier dsh-workbuddy-oauth/src/region.ts.
 *
 * @module @veren/workbuddy-protocol/region
 */

/** 凭据所属的 WorkBuddy 部署。Which WorkBuddy deployment a credential belongs to. */
export type WorkBuddyRegion = 'cn' | 'global'

/** 一个区域的全部上游端点与线路怪癖。All upstream endpoints and wire quirks of one region. */
export interface RegionProfile {
  /** API base：chat / catalog / refresh 挂在这里。API base: chat, catalog and refresh hang off this. */
  readonly base: string
  /** Web origin：计费端点与 billing 头的 Origin/Referer。Web origin: billing endpoint and its Origin/Referer headers. */
  readonly billingOrigin: string
  /**
   * OAuth 登录 base。与 base 是两个 host：state 按 host 隔离，state 在哪个
   * host 签发，授权页与该 state 的一切后续调用就必须在哪个 host。
   * OAuth login base. Deliberately a different host from `base`: states are
   * host-scoped — the page a state is issued for, and every follow-up call for
   * that state, live on one host.
   */
  readonly loginBase: string
  /** 登录/刷新请求的 Origin/Referer（上游校验它）。Origin/Referer for login and refresh calls (the upstream validates it). */
  readonly origin: string
  /** 刷新来源判别头：cn=`workbuddy`、global=`plugin`，发错上游可见。The refresh-source discriminator: cn=`workbuddy`, global=`plugin`; wrong values are visible upstream. */
  readonly refreshSource: string
  /** Accept-Language。Accept-Language header. */
  readonly acceptLanguage: string
  /** chat User-Agent 的产品段（国际版带空格：`WorkBuddy AI`）。The chat User-Agent product token (international carries a space). */
  readonly chatProduct: string
  /** 人类可读标签。Human label for status output. */
  readonly label: string
}

/** 区域表：两行数据，没有分支。The region table: two rows of data, no branches. */
export const REGION_PROFILES: Readonly<Record<WorkBuddyRegion, RegionProfile>> = {
  cn: {
    base: 'https://copilot.tencent.com',
    billingOrigin: 'https://www.codebuddy.cn',
    loginBase: 'https://www.workbuddy.cn',
    origin: 'https://www.codebuddy.cn',
    refreshSource: 'workbuddy',
    acceptLanguage: 'zh-CN',
    chatProduct: 'WorkBuddy',
    label: 'WorkBuddy (国内版)',
  },
  global: {
    base: 'https://www.workbuddy.ai',
    billingOrigin: 'https://www.workbuddy.ai',
    loginBase: 'https://www.workbuddy.ai',
    origin: 'https://www.workbuddy.ai',
    refreshSource: 'plugin',
    acceptLanguage: 'en-US',
    chatProduct: 'WorkBuddy AI',
    label: 'WorkBuddy AI (国际版)',
  },
}

/** 便利读取。Convenience accessor. */
export function regionProfile(region: WorkBuddyRegion): RegionProfile {
  return REGION_PROFILES[region]
}

/** 全部区域，供状态输出遍历。Both regions, for iteration in status output. */
export const ALL_REGIONS: readonly WorkBuddyRegion[] = ['cn', 'global'] as const

/**
 * 从凭据的 `domain` 字段推断区域。上游返回裸域名（如 `workbuddy.ai`），按后缀
 * 匹配而非全等。默认 cn：domain 缺失时国内版是唯一被实测过的降级面。
 * Infer the region from a credential's `domain` field. The upstream returns a
 * bare domain (e.g. `workbuddy.ai`), so this matches on the suffix. Defaults to
 * cn: with a missing domain the CN service is the only downgrade ever measured.
 */
export function regionOfDomain(domain: string): WorkBuddyRegion {
  const normalized = domain.trim().toLowerCase()
  return normalized === 'workbuddy.ai' || normalized.endsWith('.workbuddy.ai') ? 'global' : 'cn'
}
